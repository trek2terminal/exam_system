import json
import os
import random
import re
import secrets
import shutil
import subprocess
from datetime import datetime, timedelta
from difflib import SequenceMatcher

from flask import Blueprint, current_app, jsonify, request, send_file, session, url_for
from sqlalchemy import or_
from werkzeug.utils import secure_filename

from app.models.audit_model import AuditLog, ViolationLog
from app.models.database import db
from app.models.exam_model import ExamEnrollment, ExamSet, Question, QuestionBankItem, generate_access_code
from app.models.group_model import StudentGroup, StudentGroupMember, generate_group_join_code
from app.models.notification_model import Notification
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
from app.socketio.realtime_events import emit_data_changed, emit_to_proctors, emit_to_session
from app.routes.teacher_routes import _save_question_images
from app.utils.export_utils import csv_response, format_datetime
from app.utils.helpers import create_submission_pdf, current_session_matches_user, parse_options
from app.utils.network import get_client_ip
from app.utils.rate_limiter import rate_limit

api_bp = Blueprint("api", __name__, url_prefix="/api")

REALTIME_MUTATION_METHODS = {"POST", "PATCH", "PUT", "DELETE"}
REALTIME_MUTATION_EXCLUDES = (
    "/api/auth/session-status",
    "/api/student/session/",
)
REALTIME_STUDENT_SESSION_ALLOWED_SUFFIXES = (
    "/precheck",
    "/pause-request",
    "/submit",
    "/violation",
)


def _should_emit_realtime_change(response):
    if request.method not in REALTIME_MUTATION_METHODS:
        return False
    if response.status_code >= 400:
        return False
    if not session.get("role"):
        return False

    path = request.path or ""
    if path.startswith("/api/student/session/"):
        return path.endswith(REALTIME_STUDENT_SESSION_ALLOWED_SUFFIXES)
    return not any(path.startswith(prefix) for prefix in REALTIME_MUTATION_EXCLUDES)


@api_bp.after_request
def emit_realtime_mutation(response):
    if not _should_emit_realtime_change(response):
        return response
    try:
        emit_data_changed({
            "role": session.get("role"),
            "user_id": session.get("user_id") or session.get("admin_id") or session.get("teacher_id") or session.get("student_user_id"),
            "method": request.method,
            "path": request.path,
            "resource": request.path.replace("/api/", "", 1).split("/", 1)[0],
            "timestamp": datetime.utcnow().isoformat() + "Z",
        })
    except Exception:
        current_app.logger.exception("Realtime mutation broadcast failed.")
    return response


def _login_page_settings(settings):
    heading = (
        getattr(settings, "login_page_heading", None)
        or SettingsService.DEFAULT_LOGIN_PAGE_HEADING
    ).strip()
    subheading = (
        getattr(settings, "login_page_subheading", None)
        or SettingsService.DEFAULT_LOGIN_PAGE_SUBHEADING
    ).strip()
    features = SettingsService.normalize_login_features(getattr(settings, "login_page_features", None))
    return heading, subheading, features


def _settings_payload(settings):
    if not settings:
        return {}
    logo_path = getattr(settings, "logo_path", None)
    login_heading, login_subheading, login_features = _login_page_settings(settings)
    return {
        "platform_name": settings.platform_name,
        "logo_path": logo_path,
        "logo_url": url_for("static", filename=logo_path) if logo_path else None,
        "welcome_message": settings.welcome_message,
        "announcement_message": getattr(settings, "announcement_message", None),
        "login_page_heading": login_heading,
        "login_page_subheading": login_subheading,
        "login_page_features": login_features,
        "login_heading": login_heading,
        "login_subheading": login_subheading,
        "login_features": login_features,
        "quote_pool": SettingsService.get_quotes(settings),
        "student_self_registration": settings.student_self_registration,
        "registration_code_required": bool(getattr(settings, "registration_code_required", False)),
        "registration_code": getattr(settings, "registration_code", None),
        "max_violations_before_alert": settings.max_violations_before_alert,
        "admin_lockout_count": getattr(settings, "admin_lockout_count", 3),
        "admin_idle_timeout_minutes": getattr(settings, "admin_idle_timeout_minutes", 120),
    }


def _clean_audit_fragment(value):
    if not value:
        return None
    text_value = re.sub(r"\s+", " ", str(value).strip())
    if not text_value:
        return None
    path_like = (
        re.search(r"[A-Za-z]:\\", text_value)
        or "uploads/" in text_value
        or "static/" in text_value
        or re.search(r"\.(db|sqlite|csv|pdf|png|jpg|jpeg|webp|gif)(\b|$)", text_value, re.IGNORECASE)
    )
    if path_like:
        return None
    for separator in (":", ";"):
        if separator in text_value:
            text_value = text_value.split(separator, 1)[1 if separator == ":" else 0].strip()
    return text_value[:140] or None


def _audit_subject(item):
    if item.resource_type == "user" and item.resource_id:
        user = User.query.get(item.resource_id)
        if user:
            return user.name or user.username or user.email
    if item.resource_type in {"exam", "exam_set"} and item.resource_id:
        exam = ExamSet.query.get(item.resource_id)
        if exam:
            return exam.exam_name
    if item.resource_type in {"student_session", "session"} and item.resource_id:
        student_session = StudentSession.query.get(item.resource_id)
        if student_session:
            return student_session.student_name or student_session.roll_no or student_session.session_code
    return _clean_audit_fragment(item.changes)


def _audit_exam_title(item):
    if item.resource_type in {"exam", "exam_set"} and item.resource_id:
        exam = ExamSet.query.get(item.resource_id)
        return exam.exam_name if exam else None
    if item.resource_type in {"student_session", "session"} and item.resource_id:
        student_session = StudentSession.query.get(item.resource_id)
        if student_session and student_session.exam_set:
            return student_session.exam_set.exam_name
    return _clean_audit_fragment(item.changes)


def _humanize_audit_action(action):
    clean_action = (action or "activity").replace("_api", "").replace("_", " ").strip()
    return clean_action[:1].upper() + clean_action[1:]


def _audit_formatted_message(item):
    action = item.action or ""
    subject = _audit_subject(item)
    exam_title = _audit_exam_title(item)

    if action in {"update_platform_logo", "upload_platform_logo"}:
        return "Platform logo was updated"
    if action in {"remove_platform_logo", "delete_platform_logo"}:
        return "Platform logo was removed"
    if action in {"create_teacher", "create_user", "create_user_api"}:
        return f"New teacher account created: {subject}" if subject else "New teacher account created"
    if action in {"deactivate_user", "delete_user", "toggle_user_status", "soft_delete_user_api"}:
        return f"User account deactivated: {subject}" if subject else "User account deactivated"
    if action in {"terminate_exam", "terminate_exam_session"}:
        return f"Exam terminated for student: {subject}" if subject else "Exam was terminated for a student"
    if action in {"second_chance", "grant_second_chance"}:
        return f"Second chance granted to: {subject}" if subject else "Second chance was granted"
    if action in {"reduce_time", "reduce_exam_time"}:
        return f"Exam time reduced for: {subject}" if subject else "Exam time was reduced"
    if action in {"backup_database", "backup_database_api"}:
        return "Database backup was downloaded"
    if action == "update_admin_account":
        return "Admin account details updated"
    if action in {"publish_results", "publish_results_api"}:
        return f"Results published for exam: {exam_title}" if exam_title else "Results were published"
    if action in {"student_submit", "submit_exam_session"}:
        return f"Student submitted exam: {exam_title}" if exam_title else "Student submitted an exam"
    if action in {"code_execution", "run_python_code"}:
        return f"Code executed by: {subject}" if subject else "Code was executed"
    if action in {"update_platform_settings", "update_platform_settings_api"}:
        return "Platform settings were updated"
    return _humanize_audit_action(action)


