from datetime import datetime

from flask import Blueprint, current_app, jsonify, request, session, url_for

from app.models.audit_model import AuditLog
from app.models.database import db
from app.models.exam_model import ExamEnrollment, ExamSet, Question
from app.models.result_model import QuestionMark, Result
from app.models.submission_model import Answer, StudentSession
from app.models.user_model import User
from app.services.autosave_service import AutoSaveService
from app.services.code_execution_service import CodeExecutionService
from app.services.exam_service import ExamService
from app.services.exam_session_guard import ExamSessionGuard, LOCKED_SESSION_STATUSES, MUTABLE_SESSION_STATUS
from app.services.notification_service import NotificationService
from app.services.result_service import ResultService
from app.services.security_service import SecurityService
from app.services.settings_service import SettingsService
from app.socketio.realtime_events import emit_to_proctors, emit_to_session
from app.utils.network import get_client_ip
from app.utils.rate_limiter import rate_limit

api_bp = Blueprint("api", __name__, url_prefix="/api")


def _settings_payload(settings):
    if not settings:
        return {}
    return {
        "platform_name": settings.platform_name,
        "welcome_message": settings.welcome_message,
        "announcement_message": getattr(settings, "announcement_message", None),
        "student_self_registration": settings.student_self_registration,
        "max_violations_before_alert": settings.max_violations_before_alert,
    }


def _forbidden_session_response(message="Unauthorized exam session", redirect=None, status_code=403):
    payload = {"ok": False, "message": message}
    if redirect:
        payload["redirect"] = redirect
    return jsonify(payload), status_code


def _get_student_session(session_code):
    return StudentSession.query.filter_by(session_code=session_code).first_or_404()


def _get_json_payload():
    payload = request.get_json(silent=True)
    return payload if isinstance(payload, dict) else {}


def _submitted_redirect(session_code):
    return f"/student/submitted/{session_code}"


def _active_elsewhere_redirect(session_code):
    return f"/student/session-active/{session_code}"


def _locked_session_response(student_session):
    return _forbidden_session_response(
        "This exam attempt is already locked.",
        redirect=_submitted_redirect(student_session.session_code),
    )


def _window_lock_response(student_session):
    return _forbidden_session_response(
        "This exam is already open in another tab or device.",
        redirect=_active_elsewhere_redirect(student_session.session_code),
        status_code=409,
    )


def _require_attempt(session_code, payload=None, require_active=False, require_window=False, allowed_statuses=None):
    student_session = _get_student_session(session_code)
    payload = payload or {}

    if not ExamSessionGuard.request_owns_attempt(student_session, payload):
        return None, _forbidden_session_response()

    if require_active:
        time_state = ExamService.enforce_time_window(student_session)
        if time_state == "ended":
            return None, _locked_session_response(student_session)
        if time_state == "not_started":
            return None, _forbidden_session_response(
                "This exam has not opened yet.",
                redirect=f"/student/waiting/{student_session.session_code}",
            )

    allowed_statuses = allowed_statuses or {MUTABLE_SESSION_STATUS}
    if require_active and student_session.status not in allowed_statuses:
        return None, _locked_session_response(student_session)

    if require_window and not ExamSessionGuard.request_window_owns_attempt(student_session, payload):
        return None, _window_lock_response(student_session)

    return student_session, None


def _parse_int_field(payload, field_name):
    value = payload.get(field_name)
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _iso_datetime(value):
    return value.isoformat() if value else None


def _student_exam_window_payload(exam, student_session=None, now=None):
    now = now or datetime.utcnow()
    time_state = None
    if student_session and student_session.status not in LOCKED_SESSION_STATUSES:
        time_state = ExamService.enforce_time_window(student_session)
    elif exam.has_ended(now):
        time_state = "ended"
    elif not exam.has_started(now):
        time_state = "not_started"
    else:
        time_state = "open"

    return {
        "time_state": time_state,
        "is_open": exam.is_open_for_student(now),
        "has_started": exam.has_started(now),
        "has_ended": exam.has_ended(now),
        "seconds_until_start": max(int((exam.start_time - now).total_seconds()), 0) if exam.start_time else 0,
        "seconds_until_end": max(int((exam.end_time - now).total_seconds()), 0) if exam.end_time else None,
    }


def _student_exam_action_payload(exam, student_session, attempts_remaining, window):
    locked = bool(student_session and student_session.status in LOCKED_SESSION_STATUSES)
    no_attempts_left = attempts_remaining == 0

    if locked and no_attempts_left:
        return {
            "label": "View submission",
            "href": url_for("student.submitted", session_code=student_session.session_code),
            "method": "get",
            "variant": "secondary",
            "disabled": False,
        }

    if exam.status == "closed" or window.get("has_ended"):
        return {
            "label": "Closed",
            "href": None,
            "method": "get",
            "variant": "secondary",
            "disabled": True,
        }

    if student_session and student_session.status in {"active", "paused"} and window.get("is_open"):
        return {
            "label": "Resume",
            "href": f"/react/exam/{student_session.session_code}",
            "method": "get",
            "variant": "primary",
            "disabled": False,
        }

    if locked:
        label = "Start next attempt"
    elif exam.status == "active" and window.get("is_open"):
        label = "Resume" if student_session else "Start exam"
    else:
        label = "Join waiting room"

    return {
        "label": label,
        "ready_label": "Start exam" if exam.status == "active" else label,
        "href": url_for("student.start_assigned_exam", exam_id=exam.id),
        "method": "post",
        "variant": "primary",
        "disabled": False,
    }


