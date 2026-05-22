from datetime import datetime

from flask import Blueprint, current_app, jsonify, request, session

from app.models.audit_model import AuditLog
from app.models.database import db
from app.models.exam_model import Question
from app.models.submission_model import Answer, StudentSession
from app.services.autosave_service import AutoSaveService
from app.services.code_execution_service import CodeExecutionService
from app.services.exam_service import ExamService
from app.services.exam_session_guard import ExamSessionGuard, MUTABLE_SESSION_STATUS
from app.services.notification_service import NotificationService
from app.services.result_service import ResultService
from app.services.security_service import SecurityService
from app.services.settings_service import SettingsService
from app.socketio.realtime_events import emit_to_proctors, emit_to_session
from app.utils.network import get_client_ip
from app.utils.rate_limiter import rate_limit

api_bp = Blueprint("api", __name__, url_prefix="/api")


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