def _audit_payload(item):
    actor_name = item.user.name if item.user else "System"
    formatted_message = _audit_formatted_message(item)
    return {
        "id": item.id,
        "action": item.action,
        "action_type": item.action,
        "formatted_message": formatted_message,
        "description": formatted_message,
        "resource_type": item.resource_type,
        "resource_id": item.resource_id,
        "status": item.status,
        "user": actor_name,
        "actor_name": actor_name,
        "timestamp": _iso_datetime(item.created_at),
        "ip_address": item.ip_address,
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
    return f"/react/student/submitted/{session_code}"


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
    student_user_id = session.get("student_user_id")
    if student_user_id:
        student_user = User.query.get(student_user_id)
        if (
            not student_user
            or student_user.role != "student"
            or not student_user.is_active
            or not current_session_matches_user(student_user)
        ):
            session.clear()
            return None, _forbidden_session_response(
                "This student account is active in another browser. Please log in again here.",
                status_code=401,
            )

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
                redirect=f"/react/student/waiting/{student_session.session_code}",
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


def _strong_password(password):
    password = password or ""
    return (
        len(password) >= 10
        and any(char.isupper() for char in password)
        and any(char.islower() for char in password)
        and any(char.isdigit() for char in password)
    )


def _valid_student_password(password):
    password = password or ""
    return (
        len(password) >= 8
        and any(char.isupper() for char in password)
        and any(char.isdigit() for char in password)
        and any(char in "!@#$%^&*" for char in password)
    )


def _valid_username(username):
    username = (username or "").strip()
    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-@")
    return 4 <= len(username) <= 50 and all(char in allowed for char in username)


def _admin_lockout_limit():
    try:
        return min(max(int(getattr(SettingsService.get_settings(), "admin_lockout_count", 3) or 3), 1), 10)
    except Exception:
        return 3


def _admin_idle_timeout_seconds():
    try:
        minutes = int(getattr(SettingsService.get_settings(), "admin_idle_timeout_minutes", 120) or 120)
    except Exception:
        minutes = 120
    return min(max(minutes, 5), 24 * 60) * 60


def _has_live_session_conflict(user):
    if not user or not user.active_session_token or not user.active_session_started_at:
        return False

    max_age_seconds = _admin_idle_timeout_seconds() if user.role == "admin" else 24 * 60 * 60
    age_seconds = (datetime.utcnow() - user.active_session_started_at).total_seconds()
    return age_seconds <= max_age_seconds


def _session_conflict_payload(conflict):
    if not conflict:
        return {"session_conflict": False}
    return {
        "session_conflict": True,
        "conflict_message": "Another session was active on a different device. It has been signed out.",
    }


def _row_payload_value(row, *names):
    lowered = {str(key).strip().lower(): value for key, value in (row or {}).items()}
    for name in names:
        value = lowered.get(name)
        if value not in (None, ""):
            return str(value).strip()
    return ""


def _user_payload(user):
    return {
        "id": user.id,
        "name": user.name,
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "roll_number": user.roll_number,
        "is_active": bool(user.is_active),
        "is_verified": bool(user.is_verified),
        "department": user.department,
        "designation": user.designation,
        "profile_picture": url_for("static", filename=user.profile_picture) if user.profile_picture else None,
        "last_login": _iso_datetime(user.last_login),
        "created_at": _iso_datetime(user.created_at),
        "updated_at": _iso_datetime(user.updated_at),
        "edit_href": f"/react/admin/users?edit={user.id}",
    }


def _admin_exam_payload(exam):
    submitted_statuses = ["submitted", "evaluated", "terminated", "auto_submitted"]
    session_query = StudentSession.query.filter_by(exam_set_id=exam.id)
    submitted_count = session_query.filter(StudentSession.status.in_(submitted_statuses)).count()
    pending_review_count = (
        session_query.filter(StudentSession.status.in_(submitted_statuses))
        .outerjoin(Result, Result.session_id == StudentSession.id)
        .filter(Result.id.is_(None))
        .count()
    )
    return {
        "id": exam.id,
        "exam_name": exam.exam_name,
        "subject": exam.subject,
        "set_code": exam.set_code,
        "status": exam.status,
        "duration_minutes": exam.duration_minutes,
        "total_marks": exam.total_marks,
        "question_count": Question.query.filter_by(exam_set_id=exam.id).count(),
        "enrolled_count": ExamEnrollment.query.filter_by(exam_set_id=exam.id).count(),
        "submitted_count": submitted_count,
        "pending_review_count": pending_review_count,
        "teacher_id": exam.created_by,
        "teacher_name": exam.creator.name if exam.creator else None,
        "created_at": _iso_datetime(exam.created_at),
        "updated_at": _iso_datetime(exam.updated_at),
        "start_time": _iso_datetime(exam.start_time),
        "end_time": _iso_datetime(exam.end_time),
        "links": {
            "report_pdf": url_for("admin.export_exam_report_pdf", exam_id=exam.id),
        },
    }


def _question_bank_payload(item):
    return {
        "id": item.id,
        "question_text": item.question_text,
        "question_type": item.question_type,
        "marks": item.marks,
        "options": item.options_as_list(),
        "correct_answer": item.correct_answer,
        "explanation": item.explanation,
        "model_answer": item.model_answer,
        "image_paths": item.image_paths_as_list(),
        "image_urls": [url_for("static", filename=path) for path in item.image_paths_as_list()],
        "code_snippet": item.code_snippet,
        "code_language": item.code_language or "python",
        "time_limit_seconds": item.time_limit_seconds,
        "execution_time_limit_seconds": item.execution_time_limit_seconds,
        "created_at": _iso_datetime(item.created_at),
        "updated_at": _iso_datetime(item.updated_at),
    }


def _question_options_for_attempt(question, student_session=None):
    options = question.options_as_list()
    if (
        student_session
        and question.question_type == "mcq"
        and getattr(student_session.exam_set, "shuffle_options", False)
        and len(options) > 1
    ):
        shuffled_options = list(options)
        random.Random(f"{student_session.session_code}:{question.id}:options").shuffle(shuffled_options)
        return shuffled_options
    return options


def _group_payload(group):
    return {
        "id": group.id,
        "name": group.name,
        "description": group.description,
        "join_code": group.join_code,
        "created_at": _iso_datetime(group.created_at),
        "updated_at": _iso_datetime(group.updated_at),
        "student_count": len(group.members),
        "members": [
            {
                "id": member.id,
                "student_id": member.student.id,
                "name": member.student.name,
                "username": member.student.username,
                "email": member.student.email,
                "roll_number": member.student.roll_number,
                "profile_picture": url_for("static", filename=member.student.profile_picture) if member.student.profile_picture else None,
            }
            for member in group.members
        ],
    }


def _student_group_public_payload(group, student_group_ids=None):
    student_group_ids = student_group_ids or set()
    return {
        "id": group.id,
        "name": group.name,
        "description": group.description,
        "student_count": len(group.members),
        "is_member": group.id in student_group_ids,
    }


def _assign_unique_group_join_code(group):
    code = generate_group_join_code()
    while StudentGroup.query.filter(
        StudentGroup.id != (group.id or 0),
        StudentGroup.join_code == code,
    ).first():
        code = generate_group_join_code()
    group.join_code = code
    return code


def _find_student_by_identifier(identifier):
    value = (identifier or "").strip()
    if not value:
        return None
    normalized = value.upper()
    return (
        User.query.filter_by(role="student")
        .filter(
            or_(
                db.func.upper(User.roll_number) == normalized,
                db.func.upper(User.username) == normalized,
                db.func.lower(User.email) == value.lower(),
            )
        )
        .first()
    )


def _student_user_for_current_session():
    student_user_id = session.get("student_user_id")
    if student_user_id:
        user = User.query.filter_by(id=student_user_id, role="student").first()
        if user:
            return user
    roll_no = (session.get("roll_no") or "").strip().upper()
    if not roll_no:
        return None
    return User.query.filter(
        User.role == "student",
        db.func.upper(User.roll_number) == roll_no,
    ).first()


def _current_session_user():
    user_id = session.get("user_id") or session.get("admin_id") or session.get("teacher_id") or session.get("student_user_id")
    if not user_id:
        return None, _role_error("Login required", 401)
    user = User.query.get(user_id)
    if not user or not user.is_active or not current_session_matches_user(user):
        session.clear()
        return None, _role_error("This account is active in another browser. Please log in again here.", 401)
    return user, None


def _set_react_student_session(student_name, roll_no, student_id=None, username=None, auth_session_token=None):
    session.clear()
    session.permanent = True
    session["student_id"] = student_id or hash(f"{student_name}_{roll_no}_{datetime.utcnow().isoformat()}")
    if student_id:
        session["user_id"] = student_id
        session["student_user_id"] = student_id
    if auth_session_token:
        session["auth_session_token"] = auth_session_token
    if username:
        session["student_username"] = username
    session["student_name"] = student_name
    session["roll_no"] = (roll_no or "").strip().upper()
    session["role"] = "student"
    session["login_time"] = datetime.utcnow().isoformat()
    session.modified = True


def _remember_react_attempt(student_session):
    session.permanent = True
    session["role"] = "student"
    session["student_id"] = student_session.id
    session["student_name"] = student_session.student_name
    session["roll_no"] = student_session.roll_no
    ExamSessionGuard.remember_browser_attempt(student_session)


def _require_student_api_details():
    student_user_id = session.get("student_user_id")
    if student_user_id:
        user = User.query.get(student_user_id)
        if (
            not user
            or user.role != "student"
            or not user.is_active
            or not current_session_matches_user(user)
        ):
            session.clear()
            return None, None, _role_error("Student login required", 401)

    student_name = (session.get("student_name") or "").strip()
    roll_no = (session.get("roll_no") or "").strip().upper()
    if session.get("role") != "student" or not student_name or not roll_no:
        return None, None, _role_error("Student login required", 401)
    return student_name, roll_no, None


def _latest_student_attempt(exam_id, roll_no):
    return (
        StudentSession.query.filter(
            StudentSession.exam_set_id == exam_id,
            db.func.upper(StudentSession.roll_no) == (roll_no or "").strip().upper(),
        )
        .order_by(StudentSession.created_at.desc())
        .first()
    )


def _exam_requires_enrollment(exam_id):
    return ExamEnrollment.query.filter_by(exam_set_id=exam_id).first() is not None


def _student_is_enrolled(exam_id, roll_no):
    return (
        ExamEnrollment.query.filter(
            ExamEnrollment.exam_set_id == exam_id,
            db.func.upper(ExamEnrollment.roll_no) == (roll_no or "").strip().upper(),
        ).first()
        is not None
    )


def _react_attempt_destination(student_session):
    exam = student_session.exam_set
    _remember_react_attempt(student_session)
    time_state = ExamService.enforce_time_window(student_session)

    if ExamSessionGuard.is_locked(student_session) or time_state == "ended":
        return {"state": "submitted", "redirect": f"/react/student/submitted/{student_session.session_code}"}
    if exam.status == "active" and time_state == "not_started":
        return {"state": "waiting", "redirect": f"/react/student/waiting/{student_session.session_code}"}
    if exam.status == "active" and not student_session.start_time:
        return {"state": "precheck", "redirect": f"/react/student/precheck/{student_session.session_code}"}
    if exam.status == "active":
        return {"state": "exam", "redirect": f"/react/exam/{student_session.session_code}"}
    return {"state": "waiting", "redirect": f"/react/student/waiting/{student_session.session_code}"}


def _parse_datetime_local_value(raw_value):
    value = (raw_value or "").strip()
    if not value:
        return None
    for fmt in ("%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _exam_editor_payload(exam):
    questions = Question.query.filter_by(exam_set_id=exam.id).order_by(Question.question_number.asc()).all()
    return {
        "id": exam.id,
        "name": exam.exam_name,
        "exam_name": exam.exam_name,
        "subject": exam.subject,
        "set_code": exam.set_code,
        "status": exam.status,
        "total_marks": exam.total_marks,
        "duration_minutes": exam.duration_minutes,
        "attempt_limit": exam.attempt_limit,
        "random_question_count": exam.random_question_count,
        "randomize_delivery": bool(exam.random_question_count),
        "shuffle_questions": bool(exam.shuffle_questions),
        "shuffle_options": bool(exam.shuffle_options),
        "access_mode": "access_code" if exam.access_code else "open",
        "access_code": exam.access_code,
        "start_time": exam.start_time.strftime("%Y-%m-%dT%H:%M") if exam.start_time else "",
        "end_time": exam.end_time.strftime("%Y-%m-%dT%H:%M") if exam.end_time else "",
        "questions": [
            {
                "id": question.id,
                "text": question.question_text,
                "type": question.question_type,
                "options": question.options_as_list(),
                "max_marks": question.marks,
                "correct_answer": question.correct_answer or "",
                "model_answer": question.model_answer or "",
                "image_paths": question.image_paths_as_list(),
                "image_urls": [url_for("static", filename=path) for path in question.image_paths_as_list()],
                "code_snippet": question.code_snippet or "",
                "has_code_snippet": bool(question.code_snippet),
                "code_language": question.code_language or "python",
                "time_limit_seconds": question.time_limit_seconds or 0,
                "execution_time_limit_seconds": question.execution_time_limit_seconds or 10,
            }
            for question in questions
        ],
    }


def _teacher_student_payload(student):
    return {
        "id": student.id,
        "name": student.name,
        "username": student.username,
        "email": student.email,
        "roll_number": student.roll_number,
    }


def _teacher_group_option_payload(group):
    return {
        "id": group.id,
        "name": group.name,
        "student_count": len(group.members),
        "members": [
            {
                "id": member.id,
                "student_id": member.student.id,
                "name": member.student.name,
                "username": member.student.username,
                "email": member.student.email,
                "roll_number": member.student.roll_number,
                "profile_picture": url_for("static", filename=member.student.profile_picture) if member.student.profile_picture else None,
            }
            for member in group.members
        ],
    }


def _enrollment_payload(enrollment):
    student = _find_student_by_identifier(enrollment.roll_no)
    return {
        "id": enrollment.id,
        "roll_no": enrollment.roll_no,
        "student_name": enrollment.student_name or (student.name if student else ""),
        "extra_time_minutes": enrollment.extra_time_minutes,
        "created_at": _iso_datetime(enrollment.created_at),
        "updated_at": _iso_datetime(enrollment.updated_at),
        "student": _teacher_student_payload(student) if student else None,
    }


def _teacher_result_export_base_row(student_session):
    exam = student_session.exam_set
    result = student_session.result
    return [
        exam.exam_name if exam else "",
        exam.subject if exam else "",
        exam.set_code if exam else "",
        student_session.student_name,
        student_session.roll_no,
        student_session.status,
        format_datetime(student_session.start_time),
        format_datetime(student_session.submitted_at),
        result.total_marks_obtained if result else "",
        result.total_marks if result else (exam.total_marks if exam else ""),
        result.percentage if result else "",
        "Yes" if result and result.published else "No",
        format_datetime(result.published_at) if result and result.published_at else "",
        student_session.focus_violations,
        result.teacher_remarks if result else "",
    ]


def _parse_extra_minutes(value):
    try:
        return max(int(value or 0), 0)
    except (TypeError, ValueError):
        return 0


def _parse_enrollment_line(raw_line):
    parts = [part.strip() for part in (raw_line or "").split(",")]
    if not parts or not parts[0]:
        return None
    return {
        "roll_no": parts[0],
        "student_name": parts[1] if len(parts) > 1 else "",
        "extra_time_minutes": _parse_extra_minutes(parts[2] if len(parts) > 2 else 0),
    }


def _sync_enrollment_sessions(exam_id, roll_no, student_name, extra_time_minutes):
    sessions = (
        StudentSession.query.filter(
            StudentSession.exam_set_id == exam_id,
            db.func.upper(StudentSession.roll_no) == (roll_no or "").upper(),
            StudentSession.status.notin_(LOCKED_SESSION_STATUSES),
        )
        .all()
    )
    for student_session in sessions:
        if student_name:
            student_session.student_name = student_name
        student_session.extra_time_minutes = extra_time_minutes


def _upsert_exam_enrollment(exam, teacher, roll_no, student_name="", extra_time_minutes=0):
    normalized_roll = ExamEnrollment.normalize_roll_no(roll_no)
    if not normalized_roll:
        return None, "Roll number is required."

    student = _find_student_by_identifier(normalized_roll)
    clean_name = (student_name or "").strip() or (student.name if student else "")
    clean_extra = _parse_extra_minutes(extra_time_minutes)
    enrollment = (
        ExamEnrollment.query.filter(
            ExamEnrollment.exam_set_id == exam.id,
            db.func.upper(ExamEnrollment.roll_no) == normalized_roll,
        )
        .first()
    )
    if enrollment:
        enrollment.student_name = clean_name
        enrollment.extra_time_minutes = clean_extra
    else:
        enrollment = ExamEnrollment(
            exam_set_id=exam.id,
            roll_no=normalized_roll,
            student_name=clean_name,
            extra_time_minutes=clean_extra,
            created_by=teacher.id,
        )
        db.session.add(enrollment)

    _sync_enrollment_sessions(exam.id, normalized_roll, clean_name, clean_extra)
    return enrollment, None


def _apply_teacher_enrollment_payload(exam, teacher, payload):
    added = 0
    errors = []

    student_id = payload.get("student_id")
    if student_id:
        student = User.query.filter_by(id=student_id, role="student").first()
        if not student:
            errors.append("Selected student was not found.")
        else:
            roll_no = student.roll_number or student.username
            _, error = _upsert_exam_enrollment(
                exam,
                teacher,
                roll_no,
                student.name,
                payload.get("extra_time_minutes", 0),
            )
            if error:
                errors.append(error)
            else:
                added += 1

    if payload.get("roll_no"):
        _, error = _upsert_exam_enrollment(
            exam,
            teacher,
            payload.get("roll_no"),
            payload.get("student_name", ""),
            payload.get("extra_time_minutes", 0),
        )
        if error:
            errors.append(error)
        else:
            added += 1

    raw_group_ids = payload.get("group_ids")
    if isinstance(raw_group_ids, str):
        try:
            raw_group_ids = json.loads(raw_group_ids)
        except json.JSONDecodeError:
            raw_group_ids = [raw_group_ids]
    if raw_group_ids is None:
        raw_group_ids = []
    if not isinstance(raw_group_ids, list):
        raw_group_ids = [raw_group_ids]
    if payload.get("group_id"):
        raw_group_ids.append(payload.get("group_id"))

    clean_group_ids = []
    for group_id in raw_group_ids:
        try:
            group_id_int = int(group_id)
        except (TypeError, ValueError):
            continue
        if group_id_int not in clean_group_ids:
            clean_group_ids.append(group_id_int)

    for group_id in clean_group_ids:
        group = StudentGroup.query.get(group_id)
        if not group:
            errors.append("Selected group was not found.")
            continue
        for member in group.members:
            student = member.student
            if not student:
                continue
            roll_no = student.roll_number or student.username
            _, error = _upsert_exam_enrollment(exam, teacher, roll_no, student.name, 0)
            if error:
                errors.append(error)
            else:
                added += 1

    bulk_items = payload.get("enrollments") or payload.get("enrollment_lines")
    if isinstance(bulk_items, str):
        iterable = [_parse_enrollment_line(line) for line in bulk_items.splitlines()]
    elif isinstance(bulk_items, list):
        iterable = bulk_items
    else:
        iterable = []

    for item in iterable:
        if not isinstance(item, dict):
            continue
        _, error = _upsert_exam_enrollment(
            exam,
            teacher,
            item.get("roll_no") or item.get("roll_number") or item.get("username"),
            item.get("student_name") or item.get("name") or "",
            item.get("extra_time_minutes", 0),
        )
        if error:
            errors.append(error)
        else:
            added += 1

    return added, errors


def _result_question_payload(question, answer, question_mark, result):
    answer_text = answer.answer_text if answer else ""
    marks_awarded = question_mark.marks_awarded if question_mark else 0
    return {
        "id": question.id,
        "question_number": question.question_number,
        "question_text": question.question_text,
        "question_type": question.question_type,
        "type": question.question_type,
        "marks_obtained": marks_awarded,
        "marks_awarded": marks_awarded,
        "max_marks": question.marks,
        "student_answer": answer_text,
        "code_output": answer.code_output if answer else None,
        "execution_output": answer.code_output if answer else None,
        "execution_status": answer.execution_status if answer else None,
        "correct_answer": question.correct_answer if result and result.published else None,
        "correct_option": question.correct_answer if result and result.published else None,
        "model_answer": question.model_answer if result and result.published else None,
        "teacher_remark": question_mark.teacher_remark if question_mark else None,
        "explanation": question.explanation,
        "options": question.options_as_list(),
        "image_urls": [url_for("static", filename=path) for path in question.image_paths_as_list()],
        "code_snippet": question.code_snippet,
        "code_language": question.code_language or "python",
    }


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
            "href": f"/react/student/submitted/{student_session.session_code}",
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
        "href": f"/react/student/precheck/{student_session.session_code}" if student_session and student_session.start_time is None else "/react/student",
        "api_path": f"/student/exams/{exam.id}/start",
        "method": "post",
        "variant": "primary",
        "disabled": False,
    }


def _require_teacher_owner(exam_id=None, student_session=None):
    teacher, error = _require_teacher_api()
    if error:
        return None, error

    teacher_id = teacher.id

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
            "answer_pdf": f"/api/teacher/reports/sessions/{student_session.id}/answer.pdf",
        },
    }


def _role_error(message, status_code):
    return jsonify({"ok": False, "message": message}), status_code


def _require_admin_api():
    admin_id = session.get("admin_id")
    if session.get("role") != "admin" or not admin_id:
        return None, _role_error("Admin login required", 401)

    admin = User.query.get(admin_id)
    if not admin or admin.role != "admin" or not admin.is_active:
        session.clear()
        return None, _role_error("Your admin session is no longer active.", 401)
    if not current_session_matches_user(admin):
        session.clear()
        return None, _role_error("This admin account is active in another browser. Please log in again here.", 401)

    idle_timeout = _admin_idle_timeout_seconds()
    last_activity = session.get("admin_last_activity")
    if last_activity:
        try:
            elapsed = (datetime.utcnow() - datetime.fromisoformat(last_activity)).total_seconds()
        except ValueError:
            elapsed = 0
        if elapsed > idle_timeout:
            session.clear()
            return None, _role_error("Your admin session expired due to inactivity.", 401)

    session["admin_last_activity"] = datetime.utcnow().isoformat()
    session.modified = True
    return admin, None


def _require_teacher_api():
    teacher_id = session.get("teacher_id")
    if session.get("role") != "teacher" or not teacher_id:
        return None, _role_error("Teacher login required", 401)

    teacher = User.query.get(teacher_id)
    if not teacher or teacher.role != "teacher" or not teacher.is_active:
        session.clear()
        return None, _role_error("Your teacher account is no longer active.", 401)
    if not current_session_matches_user(teacher):
        session.clear()
        return None, _role_error("This teacher account is active in another browser. Please log in again here.", 401)
    if getattr(teacher, "must_change_password", False):
        return None, _role_error("Please change your temporary password first.", 403)
    return teacher, None


def _admin_password_matches(payload):
    password = (payload or {}).get("admin_password") or ""
    admin = User.query.get(session.get("admin_id"))
    return bool(password and admin and admin.check_password(password))


def _proctor_session_payload(student_session):
    exam = student_session.exam_set
    student_user = _find_student_by_identifier(student_session.roll_no)
    total_questions = Question.query.filter_by(exam_set_id=exam.id).count()
    answered_count = (
        Answer.query.filter_by(session_id=student_session.id)
        .filter(Answer.answer_text != "")
        .count()
    )
    latest_violation = (
        ViolationLog.query.filter_by(session_id=student_session.id)
        .order_by(ViolationLog.occurred_at.desc())
        .first()
    )

    heartbeat_age = None
    if student_session.last_heartbeat:
        heartbeat_age = int((datetime.utcnow() - student_session.last_heartbeat).total_seconds())

    return {
        "id": student_session.id,
        "exam_id": exam.id,
        "session_code": student_session.session_code,
        "student_name": student_session.student_name,
        "roll_no": student_session.roll_no,
        "profile_picture": url_for("static", filename=student_user.profile_picture) if student_user and student_user.profile_picture else None,
        "exam_name": exam.exam_name,
        "set_code": exam.set_code,
        "status": student_session.status,
        "remaining_seconds": ExamService.remaining_seconds_for_session(student_session),
        "answered_count": answered_count,
        "total_questions": total_questions,
        "focus_violations": student_session.focus_violations,
        "suspicion_score": student_session.suspicion_score,
        "last_heartbeat_age": heartbeat_age,
        "latest_violation": latest_violation.violation_type if latest_violation else None,
        "latest_violation_at": _iso_datetime(latest_violation.occurred_at) if latest_violation else None,
        "pause_requested": bool(student_session.pause_requested_at),
        "pause_reason": student_session.pause_reason,
        "paused_at": _iso_datetime(student_session.paused_at),
        "links": {
            "teacher_review": f"/react/teacher/session/{student_session.id}/review",
        },
    }


def _proctor_counts(snapshots):
    return {
        "active_sessions": sum(1 for item in snapshots if item["status"] == "active"),
        "waiting_sessions": sum(1 for item in snapshots if item["status"] == "waiting"),
        "paused_sessions": sum(1 for item in snapshots if item["status"] == "paused"),
        "flagged_sessions": sum(1 for item in snapshots if item["focus_violations"] > 0),
    }


def _recent_violations_payload(limit=10):
    recent_violations = (
        ViolationLog.query.order_by(ViolationLog.occurred_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": violation.id,
            "student_name": violation.student_session.student_name,
            "roll_no": violation.student_session.roll_no,
            "exam_name": violation.student_session.exam_set.exam_name,
            "type": violation.violation_type,
            "detail": violation.detail,
            "occurred_at": _iso_datetime(violation.occurred_at),
        }
        for violation in recent_violations
    ]