def _require_teacher_owner(exam_id=None, student_session=None):
    teacher_id = session.get("teacher_id")
    if session.get("role") != "teacher" or not teacher_id:
        return None, (jsonify({"ok": False, "message": "Teacher login required"}), 401)

    if student_session:
        exam = student_session.exam_set
    else:
        exam = ExamSet.query.get_or_404(exam_id)

    if exam.created_by != teacher_id:
        return None, (jsonify({"ok": False, "message": "You do not have permission to view this exam."}), 403)
    return exam, None


def _question_payload(question):
    return {
        "id": question.id,
        "question_number": question.question_number,
        "question_text": question.question_text,
        "question_type": question.question_type,
        "marks": question.marks,
        "options": question.options_as_list(),
        "correct_answer": question.correct_answer,
        "explanation": question.explanation,
        "model_answer": question.model_answer,
        "image_urls": [url_for("static", filename=path) for path in question.image_paths_as_list()],
        "code_snippet": question.code_snippet,
        "code_language": question.code_language or "python",
    }


def _session_review_summary(student_session):
    result = student_session.result
    return {
        "id": student_session.id,
        "session_code": student_session.session_code,
        "student_name": student_session.student_name,
        "roll_no": student_session.roll_no,
        "status": student_session.status,
        "focus_violations": student_session.focus_violations,
        "started_at": _iso_datetime(student_session.start_time),
        "submitted_at": _iso_datetime(student_session.submitted_at),
        "result": {
            "total_marks_obtained": result.total_marks_obtained,
            "total_marks": result.total_marks,
            "percentage": result.percentage,
            "published": result.published,
            "published_at": _iso_datetime(result.published_at),
        }
        if result
        else None,
        "links": {
            "review": f"/react/teacher/session/{student_session.id}/review",
            "flask_review": url_for("teacher.student_view", session_id=student_session.id),
            "answer_pdf": url_for("teacher.student_answer_pdf", session_id=student_session.id),
        },
    }


@api_bp.route("/bootstrap")
def bootstrap():
    settings = SettingsService.get_settings()
    user_id = session.get("user_id")
    role = session.get("role")
    return jsonify(
        {
            "ok": True,
            "settings": _settings_payload(settings),
            "auth": {
                "role": role,
                "user_id": user_id,
                "admin_name": session.get("admin_name"),
                "teacher_name": session.get("teacher_name"),
                "student_name": session.get("student_name"),
                "roll_no": session.get("roll_no"),
            },
            "notifications": {
                "unread_count": NotificationService.unread_count_for_user(user_id),
                "recent": [
                    {
                        "id": item.id,
                        "type": item.notification_type,
                        "message": item.message,
                        "created_at": item.created_at.isoformat(),
                    }
                    for item in NotificationService.unread_for_user(user_id, limit=6)
                ],
            },
        }
    )


@api_bp.route("/student/dashboard")
def student_dashboard_api():
    if session.get("role") != "student" or not session.get("roll_no"):
        return jsonify({"ok": False, "message": "Student login required"}), 401

    roll_no = (session.get("roll_no") or "").strip().upper()
    now = datetime.utcnow()
    enrollments = (
        ExamEnrollment.query.filter(db.func.upper(ExamEnrollment.roll_no) == roll_no)
        .join(ExamSet)
        .order_by(ExamSet.created_at.desc())
        .all()
    )
    settings = SettingsService.get_settings()
    cards = []
    stats = {
        "assigned": 0,
        "available": 0,
        "upcoming": 0,
        "submitted": 0,
        "published_results": 0,
    }
    for enrollment in enrollments:
        exam = enrollment.exam_set
        latest_session = (
            StudentSession.query.filter(
                StudentSession.exam_set_id == exam.id,
                db.func.upper(StudentSession.roll_no) == roll_no,
            )
            .order_by(StudentSession.created_at.desc())
            .first()
        )
        attempts_remaining = ExamService.attempts_remaining(exam.id, roll_no)
        window = _student_exam_window_payload(exam, latest_session, now=now)
        action = _student_exam_action_payload(exam, latest_session, attempts_remaining, window)
        published_result = (
            latest_session.result
            if latest_session and latest_session.result and latest_session.result.published
            else None
        )

        stats["assigned"] += 1
        if window["is_open"] and exam.status == "active":
            stats["available"] += 1
        if window["time_state"] == "not_started":
            stats["upcoming"] += 1
        if latest_session and latest_session.status in LOCKED_SESSION_STATUSES:
            stats["submitted"] += 1
        if published_result:
            stats["published_results"] += 1

        cards.append(
            {
                "exam_id": exam.id,
                "exam_name": exam.exam_name,
                "subject": exam.subject,
                "set_code": exam.set_code,
                "status": exam.status,
                "start_time": _iso_datetime(exam.start_time),
                "end_time": _iso_datetime(exam.end_time),
                "duration_minutes": exam.duration_minutes,
                "extra_time_minutes": enrollment.extra_time_minutes or 0,
                "effective_duration_minutes": exam.duration_minutes + int(enrollment.extra_time_minutes or 0),
                "total_marks": exam.total_marks,
                "question_count": len(exam.questions),
                "attempt_limit": exam.attempt_limit,
                "attempt_count": ExamService.attempt_count(exam.id, roll_no),
                "attempts_remaining": attempts_remaining,
                "window": window,
                "action": action,
                "latest_session": {
                    "session_code": latest_session.session_code,
                    "status": latest_session.status,
                    "remaining_seconds": ExamService.remaining_seconds_for_session(latest_session),
                    "focus_violations": latest_session.focus_violations,
                    "submitted_at": _iso_datetime(latest_session.submitted_at),
                }
                if latest_session
                else None,
                "result": {
                    "total_marks_obtained": published_result.total_marks_obtained,
                    "total_marks": published_result.total_marks,
                    "percentage": published_result.percentage,
                    "published_at": _iso_datetime(published_result.published_at),
                    "href": url_for("student.submitted", session_code=latest_session.session_code),
                    "pdf_href": url_for("student.result_pdf", session_code=latest_session.session_code),
                }
                if published_result
                else None,
            }
        )

    hour = datetime.now().hour
    if hour < 12:
        greeting = "Good morning"
    elif hour < 17:
        greeting = "Good afternoon"
    else:
        greeting = "Good evening"

    return jsonify(
        {
            "ok": True,
            "student": {"name": session.get("student_name"), "roll_no": roll_no, "greeting": greeting},
            "quote": SettingsService.random_quote(settings),
            "announcement_message": settings.announcement_message if settings else None,
            "server_time": _iso_datetime(now),
            "stats": stats,
            "exams": cards,
            "links": {
                "join_exam": url_for("student.join_exam"),
                "results": url_for("student.results"),
                "dashboard": url_for("student.dashboard"),
            },
        }
    )


@api_bp.route("/teacher/dashboard")
def teacher_dashboard_api():
    teacher_id = session.get("teacher_id")
    if session.get("role") != "teacher" or not teacher_id:
        return jsonify({"ok": False, "message": "Teacher login required"}), 401

    exams = ExamSet.query.filter_by(created_by=teacher_id).order_by(ExamSet.created_at.desc()).all()
    return jsonify(
        {
            "ok": True,
            "teacher": {"id": teacher_id, "name": session.get("teacher_name")},
            "exams": [
                {
                    "id": exam.id,
                    "exam_name": exam.exam_name,
                    "subject": exam.subject,
                    "set_code": exam.set_code,
                    "status": exam.status,
                    "total_marks": exam.total_marks,
                    "duration_minutes": exam.duration_minutes,
                    "question_count": len(exam.questions),
                    "session_count": len(exam.sessions),
                    "review_url": f"/react/teacher/exam/{exam.id}/review",
                    "flask_results_url": url_for("teacher.exam_results", exam_id=exam.id),
                }
                for exam in exams
            ],
        }
    )


@api_bp.route("/teacher/exam/<int:exam_id>/review")
def teacher_exam_review_api(exam_id):
    exam, error_response = _require_teacher_owner(exam_id=exam_id)
    if error_response:
        return error_response

    sessions = (
        StudentSession.query.filter_by(exam_set_id=exam.id)
        .order_by(StudentSession.created_at.desc())
        .all()
    )
    questions = Question.query.filter_by(exam_set_id=exam.id).order_by(Question.question_number.asc()).all()
    evaluated_count = sum(1 for student_session in sessions if student_session.result)
    published_count = sum(
        1 for student_session in sessions if student_session.result and student_session.result.published
    )
    locked_count = sum(1 for student_session in sessions if student_session.status in LOCKED_SESSION_STATUSES)

    return jsonify(
        {
            "ok": True,
            "exam": {
                "id": exam.id,
                "exam_name": exam.exam_name,
                "subject": exam.subject,
                "set_code": exam.set_code,
                "status": exam.status,
                "access_code": exam.access_code,
                "total_marks": exam.total_marks,
                "duration_minutes": exam.duration_minutes,
            },
            "stats": {
                "attempts": len(sessions),
                "submitted": locked_count,
                "evaluated": evaluated_count,
                "published": published_count,
                "pending_review": max(locked_count - evaluated_count, 0),
            },
            "questions": [_question_payload(question) for question in questions],
            "sessions": [_session_review_summary(student_session) for student_session in sessions],
            "links": {
                "csv_export": url_for("teacher.export_exam_results", exam_id=exam.id),
                "similarity": url_for("teacher.similarity_report", exam_id=exam.id),
                "flask_results": url_for("teacher.exam_results", exam_id=exam.id),
            },
        }
    )