def _emit_proctor_session_update(student_session):
    emit_to_proctors(
        student_session.exam_set_id,
        "proctor:student_status",
        _proctor_session_payload(student_session),
    )


def _record_admin_session_action(student_session, action, reason=None, changes=None, status="success"):
    db.session.add(
        AuditLog(
            user_id=session.get("admin_id"),
            action=action,
            resource_type="student_session",
            resource_id=student_session.id,
            reason=reason,
            changes=changes,
            status=status,
            ip_address=get_client_ip(),
            user_agent=request.headers.get("User-Agent"),
        )
    )


@api_bp.route("/bootstrap")
def bootstrap():
    settings = SettingsService.get_settings()
    user_id = session.get("user_id")
    role = session.get("role")
    if user_id:
        user = User.query.get(user_id)
        if (
            not user
            or not user.is_active
            or user.role != role
            or not current_session_matches_user(user)
        ):
            session.clear()
            user_id = None
            role = None
    return jsonify(
        {
            "ok": True,
            "settings": _settings_payload(settings),
            "auth": {
                "role": role,
                "user_id": user_id,
                "username": user.username if user_id and user else None,
                "email": user.email if user_id and user else None,
                "profile_picture": _user_payload(user).get("profile_picture") if user_id and user else None,
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


def _admin_lockout_payload(user):
    if not user or not user.locked_until:
        return {}
    remaining = max(int((user.locked_until - datetime.utcnow()).total_seconds()), 0)
    if remaining > 24 * 60 * 60:
        return {
            "locked": True,
            "server_unlock_required": True,
            "locked_until": user.locked_until.isoformat(),
        }
    return {
        "locked": True,
        "retry_after_seconds": remaining,
        "retry_after_minutes": max((remaining + 59) // 60, 1),
        "locked_until": user.locked_until.isoformat(),
    }


@api_bp.route("/auth/admin-login", methods=["POST"])
@rate_limit("auth_login")
def react_admin_login_api():
    if not User.query.filter_by(role="admin").first():
        return jsonify({
            "ok": False,
            "message": "Admin setup is required before sign in.",
            "setup_required": True,
            "redirect": "/admin/setup",
        }), 409

    payload = _get_json_payload()
    username = (payload.get("username") or "").strip()
    password = (payload.get("password") or "").strip()

    if not username or not password:
        return jsonify({"ok": False, "message": "Username and password are required."}), 400

    admin = User.query.filter_by(username=username, role="admin").first()
    if not admin:
        return jsonify({"ok": False, "message": "Invalid credentials."}), 401

    if not admin.is_active:
        return jsonify({"ok": False, "message": "Admin account is disabled."}), 403

    if admin.is_account_locked():
        message = (
            "Account locked. Unlock it from the server CLI."
            if admin.locked_until and (admin.locked_until - datetime.utcnow()).days > 1
            else "Account locked. Try again later."
        )
        return jsonify({"ok": False, "message": message, **_admin_lockout_payload(admin)}), 423

    lockout_limit = _admin_lockout_limit()
    if not admin.check_password(password):
        admin.failed_login_attempts += 1
        if admin.failed_login_attempts >= lockout_limit:
            admin.locked_until = datetime.utcnow() + timedelta(minutes=30)
            message = "Account locked. Try again in 30 minutes."
        else:
            message = "Invalid credentials."
        db.session.commit()
        AuditLog(
            user_id=admin.id,
            action="failed_login",
            resource_type="user",
            resource_id=admin.id,
            status="failed",
            ip_address=get_client_ip(),
            user_agent=request.headers.get("User-Agent"),
        ).save()
        return jsonify({
            "ok": False,
            "message": message,
            "failed_attempts": admin.failed_login_attempts,
            "attempts_remaining": max(lockout_limit - admin.failed_login_attempts, 0),
            **_admin_lockout_payload(admin),
        }), 423 if admin.failed_login_attempts >= lockout_limit else 401

    session_conflict = _has_live_session_conflict(admin)
    admin.reset_failed_attempts()
    auth_session_token = admin.issue_active_session_token()
    db.session.commit()
    session.clear()
    session.permanent = True
    session["user_id"] = admin.id
    session["admin_id"] = admin.id
    session["admin_name"] = admin.name
    session["admin_username"] = admin.username
    session["role"] = "admin"
    session["auth_session_token"] = auth_session_token
    session["login_time"] = datetime.utcnow().isoformat()
    session["admin_last_activity"] = datetime.utcnow().isoformat()

    AuditLog(
        user_id=admin.id,
        action="login",
        resource_type="user",
        resource_id=admin.id,
        status="success",
        ip_address=get_client_ip(),
        user_agent=request.headers.get("User-Agent"),
    ).save()

    return jsonify({
        "ok": True,
        "message": "Welcome Admin!",
        "redirect": "/react/admin",
        "role": "admin",
        **_session_conflict_payload(session_conflict),
    })


@api_bp.route("/auth/admin-setup", methods=["GET", "POST"])
@rate_limit("auth_login", methods=("POST",))
def react_admin_setup_api():
    admin_exists = User.query.filter_by(role="admin").first()
    if request.method == "GET":
        return jsonify({"ok": True, "setup_required": not bool(admin_exists)})

    if admin_exists:
        return jsonify({
            "ok": False,
            "message": "Admin account already exists. Sign in instead.",
            "setup_required": False,
            "redirect": "/react/admin/login",
        }), 409

    payload = _get_json_payload()
    name = (payload.get("name") or "").strip()
    username = (payload.get("username") or "").strip()
    password = (payload.get("password") or "").strip()
    confirm_password = (payload.get("confirm_password") or "").strip()

    if not name or not username or not password or not confirm_password:
        return jsonify({"ok": False, "message": "Name, username, password, and confirmation are required."}), 400
    if password != confirm_password:
        return jsonify({"ok": False, "message": "Passwords do not match."}), 400
    if len(username) < 5:
        return jsonify({"ok": False, "message": "Username must be at least 5 characters."}), 400
    if not _strong_password(password):
        return jsonify({"ok": False, "message": "Admin password must be at least 10 characters and include uppercase, lowercase, and number."}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({"ok": False, "message": "Username already exists."}), 400

    admin = User(
        name=name,
        username=username,
        role="admin",
        is_active=True,
        is_verified=True,
        created_at=datetime.utcnow(),
    )
    admin.set_password(password)
    db.session.add(admin)
    db.session.commit()

    AuditLog(
        user_id=admin.id,
        action="admin_setup",
        resource_type="user",
        resource_id=admin.id,
        status="success",
        ip_address=get_client_ip(),
        user_agent=request.headers.get("User-Agent"),
    ).save()

    return jsonify({"ok": True, "message": "Admin account created. Please sign in.", "redirect": "/react/admin/login"})


@api_bp.route("/auth/login", methods=["POST"])
@rate_limit("auth_login")
def react_login_api():
    payload = _get_json_payload()
    role = (payload.get("role") or "student").strip().lower()
    identifier = (payload.get("identifier") or payload.get("username") or "").strip()
    password = (payload.get("password") or "").strip()

    if role not in {"student", "teacher"}:
        return jsonify({"ok": False, "message": "Choose a valid role."}), 400
    if not identifier or not password:
        return jsonify({"ok": False, "message": "Username and password are required."}), 400

    if role == "teacher":
        user = User.query.filter_by(username=identifier, role="teacher").first()
    else:
        user = User.query.filter(
            User.role == "student",
            or_(
                User.username == identifier,
                User.email == identifier,
                User.roll_number == identifier.upper(),
            ),
        ).first()

    if not user or not user.check_password(password):
        if user:
            user.increment_failed_attempts()
            AuditLog(
                user_id=user.id,
                action="failed_login" if role == "teacher" else "failed_student_login",
                resource_type="user",
                resource_id=user.id,
                status="failed",
                ip_address=get_client_ip(),
                user_agent=request.headers.get("User-Agent"),
            ).save()
        return jsonify({"ok": False, "message": "Invalid credentials."}), 401

    if not user.is_active:
        return jsonify({"ok": False, "message": "This account is disabled by the administrator."}), 403
    if user.is_account_locked():
        minutes = max(int((user.locked_until - datetime.utcnow()).total_seconds() // 60), 1) if user.locked_until else 30
        return jsonify({"ok": False, "message": f"Account locked. Try again in {minutes} minutes.", "locked": True}), 423

    session_conflict = _has_live_session_conflict(user)
    user.reset_failed_attempts()
    auth_session_token = user.issue_active_session_token()
    db.session.commit()

    if role == "teacher":
        session.clear()
        session.permanent = True
        session["user_id"] = user.id
        session["teacher_id"] = user.id
        session["teacher_name"] = user.name
        session["teacher_username"] = user.username
        session["role"] = "teacher"
        session["auth_session_token"] = auth_session_token
        session["login_time"] = datetime.utcnow().isoformat()
        redirect = "/react/settings" if user.must_change_password else "/react/teacher"
    else:
        _set_react_student_session(
            user.name,
            user.roll_number or user.username,
            student_id=user.id,
            username=user.username,
            auth_session_token=auth_session_token,
        )
        redirect = "/react/student"

    AuditLog(
        user_id=user.id,
        action="login" if role == "teacher" else "student_login",
        resource_type="user",
        resource_id=user.id,
        status="success",
        ip_address=get_client_ip(),
        user_agent=request.headers.get("User-Agent"),
    ).save()
    return jsonify({
        "ok": True,
        "message": "Login successful.",
        "redirect": redirect,
        "role": role,
        **_session_conflict_payload(session_conflict),
    })


@api_bp.route("/auth/session-status", methods=["GET"])
@rate_limit("session_status", limit=120, window_seconds=60, methods=("GET",))
def react_session_status_api():
    user_id = session.get("user_id") or session.get("admin_id") or session.get("teacher_id") or session.get("student_user_id")
    role = session.get("role")
    session_token = session.get("auth_session_token")

    if not user_id or not role or not session_token:
        return jsonify({"ok": True, "valid": False, "reason": "no_session"})

    user = User.query.get(user_id)
    if not user or not user.is_active or user.role != role:
        return jsonify({"ok": True, "valid": False, "reason": "account_inactive"})

    active_token = getattr(user, "active_session_token", None)
    if not active_token or not secrets.compare_digest(str(session_token), str(active_token)):
        return jsonify({"ok": True, "valid": False, "reason": "signed_out_elsewhere"})

    return jsonify({"ok": True, "valid": True, "role": role})


@api_bp.route("/auth/register", methods=["POST"])
@rate_limit("student_login")
def react_register_api():
    settings = SettingsService.get_settings()
    if not settings.student_self_registration:
        return jsonify({"ok": False, "message": "Student registration is currently closed."}), 403

    payload = _get_json_payload()
    name = (payload.get("name") or "").strip()
    username = (payload.get("username") or "").strip()
    email = (payload.get("email") or "").strip() or None
    roll_no = (payload.get("roll_no") or payload.get("roll_number") or "").strip().upper()
    password = (payload.get("password") or "").strip()
    confirm_password = (payload.get("confirm_password") or "").strip()
    registration_code = (payload.get("registration_code") or "").strip()

    if not name or not username or not roll_no or not password or not confirm_password:
        return jsonify({"ok": False, "message": "Name, username, roll number, password, and confirmation are required."}), 400
    if getattr(settings, "registration_code_required", False):
        expected_code = (getattr(settings, "registration_code", None) or "").strip()
        if not expected_code or registration_code != expected_code:
            return jsonify({"ok": False, "message": "A valid registration code is required."}), 403
    if len(username) < 4:
        return jsonify({"ok": False, "message": "Username must be at least 4 characters."}), 400
    if password != confirm_password:
        return jsonify({"ok": False, "message": "Passwords do not match."}), 400
    if not _valid_student_password(password):
        return jsonify({"ok": False, "message": "Password must be at least 8 characters and include uppercase, number, and special character."}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({"ok": False, "message": "Username already exists."}), 400
    if email and User.query.filter_by(email=email).first():
        return jsonify({"ok": False, "message": "Email already exists."}), 400
    if User.query.filter_by(role="student", roll_number=roll_no).first():
        return jsonify({"ok": False, "message": "A student account with this roll number already exists."}), 400

    student = User(
        name=name,
        username=username,
        email=email,
        role="student",
        roll_number=roll_no,
        is_active=True,
        is_verified=True,
        created_at=datetime.utcnow(),
    )
    student.set_password(password)
    db.session.add(student)
    db.session.commit()
    auth_session_token = student.issue_active_session_token()
    db.session.commit()

    AuditLog(
        user_id=student.id,
        action="student_self_register",
        resource_type="user",
        resource_id=student.id,
        status="success",
        ip_address=get_client_ip(),
        user_agent=request.headers.get("User-Agent"),
    ).save()
    NotificationService.notify_role(
        "admin",
        f"New student registered: {student.name} ({student.roll_number}).",
        notification_type="student_registered",
        related_entity_type="user",
        related_entity_id=student.id,
    )
    db.session.commit()
    _set_react_student_session(
        student.name,
        student.roll_number,
        student_id=student.id,
        username=student.username,
        auth_session_token=auth_session_token,
    )
    return jsonify({"ok": True, "message": "Student account created.", "redirect": "/react/student", "role": "student"}), 201


@api_bp.route("/account/profile", methods=["PATCH"])
@rate_limit("admin_action")
def account_profile_api():
    user, error_response = _current_session_user()
    if error_response:
        return error_response

    payload = _get_json_payload()
    name = (payload.get("name") or "").strip()
    email = (payload.get("email") or "").strip() or None

    if not name:
        return jsonify({"ok": False, "message": "Full name is required."}), 400
    if user.role != "student" and email:
        duplicate_email = User.query.filter(User.email == email, User.id != user.id).first()
        if duplicate_email:
            return jsonify({"ok": False, "message": "Email already exists."}), 400

    user.name = name
    if user.role != "student":
        user.email = email
    db.session.commit()

    if user.role == "admin":
        session["admin_name"] = user.name
    elif user.role == "teacher":
        session["teacher_name"] = user.name
    elif user.role == "student":
        session["student_name"] = user.name
    session.modified = True

    AuditLog(
        user_id=user.id,
        action="update_account_profile",
        resource_type="user",
        resource_id=user.id,
        status="success",
        ip_address=get_client_ip(),
        user_agent=request.headers.get("User-Agent"),
    ).save()
    return jsonify({"ok": True, "message": "Profile updated.", "user": _user_payload(user)})


@api_bp.route("/account/avatar", methods=["POST"])
@rate_limit("admin_action")
def account_avatar_api():
    user, error_response = _current_session_user()
    if error_response:
        return error_response

    upload = request.files.get("avatar")
    if not upload or not upload.filename:
        return jsonify({"ok": False, "message": "Choose a profile image to upload."}), 400

    max_bytes = 2 * 1024 * 1024
    if request.content_length and request.content_length > max_bytes + 8192:
        return jsonify({"ok": False, "message": "Profile image must be 2 MB or smaller."}), 400

    filename = secure_filename(upload.filename)
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    allowed_extensions = {"png", "jpg", "jpeg", "webp", "gif"}
    if extension not in allowed_extensions:
        return jsonify({"ok": False, "message": "Profile image must be PNG, JPG, WEBP, or GIF."}), 400

    upload_root = os.path.join(current_app.static_folder, "uploads", "profiles")
    os.makedirs(upload_root, exist_ok=True)
    stored_filename = f"user_{user.id}_{secrets.token_hex(8)}.{extension}"
    stored_path = os.path.join(upload_root, stored_filename)
    upload.save(stored_path)

    old_picture = user.profile_picture
    user.profile_picture = f"uploads/profiles/{stored_filename}"
    db.session.add(
        AuditLog(
            user_id=user.id,
            action="upload_account_avatar",
            resource_type="user",
            resource_id=user.id,
            status="success",
            ip_address=get_client_ip(),
            user_agent=request.headers.get("User-Agent"),
        )
    )
    db.session.commit()

    if old_picture and old_picture.startswith("uploads/profiles/"):
        old_abs_path = os.path.abspath(os.path.join(current_app.static_folder, old_picture))
        upload_abs_root = os.path.abspath(upload_root)
        if old_abs_path.startswith(upload_abs_root) and os.path.exists(old_abs_path):
            try:
                os.remove(old_abs_path)
            except OSError:
                current_app.logger.warning("Could not remove old profile image %s", old_abs_path)

    return jsonify({"ok": True, "message": "Profile image uploaded.", "user": _user_payload(user)})


@api_bp.route("/account/password", methods=["POST"])
@rate_limit("admin_action")
def account_password_api():
    user, error_response = _current_session_user()
    if error_response:
        return error_response

    payload = _get_json_payload()
    current_password = payload.get("current_password") or ""
    new_password = payload.get("new_password") or ""
    confirm_password = payload.get("confirm_password") or ""

    if not user.check_password(current_password):
        return jsonify({"ok": False, "message": "Current password is incorrect."}), 403
    if new_password != confirm_password:
        return jsonify({"ok": False, "message": "New passwords do not match."}), 400
    if not _strong_password(new_password):
        return jsonify({"ok": False, "message": "Password must be at least 10 characters and include uppercase, lowercase, and a number."}), 400

    user.set_password(new_password)
    if user.role == "teacher":
        user.must_change_password = False
    session["auth_session_token"] = user.issue_active_session_token()
    db.session.commit()
    session.modified = True

    AuditLog(
        user_id=user.id,
        action="change_account_password",
        resource_type="user",
        resource_id=user.id,
        status="success",
        ip_address=get_client_ip(),
        user_agent=request.headers.get("User-Agent"),
    ).save()
    return jsonify({"ok": True, "message": "Password changed successfully."})


@api_bp.route("/student/dashboard")
def student_dashboard_api():
    if session.get("role") != "student" or not session.get("roll_no"):
        return jsonify({"ok": False, "message": "Student login required"}), 401
    student_user_id = session.get("student_user_id")
    if student_user_id:
        student_user = User.query.get(student_user_id)
        if (
            not student_user
            or student_user.role != "student"
            or not student_user.is_active
            or not current_session_matches_user(student_user)
        ):
            session.clear()
            return jsonify({
                "ok": False,
                "message": "This student account is active in another browser. Please log in again here.",
            }), 401

    roll_no = (session.get("roll_no") or "").strip().upper()
    student_user = _student_user_for_current_session()
    student_group_memberships = []
    if student_user:
        student_group_memberships = (
            StudentGroupMember.query.filter_by(student_id=student_user.id)
            .join(StudentGroup)
            .order_by(StudentGroup.name.asc())
            .all()
        )
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
                    "href": f"/react/student/submitted/{latest_session.session_code}",
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
            "student": {
                "name": session.get("student_name"),
                "roll_no": roll_no,
                "greeting": greeting,
                "batches": [
                    {
                        "id": membership.group.id,
                        "name": membership.group.name,
                        "description": membership.group.description,
                        "student_count": len(membership.group.members),
                    }
                    for membership in student_group_memberships
                ],
                "needs_batch_join": not bool(student_group_memberships),
            },
            "quote": SettingsService.random_quote(settings),
            "announcement_message": settings.announcement_message if settings else None,
            "server_time": _iso_datetime(now),
            "stats": stats,
            "exams": cards,
            "links": {
                "join_exam": "/react/student/join",
                "results": "/react/student/results",
                "dashboard": "/react/student",
            },
        }
    )


@api_bp.route("/student/batches")
def student_batches_api():
    student_name, roll_no, error_response = _require_student_api_details()
    if error_response:
        return error_response
    student_user = _student_user_for_current_session()
    memberships = []
    if student_user:
        memberships = StudentGroupMember.query.filter_by(student_id=student_user.id).all()
    group_ids = {membership.group_id for membership in memberships}
    groups = StudentGroup.query.order_by(StudentGroup.name.asc()).all()
    return jsonify(
        {
            "ok": True,
            "student": {"name": student_name, "roll_no": roll_no},
            "batches": [_student_group_public_payload(group, group_ids) for group in groups],
            "joined_batches": [_student_group_public_payload(membership.group, group_ids) for membership in memberships],
        }
    )


@api_bp.route("/student/batches/join", methods=["POST"])
@rate_limit("submit")
def student_batch_join_api():
    student_name, roll_no, error_response = _require_student_api_details()
    if error_response:
        return error_response
    student_user = _student_user_for_current_session()
    if not student_user:
        return jsonify({"ok": False, "message": "Student account was not found. Please log in again."}), 401

    payload = _get_json_payload()
    group_id = payload.get("group_id") or payload.get("batch_id")
    join_code = (payload.get("join_code") or payload.get("code") or "").strip().upper()
    if not group_id:
        return jsonify({"ok": False, "message": "Choose your batch first."}), 400
    if not join_code:
        return jsonify({"ok": False, "message": "Enter the batch code shared by the admin."}), 400

    group = StudentGroup.query.get_or_404(group_id)
    expected_code = (group.join_code or "").strip().upper()
    if not expected_code or not secrets.compare_digest(join_code, expected_code):
        return jsonify({"ok": False, "message": "That batch code does not match. Please check it and try again."}), 403

    existing = StudentGroupMember.query.filter_by(group_id=group.id, student_id=student_user.id).first()
    if not existing:
        db.session.add(StudentGroupMember(group_id=group.id, student_id=student_user.id))
    student_user.batch = group.name[:20]
    db.session.commit()
    return jsonify(
        {
            "ok": True,
            "message": f"You joined {group.name}.",
            "batch": _student_group_public_payload(group, {group.id}),
        }
    )


@api_bp.route("/student/exams/<int:exam_id>/start", methods=["POST"])
@rate_limit("submit")
def react_start_exam_api(exam_id):
    student_name, roll_no, error_response = _require_student_api_details()
    if error_response:
        return error_response

    exam = ExamSet.query.get_or_404(exam_id)
    if not _student_is_enrolled(exam.id, roll_no):
        return jsonify({"ok": False, "message": "This exam is not assigned to your roll number."}), 403
    if exam.status == "closed":
        return jsonify({"ok": False, "message": "This exam has been closed by the teacher."}), 403

    existing_session = _latest_student_attempt(exam.id, roll_no)
    if existing_session and ExamSessionGuard.is_locked(existing_session) and not ExamService.can_start_new_attempt(exam.id, roll_no):
        return jsonify({"ok": True, "message": "Maximum attempts reached.", **_react_attempt_destination(existing_session)})

    student_session = ExamService.create_student_session(
        exam_set_id=exam.id,
        student_name=student_name,
        roll_no=roll_no,
    )
    return jsonify({"ok": True, "message": "Exam session ready.", **_react_attempt_destination(student_session)})


@api_bp.route("/student/join", methods=["POST"])
@rate_limit("submit")
def react_join_exam_api():
    student_name, roll_no, error_response = _require_student_api_details()
    if error_response:
        return error_response

    payload = _get_json_payload()
    access_code = (payload.get("access_code") or "").strip().upper()
    if not access_code:
        return jsonify({"ok": False, "message": "Exam access code is required."}), 400

    exam = ExamSet.query.filter_by(access_code=access_code).first()
    if not exam:
        return jsonify({"ok": False, "message": "Invalid exam access code."}), 404
    if _exam_requires_enrollment(exam.id) and not _student_is_enrolled(exam.id, roll_no):
        return jsonify({"ok": False, "message": "This exam is assigned by roll number and is not available for your login."}), 403
    if exam.status == "closed":
        existing_session = _latest_student_attempt(exam.id, roll_no)
        if existing_session and ExamSessionGuard.is_locked(existing_session):
            return jsonify({"ok": True, "message": "This exam is already submitted.", **_react_attempt_destination(existing_session)})
        return jsonify({"ok": False, "message": "This exam has been closed by the teacher."}), 403

    existing_session = _latest_student_attempt(exam.id, roll_no)
    if existing_session and ExamSessionGuard.is_locked(existing_session) and not ExamService.can_start_new_attempt(exam.id, roll_no):
        return jsonify({"ok": True, "message": "Maximum attempts reached.", **_react_attempt_destination(existing_session)})

    student_session = ExamService.create_student_session(
        exam_set_id=exam.id,
        student_name=student_name,
        roll_no=roll_no,
    )
    return jsonify({"ok": True, "message": "Exam session ready.", **_react_attempt_destination(student_session)})


@api_bp.route("/student/session/<session_code>/precheck", methods=["GET", "POST"])
@rate_limit("submit", methods=("POST",))
def react_precheck_api(session_code):
    student_session = _get_student_session(session_code)
    if not ExamSessionGuard.browser_owns_attempt(student_session):
        return _forbidden_session_response()

    exam = student_session.exam_set
    question_count = Question.query.filter_by(exam_set_id=exam.id).count()
    time_state = ExamService.enforce_time_window(student_session)

    if ExamSessionGuard.is_locked(student_session) or time_state == "ended":
        return jsonify({"ok": True, "redirect": f"/react/student/submitted/{session_code}", "state": "submitted"})
    if exam.status != "active" or time_state == "not_started":
        return jsonify({"ok": True, "redirect": f"/react/student/waiting/{session_code}", "state": "waiting"})
    if student_session.start_time:
        return jsonify({"ok": True, "redirect": f"/react/exam/{session_code}", "state": "exam"})

    if request.method == "POST":
        payload = _get_json_payload()
        if not payload.get("rules_ack"):
            return jsonify({"ok": False, "message": "Please confirm that you understand the exam rules."}), 400
        if not ExamService.start_exam(session_code):
            time_state = ExamService.enforce_time_window(student_session)
            if time_state == "ended":
                return jsonify({"ok": True, "redirect": f"/react/student/submitted/{session_code}", "state": "submitted"})
            return jsonify({"ok": True, "redirect": f"/react/student/waiting/{session_code}", "state": "waiting"})
        return jsonify({"ok": True, "redirect": f"/react/exam/{session_code}", "state": "exam"})

    return jsonify(
        {
            "ok": True,
            "state": "precheck",
            "attempt_token": ExamSessionGuard.ensure_token(student_session),
            "question_count": question_count,
            "max_violations_allowed": SettingsService.max_violations_allowed(),
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
                "extra_time_minutes": student_session.extra_time_minutes,
            },
        }
    )


@api_bp.route("/teacher/dashboard")
def teacher_dashboard_api():
    teacher, error_response = _require_teacher_api()
    if error_response:
        return error_response

    exams = ExamSet.query.filter_by(created_by=teacher.id).order_by(ExamSet.created_at.desc()).all()
    return jsonify(
        {
            "ok": True,
            "teacher": {"id": teacher.id, "name": teacher.name},
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
                }
                for exam in exams
            ],
        }
    )


@api_bp.route("/teacher/students/search")
def teacher_students_search_api():
    teacher, error_response = _require_teacher_api()
    if error_response:
        return error_response

    query_text = (request.args.get("q") or "").strip().lower()
    query = User.query.filter_by(role="student", is_active=True)
    if query_text:
        pattern = f"%{query_text}%"
        query = query.filter(
            or_(
                db.func.lower(User.name).like(pattern),
                db.func.lower(User.username).like(pattern),
                db.func.lower(User.email).like(pattern),
                db.func.lower(User.roll_number).like(pattern),
            )
        )
    students = query.order_by(User.name.asc()).limit(12).all()
    return jsonify({"ok": True, "students": [_teacher_student_payload(student) for student in students]})


@api_bp.route("/teacher/groups")
def teacher_groups_api():
    teacher, error_response = _require_teacher_api()
    if error_response:
        return error_response
    groups = StudentGroup.query.order_by(StudentGroup.name.asc()).all()
    return jsonify({"ok": True, "groups": [_teacher_group_option_payload(group) for group in groups]})


@api_bp.route("/teacher/exams/<int:exam_id>/enrollments", methods=["GET", "POST"])
@rate_limit("admin_action", methods=("POST",))
def teacher_exam_enrollments_api(exam_id):
    exam, error_response = _require_teacher_owner(exam_id=exam_id)
    if error_response:
        return error_response

    if request.method == "POST":
        payload = _get_json_payload()
        added, errors = _apply_teacher_enrollment_payload(exam, exam.creator, payload)
        if errors and not added:
            return jsonify({"ok": False, "message": errors[0], "errors": errors}), 400
        db.session.commit()

    enrollments = (
        ExamEnrollment.query.filter_by(exam_set_id=exam.id)
        .order_by(ExamEnrollment.roll_no.asc())
        .all()
    )
    groups = StudentGroup.query.order_by(StudentGroup.name.asc()).all()
    return jsonify(
        {
            "ok": True,
            "message": "Enrollment updated." if request.method == "POST" else None,
            "enrollments": [_enrollment_payload(enrollment) for enrollment in enrollments],
            "groups": [_teacher_group_option_payload(group) for group in groups],
        }
    )


@api_bp.route("/teacher/exams/<int:exam_id>/enrollments/<int:enrollment_id>", methods=["PATCH", "DELETE"])
@rate_limit("admin_action")
def teacher_exam_enrollment_item_api(exam_id, enrollment_id):
    exam, error_response = _require_teacher_owner(exam_id=exam_id)
    if error_response:
        return error_response

    enrollment = ExamEnrollment.query.filter_by(id=enrollment_id, exam_set_id=exam.id).first_or_404()
    if request.method == "DELETE":
        db.session.delete(enrollment)
        db.session.commit()
        return jsonify({"ok": True, "message": "Student removed from this exam."})

    payload = _get_json_payload()
    enrollment.student_name = (payload.get("student_name") or enrollment.student_name or "").strip()
    enrollment.extra_time_minutes = _parse_extra_minutes(payload.get("extra_time_minutes"))
    _sync_enrollment_sessions(
        exam.id,
        enrollment.roll_no,
        enrollment.student_name,
        enrollment.extra_time_minutes,
    )
    db.session.commit()
    return jsonify({"ok": True, "message": "Enrollment saved.", "enrollment": _enrollment_payload(enrollment)})


@api_bp.route("/teacher/reports/results.csv")
def teacher_reports_all_results_csv_api():
    teacher, error_response = _require_teacher_api()
    if error_response:
        return error_response

    exam_ids = [exam.id for exam in ExamSet.query.filter_by(created_by=teacher.id).all()]
    sessions = []
    if exam_ids:
        sessions = (
            StudentSession.query.filter(StudentSession.exam_set_id.in_(exam_ids))
            .order_by(StudentSession.created_at.desc())
            .all()
        )

    headers = [
        "Exam",
        "Subject",
        "Set Code",
        "Student Name",
        "Roll No",
        "Session Status",
        "Started At",
        "Submitted At",
        "Marks Obtained",
        "Total Marks",
        "Percentage",
        "Published",
        "Published At",
        "Violation Count",
        "Teacher Remarks",
    ]
    return csv_response("teacher_results.csv", headers, [_teacher_result_export_base_row(item) for item in sessions])


@api_bp.route("/teacher/reports/exams/<int:exam_id>/results.csv")
def teacher_reports_exam_results_csv_api(exam_id):
    exam, error_response = _require_teacher_owner(exam_id=exam_id)
    if error_response:
        return error_response

    sessions = (
        StudentSession.query.filter_by(exam_set_id=exam.id)
        .order_by(StudentSession.created_at.desc())
        .all()
    )
    questions = Question.query.filter_by(exam_set_id=exam.id).order_by(Question.question_number.asc()).all()

    headers = [
        "Exam",
        "Subject",
        "Set Code",
        "Student Name",
        "Roll No",
        "Session Status",
        "Started At",
        "Submitted At",
        "Marks Obtained",
        "Total Marks",
        "Percentage",
        "Published",
        "Published At",
        "Violation Count",
        "Teacher Remarks",
    ]
    for question in questions:
        headers.extend([f"Q{question.question_number} Marks", f"Q{question.question_number} Remark"])

    rows = []
    for student_session in sessions:
        row = _teacher_result_export_base_row(student_session)
        marks_by_question = {}
        if student_session.result:
            marks_by_question = {question_mark.question_id: question_mark for question_mark in student_session.result.question_marks}
        for question in questions:
            question_mark = marks_by_question.get(question.id)
            row.extend(
                [
                    question_mark.marks_awarded if question_mark else "",
                    question_mark.teacher_remark if question_mark else "",
                ]
            )
        rows.append(row)

    safe_name = "".join(ch if ch.isalnum() else "_" for ch in exam.set_code or str(exam.id))
    return csv_response(f"results_{safe_name}.csv", headers, rows)


@api_bp.route("/teacher/reports/sessions/<int:session_id>/answer.pdf")
def teacher_reports_answer_pdf_api(session_id):
    student_session = StudentSession.query.get_or_404(session_id)
    exam, error_response = _require_teacher_owner(student_session=student_session)
    if error_response:
        return error_response

    pdf_buffer = create_submission_pdf(student_session, include_unpublished_feedback=True)
    filename = f"answer_sheet_{student_session.roll_no}_{student_session.session_code}.pdf"
    return send_file(pdf_buffer, mimetype="application/pdf", as_attachment=True, download_name=filename)


def _json_exam_question_rows(payload):
    rows = []
    for index, question in enumerate(payload.get("questions") or [], start=1):
        text = (question.get("text") or question.get("question_text") or "").strip()
        if not text:
            continue
        q_type = (question.get("type") or question.get("question_type") or "short").strip().lower()
        if q_type == "short_answer":
            q_type = "short"
        if q_type == "long_answer":
            q_type = "long"
        if q_type == "code":
            q_type = "coding"
        try:
            marks = int(question.get("max_marks") or question.get("marks") or 1)
        except (TypeError, ValueError):
            marks = 1
        options = parse_options(question.get("options") or [])
        if q_type == "mcq" and len(options) < 2:
            raise ValueError(f"Question {index} needs at least two MCQ options.")
        rows.append(
            {
                "number": index,
                "text": text,
                "type": q_type,
                "marks": max(marks, 1),
                "options": options,
                "answer": (question.get("correct_answer") or "").strip(),
                "model_answer": (question.get("model_answer") or "").strip(),
                "image_paths": question.get("image_paths") or [],
                "code_snippet": (question.get("code_snippet") or "").strip(),
                "code_language": (question.get("code_language") or "").strip() or None,
                "time_limit_seconds": max(int(question.get("time_limit_seconds") or 0), 0),
                "execution_time_limit_seconds": min(max(int(question.get("execution_time_limit_seconds") or 10), 1), 60),
            }
        )
    return rows


def _multipart_exam_question_rows():
    q_numbers = request.form.getlist("question_number")
    q_texts = request.form.getlist("question_text")
    q_types = request.form.getlist("question_type")
    q_marks = request.form.getlist("marks")
    q_options = request.form.getlist("options")
    q_answers = request.form.getlist("correct_answer")
    q_model_answers = request.form.getlist("model_answer")
    q_existing_images = request.form.getlist("existing_image_paths")
    q_code_snippets = request.form.getlist("code_snippet")
    q_code_languages = request.form.getlist("code_language")
    q_time_limits = request.form.getlist("time_limit_seconds")
    q_execution_time_limits = request.form.getlist("execution_time_limit_seconds")

    rows = []
    for index, raw_text in enumerate(q_texts):
        text = (raw_text or "").strip()
        if not text:
            continue
        try:
            number = int(q_numbers[index]) if index < len(q_numbers) and q_numbers[index].strip() else index + 1
        except ValueError:
            number = index + 1
        q_type = (q_types[index] if index < len(q_types) else "short").strip().lower()
        try:
            marks = int(q_marks[index]) if index < len(q_marks) and q_marks[index].strip() else 1
        except ValueError:
            marks = 1
        options = parse_options(q_options[index] if index < len(q_options) else "")
        if q_type == "mcq" and len(options) < 2:
            raise ValueError(f"Question {number} needs at least two MCQ options.")
        existing_images = []
        if index < len(q_existing_images):
            try:
                existing_images = json.loads(q_existing_images[index] or "[]")
            except json.JSONDecodeError:
                existing_images = []
        image_paths = existing_images + _save_question_images(request.files.getlist(f"question_images_{index}"))
        try:
            time_limit_seconds = int(q_time_limits[index]) if index < len(q_time_limits) and q_time_limits[index].strip() else 0
        except ValueError:
            time_limit_seconds = 0
        try:
            execution_time_limit_seconds = (
                int(q_execution_time_limits[index])
                if index < len(q_execution_time_limits) and q_execution_time_limits[index].strip()
                else 10
            )
        except ValueError:
            execution_time_limit_seconds = 10
        rows.append(
            {
                "number": number,
                "text": text,
                "type": q_type,
                "marks": max(marks, 1),
                "options": options,
                "answer": (q_answers[index] if index < len(q_answers) else "").strip(),
                "model_answer": (q_model_answers[index] if index < len(q_model_answers) else "").strip(),
                "image_paths": image_paths,
                "code_snippet": (q_code_snippets[index] if index < len(q_code_snippets) else "").strip(),
                "code_language": (q_code_languages[index] if index < len(q_code_languages) else "").strip() or None,
                "time_limit_seconds": max(time_limit_seconds, 0),
                "execution_time_limit_seconds": min(max(execution_time_limit_seconds, 1), 60),
            }
        )
    return rows


def _save_teacher_exam_from_request(teacher, exam=None):
    is_multipart = bool(request.content_type and "multipart/form-data" in request.content_type)
    payload = {} if is_multipart else _get_json_payload()

    if exam and exam.status == "active":
        return None, (jsonify({"ok": False, "message": "Cannot edit an active exam. Close it first."}), 400)

    exam_name = (request.form.get("exam_name") if is_multipart else payload.get("exam_name") or payload.get("name") or "").strip()
    set_code = (request.form.get("set_code") if is_multipart else payload.get("set_code") or "").strip().upper()
    subject = (request.form.get("subject") if is_multipart else payload.get("subject") or "").strip()
    duration_raw = request.form.get("duration_minutes") if is_multipart else payload.get("duration_minutes")
    access_code = (request.form.get("access_code") if is_multipart else payload.get("access_code") or "").strip().upper()
    start_time = _parse_datetime_local_value(request.form.get("start_time") if is_multipart else payload.get("start_time"))
    end_time = _parse_datetime_local_value(request.form.get("end_time") if is_multipart else payload.get("end_time"))
    shuffle_questions = request.form.get("shuffle_questions") == "on" if is_multipart else bool(payload.get("shuffle_questions"))
    shuffle_options = request.form.get("shuffle_options") == "on" if is_multipart else bool(payload.get("shuffle_options"))
    attempt_limit = _parse_int_field(request.form if is_multipart else payload, "attempt_limit")
    random_question_count = _parse_int_field(request.form if is_multipart else payload, "random_question_count")

    if not exam_name or not set_code or not subject:
        return None, (jsonify({"ok": False, "message": "Exam name, set code, and subject are required."}), 400)
    duration_minutes = _parse_int_field({"duration_minutes": duration_raw}, "duration_minutes") or 0
    if duration_minutes <= 0:
        return None, (jsonify({"ok": False, "message": "Duration must be a positive number."}), 400)
    if start_time and end_time and end_time <= start_time:
        return None, (jsonify({"ok": False, "message": "End time must be after start time."}), 400)
    duplicate = ExamSet.query.filter(ExamSet.set_code == set_code)
    if exam:
        duplicate = duplicate.filter(ExamSet.id != exam.id)
    if duplicate.first():
        return None, (jsonify({"ok": False, "message": "Set code already exists. Choose another."}), 400)

    try:
        question_rows = _multipart_exam_question_rows() if is_multipart else _json_exam_question_rows(payload)
    except ValueError as exc:
        return None, (jsonify({"ok": False, "message": str(exc)}), 400)
    if not question_rows:
        return None, (jsonify({"ok": False, "message": "Add at least one question."}), 400)

    total_marks = sum(row["marks"] for row in question_rows)
    if exam:
        Question.query.filter_by(exam_set_id=exam.id).delete()
        exam.exam_name = exam_name
        exam.set_code = set_code
        exam.subject = subject
        exam.duration_minutes = duration_minutes
        exam.total_marks = total_marks
        exam.start_time = start_time
        exam.end_time = end_time
        exam.shuffle_questions = shuffle_questions
        exam.shuffle_options = shuffle_options
        exam.random_question_count = max(random_question_count or 0, 0)
        exam.attempt_limit = max(attempt_limit if attempt_limit is not None else 1, 0)
        if access_code:
            exam.access_code = access_code
    else:
        exam = ExamSet(
            exam_name=exam_name,
            set_code=set_code,
            subject=subject,
            duration_minutes=duration_minutes,
            total_marks=total_marks,
            access_code=access_code or generate_access_code(),
            status="draft",
            created_by=teacher.id,
            start_time=start_time,
            end_time=end_time,
            shuffle_questions=shuffle_questions,
            shuffle_options=shuffle_options,
            random_question_count=max(random_question_count or 0, 0),
            attempt_limit=max(attempt_limit if attempt_limit is not None else 1, 0),
        )
        db.session.add(exam)
        db.session.flush()

    for row in question_rows:
        question = Question(
            exam_set_id=exam.id,
            question_number=row["number"],
            question_text=row["text"],
            question_type=row["type"],
            marks=row["marks"],
            correct_answer=row["answer"],
            model_answer=row["model_answer"],
            code_snippet=row["code_snippet"],
            code_language=row["code_language"],
            time_limit_seconds=row["time_limit_seconds"],
            execution_time_limit_seconds=row["execution_time_limit_seconds"],
        )
        question.set_options(row["options"])
        question.set_image_paths(row["image_paths"])
        db.session.add(question)

    enrollment_payload = {
        "enrollment_lines": request.form.get("enrollment_lines") if is_multipart else payload.get("enrollment_lines"),
        "group_id": request.form.get("group_id") if is_multipart else payload.get("group_id"),
        "group_ids": request.form.get("group_ids") if is_multipart else payload.get("group_ids"),
    }
    if enrollment_payload["enrollment_lines"] or enrollment_payload["group_id"] or enrollment_payload["group_ids"]:
        _, enrollment_errors = _apply_teacher_enrollment_payload(exam, teacher, enrollment_payload)
        if enrollment_errors:
            return None, (
                jsonify(
                    {
                        "ok": False,
                        "message": enrollment_errors[0],
                        "errors": enrollment_errors,
                    }
                ),
                400,
            )

    db.session.commit()
    return exam, None


@api_bp.route("/teacher/exams", methods=["POST"])
@rate_limit("admin_action")
def teacher_create_exam_api():
    teacher, error_response = _require_teacher_api()
    if error_response:
        return error_response
    exam, save_error = _save_teacher_exam_from_request(teacher)
    if save_error:
        return save_error
    return jsonify({"ok": True, "message": "Exam saved successfully.", "exam": _exam_editor_payload(exam)}), 201


@api_bp.route("/teacher/exams/<int:exam_id>", methods=["GET", "PATCH"])
@rate_limit("admin_action", methods=("PATCH",))
def teacher_exam_editor_api(exam_id):
    exam, error_response = _require_teacher_owner(exam_id=exam_id)
    if error_response:
        return error_response
    if request.method == "GET":
        return jsonify(_exam_editor_payload(exam))
    saved_exam, save_error = _save_teacher_exam_from_request(exam.creator, exam=exam)
    if save_error:
        return save_error
    return jsonify({"ok": True, "message": "Exam saved successfully.", "exam": _exam_editor_payload(saved_exam)})


@api_bp.route("/teacher/exam/<int:exam_id>/similarity")
def teacher_similarity_api(exam_id):
    exam, error_response = _require_teacher_owner(exam_id=exam_id)
    if error_response:
        return error_response

    threshold = 0.8
    flags = []
    questions = Question.query.filter(
        Question.exam_set_id == exam.id,
        Question.question_type.in_(["long", "coding"]),
    ).order_by(Question.question_number.asc()).all()

    for question in questions:
        answers = (
            db.session.query(StudentSession, Answer)
            .join(Answer, Answer.session_id == StudentSession.id)
            .filter(
                StudentSession.exam_set_id == exam.id,
                StudentSession.status.in_(LOCKED_SESSION_STATUSES),
                Answer.question_id == question.id,
            )
            .all()
        )
        for index, (left_session, left_answer) in enumerate(answers):
            left_text = (left_answer.answer_text or "").strip()
            if len(left_text) < 40:
                continue
            for right_session, right_answer in answers[index + 1:]:
                right_text = (right_answer.answer_text or "").strip()
                if len(right_text) < 40:
                    continue
                score = SequenceMatcher(None, left_text.lower(), right_text.lower()).ratio()
                if score >= threshold:
                    flags.append(
                        {
                            "question_id": question.id,
                            "question_text": question.question_text,
                            "question_type": question.question_type,
                            "student_a": {
                                "session_id": left_session.id,
                                "name": left_session.student_name,
                                "roll_no": left_session.roll_no,
                                "answer": left_text,
                            },
                            "student_b": {
                                "session_id": right_session.id,
                                "name": right_session.student_name,
                                "roll_no": right_session.roll_no,
                                "answer": right_text,
                            },
                            "score": round(score * 100, 1),
                        }
                    )

    flags.sort(key=lambda item: item["score"], reverse=True)
    return jsonify({"ok": True, "threshold": int(threshold * 100), "flags": flags})


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
                "csv_export": f"/api/teacher/reports/exams/{exam.id}/results.csv",
                "similarity": f"/react/teacher/exam/{exam.id}/review",
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
                "answer_pdf": f"/api/teacher/reports/sessions/{student_session.id}/answer.pdf",
            },
        }
    )