@api_bp.route("/teacher/exam/<int:exam_id>/publish-results", methods=["POST"])
def teacher_publish_exam_results_api(exam_id):
    exam, error_response = _require_teacher_owner(exam_id=exam_id)
    if error_response:
        return error_response

    payload = _get_json_payload()
    publish = bool(payload.get("publish"))
    sessions = StudentSession.query.filter_by(exam_set_id=exam.id).all()
    changed_count = 0

    for student_session in sessions:
        result = student_session.result
        if not result:
            continue
        result.published = publish
        result.published_at = datetime.utcnow() if publish else None
        if publish:
            student = User.query.filter(
                User.role == "student",
                db.func.upper(User.roll_number) == (student_session.roll_no or "").upper(),
            ).first()
            if student:
                NotificationService.notify_user(
                    student.id,
                    f"Results published for {exam.exam_name}.",
                    notification_type="result_published",
                    related_entity_type="exam",
                    related_entity_id=exam.id,
                )
        changed_count += 1

    db.session.commit()
    return jsonify({"ok": True, "changed": changed_count, "published": publish})


@api_bp.route("/teacher/session/<int:session_id>/review", methods=["GET", "POST"])
def teacher_session_review_api(session_id):
    student_session = StudentSession.query.get_or_404(session_id)
    exam, error_response = _require_teacher_owner(student_session=student_session)
    if error_response:
        return error_response

    questions = Question.query.filter_by(exam_set_id=student_session.exam_set_id).order_by(Question.question_number.asc()).all()
    answers = Answer.query.filter_by(session_id=student_session.id).all()
    answer_by_question = {answer.question_id: answer for answer in answers}
    result = Result.query.filter_by(session_id=student_session.id).first()

    if request.method == "POST":
        if student_session.status not in LOCKED_SESSION_STATUSES:
            return jsonify({"ok": False, "message": "Marks can be saved after the student submits."}), 409

        payload = _get_json_payload()
        marks_items = payload.get("marks")
        if not isinstance(marks_items, list):
            return jsonify({"ok": False, "message": "Marks payload must be a list."}), 400

        marks_by_question = {int(item.get("question_id")): item for item in marks_items if item.get("question_id")}
        total_obtained = 0
        total_possible = sum(question.marks for question in questions)
        clean_marks = {}
        clean_remarks = {}

        for question in questions:
            item = marks_by_question.get(question.id, {})
            try:
                marks_awarded = int(item.get("marks_awarded", 0) or 0)
            except (TypeError, ValueError):
                return jsonify({"ok": False, "message": f"Q{question.question_number} marks must be a number."}), 400
            if marks_awarded < 0 or marks_awarded > question.marks:
                return (
                    jsonify(
                        {
                            "ok": False,
                            "message": f"Q{question.question_number} marks must be between 0 and {question.marks}.",
                        }
                    ),
                    400,
                )
            clean_marks[question.id] = marks_awarded
            clean_remarks[question.id] = (item.get("teacher_remark") or "").strip()
            total_obtained += marks_awarded

        if not result:
            result = Result(session_id=student_session.id)
            db.session.add(result)
            db.session.flush()
        else:
            QuestionMark.query.filter_by(result_id=result.id).delete()

        result.total_marks = total_possible
        result.total_marks_obtained = total_obtained
        result.teacher_remarks = (payload.get("teacher_remarks") or "").strip()
        result.evaluated_by = session.get("teacher_id")
        result.published = bool(payload.get("published"))
        result.published_at = datetime.utcnow() if result.published else None
        result.calculate_percentage()

        for question in questions:
            db.session.add(
                QuestionMark(
                    result_id=result.id,
                    question_id=question.id,
                    marks_awarded=clean_marks[question.id],
                    teacher_remark=clean_remarks[question.id],
                )
            )

        student_session.status = "evaluated"
        if result.published:
            student = User.query.filter(
                User.role == "student",
                db.func.upper(User.roll_number) == (student_session.roll_no or "").upper(),
            ).first()
            if student:
                NotificationService.notify_user(
                    student.id,
                    f"Results published for {exam.exam_name}.",
                    notification_type="result_published",
                    related_entity_type="student_session",
                    related_entity_id=student_session.id,
                )
        db.session.commit()
        result = Result.query.filter_by(session_id=student_session.id).first()

    marks_by_question = {}
    if result:
        marks_by_question = {question_mark.question_id: question_mark for question_mark in result.question_marks}

    review_questions = []
    for question in questions:
        answer = answer_by_question.get(question.id)
        question_mark = marks_by_question.get(question.id)
        review_questions.append(
            {
                **_question_payload(question),
                "answer": {
                    "answer_text": answer.answer_text if answer else "",
                    "code_output": answer.code_output if answer else "",
                    "execution_status": answer.execution_status if answer else None,
                    "execution_time_ms": answer.execution_time_ms if answer else None,
                    "saved_at": _iso_datetime(answer.saved_at) if answer else None,
                },
                "mark": {
                    "marks_awarded": question_mark.marks_awarded if question_mark else 0,
                    "teacher_remark": question_mark.teacher_remark if question_mark else "",
                },
            }
        )

    return jsonify(
        {
            "ok": True,
            "exam": {
                "id": exam.id,
                "exam_name": exam.exam_name,
                "subject": exam.subject,
                "set_code": exam.set_code,
                "total_marks": exam.total_marks,
            },
            "student_session": _session_review_summary(student_session),
            "locked_for_review": student_session.status in LOCKED_SESSION_STATUSES,
            "teacher_remarks": result.teacher_remarks if result else "",
            "published": bool(result.published) if result else False,
            "questions": review_questions,
            "links": {
                "exam_review": f"/react/teacher/exam/{exam.id}/review",
                "answer_pdf": url_for("teacher.student_answer_pdf", session_id=student_session.id),
                "flask_review": url_for("teacher.student_view", session_id=student_session.id),
            },
        }
    )