@api_bp.route("/admin/dashboard")
def admin_dashboard_api():
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response

    now = datetime.utcnow()
    last_7_days = [(now - timedelta(days=offset)).date() for offset in range(6, -1, -1)]
    recent_sessions = StudentSession.query.filter(
        StudentSession.created_at >= datetime.combine(last_7_days[0], datetime.min.time())
    ).all()
    participation_trend = [
        {
            "day": day.strftime("%a"),
            "date": day.isoformat(),
            "participants": sum(1 for item in recent_sessions if item.created_at and item.created_at.date() == day),
        }
        for day in last_7_days
    ]

    submitted_statuses = ["submitted", "evaluated", "terminated", "auto_submitted"]
    pending_reviews = (
        StudentSession.query.filter(StudentSession.status.in_(submitted_statuses))
        .outerjoin(Result, Result.session_id == StudentSession.id)
        .filter(Result.id.is_(None))
        .count()
    )
    violations_today = ViolationLog.query.filter(
        ViolationLog.occurred_at >= datetime.combine(now.date(), datetime.min.time())
    ).count()
    recent_activity = (
        AuditLog.query.order_by(AuditLog.created_at.desc())
        .limit(10)
        .all()
    )
    violation_sessions = StudentSession.query.filter(StudentSession.focus_violations > 0).all()
    suspicious_by_roll = {}
    for student_session in violation_sessions:
        key = (student_session.roll_no or student_session.student_name or str(student_session.id)).upper()
        entry = suspicious_by_roll.setdefault(
            key,
            {
                "id": key,
                "name": student_session.student_name,
                "roll_no": student_session.roll_no,
                "exam_ids": set(),
                "total_violations": 0,
            },
        )
        entry["exam_ids"].add(student_session.exam_set_id)
        entry["total_violations"] += int(student_session.focus_violations or 0)
    suspicious_students = [
        {
            "id": entry["id"],
            "name": entry["name"],
            "roll_no": entry["roll_no"],
            "exam_count": len(entry["exam_ids"]),
            "total_violations": entry["total_violations"],
        }
        for entry in suspicious_by_roll.values()
        if len(entry["exam_ids"]) > 1 or entry["total_violations"] >= 3
    ]
    suspicious_students.sort(key=lambda item: (item["exam_count"], item["total_violations"]), reverse=True)

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
                "violations_today": violations_today,
                "pending_reviews": pending_reviews,
            },
            "participation_trend": participation_trend,
            "status_distribution": {
                "draft": ExamSet.query.filter_by(status="draft").count(),
                "published": ExamSet.query.filter_by(status="active").count(),
                "closed": ExamSet.query.filter_by(status="closed").count(),
                "archived": ExamSet.query.filter_by(status="archived").count(),
            },
            "recent_activity": [_audit_payload(item) for item in recent_activity],
            "suspicious_students": suspicious_students[:10],
        }
    )


@api_bp.route("/admin/settings", methods=["GET", "PATCH", "POST"])
@rate_limit("admin_action")
def admin_settings_api():
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response

    if request.method == "GET":
        return jsonify({"ok": True, "settings": _settings_payload(SettingsService.get_settings())})

    payload = _get_json_payload()
    if payload.get("registration_code_required") and not (payload.get("registration_code") or "").strip():
        return jsonify({"ok": False, "message": "Enter a registration code before requiring one."}), 400
    settings_payload = {
        "platform_name": payload.get("platform_name"),
        "welcome_message": payload.get("welcome_message"),
        "announcement_message": payload.get("announcement_message"),
        "login_page_heading": payload.get("login_page_heading"),
        "login_page_subheading": payload.get("login_page_subheading"),
        "login_page_features": payload.get("login_page_features"),
        "quote_pool": payload.get("quote_pool"),
        "max_violations_before_alert": payload.get("max_violations_before_alert"),
        "student_self_registration": "on" if payload.get("student_self_registration") else "",
        "registration_code_required": "on" if payload.get("registration_code_required") else "",
        "registration_code": payload.get("registration_code"),
        "admin_lockout_count": payload.get("admin_lockout_count"),
        "admin_idle_timeout_minutes": payload.get("admin_idle_timeout_minutes"),
    }
    settings = SettingsService.update_settings(settings_payload, updated_by=admin.id)
    AuditLog(
        user_id=admin.id,
        action="update_platform_settings_api",
        resource_type="settings",
        resource_id=settings.id,
        changes="Updated platform settings from React",
        status="success",
        ip_address=get_client_ip(),
        user_agent=request.headers.get("User-Agent"),
    ).save()
    return jsonify({"ok": True, "message": "Settings saved successfully.", "settings": _settings_payload(settings)})