@api_bp.route("/admin/dashboard")
def admin_dashboard_api():
    if session.get("role") != "admin" or not session.get("admin_id"):
        return jsonify({"ok": False, "message": "Admin login required"}), 401

    return jsonify(
        {
            "ok": True,
            "stats": {
                "total_users": User.query.count(),
                "total_students": User.query.filter_by(role="student").count(),
                "total_teachers": User.query.filter_by(role="teacher").count(),
                "total_exams": ExamSet.query.count(),
                "active_exams": ExamSet.query.filter_by(status="active").count(),
                "submitted_sessions": StudentSession.query.filter(
                    StudentSession.status.in_(["submitted", "evaluated", "terminated", "auto_submitted"])
                ).count(),
                "published_results": Result.query.filter_by(published=True).count(),
            },
        }
    )


@api_bp.route("/notifications/mark-read", methods=["POST"])
def mark_notifications_read():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"ok": False, "message": "Not logged in"}), 401
    count = NotificationService.mark_user_notifications_read(user_id)
    return jsonify({"ok": True, "read": count})


@api_bp.route("/student/session/<session_code>/status")
def session_status(session_code):
    student_session, error_response = _require_attempt(session_code)
    if error_response:
        return error_response

    exam = student_session.exam_set
    time_state = ExamService.enforce_time_window(student_session)

    remaining_seconds = ExamService.remaining_seconds_for_session(student_session)
    is_locked = ExamSessionGuard.is_locked(student_session)

    return jsonify(
        {
            "ok": True,
            "exam_status": exam.status,
            "session_status": student_session.status,
            "time_state": time_state,
            "remaining_seconds": remaining_seconds,
            "focus_violations": student_session.focus_violations,
            "max_violations_allowed": SettingsService.max_violations_allowed(),
            "suspicion_score": getattr(student_session, "suspicion_score", 0),
            "pause_requested": bool(student_session.pause_requested_at),
            "pause_reason": student_session.pause_reason,
            "paused": student_session.status == "paused",
            "submitted": is_locked,
            "redirect": _submitted_redirect(session_code) if is_locked else None,
        }
    )