@api_bp.route("/admin/settings/logo", methods=["POST"])
@rate_limit("admin_action")
def admin_settings_logo_api():
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response

    upload = request.files.get("logo")
    if not upload or not upload.filename:
        return jsonify({"ok": False, "message": "Choose a logo image to upload."}), 400

    max_bytes = 2 * 1024 * 1024
    if request.content_length and request.content_length > max_bytes + 8192:
        return jsonify({"ok": False, "message": "Logo must be 2 MB or smaller."}), 400

    filename = secure_filename(upload.filename)
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    allowed_extensions = {"png", "jpg", "jpeg", "webp", "gif"}
    if extension not in allowed_extensions:
        return jsonify({"ok": False, "message": "Logo must be PNG, JPG, WEBP, or GIF."}), 400

    upload_root = os.path.join(current_app.static_folder, "uploads", "platform")
    os.makedirs(upload_root, exist_ok=True)
    stored_filename = f"logo_{secrets.token_hex(8)}.{extension}"
    stored_path = os.path.join(upload_root, stored_filename)
    upload.save(stored_path)

    settings = SettingsService.get_settings()
    old_logo_path = getattr(settings, "logo_path", None)
    settings.logo_path = f"uploads/platform/{stored_filename}"
    settings.updated_by = admin.id
    settings.updated_at = datetime.utcnow()

    db.session.add(
        AuditLog(
            user_id=admin.id,
            action="upload_platform_logo",
            resource_type="settings",
            resource_id=settings.id,
            changes=f"Updated platform logo to {settings.logo_path}",
            status="success",
            ip_address=get_client_ip(),
            user_agent=request.headers.get("User-Agent"),
        )
    )
    db.session.commit()

    if old_logo_path and old_logo_path.startswith("uploads/platform/"):
        old_abs_path = os.path.abspath(os.path.join(current_app.static_folder, old_logo_path))
        upload_abs_root = os.path.abspath(upload_root)
        if old_abs_path.startswith(upload_abs_root) and os.path.exists(old_abs_path):
            try:
                os.remove(old_abs_path)
            except OSError:
                current_app.logger.warning("Could not remove old platform logo %s", old_abs_path)

    return jsonify({"ok": True, "message": "Logo uploaded successfully.", "settings": _settings_payload(settings)})


@api_bp.route("/admin/settings/logo", methods=["DELETE"])
@rate_limit("admin_action")
def admin_settings_logo_delete_api():
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response

    settings = SettingsService.get_settings()
    old_logo_path = getattr(settings, "logo_path", None)
    settings.logo_path = None
    settings.updated_by = admin.id
    settings.updated_at = datetime.utcnow()

    db.session.add(
        AuditLog(
            user_id=admin.id,
            action="remove_platform_logo",
            resource_type="settings",
            resource_id=settings.id,
            changes="Removed platform logo",
            status="success",
            ip_address=get_client_ip(),
            user_agent=request.headers.get("User-Agent"),
        )
    )
    db.session.commit()

    if old_logo_path and old_logo_path.startswith("uploads/platform/"):
        upload_root = os.path.abspath(os.path.join(current_app.static_folder, "uploads", "platform"))
        old_abs_path = os.path.abspath(os.path.join(current_app.static_folder, old_logo_path))
        if old_abs_path.startswith(upload_root) and os.path.exists(old_abs_path):
            try:
                os.remove(old_abs_path)
            except OSError:
                current_app.logger.warning("Could not remove platform logo %s", old_abs_path)

    return jsonify({"ok": True, "message": "Logo removed successfully.", "settings": _settings_payload(settings)})