@api_bp.route("/student/session/<session_code>/exam-state")
def exam_state(session_code):
    student_session = _get_student_session(session_code)
    if not ExamSessionGuard.browser_owns_attempt(student_session):
        return _forbidden_session_response()

    exam = student_session.exam_set
    time_state = ExamService.enforce_time_window(student_session)
    if ExamSessionGuard.is_locked(student_session) or time_state == "ended":
        return _locked_session_response(student_session)
    if exam.status != "active" or time_state == "not_started":
        return _forbidden_session_response(
            "This exam has not opened yet.",
            redirect=url_for("student.waiting", session_code=session_code),
        )
    if not student_session.start_time:
        return _forbidden_session_response(
            "Please complete the pre-exam checklist first.",
            redirect=url_for("student.precheck", session_code=session_code, ui="react"),
        )
    if student_session.status not in {"active", "paused"}:
        return _forbidden_session_response("This exam attempt is not active.")

    questions = ExamService.get_session_questions(student_session)
    answers = Answer.query.filter_by(session_id=student_session.id).all()
    answers_by_question = {answer.question_id: answer for answer in answers}

    question_payloads = []
    status_counts = {state: 0 for state in AutoSaveService.VALID_VISIT_STATUSES}
    for question in questions:
        answer = answers_by_question.get(question.id)
        visit_status = (
            answer.visit_status
            if answer and answer.visit_status in AutoSaveService.VALID_VISIT_STATUSES
            else "ANSWERED"
            if answer and (answer.answer_text or "").strip()
            else "NOT_VISITED"
        )
        status_counts[visit_status] = status_counts.get(visit_status, 0) + 1
        question_payloads.append(
            {
                "id": question.id,
                "question_number": question.question_number,
                "question_text": question.question_text,
                "question_type": question.question_type,
                "marks": question.marks,
                "options": question.options_as_list(),
                "image_urls": [url_for("static", filename=path) for path in question.image_paths_as_list()],
                "code_snippet": question.code_snippet,
                "code_language": question.code_language or "python",
                "time_limit_seconds": question.time_limit_seconds or 0,
                "answer": {
                    "answer_text": answer.answer_text if answer else "",
                    "code_output": answer.code_output if answer else "",
                    "execution_status": answer.execution_status if answer else None,
                    "execution_time_ms": answer.execution_time_ms if answer else None,
                    "visit_status": visit_status,
                    "question_time_expired": bool(answer and answer.question_time_expired),
                    "question_expires_at": _iso_datetime(answer.question_expires_at) if answer else None,
                    "saved_at": _iso_datetime(answer.saved_at) if answer else None,
                },
            }
        )

    remaining_seconds = ExamService.remaining_seconds_for_session(student_session)
    return jsonify(
        {
            "ok": True,
            "attempt_token": ExamSessionGuard.ensure_token(student_session),
            "max_violations_allowed": SettingsService.max_violations_allowed(),
            "remaining_seconds": remaining_seconds,
            "status_counts": status_counts,
            "exam": {
                "id": exam.id,
                "exam_name": exam.exam_name,
                "subject": exam.subject,
                "set_code": exam.set_code,
                "duration_minutes": exam.duration_minutes,
                "total_marks": exam.total_marks,
                "start_time": _iso_datetime(exam.start_time),
                "end_time": _iso_datetime(exam.end_time),
            },
            "student_session": {
                "id": student_session.id,
                "session_code": student_session.session_code,
                "student_name": student_session.student_name,
                "roll_no": student_session.roll_no,
                "status": student_session.status,
                "extra_time_minutes": student_session.extra_time_minutes,
                "focus_violations": student_session.focus_violations,
                "submitted_url": url_for("student.submitted", session_code=session_code),
            },
            "questions": question_payloads,
        }
    )


@api_bp.route("/student/session/<session_code>/window-lock", methods=["POST"])
@rate_limit("heartbeat")
def acquire_window_lock(session_code):
    data = _get_json_payload()
    student_session, error_response = _require_attempt(session_code, data, require_active=True)
    if error_response:
        return error_response

    window_token = ExamSessionGuard.request_window_token(data)
    if not ExamSessionGuard.acquire_window_lock(student_session, window_token):
        return _window_lock_response(student_session)

    return jsonify({"ok": True, "message": "Exam window locked"})


@api_bp.route("/student/session/<session_code>/save", methods=["POST"])
@rate_limit("autosave")
def save_answer(session_code):
    """Autosave answer using service"""
    data = _get_json_payload()
    student_session, error_response = _require_attempt(
        session_code,
        data,
        require_active=True,
        require_window=True,
    )
    if error_response:
        return error_response

    question_id = _parse_int_field(data, "question_id")
    answer_text = (data.get("answer_text", "") or "").strip()
    visit_status = data.get("visit_status")

    if question_id is None:
        return jsonify({"ok": False, "message": "Valid question_id is required"}), 400

    success, message = AutoSaveService.save_answer(session_code, question_id, answer_text, visit_status=visit_status)

    return jsonify({"ok": success, "message": message}), 200 if success else 400


@api_bp.route("/student/session/<session_code>/question-status", methods=["POST"])
@rate_limit("autosave")
def save_question_status(session_code):
    data = _get_json_payload()
    student_session, error_response = _require_attempt(
        session_code,
        data,
        require_active=True,
        require_window=True,
    )
    if error_response:
        return error_response

    question_id = _parse_int_field(data, "question_id")
    visit_status = data.get("visit_status")

    if question_id is None:
        return jsonify({"ok": False, "message": "Valid question_id is required"}), 400

    success, message = AutoSaveService.save_visit_status(session_code, question_id, visit_status)
    return jsonify({"ok": success, "message": message}), 200 if success else 400


@api_bp.route("/student/session/<session_code>/question-expired", methods=["POST"])
@rate_limit("autosave")
def mark_question_expired(session_code):
    data = _get_json_payload()
    student_session, error_response = _require_attempt(
        session_code,
        data,
        require_active=True,
        require_window=True,
    )
    if error_response:
        return error_response

    question_id = _parse_int_field(data, "question_id")
    if question_id is None:
        return jsonify({"ok": False, "message": "Valid question_id is required"}), 400

    answer_text = (data.get("answer_text", "") or "").strip()
    visit_status = data.get("visit_status")
    if answer_text:
        AutoSaveService.save_answer(session_code, question_id, answer_text, visit_status=visit_status)

    success, message = AutoSaveService.mark_question_expired(session_code, question_id)
    return jsonify({"ok": success, "message": message}), 200 if success else 400


@api_bp.route("/student/session/<session_code>/pause-request", methods=["POST"])
@rate_limit("autosave")
def request_pause(session_code):
    data = _get_json_payload()
    student_session, error_response = _require_attempt(
        session_code,
        data,
        require_active=True,
        require_window=True,
        allowed_statuses={"active"},
    )
    if error_response:
        return error_response

    reason = (data.get("reason") or "").strip()
    if len(reason) < 3:
        return jsonify({"ok": False, "message": "Please enter a short pause reason."}), 400

    ExamService.request_pause(session_code, reason)
    AuditLog(
        user_id=None,
        action="request_exam_pause",
        resource_type="student_session",
        resource_id=student_session.id,
        reason=reason,
        status="success",
        ip_address=get_client_ip(),
        user_agent=request.headers.get("User-Agent"),
    ).save()
    return jsonify({"ok": True, "message": "Pause request sent to admin."})


@api_bp.route("/student/session/<session_code>/execute", methods=["POST"])
@rate_limit("code_execution")
def execute_code(session_code):
    """Run Python code for an authorized coding question."""
    data = _get_json_payload()
    student_session, error_response = _require_attempt(
        session_code,
        data,
        require_active=True,
        require_window=True,
    )
    if error_response:
        return error_response

    question_id = _parse_int_field(data, "question_id")
    code = data.get("code") or ""
    stdin_text = data.get("stdin") or ""

    if question_id is None:
        return jsonify({"ok": False, "message": "Valid question_id is required"}), 400

    question = Question.query.filter_by(id=question_id, exam_set_id=student_session.exam_set_id).first()
    if not question:
        return jsonify({"ok": False, "message": "Question not found for this exam."}), 404
    if question.question_type != "coding":
        return jsonify({"ok": False, "message": "This question is not a coding question."}), 400

    answer = Answer.query.filter_by(session_id=student_session.id, question_id=question.id).first()
    if not answer:
        answer = Answer(session_id=student_session.id, question_id=question.id)
        db.session.add(answer)
    AutoSaveService.ensure_question_timer(answer, question)
    if AutoSaveService.answer_timer_expired(answer):
        answer.question_time_expired = True
        db.session.commit()
        return jsonify({"ok": False, "message": "This question's time limit has expired."}), 403
    if answer.question_time_expired:
        return jsonify({"ok": False, "message": "This question's time limit has expired."}), 403

    result = CodeExecutionService.run_python(
        code=code,
        stdin_text=stdin_text,
        timeout_seconds=current_app.config.get("CODE_EXECUTION_TIMEOUT_SECONDS", 10),
        max_chars=current_app.config.get("CODE_EXECUTION_MAX_CHARS", 12000),
        stdin_max_chars=current_app.config.get("CODE_EXECUTION_STDIN_MAX_CHARS", 4000),
        output_max_chars=current_app.config.get("CODE_EXECUTION_OUTPUT_MAX_CHARS", 8000),
    )

    output_parts = [f"[{result.status.upper()}] {result.message}"]
    if result.stdout:
        output_parts.append(f"STDOUT:\n{result.stdout}")
    if result.stderr:
        output_parts.append(f"STDERR:\n{result.stderr}")

    answer.answer_text = code
    answer.code_output = "\n".join(part for part in output_parts if part)
    answer.execution_status = result.status
    answer.execution_time_ms = result.execution_time_ms
    answer.visit_status = AutoSaveService.normalize_visit_status(data.get("visit_status"), code)
    student_session.last_heartbeat = datetime.utcnow()
    student_session.updated_at = datetime.utcnow()
    db.session.add(
        AuditLog(
            user_id=session.get("student_user_id"),
            action="run_python_code",
            resource_type="student_session",
            resource_id=student_session.id,
            changes=f"question_id={question.id}; status={result.status}; time_ms={result.execution_time_ms}",
            status="success" if result.ok else "warning",
            error_message=result.message if not result.ok else None,
            ip_address=get_client_ip(),
            user_agent=request.headers.get("User-Agent"),
        )
    )
    db.session.commit()

    payload = result.as_dict()
    payload["message"] = result.message
    return jsonify(payload), 200 if result.status in ["success", "error", "timeout", "rejected"] else 400