@api_bp.route("/admin/settings/backup", methods=["POST"])
@rate_limit("admin_action")
def admin_backup_api():
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response
    payload = _get_json_payload()
    if not _admin_password_matches(payload):
        return jsonify({"ok": False, "message": "Admin password confirmation failed."}), 403

    backup_root = current_app.config.get("BACKUP_FOLDER")
    os.makedirs(backup_root, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    database_url = str(db.engine.url)

    if database_url.startswith("sqlite"):
        source_path = db.engine.url.database
        if not source_path or not os.path.exists(source_path):
            return jsonify({"ok": False, "message": "SQLite database file could not be found."}), 404
        backup_path = os.path.join(backup_root, f"exam_backup_{timestamp}.db")
        shutil.copy2(source_path, backup_path)
    elif database_url.startswith("postgres"):
        backup_path = os.path.join(backup_root, f"exam_backup_{timestamp}.sql")
        try:
            subprocess.run(
                ["pg_dump", database_url, "-f", backup_path],
                check=True,
                capture_output=True,
                text=True,
                timeout=60,
            )
        except Exception as exc:
            current_app.logger.exception("Database backup failed")
            return jsonify({"ok": False, "message": f"PostgreSQL backup failed. Ensure pg_dump is installed. Details: {exc}"}), 500
    else:
        return jsonify({"ok": False, "message": "Database backup is not configured for this database engine."}), 400

    download_name = os.path.basename(backup_path)
    AuditLog(
        user_id=admin.id,
        action="backup_database_api",
        resource_type="system",
        changes=download_name,
        status="success",
        ip_address=get_client_ip(),
        user_agent=request.headers.get("User-Agent"),
    ).save()
    return send_file(backup_path, as_attachment=True, download_name=download_name)


@api_bp.route("/admin/users")
def admin_users_api():
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response

    page = max(request.args.get("page", 1, type=int), 1)
    per_page = min(max(request.args.get("per_page", 20, type=int), 1), 100)
    role_filter = (request.args.get("role") or "all").strip().lower()
    status_filter = (request.args.get("status") or "all").strip().lower()
    search = (request.args.get("search") or "").strip()

    query = User.query
    if role_filter in {"admin", "teacher", "student"}:
        query = query.filter_by(role=role_filter)
    if status_filter == "active":
        query = query.filter_by(is_active=True)
    elif status_filter == "inactive":
        query = query.filter_by(is_active=False)
    if search:
        pattern = f"%{search.lower()}%"
        query = query.filter(
            or_(
                db.func.lower(User.name).like(pattern),
                db.func.lower(User.username).like(pattern),
                db.func.lower(User.email).like(pattern),
                db.func.lower(User.roll_number).like(pattern),
            )
        )

    pagination = query.order_by(User.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
    return jsonify(
        {
            "ok": True,
            "users": [_user_payload(user) for user in pagination.items],
            "pagination": {
                "page": pagination.page,
                "per_page": pagination.per_page,
                "pages": pagination.pages,
                "total": pagination.total,
                "has_next": pagination.has_next,
                "has_prev": pagination.has_prev,
            },
        }
    )


@api_bp.route("/admin/users/teachers", methods=["POST"])
@rate_limit("admin_action")
def admin_create_teacher_api():
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response

    payload = _get_json_payload()
    name = (payload.get("name") or "").strip()
    username = (payload.get("username") or "").strip()
    email = (payload.get("email") or "").strip() or None
    password = (payload.get("password") or "").strip()
    department = (payload.get("department") or "").strip() or None
    designation = (payload.get("designation") or "").strip() or None

    if not name or not username or not password:
        return jsonify({"ok": False, "message": "Name, username, and password are required."}), 400
    if not _valid_username(username):
        return jsonify({"ok": False, "message": "Username must be 4-50 characters and use only letters, numbers, dot, @, dash, or underscore."}), 400
    if not _strong_password(password):
        return jsonify({"ok": False, "message": "Password must be at least 10 characters and include uppercase, lowercase, and a number."}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({"ok": False, "message": "Username already exists."}), 400
    if email and User.query.filter_by(email=email).first():
        return jsonify({"ok": False, "message": "Email already exists."}), 400

    teacher = User(
        name=name,
        username=username,
        email=email,
        role="teacher",
        department=department,
        designation=designation,
        is_active=True,
        is_verified=True,
        must_change_password=True,
        created_at=datetime.utcnow(),
    )
    teacher.set_password(password)
    db.session.add(teacher)
    db.session.commit()
    AuditLog(
        user_id=admin.id,
        action="create_user_api",
        resource_type="user",
        resource_id=teacher.id,
        changes=f"Created teacher: {teacher.username}",
        status="success",
        ip_address=get_client_ip(),
    ).save()
    return jsonify({"ok": True, "message": "Teacher account created.", "user": _user_payload(teacher)}), 201


@api_bp.route("/admin/users/import-students", methods=["POST"])
@rate_limit("admin_action")
def admin_import_students_api():
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response

    payload = _get_json_payload()
    rows = payload.get("rows") or []
    if not isinstance(rows, list) or not rows:
        return jsonify({"ok": False, "message": "No student rows were provided."}), 400

    created = 0
    skipped = 0
    failed = []
    created_users = []

    for index, row in enumerate(rows, start=2):
        name = _row_payload_value(row, "name", "full_name", "student_name")
        email = _row_payload_value(row, "email", "email_address") or None
        roll_no = _row_payload_value(row, "roll", "roll_no", "roll_number", "registration").upper()
        username = _row_payload_value(row, "username", "user_name") or roll_no or (email.split("@")[0] if email else "")
        password = _row_payload_value(row, "password", "temporary_password")

        if not name or not username or not roll_no:
            failed.append({"row": index, "message": "Missing name, username/roll, or roll number."})
            continue
        if not _valid_username(username):
            failed.append({"row": index, "message": "Invalid username."})
            continue
        if User.query.filter_by(username=username).first():
            skipped += 1
            continue
        if email and User.query.filter_by(email=email).first():
            skipped += 1
            continue
        if User.query.filter_by(role="student", roll_number=roll_no).first():
            skipped += 1
            continue
        if not password:
            password = f"{secrets.token_urlsafe(8)}A1!"

        student = User(
            name=name,
            username=username,
            email=email,
            role="student",
            roll_number=roll_no,
            is_active=True,
            is_verified=True,
            created_at=datetime.utcnow(),
        )
        student.set_password(password)
        db.session.add(student)
        created += 1
        created_users.append(student)

    if created:
        db.session.commit()
    AuditLog(
        user_id=admin.id,
        action="bulk_import_students_api",
        resource_type="user",
        changes=f"created={created}, skipped={skipped}, failed={len(failed)}",
        status="success" if not failed else "warning",
        ip_address=get_client_ip(),
    ).save()
    return jsonify(
        {
            "ok": True,
            "message": f"Student import finished: {created} created, {skipped} skipped, {len(failed)} failed.",
            "created": created,
            "skipped": skipped,
            "failed": failed,
            "users": [_user_payload(user) for user in created_users],
        }
    )


@api_bp.route("/admin/users/<int:user_id>", methods=["PATCH"])
@rate_limit("admin_action")
def admin_update_user_api(user_id):
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response
    payload = _get_json_payload()
    if not _admin_password_matches(payload):
        return jsonify({"ok": False, "message": "Admin password confirmation failed."}), 403

    user = User.query.get_or_404(user_id)
    name = (payload.get("name") or user.name).strip()
    username = (payload.get("username") or user.username).strip()
    email = (payload.get("email") or "").strip() or None
    roll_number = (payload.get("roll_number") or "").strip().upper() or None
    is_active = payload.get("is_active")

    if not name or not username:
        return jsonify({"ok": False, "message": "Name and username are required."}), 400
    duplicate_username = User.query.filter(User.username == username, User.id != user.id).first()
    if duplicate_username:
        return jsonify({"ok": False, "message": "Username already exists."}), 400
    if email and User.query.filter(User.email == email, User.id != user.id).first():
        return jsonify({"ok": False, "message": "Email already exists."}), 400
    if user.id == admin.id and is_active is False:
        return jsonify({"ok": False, "message": "You cannot disable your own account."}), 400

    user.name = name
    user.username = username
    user.email = email
    user.roll_number = roll_number
    if isinstance(is_active, bool):
        user.is_active = is_active
        if not is_active:
            user.clear_active_session_token()
    db.session.commit()
    AuditLog(
        user_id=admin.id,
        action="edit_user_api",
        resource_type="user",
        resource_id=user.id,
        changes=f"Edited user: {user.username}",
        status="success",
        ip_address=get_client_ip(),
    ).save()
    return jsonify({"ok": True, "user": _user_payload(user)})


@api_bp.route("/admin/users/<int:user_id>/reset-password", methods=["POST"])
@rate_limit("admin_action")
def admin_reset_user_password_api(user_id):
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response
    payload = _get_json_payload()
    if not _admin_password_matches(payload):
        return jsonify({"ok": False, "message": "Admin password confirmation failed."}), 403
    new_password = (payload.get("new_password") or "").strip()
    if not _strong_password(new_password):
        return jsonify({"ok": False, "message": "Password must be at least 10 characters and include uppercase, lowercase, and a number."}), 400
    user = User.query.get_or_404(user_id)
    user.set_password(new_password)
    user.failed_login_attempts = 0
    user.locked_until = None
    user.must_change_password = user.role == "teacher"
    user.clear_active_session_token()
    db.session.commit()
    AuditLog(
        user_id=admin.id,
        action="reset_user_password",
        resource_type="user",
        resource_id=user.id,
        changes=f"Reset password for {user.username}",
        status="success",
        ip_address=get_client_ip(),
    ).save()
    return jsonify({"ok": True, "message": "Password reset successfully."})


@api_bp.route("/admin/users/<int:user_id>/sessions")
def admin_user_sessions_api(user_id):
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response
    user = User.query.get_or_404(user_id)
    sessions_query = StudentSession.query
    if user.role == "student":
        identifiers = [value for value in {user.roll_number, user.username} if value]
        sessions_query = sessions_query.filter(db.func.upper(StudentSession.roll_no).in_([value.upper() for value in identifiers])) if identifiers else sessions_query.filter(False)
    elif user.role == "teacher":
        exam_ids = [exam.id for exam in ExamSet.query.filter_by(created_by=user.id).all()]
        sessions_query = sessions_query.filter(StudentSession.exam_set_id.in_(exam_ids)) if exam_ids else sessions_query.filter(False)
    else:
        sessions_query = sessions_query.filter(False)

    sessions = sessions_query.order_by(StudentSession.created_at.desc()).limit(100).all()
    return jsonify(
        {
            "ok": True,
            "user": _user_payload(user),
            "sessions": [
                {
                    "id": item.id,
                    "exam_name": item.exam_set.exam_name if item.exam_set else None,
                    "session_code": item.session_code,
                    "start_time": _iso_datetime(item.start_time),
                    "end_time": _iso_datetime(item.end_time),
                    "submitted_at": _iso_datetime(item.submitted_at),
                    "status": item.status,
                    "score": item.result.total_marks_obtained if item.result else None,
                    "total_marks": item.result.total_marks if item.result else None,
                    "percentage": item.result.percentage if item.result else None,
                }
                for item in sessions
            ],
        }
    )


@api_bp.route("/admin/exams")
def admin_exams_api():
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response
    page = max(request.args.get("page", 1, type=int), 1)
    per_page = min(max(request.args.get("per_page", 20, type=int), 1), 100)
    status_filter = (request.args.get("status") or "all").strip().lower()
    teacher_id = request.args.get("teacher_id", type=int)
    search = (request.args.get("search") or "").strip()

    query = ExamSet.query
    if status_filter != "all":
        query = query.filter_by(status=status_filter)
    if teacher_id:
        query = query.filter_by(created_by=teacher_id)
    if search:
        pattern = f"%{search.lower()}%"
        query = query.filter(or_(db.func.lower(ExamSet.exam_name).like(pattern), db.func.lower(ExamSet.subject).like(pattern)))

    pagination = query.order_by(ExamSet.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
    all_query = ExamSet.query
    return jsonify(
        {
            "ok": True,
            "exams": [_admin_exam_payload(exam) for exam in pagination.items],
            "stats": {
                "total": all_query.count(),
                "draft": all_query.filter_by(status="draft").count(),
                "published": all_query.filter_by(status="active").count(),
                "closed": all_query.filter_by(status="closed").count(),
                "archived": all_query.filter_by(status="archived").count(),
            },
            "teachers": [_user_payload(user) for user in User.query.filter_by(role="teacher").order_by(User.name.asc()).all()],
            "pagination": {
                "page": pagination.page,
                "per_page": pagination.per_page,
                "pages": pagination.pages,
                "total": pagination.total,
            },
        }
    )


@api_bp.route("/admin/exams/<int:exam_id>/status", methods=["POST"])
@rate_limit("admin_action")
def admin_exam_status_api(exam_id):
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response

    payload = _get_json_payload()
    action = (payload.get("action") or "").strip().lower()
    exam = ExamSet.query.get_or_404(exam_id)

    if action in {"activate", "publish", "published"}:
        if exam.status != "draft":
            return jsonify({"ok": False, "message": "Only draft exams can be activated."}), 400
        if not exam.questions:
            return jsonify({"ok": False, "message": "Add at least one question before activating."}), 400
        exam.activate()
        audit_action = "activate_exam_api"
        message = f"Exam {exam.exam_name} activated."
    elif action in {"close", "archive", "archived"}:
        if exam.status == "closed":
            return jsonify({"ok": False, "message": "Exam is already closed."}), 400
        exam.close()
        audit_action = "close_exam_api"
        message = "Exam closed."
    else:
        return jsonify({"ok": False, "message": "Unsupported exam status action."}), 400

    AuditLog(
        user_id=admin.id,
        action=audit_action,
        resource_type="exam",
        resource_id=exam.id,
        changes=f"{action}: {exam.exam_name}",
        status="success",
        ip_address=get_client_ip(),
    ).save()
    return jsonify({"ok": True, "message": message, "exam": _admin_exam_payload(exam)})


@api_bp.route("/admin/exams/<int:exam_id>", methods=["DELETE"])
@rate_limit("admin_action")
def admin_exam_delete_api(exam_id):
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response

    payload = _get_json_payload()
    if payload.get("confirm_word") != "DELETE":
        return jsonify({"ok": False, "message": "Type DELETE to delete this exam."}), 400

    exam = ExamSet.query.get_or_404(exam_id)
    exam_name = exam.exam_name
    session_ids = [item.id for item in StudentSession.query.filter_by(exam_set_id=exam.id).all()]
    result_ids = []
    if session_ids:
        result_ids = [item.id for item in Result.query.filter(Result.session_id.in_(session_ids)).all()]
        if result_ids:
            QuestionMark.query.filter(QuestionMark.result_id.in_(result_ids)).delete(synchronize_session=False)
            Result.query.filter(Result.id.in_(result_ids)).delete(synchronize_session=False)
        Answer.query.filter(Answer.session_id.in_(session_ids)).delete(synchronize_session=False)
        ViolationLog.query.filter(ViolationLog.session_id.in_(session_ids)).delete(synchronize_session=False)
        Notification.query.filter(Notification.session_id.in_(session_ids)).delete(synchronize_session=False)
        StudentSession.query.filter(StudentSession.id.in_(session_ids)).delete(synchronize_session=False)

    ExamEnrollment.query.filter_by(exam_set_id=exam.id).delete(synchronize_session=False)
    Question.query.filter_by(exam_set_id=exam.id).delete(synchronize_session=False)
    db.session.delete(exam)
    db.session.add(
        AuditLog(
            user_id=admin.id,
            action="delete_exam_api",
            resource_type="exam",
            resource_id=exam_id,
            changes=f"Deleted exam {exam_name}; sessions={len(session_ids)}; results={len(result_ids)}",
            status="success",
            ip_address=get_client_ip(),
            user_agent=request.headers.get("User-Agent"),
        )
    )
    db.session.commit()
    return jsonify({"ok": True, "message": f"Exam '{exam_name}' deleted."})


@api_bp.route("/admin/exams/<int:exam_id>/report.pdf")
def admin_exam_report_pdf_api(exam_id):
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response

    exam = ExamSet.query.get_or_404(exam_id)
    sessions = (
        StudentSession.query.filter_by(exam_set_id=exam.id)
        .order_by(StudentSession.created_at.asc())
        .all()
    )
    questions = Question.query.filter_by(exam_set_id=exam.id).order_by(Question.question_number.asc()).all()

    import io
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.utils import simpleSplit
    from reportlab.pdfgen import canvas

    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    left = 16 * mm
    y = height - 18 * mm
    usable_width = width - (2 * left)

    def page_break(required=20 * mm):
        nonlocal y
        if y < required:
            pdf.showPage()
            y = height - 18 * mm

    def line(text, font="Helvetica", size=10, leading=6 * mm):
        nonlocal y
        pdf.setFont(font, size)
        for part in simpleSplit(str(text or "-"), font, size, usable_width):
            page_break()
            pdf.drawString(left, y, part)
            y -= leading

    pdf.setFont("Helvetica-Bold", 17)
    pdf.drawString(left, y, f"Exam Report: {exam.exam_name}")
    y -= 10 * mm
    line(f"Subject: {exam.subject} | Set: {exam.set_code} | Status: {exam.status}", size=10)
    line(f"Duration: {exam.duration_minutes} minutes | Total Marks: {exam.total_marks} | Access Code: {exam.access_code}", size=10)
    if exam.start_time or exam.end_time:
        line(f"Window: {format_datetime(exam.start_time) if exam.start_time else 'Open'} to {format_datetime(exam.end_time) if exam.end_time else 'No end'}", size=10)
    y -= 4 * mm

    total_sessions = len(sessions)
    submitted = sum(1 for item in sessions if item.status in LOCKED_SESSION_STATUSES)
    active = sum(1 for item in sessions if item.status == "active")
    violations = sum(item.focus_violations for item in sessions)
    line("Summary", font="Helvetica-Bold", size=13)
    line(f"Sessions: {total_sessions} | Submitted/Locked: {submitted} | Active: {active} | Total Violations: {violations}")
    y -= 4 * mm

    line("Questions", font="Helvetica-Bold", size=13)
    for question in questions:
        page_break(35 * mm)
        line(f"Q{question.question_number}. [{question.question_type.upper()}] {question.marks} marks", font="Helvetica-Bold")
        line(question.question_text, size=9, leading=5 * mm)
    y -= 4 * mm

    line("Student Sessions", font="Helvetica-Bold", size=13)
    for student_session in sessions:
        result = student_session.result
        score = f"{result.total_marks_obtained}/{result.total_marks} ({result.percentage}%)" if result else "Not evaluated"
        page_break(20 * mm)
        line(
            f"{student_session.student_name} | Roll {student_session.roll_no} | {student_session.status} | Score: {score} | Violations: {student_session.focus_violations}",
            size=9,
            leading=5 * mm,
        )

    pdf.showPage()
    pdf.save()
    buffer.seek(0)
    safe_code = "".join(ch if ch.isalnum() else "_" for ch in (exam.set_code or str(exam.id)))
    return send_file(buffer, as_attachment=True, download_name=f"exam_report_{safe_code}.pdf", mimetype="application/pdf")


@api_bp.route("/admin/audit-log")
def admin_audit_log_api():
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response
    page = max(request.args.get("page", 1, type=int), 1)
    per_page = min(max(request.args.get("per_page", 20, type=int), 1), 100)
    action_type = (request.args.get("action_type") or "").strip()
    query = AuditLog.query
    if action_type:
        query = query.filter(AuditLog.action == action_type)
    pagination = query.order_by(AuditLog.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
    return jsonify(
        {
            "ok": True,
            "items": [
                {
                    **_audit_payload(item),
                    "admin_user": item.user.name if item.user else "System",
                    "target_user": item.resource_id if item.resource_type == "user" else None,
                }
                for item in pagination.items
            ],
            "pagination": {
                "page": pagination.page,
                "per_page": pagination.per_page,
                "pages": pagination.pages,
                "total": pagination.total,
            },
        }
    )


@api_bp.route("/admin/students/search")
def admin_students_search_api():
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response
    query_text = (request.args.get("q") or "").strip().lower()
    query = User.query.filter_by(role="student", is_active=True)
    if query_text:
        pattern = f"%{query_text}%"
        query = query.filter(
            or_(
                db.func.lower(User.name).like(pattern),
                db.func.lower(User.username).like(pattern),
                db.func.lower(User.email).like(pattern),
                db.func.lower(User.roll_number).like(pattern),
            )
        )
    students = query.order_by(User.name.asc()).limit(20).all()
    return jsonify({"ok": True, "students": [_user_payload(student) for student in students]})


@api_bp.route("/admin/groups", methods=["GET", "POST"])
@rate_limit("admin_action")
def admin_groups_api():
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response
    if request.method == "POST":
        payload = _get_json_payload()
        name = (payload.get("name") or "").strip()
        description = (payload.get("description") or "").strip() or None
        if not name:
            return jsonify({"ok": False, "message": "Group name is required."}), 400
        if StudentGroup.query.filter(db.func.lower(StudentGroup.name) == name.lower()).first():
            return jsonify({"ok": False, "message": "A group with this name already exists."}), 400
        group = StudentGroup(name=name, description=description, created_by=admin.id)
        _assign_unique_group_join_code(group)
        db.session.add(group)
        db.session.commit()
        return jsonify({"ok": True, "group": _group_payload(group)}), 201
    groups = StudentGroup.query.order_by(StudentGroup.name.asc()).all()
    return jsonify({"ok": True, "groups": [_group_payload(group) for group in groups]})


@api_bp.route("/admin/groups/<int:group_id>/members", methods=["POST"])
@rate_limit("admin_action")
def admin_group_members_api(group_id):
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response
    group = StudentGroup.query.get_or_404(group_id)
    payload = _get_json_payload()
    raw_members = payload.get("members") or []
    if isinstance(raw_members, str):
        identifiers = [line.strip() for line in raw_members.splitlines() if line.strip()]
    elif isinstance(raw_members, list):
        identifiers = [str(item).strip() for item in raw_members if str(item).strip()]
    else:
        identifiers = []
    if payload.get("student_id"):
        student = User.query.filter_by(id=payload.get("student_id"), role="student").first()
        identifiers.append(student.username if student else "")

    existing_student_ids = {member.student_id for member in group.members}
    added = 0
    skipped = 0
    for identifier in identifiers:
        student = _find_student_by_identifier(identifier)
        if not student or student.id in existing_student_ids:
            skipped += 1
            continue
        db.session.add(StudentGroupMember(group_id=group.id, student_id=student.id))
        student.batch = group.name[:20]
        existing_student_ids.add(student.id)
        added += 1
    db.session.commit()
    return jsonify({"ok": True, "added": added, "skipped": skipped, "group": _group_payload(group)})


@api_bp.route("/admin/groups/<int:group_id>/join-code", methods=["PATCH"])
@rate_limit("admin_action")
def admin_group_join_code_api(group_id):
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response
    group = StudentGroup.query.get_or_404(group_id)
    _assign_unique_group_join_code(group)
    db.session.commit()
    return jsonify({"ok": True, "message": "Batch code regenerated.", "group": _group_payload(group)})


@api_bp.route("/admin/groups/<int:group_id>/members/<int:member_id>", methods=["DELETE"])
@rate_limit("admin_action")
def admin_group_member_delete_api(group_id, member_id):
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response
    member = StudentGroupMember.query.filter_by(group_id=group_id, id=member_id).first_or_404()
    if member.student and member.student.batch == member.group.name[:20]:
        member.student.batch = None
    db.session.delete(member)
    db.session.commit()
    group = StudentGroup.query.get_or_404(group_id)
    return jsonify({"ok": True, "group": _group_payload(group)})


@api_bp.route("/admin/groups/<int:group_id>", methods=["DELETE"])
@rate_limit("admin_action")
def admin_group_delete_api(group_id):
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response
    payload = _get_json_payload()
    if not _admin_password_matches(payload):
        return jsonify({"ok": False, "message": "Admin password confirmation failed."}), 403
    group = StudentGroup.query.get_or_404(group_id)
    db.session.delete(group)
    db.session.commit()
    return jsonify({"ok": True, "message": "Group deleted."})


@api_bp.route("/teacher/question-bank", methods=["GET", "POST"])
@rate_limit("admin_action")
def teacher_question_bank_api():
    teacher, error_response = _require_teacher_api()
    if error_response:
        return error_response
    if request.method == "POST":
        is_multipart = request.content_type and request.content_type.startswith("multipart/form-data")
        payload = request.form if is_multipart else _get_json_payload()
        question_text = (payload.get("question_text") or "").strip()
        question_type = (payload.get("question_type") or "short").strip().lower()
        marks = _parse_int_field(payload, "marks") or 1
        options = parse_options(payload.get("options") or [])
        if is_multipart:
            try:
                existing_image_paths = json.loads(payload.get("image_paths") or "[]")
            except json.JSONDecodeError:
                existing_image_paths = []
            image_paths = existing_image_paths + _save_question_images(request.files.getlist("question_images"))
        else:
            image_paths = payload.get("image_paths") or []
        if not question_text:
            return jsonify({"ok": False, "message": "Question text is required."}), 400
        if question_type == "mcq" and len(options) < 2:
            return jsonify({"ok": False, "message": "MCQ questions need at least two options."}), 400
        item = QuestionBankItem(
            teacher_id=teacher.id,
            question_text=question_text,
            question_type=question_type,
            marks=max(marks, 1),
            correct_answer=(payload.get("correct_answer") or "").strip(),
            model_answer=(payload.get("model_answer") or "").strip(),
            explanation=(payload.get("explanation") or "").strip(),
            code_snippet=(payload.get("code_snippet") or "").strip(),
            code_language=(payload.get("code_language") or "").strip() or None,
            time_limit_seconds=max(_parse_int_field(payload, "time_limit_seconds") or 0, 0),
            execution_time_limit_seconds=min(
                max(_parse_int_field(payload, "execution_time_limit_seconds") or 10, 1),
                60,
            ),
        )
        item.set_options(options)
        item.set_image_paths(image_paths)
        db.session.add(item)
        db.session.commit()
        return jsonify({"ok": True, "item": _question_bank_payload(item)}), 201
    items = (
        QuestionBankItem.query.filter_by(teacher_id=teacher.id)
        .order_by(QuestionBankItem.created_at.desc())
        .all()
    )
    return jsonify({"ok": True, "items": [_question_bank_payload(item) for item in items]})


@api_bp.route("/teacher/question-bank/<int:item_id>", methods=["PATCH", "DELETE"])
@rate_limit("admin_action")
def teacher_question_bank_item_api(item_id):
    teacher, error_response = _require_teacher_api()
    if error_response:
        return error_response
    item = QuestionBankItem.query.filter_by(id=item_id, teacher_id=teacher.id).first_or_404()
    if request.method == "DELETE":
        db.session.delete(item)
        db.session.commit()
        return jsonify({"ok": True, "message": "Question removed from bank."})
    payload = _get_json_payload()
    if "question_text" in payload:
        item.question_text = (payload.get("question_text") or "").strip()
    if "question_type" in payload:
        item.question_type = (payload.get("question_type") or "short").strip().lower()
    if "marks" in payload:
        item.marks = max(_parse_int_field(payload, "marks") or 1, 1)
    if "options" in payload:
        item.set_options(parse_options(payload.get("options") or []))
    for field in ["correct_answer", "model_answer", "explanation", "code_snippet", "code_language"]:
        if field in payload:
            setattr(item, field, (payload.get(field) or "").strip() or None)
    if "time_limit_seconds" in payload:
        item.time_limit_seconds = max(_parse_int_field(payload, "time_limit_seconds") or 0, 0)
    if "execution_time_limit_seconds" in payload:
        item.execution_time_limit_seconds = min(
            max(_parse_int_field(payload, "execution_time_limit_seconds") or 10, 1),
            60,
        )
    db.session.commit()
    return jsonify({"ok": True, "item": _question_bank_payload(item)})


@api_bp.route("/teacher/exam/<int:exam_id>/question-bank/import", methods=["POST"])
@rate_limit("admin_action")
def teacher_import_question_bank_api(exam_id):
    exam, error_response = _require_teacher_owner(exam_id=exam_id)
    if error_response:
        return error_response
    if exam.status == "active":
        return jsonify({"ok": False, "message": "Cannot import bank questions while the exam is active. Close it first."}), 400

    payload = _get_json_payload()
    raw_ids = payload.get("bank_item_ids") or payload.get("bank_item_id") or []
    if not isinstance(raw_ids, list):
        raw_ids = [raw_ids]
    selected_ids = []
    for item_id in raw_ids:
        try:
            selected_ids.append(int(item_id))
        except (TypeError, ValueError):
            continue
    if not selected_ids:
        return jsonify({"ok": False, "message": "Choose at least one bank question to import."}), 400

    bank_items = QuestionBankItem.query.filter(
        QuestionBankItem.teacher_id == exam.created_by,
        QuestionBankItem.id.in_(selected_ids),
    ).all()
    if not bank_items:
        return jsonify({"ok": False, "message": "No matching bank questions found."}), 404

    last_question = (
        Question.query.filter_by(exam_set_id=exam.id)
        .order_by(Question.question_number.desc())
        .first()
    )
    next_number = (last_question.question_number if last_question else 0) + 1
    imported_questions = []

    for item in bank_items:
        question = Question(
            exam_set_id=exam.id,
            question_number=next_number,
            question_text=item.question_text,
            question_type=item.question_type,
            marks=item.marks,
            correct_answer=item.correct_answer,
            explanation=item.explanation,
            model_answer=item.model_answer,
            code_snippet=item.code_snippet,
            code_language=item.code_language,
            time_limit_seconds=item.time_limit_seconds,
            execution_time_limit_seconds=item.execution_time_limit_seconds,
        )
        question.set_options(item.options_as_list())
        question.set_image_paths(item.image_paths_as_list())
        db.session.add(question)
        imported_questions.append(question)
        next_number += 1

    db.session.flush()
    exam.total_marks = sum(q.marks for q in Question.query.filter_by(exam_set_id=exam.id).all())
    db.session.commit()
    return jsonify(
        {
            "ok": True,
            "message": f"Imported {len(imported_questions)} question(s).",
            "imported_count": len(imported_questions),
            "questions": [_question_payload(question) for question in imported_questions],
        }
    )


@api_bp.route("/student/results")
def student_results_api():
    if session.get("role") != "student" or not session.get("roll_no"):
        return jsonify({"ok": False, "message": "Student login required"}), 401
    student_user_id = session.get("student_user_id")
    if student_user_id:
        student_user = User.query.get(student_user_id)
        if (
            not student_user
            or student_user.role != "student"
            or not student_user.is_active
            or not current_session_matches_user(student_user)
        ):
            session.clear()
            return jsonify({"ok": False, "message": "This student account is active in another browser. Please log in again here."}), 401

    roll_no = (session.get("roll_no") or "").strip().upper()
    published_results = (
        Result.query.join(StudentSession, Result.session_id == StudentSession.id)
        .filter(db.func.upper(StudentSession.roll_no) == roll_no, Result.published.is_(True))
        .order_by(Result.published_at.desc(), Result.updated_at.desc())
        .all()
    )

    payload = []
    for result in published_results:
        student_session = result.session
        exam = student_session.exam_set
        answers_by_question = {answer.question_id: answer for answer in student_session.answers}
        marks_by_question = {mark.question_id: mark for mark in result.question_marks}
        questions = Question.query.filter_by(exam_set_id=exam.id).order_by(Question.question_number.asc()).all()
        payload.append(
            {
                "id": result.id,
                "session_id": student_session.id,
                "session_code": student_session.session_code,
                "exam_id": exam.id,
                "exam_name": exam.exam_name,
                "subject": exam.subject,
                "teacher_name": exam.creator.name if exam.creator else None,
                "submitted_at": _iso_datetime(student_session.submitted_at),
                "published_at": _iso_datetime(result.published_at),
                "total_marks_obtained": result.total_marks_obtained,
                "total_marks": result.total_marks,
                "percentage": result.percentage,
                "teacher_remarks": result.teacher_remarks,
                "status": "passed" if result.percentage >= 40 else "failed",
                "pdf_url": url_for("student.result_pdf", session_code=student_session.session_code),
                "questions": [
                    _result_question_payload(
                        question,
                        answers_by_question.get(question.id),
                        marks_by_question.get(question.id),
                        result,
                    )
                    for question in questions
                ],
            }
        )
    return jsonify({"ok": True, "results": payload})


@api_bp.route("/student/results/<int:exam_id>")
def student_result_detail_api(exam_id):
    if session.get("role") != "student" or not session.get("roll_no"):
        return jsonify({"ok": False, "message": "Student login required"}), 401
    student_user_id = session.get("student_user_id")
    if student_user_id:
        student_user = User.query.get(student_user_id)
        if (
            not student_user
            or student_user.role != "student"
            or not student_user.is_active
            or not current_session_matches_user(student_user)
        ):
            session.clear()
            return jsonify({"ok": False, "message": "This student account is active in another browser. Please log in again here."}), 401

    roll_no = (session.get("roll_no") or "").strip().upper()
    result = (
        Result.query.join(StudentSession, Result.session_id == StudentSession.id)
        .filter(
            db.func.upper(StudentSession.roll_no) == roll_no,
            StudentSession.exam_set_id == exam_id,
            Result.published.is_(True),
        )
        .order_by(Result.published_at.desc(), Result.updated_at.desc())
        .first()
    )
    if not result:
        return jsonify({"ok": False, "message": "Published result not found."}), 404

    student_session = result.session
    exam = student_session.exam_set
    answers_by_question = {answer.question_id: answer for answer in student_session.answers}
    marks_by_question = {mark.question_id: mark for mark in result.question_marks}
    questions = Question.query.filter_by(exam_set_id=exam.id).order_by(Question.question_number.asc()).all()
    return jsonify(
        {
            "ok": True,
            "result": {
                "id": result.id,
                "session_id": student_session.id,
                "session_code": student_session.session_code,
                "exam_id": exam.id,
                "exam_name": exam.exam_name,
                "subject": exam.subject,
                "teacher_name": exam.creator.name if exam.creator else None,
                "submitted_at": _iso_datetime(student_session.submitted_at),
                "published_at": _iso_datetime(result.published_at),
                "total_marks_obtained": result.total_marks_obtained,
                "total_marks": result.total_marks,
                "percentage": result.percentage,
                "teacher_remarks": result.teacher_remarks,
                "status": "passed" if result.percentage >= 40 else "failed",
                "pdf_url": url_for("student.result_pdf", session_code=student_session.session_code),
                "questions": [
                    _result_question_payload(
                        question,
                        answers_by_question.get(question.id),
                        marks_by_question.get(question.id),
                        result,
                    )
                    for question in questions
                ],
            },
        }
    )


@api_bp.route("/notifications")
def notifications_api():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"ok": False, "message": "Not logged in"}), 401
    user = User.query.get(user_id)
    if not user or not user.is_active or not current_session_matches_user(user):
        session.clear()
        return jsonify({"ok": False, "message": "This account is active in another browser. Please log in again here."}), 401
    filter_name = (request.args.get("filter") or "all").strip().lower()
    page = max(request.args.get("page", 1, type=int), 1)
    per_page = min(max(request.args.get("per_page", 20, type=int), 1), 100)
    query = Notification.query.filter_by(recipient_user_id=user_id)
    if filter_name == "unread":
        query = query.filter_by(is_read=False)
    elif filter_name == "system":
        query = query.filter(Notification.notification_type.in_(["system", "info"]))
    elif filter_name == "admin":
        query = query.filter(Notification.notification_type.like("%admin%"))
    pagination = query.order_by(Notification.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
    items = [
        {
            "id": item.id,
            "type": item.notification_type,
            "message": item.message,
            "is_read": item.is_read,
            "created_at": _iso_datetime(item.created_at),
            "related_entity_type": item.related_entity_type,
            "related_entity_id": item.related_entity_id,
        }
        for item in pagination.items
    ]
    return jsonify(
        {
            "ok": True,
            "items": items,
            "unread_count": NotificationService.unread_count_for_user(user_id),
            "pagination": {
                "page": pagination.page,
                "per_page": pagination.per_page,
                "pages": pagination.pages,
                "total": pagination.total,
            },
        }
    )


@api_bp.route("/notifications/<int:notification_id>/read", methods=["POST"])
def notification_mark_read_api(notification_id):
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"ok": False, "message": "Not logged in"}), 401
    notification = Notification.query.filter_by(id=notification_id, recipient_user_id=user_id).first_or_404()
    notification.mark_read()
    db.session.commit()
    return jsonify({"ok": True})


@api_bp.route("/admin/proctoring/status")
def admin_proctoring_status_api():
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response

    active_sessions = (
        StudentSession.query.filter(StudentSession.status.in_(["active", "waiting", "paused"]))
        .order_by(StudentSession.focus_violations.desc(), StudentSession.updated_at.desc())
        .limit(100)
        .all()
    )
    snapshots = [_proctor_session_payload(student_session) for student_session in active_sessions]

    return jsonify(
        {
            "ok": True,
            "updated_at": _iso_datetime(datetime.utcnow()),
            "counts": _proctor_counts(snapshots),
            "sessions": snapshots,
            "recent_violations": _recent_violations_payload(),
        }
    )


@api_bp.route("/teacher/proctoring/status")
def teacher_proctoring_status_api():
    teacher, error_response = _require_teacher_api()
    if error_response:
        return error_response

    exam_ids = [exam.id for exam in ExamSet.query.filter_by(created_by=teacher.id).all()]
    active_sessions = []
    if exam_ids:
        active_sessions = (
            StudentSession.query.filter(
                StudentSession.exam_set_id.in_(exam_ids),
                StudentSession.status.in_(["active", "waiting", "paused"]),
            )
            .order_by(StudentSession.focus_violations.desc(), StudentSession.updated_at.desc())
            .limit(100)
            .all()
        )
    snapshots = [_proctor_session_payload(student_session) for student_session in active_sessions]

    return jsonify(
        {
            "ok": True,
            "updated_at": _iso_datetime(datetime.utcnow()),
            "counts": _proctor_counts(snapshots),
            "sessions": snapshots,
        }
    )


@api_bp.route("/admin/proctoring/session/<int:session_id>/action", methods=["POST"])
@rate_limit("admin_action")
def admin_proctoring_action_api(session_id):
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response

    payload = _get_json_payload()
    if not _admin_password_matches(payload):
        return jsonify({"ok": False, "message": "Admin password confirmation failed."}), 403

    student_session = StudentSession.query.get_or_404(session_id)
    action = (payload.get("action") or "").strip().lower()
    reason = (payload.get("reason") or "").strip()
    response_message = ""

    if action == "terminate":
        reason = reason or "Terminated by admin"
        if student_session.status not in LOCKED_SESSION_STATUSES:
            ExamService.end_exam(student_session.session_code, reason=reason, status="terminated")
            emit_to_session(
                student_session,
                "exam:terminated",
                {
                    "reason": reason,
                    "redirect": f"/react/student/submitted/{student_session.session_code}",
                },
            )
        _record_admin_session_action(student_session, "terminate_exam_session", reason=reason)
        response_message = f"Terminated {student_session.student_name}'s exam."

    elif action == "second_chance":
        if student_session.status in LOCKED_SESSION_STATUSES:
            return jsonify({"ok": False, "message": "Locked sessions cannot be resumed."}), 409
        student_session.status = "active"
        student_session.focus_violations = 0
        student_session.tab_switch_count = 0
        student_session.suspicion_score = 0
        student_session.last_heartbeat = datetime.utcnow()
        student_session.active_window_token = None
        student_session.active_window_heartbeat_at = None
        student_session.pause_requested_at = None
        student_session.pause_reason = None
        student_session.paused_at = None
        student_session.paused_remaining_seconds = None
        if not student_session.start_time:
            student_session.start_time = datetime.utcnow()
        emit_to_session(
            student_session,
            "exam:second_chance",
            {"message": "Admin has granted you a second chance. Your exam can resume."},
        )
        _record_admin_session_action(student_session, "grant_second_chance", reason=reason or None)
        response_message = f"Second chance granted to {student_session.student_name}."

    elif action == "reduce_time":
        minutes = _parse_int_field(payload, "minutes") or 0
        if minutes <= 0:
            return jsonify({"ok": False, "message": "Enter a positive number of minutes."}), 400
        if student_session.status not in {"active", "paused"}:
            return jsonify({"ok": False, "message": "Time can only be reduced for active or paused sessions."}), 409
        if student_session.status == "paused":
            student_session.paused_remaining_seconds = max(
                int(student_session.paused_remaining_seconds or 0) - minutes * 60,
                60,
            )
        else:
            student_session.start_time = (student_session.start_time or datetime.utcnow()) - timedelta(minutes=minutes)
        emit_to_session(
            student_session,
            "exam:time_reduced",
            {"newRemainingSeconds": ExamService.remaining_seconds_for_session(student_session)},
        )
        _record_admin_session_action(
            student_session,
            "reduce_exam_time",
            reason=reason or None,
            changes=f"Reduced remaining time by {minutes} minutes",
        )
        response_message = f"Reduced {student_session.student_name}'s time by {minutes} minute(s)."

    elif action == "pause":
        reason = reason or student_session.pause_reason or "Paused by admin"
        if not ExamService.pause_session(student_session):
            return jsonify({"ok": False, "message": "Only active sessions can be paused."}), 409
        emit_to_session(
            student_session,
            "exam:paused",
            {"message": "An admin has paused your exam timer. Stay on this screen."},
        )
        _record_admin_session_action(student_session, "pause_exam_session", reason=reason)
        response_message = f"Paused {student_session.student_name}'s exam timer."

    elif action == "resume":
        reason = reason or "Resumed by admin"
        if not ExamService.resume_session(student_session):
            return jsonify({"ok": False, "message": "Only paused sessions can be resumed."}), 409
        emit_to_session(
            student_session,
            "exam:resumed",
            {
                "message": "Your exam has resumed.",
                "remainingSeconds": ExamService.remaining_seconds_for_session(student_session),
            },
        )
        _record_admin_session_action(student_session, "resume_exam_session", reason=reason)
        response_message = f"Resumed {student_session.student_name}'s exam."

    elif action == "message":
        message = (payload.get("message") or "").strip()
        if not message:
            return jsonify({"ok": False, "message": "Enter a message to send."}), 400
        message = message[:500]
        NotificationService.notify_session(
            student_session.id,
            message,
            notification_type="admin_message",
            related_entity_type="student_session",
            related_entity_id=student_session.id,
        )
        emit_to_session(student_session, "exam:admin_message", {"message": message})
        _record_admin_session_action(
            student_session,
            "send_student_message",
            reason=reason or None,
            changes=message,
        )
        response_message = f"Message sent to {student_session.student_name}."

    else:
        return jsonify({"ok": False, "message": "Unsupported proctoring action."}), 400

    student_session.updated_at = datetime.utcnow()
    db.session.commit()
    _emit_proctor_session_update(student_session)

    return jsonify(
        {
            "ok": True,
            "message": response_message,
            "session": _proctor_session_payload(student_session),
        }
    )


@api_bp.route("/notifications/mark-read", methods=["POST"])
def mark_notifications_read():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"ok": False, "message": "Not logged in"}), 401
    user = User.query.get(user_id)
    if not user or not user.is_active or not current_session_matches_user(user):
        session.clear()
        return jsonify({
            "ok": False,
            "message": "This account is active in another browser. Please log in again here.",
        }), 401
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
    waiting_sessions = (
        StudentSession.query.filter_by(exam_set_id=exam.id, status="waiting")
        .order_by(StudentSession.created_at.asc())
        .all()
    )
    waiting_ids = [item.id for item in waiting_sessions]
    lobby_position = waiting_ids.index(student_session.id) + 1 if student_session.id in waiting_ids else None
    student_user = _find_student_by_identifier(student_session.roll_no)

    return jsonify(
        {
            "ok": True,
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
            "exam_status": exam.status,
            "session_status": student_session.status,
            "time_state": time_state,
            "remaining_seconds": remaining_seconds,
            "focus_violations": student_session.focus_violations,
            "max_violations_allowed": SettingsService.max_violations_allowed(),
            "suspicion_score": getattr(student_session, "suspicion_score", 0),
            "student_session": {
                "id": student_session.id,
                "session_code": student_session.session_code,
                "student_name": student_session.student_name,
                "roll_no": student_session.roll_no,
                "profile_picture": url_for("static", filename=student_user.profile_picture) if student_user and student_user.profile_picture else None,
                "status": student_session.status,
                "created_at": _iso_datetime(student_session.created_at),
            },
            "lobby": {
                "waiting_count": len(waiting_sessions),
                "position": lobby_position,
            },
            "pause_requested": bool(student_session.pause_requested_at),
            "pause_reason": student_session.pause_reason,
            "paused": student_session.status == "paused",
            "submitted": is_locked,
            "redirect": _submitted_redirect(session_code) if is_locked else None,
            "ready_redirect": f"/react/student/precheck/{session_code}" if exam.status == "active" and time_state == "open" and not student_session.start_time else None,
            "exam_redirect": f"/react/exam/{session_code}" if exam.status == "active" and student_session.start_time and not is_locked else None,
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
            redirect=f"/react/student/waiting/{session_code}",
        )
    if not student_session.start_time:
        return _forbidden_session_response(
            "Please complete the pre-exam checklist first.",
            redirect=f"/react/student/precheck/{session_code}",
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
                "options": _question_options_for_attempt(question, student_session),
                "image_urls": [url_for("static", filename=path) for path in question.image_paths_as_list()],
                "code_snippet": question.code_snippet,
                "code_language": question.code_language or "python",
                "time_limit_seconds": question.time_limit_seconds or 0,
                "execution_time_limit_seconds": question.execution_time_limit_seconds or 10,
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
                "submitted_url": f"/react/student/submitted/{session_code}",
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

    default_timeout = current_app.config.get("CODE_EXECUTION_TIMEOUT_SECONDS", 10)
    try:
        timeout_seconds = int(question.execution_time_limit_seconds or default_timeout or 10)
    except (TypeError, ValueError):
        timeout_seconds = int(default_timeout or 10)
    timeout_seconds = min(max(timeout_seconds, 1), 60)

    result = CodeExecutionService.run_python(
        code=code,
        stdin_text=stdin_text,
        timeout_seconds=timeout_seconds,
        max_chars=current_app.config.get("CODE_EXECUTION_MAX_CHARS", 12000),
        stdin_max_chars=current_app.config.get("CODE_EXECUTION_STDIN_MAX_CHARS", 4000),
        output_max_chars=current_app.config.get("CODE_EXECUTION_OUTPUT_MAX_CHARS", 8000),
        execution_mode=current_app.config.get("CODE_EXECUTION_MODE", "subprocess"),
        docker_image=current_app.config.get("CODE_EXECUTION_DOCKER_IMAGE", "python:3.11-alpine"),
        memory_mb=current_app.config.get("CODE_EXECUTION_MEMORY_MB", 128),
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
                    "redirect": f"/react/student/submitted/{session_code}",
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
        {"message": "Your exam has been submitted.", "redirect": f"/react/student/submitted/{session_code}"},
    )

    return jsonify({"ok": True, "redirect": f"/react/student/submitted/{session_code}"})