@api_bp.route("/student/session/<session_code>/heartbeat", methods=["POST"])
@rate_limit("heartbeat")
def heartbeat(session_code):
    """Handle heartbeat and proctoring violations"""
    data = _get_json_payload()
    student_session, error_response = _require_attempt(
        session_code,
        data,
        require_active=True,
        require_window=True,
        allowed_statuses={"active", "paused"},
    )
    if error_response:
        return error_response

    remaining_seconds = ExamService.remaining_seconds_for_session(student_session)

    focused = bool(data.get("focused", True))
    violation_count = _parse_int_field(data, "violation_count")
    violation_count = violation_count if violation_count is not None else 0

    if student_session.status == "active":
        SecurityService.record_heartbeat(session_code, focused, violation_count)
    else:
        student_session.last_heartbeat = datetime.utcnow()
        db.session.commit()

    should_submit = student_session.status == "active" and SecurityService.should_auto_submit(session_code)

    if should_submit and student_session.status == "active":
        ExamService.end_exam(session_code, reason="Auto-submitted due to security violations")

    emit_to_proctors(
        student_session.exam_set_id,
        "proctor:student_status",
        {
            "session_id": student_session.id,
            "student_name": student_session.student_name,
            "roll_no": student_session.roll_no,
            "status": student_session.status,
            "remaining_seconds": remaining_seconds,
            "focus_violations": student_session.focus_violations,
        },
    )

    return jsonify(
        {
            "ok": True,
            "submitted": ExamSessionGuard.is_locked(student_session),
            "session_status": student_session.status,
            "redirect": _submitted_redirect(session_code) if ExamSessionGuard.is_locked(student_session) else None,
            "remaining_seconds": remaining_seconds,
            "focus_violations": student_session.focus_violations,
            "max_violations_allowed": SettingsService.max_violations_allowed(),
            "paused": student_session.status == "paused",
            "pause_requested": bool(student_session.pause_requested_at),
            "pause_reason": student_session.pause_reason,
            "session_messages": NotificationService.pop_unread_session_messages(student_session.id),
            "should_submit": should_submit,
        }
    )


@api_bp.route("/student/session/<session_code>/violation", methods=["POST"])
@rate_limit("violation")
def record_violation(session_code):
    """Record an append-only browser integrity violation."""
    data = _get_json_payload()
    student_session, error_response = _require_attempt(
        session_code,
        data,
        require_active=True,
        require_window=True,
    )
    if error_response:
        return error_response

    violation_type = (data.get("type") or "UNKNOWN").strip()
    detail = (data.get("detail") or "").strip()
    client_count = _parse_int_field(data, "violation_count") or 0

    violation = SecurityService.record_violation(
        session_code=session_code,
        violation_type=violation_type,
        detail=detail,
        client_count=client_count,
        ip_address=get_client_ip(),
        user_agent=request.headers.get("User-Agent"),
    )

    max_violations = SettingsService.max_violations_allowed()
    admin_review_required = student_session.focus_violations >= max_violations
    emit_to_proctors(
        student_session.exam_set_id,
        "proctor:violation_alert",
        {
            "session_id": student_session.id,
            "student_name": student_session.student_name,
            "roll_no": student_session.roll_no,
            "type": violation.violation_type if violation else violation_type,
            "detail": detail,
            "count": student_session.focus_violations,
            "admin_review_required": admin_review_required,
        },
    )

    return jsonify(
        {
            "ok": True,
            "focus_violations": student_session.focus_violations,
            "max_violations_allowed": max_violations,
            "admin_review_required": admin_review_required,
            "message": "Violation recorded",
        }
    )


@api_bp.route("/student/session/<session_code>/submit", methods=["POST"])
@rate_limit("submit")
def submit_session(session_code):
    """Manual or auto exam submission"""
    data = _get_json_payload()
    student_session, error_response = _require_attempt(
        session_code,
        data,
        require_active=True,
        require_window=True,
    )
    if error_response:
        return error_response

    reason = (data.get("reason") or "Manual submission").strip()

    ExamService.end_exam(session_code, reason=reason)
    AuditLog(
        user_id=None,
        action="submit_exam_session",
        resource_type="student_session",
        resource_id=student_session.id,
        reason=reason,
        status="success",
        ip_address=get_client_ip(),
        user_agent=request.headers.get("User-Agent"),
    ).save()

    try:
        ResultService.calculate_result(session_code)
    except Exception:
        current_app.logger.exception("Result calculation failed for session %s", session_code)
        return (
            jsonify(
                {
                    "ok": True,
                    "warning": "Submission saved, but result calculation failed",
                    "redirect": f"/student/submitted/{session_code}",
                }
            ),
            200,
        )

    NotificationService.notify_user(
        student_session.exam_set.created_by,
        f"{student_session.student_name} submitted {student_session.exam_set.exam_name}.",
        notification_type="exam_submitted",
        related_entity_type="student_session",
        related_entity_id=student_session.id,
    )
    db.session.commit()
    emit_to_proctors(
        student_session.exam_set_id,
        "proctor:exam_submitted",
        {
            "session_id": student_session.id,
            "student_name": student_session.student_name,
            "roll_no": student_session.roll_no,
            "status": student_session.status,
        },
    )
    emit_to_session(
        student_session,
        "exam:submitted",
        {"message": "Your exam has been submitted.", "redirect": f"/student/submitted/{session_code}"},
    )

    return jsonify({"ok": True, "redirect": f"/student/submitted/{session_code}"})
