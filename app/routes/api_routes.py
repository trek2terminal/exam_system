import json
import os
import random
import re
import secrets
import shutil
import subprocess
from datetime import datetime, timezone, timedelta
from difflib import SequenceMatcher

from flask import Blueprint, Response, current_app, jsonify, request, send_file, session, stream_with_context, url_for
from sqlalchemy import and_, or_
from sqlalchemy.orm import selectinload
from werkzeug.utils import secure_filename

from app.models.audit_model import AuditLog, ViolationLog
from app.models.database import db
from app.models.draft_model import Draft
from app.models.exam_model import ExamEnrollment, ExamSet, Question, QuestionBankItem
from app.models.group_model import StudentGroup, StudentGroupMember, generate_group_join_code
from app.models.notification_model import Notification
from app.models.registration_request_model import RegistrationRequest
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
from app.utils.csv_base import build_csv_response, build_student_import_template_response
from app.utils.csrf import CSRF_HEADER, SAFE_METHODS, csrf_token_matches, get_csrf_token
from app.utils.export_utils import csv_response, format_datetime
from app.utils.helpers import create_exam_report_pdf, create_result_certificate_pdf, create_submission_pdf, current_session_matches_user, parse_options
from app.utils.pdf_base import pdf_response
from app.utils.network import get_client_ip
from app.utils.rate_limiter import rate_limit
from app.utils.validators import normalize_phone_10

api_bp = Blueprint("api", __name__, url_prefix="/api")
STUDENT_PASSWORD_SPECIAL_CHARS = "!@#$%^&*"


def _submitted_csrf_token():
    token = request.headers.get(CSRF_HEADER)
    if token:
        return token

    payload = request.get_json(silent=True) if request.is_json else None
    if isinstance(payload, dict):
        token = payload.get("csrf_token")
        if token:
            return token

    return request.form.get("csrf_token")


@api_bp.before_request
def require_csrf_for_mutating_api_requests():
    if request.method in SAFE_METHODS:
        return None

    if csrf_token_matches(_submitted_csrf_token()):
        return None

    return jsonify({"ok": False, "message": "Security token expired. Refresh the page and try again."}), 403


@api_bp.after_request
def attach_csrf_token(response):
    response.headers[CSRF_HEADER] = get_csrf_token()
    return response

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

EXAM_NAVIGATOR_STATUSES = {
    "NOT_VISITED",
    "VISITED_UNANSWERED",
    "ANSWERED",
    "MARKED_REVIEW",
    "ANSWERED_MARKED",
}

EXAM_VIOLATION_TYPES = {
    "FULLSCREEN_EXIT",
    "TAB_SWITCH",
    "WINDOW_BLUR",
    "RIGHT_CLICK",
    "COPY_ATTEMPT",
    "PASTE_ATTEMPT",
    "KEYBOARD_SHORTCUT",
    "DEVTOOLS_OPEN",
}


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
    tagline = (
        getattr(settings, "login_page_tagline", None)
        or SettingsService.DEFAULT_LOGIN_PAGE_TAGLINE
    ).strip()
    subheading = (
        getattr(settings, "login_page_subheading", None)
        or SettingsService.DEFAULT_LOGIN_PAGE_SUBHEADING
    ).strip()
    features = SettingsService.normalize_login_features(getattr(settings, "login_page_features", None))
    security_badge_text = (
        getattr(settings, "login_page_security_badge_text", None)
        or SettingsService.DEFAULT_SECURITY_BADGE_TEXT
    ).strip()
    security_badge_enabled = bool(getattr(settings, "login_page_security_badge_enabled", True))
    return heading, tagline, subheading, features, security_badge_text, security_badge_enabled


def _settings_payload(settings, include_private=False):
    if not settings:
        return {}
    logo_path = getattr(settings, "logo_path", None)
    (
        login_heading,
        login_tagline,
        login_subheading,
        login_features,
        security_badge_text,
        security_badge_enabled,
    ) = _login_page_settings(settings)
    registration_page_content = SettingsService.normalize_registration_page_content(
        getattr(settings, "registration_page_content", None)
    )
    login_form_content = SettingsService.normalize_login_form_content(
        getattr(settings, "login_form_content", None)
    )
    payload = {
        "platform_name": settings.platform_name,
        "logo_path": logo_path,
        "logo_url": url_for("static", filename=logo_path) if logo_path else None,
        "welcome_message": settings.welcome_message,
        "announcement_message": getattr(settings, "announcement_message", None),
        "login_page_heading": login_heading,
        "login_page_tagline": login_tagline,
        "login_page_subheading": login_subheading,
        "login_page_features": login_features,
        "login_page_security_badge_text": security_badge_text,
        "login_page_security_badge_enabled": security_badge_enabled,
        "login_heading": login_heading,
        "login_tagline": login_tagline,
        "login_subheading": login_subheading,
        "login_features": login_features,
        "login_form_content": login_form_content,
        "login_form": login_form_content,
        "registration_page_content": registration_page_content,
        "registration_page": registration_page_content,
        "login_page": {
            "heading": login_heading,
            "tagline": login_tagline,
            "subheading": login_subheading,
            "features": login_features,
            "security_badge_text": security_badge_text,
            "security_badge_enabled": security_badge_enabled,
        },
        "quote_pool": SettingsService.get_quotes(settings),
        "student_self_registration": settings.student_self_registration,
        "registration_code_required": bool(getattr(settings, "registration_code_required", False)),
        "max_violations_before_alert": settings.max_violations_before_alert,
        "admin_lockout_count": getattr(settings, "admin_lockout_count", 3),
        "admin_idle_timeout_minutes": getattr(settings, "admin_idle_timeout_minutes", 120),
    }
    if include_private:
        payload["registration_code"] = getattr(settings, "registration_code", None)
    return payload


def _draft_json_data(draft):
    try:
        parsed = json.loads(draft.draft_data or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError):
        return {}


def _draft_title_preview(draft_type, draft_data):
    candidates = []
    if isinstance(draft_data, dict):
        candidates.extend(
            [
                draft_data.get("title"),
                draft_data.get("name"),
                draft_data.get("exam_name"),
                draft_data.get("question_text"),
                draft_data.get("description"),
            ]
        )
        nested_form = draft_data.get("formData")
        if isinstance(nested_form, dict):
            candidates.extend([nested_form.get("question_text"), nested_form.get("name"), nested_form.get("title")])
        nested_exam = draft_data.get("exam")
        if isinstance(nested_exam, dict):
            candidates.extend([nested_exam.get("name"), nested_exam.get("subject")])
    for candidate in candidates:
        value = str(candidate or "").strip()
        if value:
            return re.sub(r"\s+", " ", value)[:240]
    label = str(draft_type or "draft").replace("_", " ").strip().title()
    return f"Untitled {label}"[:240]


def _draft_payload(draft):
    return {
        "id": draft.id,
        "user_id": draft.user_id,
        "user_role": draft.user_role,
        "draft_type": draft.draft_type,
        "draft_data": _draft_json_data(draft),
        "title_preview": draft.title_preview,
        "created_at": _iso_datetime(draft.created_at),
        "updated_at": _iso_datetime(draft.updated_at),
    }


def _compact_text(value, max_length=500):
    text_value = re.sub(r"\s+", " ", str(value or "").strip())
    if max_length and len(text_value) > max_length:
        return text_value[:max_length].rstrip()
    return text_value


def _registration_request_payload(registration_request):
    reviewer = registration_request.reviewer
    return {
        "id": registration_request.id,
        "full_name": registration_request.full_name,
        "preferred_username": registration_request.preferred_username,
        "email": registration_request.email,
        "phone": registration_request.phone,
        "roll_number": registration_request.roll_number,
        "class_name": registration_request.class_name,
        "message": registration_request.message,
        "status": registration_request.status,
        "admin_note": registration_request.admin_note,
        "reviewed_by": reviewer.name if reviewer else None,
        "reviewed_at": _iso_datetime(registration_request.reviewed_at),
        "created_at": _iso_datetime(registration_request.created_at),
        "updated_at": _iso_datetime(registration_request.updated_at),
    }


def _notification_payload(item):
    notification_type = (item.notification_type or "info").strip()
    normalized_type = notification_type.lower()
    related_type = (item.related_entity_type or "").strip().lower()
    recipient_role = (getattr(item.recipient, "role", None) or "").strip().lower()

    if "admin_pending_requests" in normalized_type:
        title = "Registration queue"
        category = "admin"
        severity = "warning"
        href = "/react/notifications"
        action_label = "Review queue"
    elif "registration_request" in normalized_type or related_type == "registration_request":
        title = "Registration request"
        category = "admin"
        severity = "warning"
        href = f"/react/notifications?request={item.related_entity_id}"
        action_label = "Review request"
    elif "pending_review" in normalized_type:
        title = "Pending review"
        category = "exams"
        severity = "warning"
        href = f"/react/teacher/exam/{item.related_entity_id}/review" if item.related_entity_id else "/react/teacher"
        action_label = "Review submissions"
    elif "exam_reminder" in normalized_type:
        title = "Exam starts soon"
        category = "exams"
        severity = "warning"
        href = "/react/student/exams"
        action_label = "Open My Exams"
    elif "exam_available" in normalized_type:
        title = "Exam available"
        category = "exams"
        severity = "success"
        href = "/react/student/exams"
        action_label = "Start exam"
    elif "result" in normalized_type:
        title = "Result published"
        category = "results"
        severity = "success"
        href = "/react/student/results"
        action_label = "View result"
    elif "violation" in normalized_type or "security" in normalized_type or "warning" in normalized_type:
        title = "Integrity alert"
        category = "security"
        severity = "danger" if "terminated" in normalized_type else "warning"
        href = "/react/teacher/proctoring" if recipient_role == "teacher" else "/react/admin/proctoring"
        action_label = "Open proctoring"
    elif "announcement" in normalized_type or related_type == "announcement":
        title = "Announcement"
        category = "announcements"
        severity = "info"
        href = "/react/notifications"
        action_label = "Read"
    elif "admin_message" in normalized_type or "private_message" in normalized_type or "message" in normalized_type:
        title = "Message"
        category = "messages"
        severity = "info"
        href = "/react/notifications"
        action_label = "Open message"
    elif "exam" in normalized_type or related_type in {"exam", "student_session"}:
        title = "Exam update"
        category = "exams"
        severity = "info"
        if related_type == "student_session" and item.related_entity_id:
            href = "/react/teacher"
        elif related_type == "exam" and item.related_entity_id:
            if recipient_role == "teacher":
                href = f"/react/teacher/exam/{item.related_entity_id}/review"
            elif recipient_role == "admin":
                href = "/react/admin/exams"
            else:
                href = "/react/student/exams"
        else:
            href = "/react/notifications"
        action_label = "Open"
    elif "student_registered" in normalized_type or related_type == "user":
        title = "New account"
        category = "admin"
        severity = "success"
        href = "/react/admin/users"
        action_label = "View users"
    else:
        title = "System notice"
        category = "system"
        severity = "info"
        href = "/react/notifications"
        action_label = "Open"

    summary = _compact_text(item.message, 180)
    payload = {
        "id": item.id,
        "type": notification_type,
        "title": title,
        "summary": summary,
        "message": item.message,
        "category": category,
        "severity": severity,
        "href": href,
        "action_label": action_label,
        "is_read": item.is_read,
        "read": item.is_read,
        "created_at": _iso_datetime(item.created_at),
        "related_entity_type": item.related_entity_type,
        "related_entity_id": item.related_entity_id,
    }
    return payload


def _notification_filter_query(query, filter_name):
    if filter_name == "unread":
        return query.filter_by(is_read=False)
    if filter_name == "system":
        return query.filter(Notification.notification_type.in_(["system", "info"]))
    if filter_name == "admin":
        return query.filter(
            or_(
                Notification.notification_type.like("%admin%"),
                Notification.notification_type == "registration_request",
                Notification.notification_type == "student_registered",
                Notification.related_entity_type == "registration_request",
            )
        )
    if filter_name == "exams":
        return query.filter(
            or_(
                Notification.notification_type.like("%exam%"),
                Notification.related_entity_type == "exam",
                Notification.related_entity_type == "student_session",
            )
        )
    if filter_name == "results":
        return query.filter(Notification.notification_type.like("%result%"))
    if filter_name == "security":
        return query.filter(
            or_(
                Notification.notification_type.like("%violation%"),
                Notification.notification_type.like("%security%"),
                Notification.notification_type.like("%warning%"),
            )
        )
    if filter_name == "messages":
        return query.filter(
            or_(
                Notification.notification_type.like("%message%"),
                Notification.notification_type.like("%announcement%"),
                Notification.related_entity_type == "announcement",
            )
        )
    return query


def _notification_counts_payload(user_id):
    base = Notification.query.filter_by(recipient_user_id=user_id)
    return {
        "all": base.count(),
        "unread": base.filter_by(is_read=False).count(),
        "admin": _notification_filter_query(base, "admin").count(),
        "exams": _notification_filter_query(base, "exams").count(),
        "results": _notification_filter_query(base, "results").count(),
        "security": _notification_filter_query(base, "security").count(),
        "messages": _notification_filter_query(base, "messages").count(),
        "system": _notification_filter_query(base, "system").count(),
    }


def _run_due_notification_reminders(user):
    if not user:
        return 0
    try:
        return NotificationService.run_due_reminders_for_user(user)
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Notification reminder generation failed.")
        return 0


def _public_settings_payload(settings):
    payload = _settings_payload(settings)
    return {
        "platformName": payload.get("platform_name"),
        "platform_name": payload.get("platform_name"),
        "logoUrl": payload.get("logo_url"),
        "logo_url": payload.get("logo_url"),
        "tagline": payload.get("login_page_tagline"),
        "welcomeMessage": payload.get("welcome_message"),
        "welcome_message": payload.get("welcome_message"),
        "student_self_registration": payload.get("student_self_registration"),
        "studentSelfRegistration": payload.get("student_self_registration"),
        "registration_code_required": payload.get("registration_code_required"),
        "loginPage": {
            "heading": payload.get("login_page_heading"),
            "tagline": payload.get("login_page_tagline"),
            "subheading": payload.get("login_page_subheading"),
            "features": payload.get("login_page_features", []),
            "securityBadgeText": payload.get("login_page_security_badge_text"),
            "securityBadgeEnabled": payload.get("login_page_security_badge_enabled"),
        },
        "login_page": payload.get("login_page"),
        "loginForm": payload.get("login_form_content"),
        "login_form": payload.get("login_form_content"),
        "registrationPage": payload.get("registration_page_content"),
        "registration_page": payload.get("registration_page_content"),
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


def _audit_resource_cache(items):
    user_ids = set()
    exam_ids = set()
    session_ids = set()
    for item in items:
        if item.user_id:
            user_ids.add(item.user_id)
        resource_type = (item.resource_type or "").lower()
        if item.resource_id and resource_type == "user":
            user_ids.add(item.resource_id)
        elif item.resource_id and resource_type in {"exam", "exam_set"}:
            exam_ids.add(item.resource_id)
        elif item.resource_id and resource_type in {"student_session", "session"}:
            session_ids.add(item.resource_id)

    sessions = {
        item.id: item
        for item in StudentSession.query.options(selectinload(StudentSession.exam_set))
        .filter(StudentSession.id.in_(session_ids))
        .all()
    } if session_ids else {}
    return {
        "users": {item.id: item for item in User.query.filter(User.id.in_(user_ids)).all()} if user_ids else {},
        "exams": {item.id: item for item in ExamSet.query.filter(ExamSet.id.in_(exam_ids)).all()} if exam_ids else {},
        "sessions": sessions,
    }


def _audit_subject(item, cache=None):
    cache_provided = cache is not None
    cache = cache or {}
    if item.resource_type == "user" and item.resource_id:
        user = cache.get("users", {}).get(item.resource_id) if cache_provided else User.query.get(item.resource_id)
        if user:
            return user.name or user.username or user.email
    if item.resource_type in {"exam", "exam_set"} and item.resource_id:
        exam = cache.get("exams", {}).get(item.resource_id) if cache_provided else ExamSet.query.get(item.resource_id)
        if exam:
            return exam.exam_name
    if item.resource_type in {"student_session", "session"} and item.resource_id:
        student_session = cache.get("sessions", {}).get(item.resource_id) if cache_provided else StudentSession.query.get(item.resource_id)
        if student_session:
            return student_session.student_name or student_session.roll_no or student_session.session_code
    return _clean_audit_fragment(item.changes)


def _audit_exam_title(item, cache=None):
    cache_provided = cache is not None
    cache = cache or {}
    if item.resource_type in {"exam", "exam_set"} and item.resource_id:
        exam = cache.get("exams", {}).get(item.resource_id) if cache_provided else ExamSet.query.get(item.resource_id)
        return exam.exam_name if exam else None
    if item.resource_type in {"student_session", "session"} and item.resource_id:
        student_session = cache.get("sessions", {}).get(item.resource_id) if cache_provided else StudentSession.query.get(item.resource_id)
        if student_session and student_session.exam_set:
            return student_session.exam_set.exam_name
    return _clean_audit_fragment(item.changes)


def _humanize_audit_action(action):
    clean_action = (action or "activity").replace("_api", "").replace("_", " ").strip()
    return clean_action[:1].upper() + clean_action[1:]


def _audit_category_from_values(action, resource_type):
    action_text = (action or "").lower()
    resource_text = (resource_type or "").lower()
    if any(fragment in action_text for fragment in ("violation", "security", "terminate", "second_chance", "reduce_time", "pause", "proctor")):
        return "security"
    if any(fragment in action_text for fragment in ("export", "download", "report", "backup")):
        return "exports"
    if any(fragment in action_text for fragment in ("settings", "logo", "announcement", "platform")) or resource_text in {"settings", "system"}:
        return "settings"
    if resource_text == "user" or any(fragment in action_text for fragment in ("user", "account", "login", "registration", "password")):
        return "accounts"
    if resource_text in {"exam", "exam_set", "question", "answer", "student_session", "session", "result"} or any(fragment in action_text for fragment in ("exam", "result", "question", "session", "submit", "publish")):
        return "exams"
    return "system"


def _audit_severity(item):
    status = (item.status or "").lower()
    action = (item.action or "").lower()
    if status in {"failed", "error"} or any(fragment in action for fragment in ("terminate", "delete", "deactivate")):
        return "danger"
    if status == "warning" or any(fragment in action for fragment in ("violation", "security", "reduce_time", "second_chance", "pause")):
        return "warning"
    if any(fragment in action for fragment in ("create", "publish", "activate", "success")):
        return "success"
    return "info"


def _audit_category_condition(category):
    action = db.func.lower(AuditLog.action)
    resource = db.func.lower(AuditLog.resource_type)
    if category == "security":
        return or_(
            action.like("%violation%"),
            action.like("%security%"),
            action.like("%terminate%"),
            action.like("%second_chance%"),
            action.like("%reduce_time%"),
            action.like("%pause%"),
            action.like("%proctor%"),
        )
    if category == "exports":
        return or_(action.like("%export%"), action.like("%download%"), action.like("%report%"), action.like("%backup%"))
    if category == "settings":
        return or_(
            action.like("%settings%"),
            action.like("%logo%"),
            action.like("%announcement%"),
            action.like("%platform%"),
            resource.in_(["settings", "system"]),
        )
    if category == "accounts":
        return or_(
            resource == "user",
            action.like("%user%"),
            action.like("%account%"),
            action.like("%login%"),
            action.like("%registration%"),
            action.like("%password%"),
        )
    if category == "exams":
        return or_(
            resource.in_(["exam", "exam_set", "question", "answer", "student_session", "session", "result"]),
            action.like("%exam%"),
            action.like("%result%"),
            action.like("%question%"),
            action.like("%session%"),
            action.like("%submit%"),
            action.like("%publish%"),
        )
    if category == "system":
        return resource.in_(["system", "audit_logs"])
    return None


def _audit_formatted_message(item, cache=None):
    action = item.action or ""
    subject = _audit_subject(item, cache)
    exam_title = _audit_exam_title(item, cache)

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


def _audit_payload(item, cache=None):
    cache_provided = cache is not None
    cache = cache or {}
    actor = cache.get("users", {}).get(item.user_id) if item.user_id else None
    if actor is None and not cache_provided and item.user:
        actor = item.user
    actor_name = actor.name if actor else "System"
    formatted_message = _audit_formatted_message(item, cache)
    category = _audit_category_from_values(item.action, item.resource_type)
    subject = _audit_subject(item, cache)
    return {
        "id": item.id,
        "action": item.action,
        "action_type": item.action,
        "category": category,
        "severity": _audit_severity(item),
        "formatted_message": formatted_message,
        "description": formatted_message,
        "resource_type": item.resource_type,
        "resource_id": item.resource_id,
        "resource_label": subject,
        "status": item.status,
        "user": actor_name,
        "actor_name": actor_name,
        "actor_role": actor.role if actor else "system",
        "timestamp": _iso_datetime(item.created_at),
        "ip_address": item.ip_address,
        "reason": item.reason,
        "changes": item.changes,
        "error_message": item.error_message,
        "user_agent": item.user_agent,
    }


def _audit_payloads(items):
    cache = _audit_resource_cache(items)
    return [_audit_payload(item, cache) for item in items]


def _parse_audit_date(value, end_of_day=False):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo:
            parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed
    except (TypeError, ValueError):
        pass
    try:
        parsed_date = datetime.strptime(str(value), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None
    return datetime.combine(parsed_date, datetime.max.time() if end_of_day else datetime.min.time())


def _apply_audit_filters(query, args):
    action_type = (args.get("action_type") or args.get("action") or "").strip()
    if action_type:
        query = query.filter(AuditLog.action == action_type)

    status = (args.get("status") or "").strip().lower()
    if status and status != "all":
        query = query.filter(db.func.lower(AuditLog.status) == status)

    resource_type = (args.get("resource_type") or args.get("resource") or "").strip().lower()
    if resource_type and resource_type != "all":
        query = query.filter(db.func.lower(AuditLog.resource_type) == resource_type)

    category = (args.get("category") or "").strip().lower()
    category_condition = _audit_category_condition(category)
    if category_condition is not None:
        query = query.filter(category_condition)

    from_date = _parse_audit_date(args.get("from") or args.get("from_date"))
    if from_date:
        query = query.filter(AuditLog.created_at >= from_date)
    to_date = _parse_audit_date(args.get("to") or args.get("to_date"), end_of_day=True)
    if to_date:
        query = query.filter(AuditLog.created_at <= to_date)

    search = (args.get("q") or args.get("search") or "").strip().lower()
    if search:
        pattern = f"%{search}%"
        actor_ids = [
            user.id
            for user in User.query.filter(
                or_(
                    db.func.lower(User.name).like(pattern),
                    db.func.lower(User.username).like(pattern),
                    db.func.lower(User.email).like(pattern),
                    db.func.lower(User.role).like(pattern),
                )
            )
            .limit(50)
            .all()
        ]
        conditions = [
            db.func.lower(AuditLog.action).like(pattern),
            db.func.lower(AuditLog.resource_type).like(pattern),
            db.func.lower(AuditLog.status).like(pattern),
            db.func.lower(AuditLog.changes).like(pattern),
            db.func.lower(AuditLog.reason).like(pattern),
            db.func.lower(AuditLog.ip_address).like(pattern),
        ]
        if actor_ids:
            conditions.append(AuditLog.user_id.in_(actor_ids))
        query = query.filter(or_(*conditions))
    return query


def _audit_important_condition():
    action = db.func.lower(AuditLog.action)
    return or_(
        db.func.lower(AuditLog.status).in_(["warning", "failed", "error"]),
        action.like("%violation%"),
        action.like("%terminate%"),
        action.like("%second_chance%"),
        action.like("%reduce_time%"),
        action.like("%delete%"),
        action.like("%deactivate%"),
        action.like("%publish%"),
        action.like("%settings%"),
        action.like("%backup%"),
    )


def _audit_summary_payload(query):
    today_start = datetime.combine(datetime.utcnow().date(), datetime.min.time())
    return {
        "total": query.count(),
        "today": query.filter(AuditLog.created_at >= today_start).count(),
        "important": query.filter(_audit_important_condition()).count(),
        "warnings": query.filter(
            or_(
                db.func.lower(AuditLog.status).in_(["warning", "failed", "error"]),
                _audit_category_condition("security"),
            )
        ).count(),
        "security": query.filter(_audit_category_condition("security")).count(),
        "exports": query.filter(_audit_category_condition("exports")).count(),
    }


def _audit_filter_options_payload(query):
    actions = [
        row[0]
        for row in query.with_entities(AuditLog.action)
        .filter(AuditLog.action.isnot(None))
        .distinct()
        .order_by(AuditLog.action.asc())
        .limit(80)
        .all()
    ]
    resources = [
        row[0]
        for row in query.with_entities(AuditLog.resource_type)
        .filter(AuditLog.resource_type.isnot(None))
        .distinct()
        .order_by(AuditLog.resource_type.asc())
        .limit(40)
        .all()
    ]
    statuses = [
        row[0]
        for row in query.with_entities(AuditLog.status)
        .filter(AuditLog.status.isnot(None))
        .distinct()
        .order_by(AuditLog.status.asc())
        .limit(20)
        .all()
    ]
    return {
        "actions": [{"value": item, "label": _humanize_audit_action(item)} for item in actions],
        "resources": [{"value": item, "label": _humanize_audit_action(item)} for item in resources],
        "statuses": [{"value": item, "label": _humanize_audit_action(item)} for item in statuses],
        "categories": [
            {"value": "exams", "label": "Exams"},
            {"value": "accounts", "label": "Accounts"},
            {"value": "security", "label": "Security"},
            {"value": "settings", "label": "Settings"},
            {"value": "exports", "label": "Exports"},
            {"value": "system", "label": "System"},
        ],
    }


def _teacher_audit_query(teacher):
    exam_ids = [exam.id for exam in ExamSet.query.filter_by(created_by=teacher.id).all()]
    session_ids = []
    if exam_ids:
        session_ids = [
            row[0]
            for row in db.session.query(StudentSession.id)
            .filter(StudentSession.exam_set_id.in_(exam_ids))
            .all()
        ]
    scope_conditions = [AuditLog.user_id == teacher.id]
    if exam_ids:
        scope_conditions.append(
            and_(
                db.func.lower(AuditLog.resource_type).in_(["exam", "exam_set"]),
                AuditLog.resource_id.in_(exam_ids),
            )
        )
    if session_ids:
        scope_conditions.append(
            and_(
                db.func.lower(AuditLog.resource_type).in_(["student_session", "session"]),
                AuditLog.resource_id.in_(session_ids),
            )
        )
    return AuditLog.query.filter(or_(*scope_conditions))


def _audit_csv_response(query, actor, filename_prefix="AuditLog"):
    """Stream audit logs to CSV without loading the whole table into memory."""
    from io import StringIO
    import csv

    headers = ["Date", "Time", "Actor", "Actor Role", "Category", "Severity", "Action", "Target", "IP Address", "Status", "Reason"]

    def generate_csv():
        output = StringIO()
        writer = csv.writer(output)

        writer.writerow(headers)
        yield output.getvalue()
        output.truncate(0)
        output.seek(0)

        base_query = query.order_by(None).enable_eagerloads(False)
        batch_size = 500
        last_created_at = None
        last_id = None

        while True:
            batch_query = base_query
            if last_id is not None:
                if last_created_at is None:
                    batch_query = batch_query.filter(AuditLog.id < last_id)
                else:
                    batch_query = batch_query.filter(
                        or_(
                            AuditLog.created_at < last_created_at,
                            and_(AuditLog.created_at == last_created_at, AuditLog.id < last_id),
                        )
                    )

            logs = (
                batch_query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
                .limit(batch_size)
                .all()
            )
            if not logs:
                break

            cache = _audit_resource_cache(logs)
            for item in logs:
                created_at = item.created_at
                payload = _audit_payload(item, cache)
                writer.writerow([
                    created_at.strftime("%Y-%m-%d") if created_at else "",
                    created_at.strftime("%H:%M:%S") if created_at else "",
                    payload["actor_name"],
                    payload["actor_role"],
                    payload["category"],
                    payload["severity"],
                    payload["formatted_message"],
                    f"{item.resource_type}:{item.resource_id}" if item.resource_id else item.resource_type,
                    item.ip_address,
                    item.status,
                    item.reason or "",
                ])

            yield output.getvalue()
            output.truncate(0)
            output.seek(0)
            last_created_at = logs[-1].created_at
            last_id = logs[-1].id

    return Response(
        stream_with_context(generate_csv()),
        mimetype="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename={filename_prefix}_{datetime.utcnow().strftime('%Y%m%d')}.csv"
        }
    )


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


def _clean_text_value(value, default=""):
    if value is None:
        value = default
    text = str(value).strip()
    if not text and default:
        return str(default).strip()
    return text


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
        exam = student_session.exam_set
        if time_state == "ended":
            return None, _locked_session_response(student_session)
        if exam.status != "active" or time_state == "not_started":
            return None, _forbidden_session_response(
                "This exam is temporarily inactive while changes are being made." if exam.status == "draft" else "This exam has not opened yet.",
                redirect=f"/react/student/waiting/{student_session.session_code}",
            )

    allowed_statuses = allowed_statuses or {MUTABLE_SESSION_STATUS}
    if require_active and student_session.status not in allowed_statuses:
        return None, _locked_session_response(student_session)

    if require_window and not ExamSessionGuard.request_window_owns_attempt(student_session, payload):
        return None, _window_lock_response(student_session)

    return student_session, None


def _parse_int_field(payload, field_name, minimum=None, maximum=None, max_digits=9):
    value = payload.get(field_name)
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        return None
    text_value = str(value).strip()
    if not re.fullmatch(r"[+-]?\d+", text_value):
        return None
    digits = text_value[1:] if text_value[:1] in {"-", "+"} else text_value
    if max_digits and len(digits) > max_digits:
        return None
    try:
        number = int(text_value)
    except (TypeError, ValueError):
        return None
    if minimum is not None:
        number = max(number, minimum)
    if maximum is not None:
        number = min(number, maximum)
    return number


def _parse_float_field(payload, field_name, minimum=None, maximum=None, max_digits=9):
    value = payload.get(field_name)
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        return None
    text_value = str(value).strip()
    if not re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)", text_value):
        return None
    if max_digits and len(re.sub(r"\D", "", text_value)) > max_digits:
        return None
    try:
        number = float(text_value)
    except (TypeError, ValueError):
        return None
    if minimum is not None:
        number = max(number, minimum)
    if maximum is not None:
        number = min(number, maximum)
    return number


def _iso_datetime(value):
    if not value:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


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
        and any(char.islower() for char in password)
        and any(char.isdigit() for char in password)
        and any(char in STUDENT_PASSWORD_SPECIAL_CHARS for char in password)
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
        "class_name": user.class_name,
        "batch": user.batch,
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


def _account_preferences(user):
    defaults = {
        "exam_reminders": True,
        "review_reminders": True,
        "registration_reminders": True,
        "reminder_lead_minutes": 30,
        "announcement_banners": True,
    }
    raw_preferences = getattr(user, "account_preferences", None)
    if not raw_preferences:
        return defaults
    try:
        loaded = json.loads(raw_preferences)
    except (TypeError, ValueError):
        return defaults
    if not isinstance(loaded, dict):
        return defaults
    reminder_lead_minutes = loaded.get("reminder_lead_minutes", defaults["reminder_lead_minutes"])
    try:
        reminder_lead_minutes = int(reminder_lead_minutes)
    except (TypeError, ValueError):
        reminder_lead_minutes = defaults["reminder_lead_minutes"]
    reminder_lead_minutes = min(max(reminder_lead_minutes, 10), 1440)
    return {
        "exam_reminders": bool(loaded.get("exam_reminders", defaults["exam_reminders"])),
        "review_reminders": bool(loaded.get("review_reminders", defaults["review_reminders"])),
        "registration_reminders": bool(loaded.get("registration_reminders", defaults["registration_reminders"])),
        "reminder_lead_minutes": reminder_lead_minutes,
        "announcement_banners": bool(loaded.get("announcement_banners", defaults["announcement_banners"])),
    }


def _account_stats(user):
    if user.role == "student":
        roll_no = (user.roll_number or session.get("roll_no") or "").strip().upper()
        submitted_statuses = ["submitted", "evaluated", "terminated", "auto_submitted"]
        exams_taken = StudentSession.query.filter(
            db.func.upper(StudentSession.roll_no) == roll_no,
            StudentSession.status.in_(submitted_statuses),
        ).count() if roll_no else 0
        results_available = (
            Result.query.join(StudentSession, Result.session_id == StudentSession.id)
            .filter(db.func.upper(StudentSession.roll_no) == roll_no, Result.published.is_(True))
            .count()
            if roll_no else 0
        )
        batches_joined = StudentGroupMember.query.filter_by(student_id=user.id).count()
        return {
            "exams_taken": exams_taken,
            "results_available": results_available,
            "batches_joined": batches_joined,
        }
    if user.role == "teacher":
        active_group_ids = [group.id for group in StudentGroup.query.filter_by(created_by=user.id).all()]
        students_taught = 0
        if active_group_ids:
            students_taught = (
                db.session.query(db.func.count(db.distinct(StudentGroupMember.student_id)))
                .filter(StudentGroupMember.group_id.in_(active_group_ids))
                .scalar()
                or 0
            )
        return {
            "exams_created": ExamSet.query.filter_by(created_by=user.id).count(),
            "students_taught": students_taught,
            "active_batches": len(active_group_ids),
        }
    return {
        "total_students": User.query.filter_by(role="student").count(),
        "total_teachers": User.query.filter_by(role="teacher").count(),
        "exams_on_platform": ExamSet.query.count(),
    }


def _search_item(item_type, title, subtitle, href, keywords=None, score=0):
    return {
        "type": item_type,
        "title": title,
        "subtitle": subtitle,
        "href": href,
        "keywords": keywords or "",
        "score": score,
    }


def _search_score(item, query):
    if not query:
        return int(item.get("score") or 0)
    haystack = " ".join(
        str(item.get(key) or "")
        for key in ("type", "title", "subtitle", "href", "keywords")
    ).lower()
    score = int(item.get("score") or 0)
    for token in query.split():
        if token in str(item.get("title") or "").lower():
            score += 8
        if token in str(item.get("subtitle") or "").lower():
            score += 4
        if token in haystack:
            score += 2
    return score


def _search_pages_for_role(role):
    page_map = {
        "admin": [
            ("Dashboard", "Live counts, recent activity, violations, and shortcuts.", "/react/admin", "workspace overview activity"),
            ("Users", "Manage admins, teachers, students, passwords, activation, and delete actions.", "/react/admin/users", "accounts user management import students create teacher"),
            ("Groups", "Manage student groups, join codes, and memberships.", "/react/admin/groups", "classes batches group members"),
            ("My Drafts", "Resume saved admin drafts.", "/react/admin/drafts", "autosave drafts"),
            ("Exams", "Review, publish, deactivate, close, and delete exams.", "/react/admin/exams", "exam sets status active draft closed"),
            ("Proctoring", "Monitor live exam sessions and violations.", "/react/admin/proctoring", "live monitoring violations students"),
            ("Reports", "Audit logs, violation exports, exam PDFs, and suspicious activity.", "/react/admin/reports", "audit log csv pdf suspicious activity"),
            ("Settings", "Platform name, login page, registration, security, logo, and backup settings.", "/react/admin/settings", "configuration platform logo theme registration lockout quotes"),
            ("Profile", "Admin profile and account settings.", "/react/admin/profile", "account password avatar"),
        ],
        "teacher": [
            ("Dashboard", "Teacher workspace overview and exam shortcuts.", "/react/teacher", "workspace overview"),
            ("My Exams", "Create, edit, publish, and review your exams.", "/react/teacher/exams", "exam sets edit publish submissions"),
            ("Question Bank", "Reusable questions and import tools.", "/react/teacher/question-bank", "bank reusable mcq coding import"),
            ("My Drafts", "Resume saved teacher drafts.", "/react/teacher/drafts", "autosave drafts"),
            ("Proctoring", "Monitor your live exam sessions.", "/react/teacher/proctoring", "live monitoring violations"),
            ("Reports", "Exam reports and student performance summaries.", "/react/teacher/reports", "analytics results reports"),
            ("Profile", "Teacher profile and account settings.", "/react/teacher/profile", "account password avatar"),
        ],
        "student": [
            ("Dashboard", "Student workspace, assigned exams, and announcements.", "/react/student", "workspace assigned exams"),
            ("My Exams", "Available, active, and upcoming exams.", "/react/student/exams", "join exam waiting precheck"),
            ("Results", "Published exam results and certificates.", "/react/student/results", "marks score percentage certificate"),
            ("Exam History", "Past attempts and submitted exams.", "/react/student/history", "attempts submissions history"),
            ("Profile", "Student profile and account settings.", "/react/student/profile", "account password avatar"),
        ],
    }
    return [
        _search_item("page", title, subtitle, href, keywords, score=3)
        for title, subtitle, href, keywords in page_map.get(role, [])
    ]


def _filter_search_items(items, query, limit):
    if not query:
        return [{**item, "score": int(item.get("score") or 0)} for item in items[:limit]]

    scored = []
    for item in items:
        score = _search_score(item, query)
        if query and score <= 0:
            continue
        scored.append({**item, "score": score})
    scored.sort(key=lambda item: (-item["score"], 0 if item["type"] == "page" else 1, item["title"].lower()))
    return scored[:limit]


def _exam_summary_count_maps(exam_ids):
    submitted_statuses = ["submitted", "evaluated", "terminated", "auto_submitted"]
    if not exam_ids:
        return {
            "questions": {},
            "enrollments": {},
            "sessions": {},
            "submitted": {},
            "pending_review": {},
        }

    def count_by_exam(column, model):
        return dict(
            db.session.query(column, db.func.count(model.id))
            .filter(column.in_(exam_ids))
            .group_by(column)
            .all()
        )

    submitted_counts = dict(
        db.session.query(StudentSession.exam_set_id, db.func.count(StudentSession.id))
        .filter(StudentSession.exam_set_id.in_(exam_ids), StudentSession.status.in_(submitted_statuses))
        .group_by(StudentSession.exam_set_id)
        .all()
    )
    pending_counts = dict(
        db.session.query(StudentSession.exam_set_id, db.func.count(StudentSession.id))
        .filter(StudentSession.exam_set_id.in_(exam_ids), StudentSession.status.in_(submitted_statuses))
        .outerjoin(Result, Result.session_id == StudentSession.id)
        .filter(Result.id.is_(None))
        .group_by(StudentSession.exam_set_id)
        .all()
    )
    return {
        "questions": count_by_exam(Question.exam_set_id, Question),
        "enrollments": count_by_exam(ExamEnrollment.exam_set_id, ExamEnrollment),
        "sessions": count_by_exam(StudentSession.exam_set_id, StudentSession),
        "submitted": submitted_counts,
        "pending_review": pending_counts,
    }


def _exam_count(counts, key, exam_id):
    return int((counts or {}).get(key, {}).get(exam_id, 0) or 0)


def _admin_exam_payload(exam, counts=None):
    if counts:
        question_count = _exam_count(counts, "questions", exam.id)
        enrolled_count = _exam_count(counts, "enrollments", exam.id)
        submitted_count = _exam_count(counts, "submitted", exam.id)
        pending_review_count = _exam_count(counts, "pending_review", exam.id)
    else:
        submitted_statuses = ["submitted", "evaluated", "terminated", "auto_submitted"]
        session_query = StudentSession.query.filter_by(exam_set_id=exam.id)
        submitted_count = session_query.filter(StudentSession.status.in_(submitted_statuses)).count()
        pending_review_count = (
            session_query.filter(StudentSession.status.in_(submitted_statuses))
            .outerjoin(Result, Result.session_id == StudentSession.id)
            .filter(Result.id.is_(None))
            .count()
        )
        question_count = Question.query.filter_by(exam_set_id=exam.id).count()
        enrolled_count = ExamEnrollment.query.filter_by(exam_set_id=exam.id).count()

    return {
        "id": exam.id,
        "exam_name": exam.exam_name,
        "subject": exam.subject,
        "set_code": exam.set_code,
        "status": exam.status,
        "duration_minutes": exam.duration_minutes,
        "total_marks": exam.total_marks,
        "question_count": question_count,
        "enrolled_count": enrolled_count,
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
        "source": getattr(item, "source", None) or "manual",
        "exam_title": getattr(item, "exam_title", None),
        "created_at": _iso_datetime(item.created_at),
        "updated_at": _iso_datetime(item.updated_at),
    }


def _normalize_question_identity(value):
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def _question_identity(question_type, question_text):
    return (
        (question_type or "short").strip().lower(),
        _normalize_question_identity(question_text),
    )


def _bank_item_matches_identity(item, identity):
    return _question_identity(item.question_type, item.question_text) == identity


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


def _exam_question_type(question):
    question_type = (question.question_type or "short").strip().lower()
    if question_type == "coding":
        return "code"
    if question_type in {"long_answer", "essay"}:
        return "long"
    if question_type in {"mcq", "short", "long", "code"}:
        return question_type
    return "short"


def _question_options_payload(question, student_session):
    if _exam_question_type(question) != "mcq":
        return []

    payload = []
    for index, option in enumerate(_question_options_for_attempt(question, student_session)):
        if isinstance(option, dict):
            text = str(option.get("text") or option.get("label") or option.get("value") or "").strip()
            option_id = str(option.get("id") or option.get("value") or text or index + 1)
        else:
            text = str(option or "").strip()
            option_id = text
        if text:
            payload.append({"id": option_id, "text": text})
    return payload


def _answer_text_for_question(question, data):
    if _exam_question_type(question) == "code" and data.get("code_text") is not None:
        return str(data.get("code_text") or "")
    if _exam_question_type(question) == "mcq" and data.get("selected_option") is not None:
        return str(data.get("selected_option") or "")
    answer_text = data.get("answer_text", "")
    return "" if answer_text is None else str(answer_text)


def _navigator_status(data, fallback_answer=""):
    return AutoSaveService.normalize_visit_status(
        data.get("navigator_status") or data.get("visit_status"),
        fallback_answer,
    )


def _pop_latest_admin_message(student_session, limit=10):
    messages = NotificationService.pop_unread_session_messages(student_session.id, limit=limit)
    admin_message = None
    for item in messages:
        message = (item.get("message") or "").strip()
        if message:
            admin_message = message
    return admin_message, messages


def _attempt_number(student_session):
    return StudentSession.query.filter(
        StudentSession.exam_set_id == student_session.exam_set_id,
        db.func.upper(StudentSession.roll_no) == (student_session.roll_no or "").strip().upper(),
        StudentSession.created_at <= student_session.created_at,
    ).count()


def _submitted_results_redirect(student_session):
    return f"/react/student/results/{student_session.exam_set_id}"


def _api_session_status(student_session):
    status = (student_session.status or "").strip().lower()
    return {
        "active": "IN_PROGRESS",
        "paused": "PAUSED",
        "submitted": "SUBMITTED",
        "auto_submitted": "SUBMITTED",
        "terminated": "TERMINATED",
        "evaluated": "EVALUATED",
        "waiting": "WAITING",
    }.get(status, status.upper() or "UNKNOWN")


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
    return {"state": "inactive", "redirect": f"/react/student/waiting/{student_session.session_code}"}


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
    ExamService.recalculate_exam_total_marks(exam.id)
    questions = Question.query.filter_by(exam_set_id=exam.id).order_by(Question.question_number.asc()).all()
    return {
        "id": exam.id,
        "name": exam.exam_name,
        "exam_name": exam.exam_name,
        "subject": exam.subject,
        "set_code": exam.set_code,
        "status": exam.status,
        "total_marks": exam.total_marks,
        "passing_percentage": getattr(exam, "passing_percentage", 40) or 40,
        "duration_minutes": exam.duration_minutes,
        "attempt_limit": exam.attempt_limit,
        "random_question_count": exam.random_question_count,
        "randomize_delivery": bool(exam.random_question_count),
        "shuffle_questions": bool(exam.shuffle_questions),
        "shuffle_options": bool(exam.shuffle_options),
        "access_mode": getattr(exam, "access_mode", None) or ("access_code" if exam.access_code else "open"),
        "access_code": exam.access_code if (getattr(exam, "access_mode", None) or "open") == "access_code" else "",
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


def _exam_passing_percentage(exam):
    try:
        return int(getattr(exam, "passing_percentage", 40) or 40)
    except (TypeError, ValueError):
        return 40


def _result_status_payload(result, exam):
    passing_percentage = _exam_passing_percentage(exam)
    percentage = float(result.percentage or 0) if result else 0
    passed = percentage >= passing_percentage
    return {
        "passing_percentage": passing_percentage,
        "passed": passed,
        "status": "passed" if passed else "failed",
    }


def _student_result_pdf_url(result):
    return f"/api/student/results/{result.id}/pdf"


def _parse_extra_minutes(value):
    return _parse_int_field({"extra_time_minutes": value}, "extra_time_minutes", minimum=0, maximum=1440) or 0


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


def _existing_exam_enrollment(exam_id, roll_no):
    normalized_roll = ExamEnrollment.normalize_roll_no(roll_no)
    if not normalized_roll:
        return None
    return (
        ExamEnrollment.query.filter(
            ExamEnrollment.exam_set_id == exam_id,
            db.func.upper(ExamEnrollment.roll_no) == normalized_roll,
        )
        .first()
    )


def _upsert_exam_enrollment(exam, teacher, roll_no, student_name="", extra_time_minutes=0, allow_update=True):
    normalized_roll = ExamEnrollment.normalize_roll_no(roll_no)
    if not normalized_roll:
        return None, "Roll number is required."

    student = _find_student_by_identifier(normalized_roll)
    clean_name = (student_name or "").strip() or (student.name if student else "")
    clean_extra = _parse_extra_minutes(extra_time_minutes)
    enrollment = _existing_exam_enrollment(exam.id, normalized_roll)
    if enrollment:
        if not allow_update:
            return enrollment, {
                "error": "duplicate",
                "message": "This student is already enrolled in this exam.",
                "student_name": enrollment.student_name or clean_name or normalized_roll,
            }
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
                allow_update=False,
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
            allow_update=False,
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
    time_spent_seconds = int(getattr(answer, "total_time_spent_seconds", 0) or 0) if answer else 0
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
        "time_spent_seconds": time_spent_seconds,
        "time_spent_minutes": round(time_spent_seconds / 60, 1) if time_spent_seconds else 0,
        "visit_count": int(getattr(answer, "visit_count", 0) or 0) if answer else 0,
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


def _answered_answer(answer):
    return bool(answer and (answer.answer_text or "").strip())


def _result_category_label(question):
    question_type = _exam_question_type(question)
    if question_type == "mcq":
        return "MCQ"
    if question_type == "code":
        return "Code"
    if question_type == "long":
        return "Long Answer"
    return "Short Answer"


def _result_analytics_payload(student_session, result, questions, answers_by_question, marks_by_question):
    total_questions = len(questions)
    status_counts = {state: 0 for state in EXAM_NAVIGATOR_STATUSES}
    category_map = {}
    answered_count = 0
    total_time_spent_seconds = 0

    for question in questions:
        answer = answers_by_question.get(question.id)
        question_mark = marks_by_question.get(question.id)
        answered = _answered_answer(answer)
        if answered:
            answered_count += 1

        if answer:
            visit_status = answer.visit_status if answer.visit_status in EXAM_NAVIGATOR_STATUSES else None
            if not visit_status:
                visit_status = "ANSWERED" if answered else "VISITED_UNANSWERED"
        else:
            visit_status = "NOT_VISITED"
        status_counts[visit_status] = status_counts.get(visit_status, 0) + 1

        time_spent_seconds = int(getattr(answer, "total_time_spent_seconds", 0) or 0) if answer else 0
        total_time_spent_seconds += time_spent_seconds

        category = _result_category_label(question)
        bucket = category_map.setdefault(
            category,
            {
                "label": category,
                "questions": 0,
                "answered": 0,
                "marks_obtained": 0,
                "max_marks": 0,
                "percentage": 0,
                "average_time_seconds": 0,
                "_time_seconds": 0,
            },
        )
        bucket["questions"] += 1
        bucket["answered"] += 1 if answered else 0
        bucket["marks_obtained"] += float(question_mark.marks_awarded or 0) if question_mark else 0
        bucket["max_marks"] += float(question.marks or 0)
        bucket["_time_seconds"] += time_spent_seconds

    category_breakdown = []
    for bucket in category_map.values():
        max_marks = bucket["max_marks"]
        percentage = round((bucket["marks_obtained"] / max_marks) * 100, 1) if max_marks else 0
        category_breakdown.append(
            {
                "label": bucket["label"],
                "questions": bucket["questions"],
                "answered": bucket["answered"],
                "marks_obtained": round(bucket["marks_obtained"], 2),
                "max_marks": round(max_marks, 2),
                "percentage": percentage,
                "average_time_seconds": round(bucket["_time_seconds"] / bucket["questions"]) if bucket["questions"] else 0,
            }
        )
    category_breakdown.sort(key=lambda item: ("MCQ", "Short Answer", "Long Answer", "Code").index(item["label"]) if item["label"] in {"MCQ", "Short Answer", "Long Answer", "Code"} else 99)

    latest_violation = (
        ViolationLog.query.filter_by(session_id=student_session.id)
        .order_by(ViolationLog.occurred_at.desc())
        .first()
    )
    violation_count = ViolationLog.query.filter_by(session_id=student_session.id).count()
    max_warnings = SettingsService.max_violations_allowed()
    warning_count = int(student_session.focus_violations or 0)
    suspicion_score = int(student_session.suspicion_score or 0)
    if warning_count == 0 and suspicion_score == 0 and violation_count == 0:
        integrity_status = "Clear"
    elif warning_count >= max_warnings or suspicion_score >= 75:
        integrity_status = "Admin review"
    else:
        integrity_status = "Review suggested"

    session_duration_seconds = 0
    if student_session.start_time and student_session.submitted_at:
        session_duration_seconds = max(int((student_session.submitted_at - student_session.start_time).total_seconds()), 0)
    elif student_session.start_time and student_session.status in {"submitted", "auto_submitted", "evaluated"}:
        end_time = student_session.end_time or datetime.utcnow()
        session_duration_seconds = max(int((end_time - student_session.start_time).total_seconds()), 0)

    unanswered_count = max(total_questions - answered_count, 0)
    not_answered_count = status_counts.get("VISITED_UNANSWERED", 0)
    not_visited_count = status_counts.get("NOT_VISITED", 0)
    review_count = status_counts.get("MARKED_REVIEW", 0) + status_counts.get("ANSWERED_MARKED", 0)
    answered_marked_count = status_counts.get("ANSWERED_MARKED", 0)
    progress_percent = round((answered_count / total_questions) * 100) if total_questions else 0

    strongest_area = max(category_breakdown, key=lambda item: item["percentage"], default=None)
    improvement_area = min(category_breakdown, key=lambda item: item["percentage"], default=None)
    recommendations = []
    if unanswered_count:
        recommendations.append(f"Review time planning: {unanswered_count} question(s) were left unanswered.")
    if improvement_area and improvement_area["max_marks"] > 0 and improvement_area["percentage"] < 60:
        recommendations.append(f"Focus revision on {improvement_area['label']} questions.")
    if strongest_area and strongest_area["max_marks"] > 0 and strongest_area["percentage"] >= 75:
        recommendations.append(f"Strongest area: {strongest_area['label']}.")
    if not recommendations:
        recommendations.append("Keep practicing with mixed question types to maintain consistency.")

    return {
        "total_questions": total_questions,
        "answered_count": answered_count,
        "unanswered_count": unanswered_count,
        "not_answered_count": not_answered_count,
        "not_visited_count": not_visited_count,
        "review_count": review_count,
        "answered_marked_count": answered_marked_count,
        "progress_percent": progress_percent,
        "status_counts": status_counts,
        "time_spent_seconds": total_time_spent_seconds,
        "time_spent_minutes": round(total_time_spent_seconds / 60, 1) if total_time_spent_seconds else 0,
        "session_duration_seconds": session_duration_seconds,
        "session_duration_minutes": round(session_duration_seconds / 60, 1) if session_duration_seconds else 0,
        "average_time_per_question_seconds": round(total_time_spent_seconds / total_questions) if total_questions else 0,
        "average_time_per_answered_seconds": round(total_time_spent_seconds / answered_count) if answered_count else 0,
        "warning_count": warning_count,
        "max_warnings": max_warnings,
        "violation_count": violation_count,
        "suspicion_score": suspicion_score,
        "integrity_status": integrity_status,
        "autosubmit_reason": student_session.autosubmit_reason,
        "latest_violation": {
            "type": latest_violation.violation_type,
            "detail": latest_violation.detail,
            "occurred_at": _iso_datetime(latest_violation.occurred_at),
        }
        if latest_violation
        else None,
        "category_breakdown": category_breakdown,
        "recommendations": recommendations,
    }


def _student_result_payload(result):
    student_session = result.session
    exam = student_session.exam_set
    answers_by_question = {answer.question_id: answer for answer in student_session.answers}
    marks_by_question = {mark.question_id: mark for mark in result.question_marks}
    questions = ExamService.get_session_questions(student_session)
    analytics = _result_analytics_payload(student_session, result, questions, answers_by_question, marks_by_question)
    return {
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
        "time_taken": analytics["session_duration_minutes"] or analytics["time_spent_minutes"],
        "time_taken_seconds": analytics["session_duration_seconds"] or analytics["time_spent_seconds"],
        "teacher_remarks": result.teacher_remarks,
        **_result_status_payload(result, exam),
        "analytics": analytics,
        "pdf_url": _student_result_pdf_url(result),
        "certificate_url": f"/api/student/results/{exam.id}/certificate",
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

    if exam.status == "draft":
        return {
            "label": "Temporarily inactive",
            "href": None,
            "method": "get",
            "variant": "secondary",
            "disabled": True,
            "message": "This exam is temporarily inactive while changes are being made. Please wait for it to be published again.",
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


def _student_progress_cache(student_sessions):
    sessions_by_id = {student_session.id: student_session for student_session in student_sessions if student_session}
    if not sessions_by_id:
        return {}

    question_ids_by_session = {}
    all_question_ids = set()
    for student_session in sessions_by_id.values():
        question_ids = ExamService.ensure_question_order(student_session)
        question_ids_by_session[student_session.id] = question_ids
        all_question_ids.update(question_ids)

    questions_by_id = {
        question.id: question
        for question in Question.query.filter(Question.id.in_(all_question_ids)).all()
    } if all_question_ids else {}
    answers_by_session = {session_id: [] for session_id in sessions_by_id}
    for answer in Answer.query.filter(Answer.session_id.in_(list(sessions_by_id))).all():
        answers_by_session.setdefault(answer.session_id, []).append(answer)

    return {
        session_id: {
            "questions": [questions_by_id[question_id] for question_id in question_ids if question_id in questions_by_id],
            "answers": answers_by_session.get(session_id, []),
        }
        for session_id, question_ids in question_ids_by_session.items()
    }


def _student_session_progress_payload(student_session, questions=None, answers=None):
    if not student_session:
        return {
            "answered_count": 0,
            "unanswered_count": 0,
            "not_visited_count": 0,
            "review_count": 0,
            "total_questions": 0,
            "progress_percent": 0,
            "time_spent_seconds": 0,
            "time_spent_minutes": 0,
        }

    questions = questions if questions is not None else ExamService.get_session_questions(student_session)
    total_questions = len(questions)
    question_ids = {question.id for question in questions}
    answers = answers if answers is not None else Answer.query.filter_by(session_id=student_session.id).all()
    answers = [answer for answer in answers if not question_ids or answer.question_id in question_ids]
    answered_count = sum(1 for answer in answers if _answered_answer(answer))
    status_counts = {state: 0 for state in EXAM_NAVIGATOR_STATUSES}
    total_time_spent_seconds = 0
    for answer in answers:
        total_time_spent_seconds += int(getattr(answer, "total_time_spent_seconds", 0) or 0)
        visit_status = answer.visit_status if answer.visit_status in EXAM_NAVIGATOR_STATUSES else None
        if not visit_status:
            visit_status = "ANSWERED" if _answered_answer(answer) else "VISITED_UNANSWERED"
        status_counts[visit_status] = status_counts.get(visit_status, 0) + 1
    status_counts["NOT_VISITED"] = max(
        status_counts.get("NOT_VISITED", 0) + total_questions - len({answer.question_id for answer in answers}),
        0,
    )
    return {
        "answered_count": answered_count,
        "unanswered_count": max(total_questions - answered_count, 0),
        "not_visited_count": status_counts.get("NOT_VISITED", 0),
        "review_count": status_counts.get("MARKED_REVIEW", 0) + status_counts.get("ANSWERED_MARKED", 0),
        "total_questions": total_questions,
        "progress_percent": round((answered_count / total_questions) * 100) if total_questions else 0,
        "time_spent_seconds": total_time_spent_seconds,
        "time_spent_minutes": round(total_time_spent_seconds / 60, 1) if total_time_spent_seconds else 0,
    }


def _student_exam_state_label(exam, latest_session, window, published_result):
    if published_result:
        return "result_published"
    if latest_session and latest_session.status in {"active", "paused"}:
        return "in_progress"
    if latest_session and latest_session.status in LOCKED_SESSION_STATUSES:
        return "submitted"
    if window.get("time_state") == "not_started":
        return "upcoming"
    if window.get("is_open") and exam.status == "active":
        return "available"
    if window.get("has_ended") or exam.status == "closed":
        return "closed"
    return exam.status or "inactive"


def _schedule_date_key(value):
    text_value = str(value or "")
    return text_value[:10] if len(text_value) >= 10 else "unscheduled"


def _dashboard_schedule_payload(items, limit=8):
    rank = {
        "in_progress": 0,
        "live": 0,
        "available": 1,
        "review_due": 1,
        "upcoming": 2,
        "draft": 3,
        "submitted": 4,
        "closed": 5,
        "result_published": 6,
    }
    filtered_items = [item for item in items if item]
    filtered_items.sort(
        key=lambda item: (
            rank.get(item.get("state"), 9),
            item.get("primary_at") or "9999-12-31T23:59:59Z",
            item.get("title") or "",
        )
    )
    counts = {}
    for item in filtered_items:
        state = item.get("state") or "other"
        counts[state] = counts.get(state, 0) + 1
    return {
        "items": filtered_items[:limit],
        "counts": counts,
        "total": len(filtered_items),
    }


def _student_schedule_payload(cards, now=None):
    now = now or datetime.utcnow()
    now_iso = _iso_datetime(now)
    schedule_items = []
    for card in cards:
        state = card.get("state")
        if state in {"closed", "result_published"}:
            continue
        primary_at = card.get("start_time")
        if state in {"in_progress", "available"}:
            primary_at = now_iso
        if not primary_at:
            primary_at = card.get("end_time") or now_iso
        schedule_items.append(
            {
                "id": f"student-exam-{card.get('exam_id')}",
                "exam_id": card.get("exam_id"),
                "title": card.get("exam_name"),
                "subject": card.get("subject"),
                "set_code": card.get("set_code"),
                "state": state,
                "starts_at": card.get("start_time"),
                "ends_at": card.get("end_time"),
                "primary_at": primary_at,
                "date_key": _schedule_date_key(primary_at),
                "duration_minutes": card.get("effective_duration_minutes") or card.get("duration_minutes"),
                "question_count": card.get("question_count"),
                "attempts_remaining": card.get("attempts_remaining"),
                "action": card.get("action") or {},
                "progress": card.get("latest_session", {}).get("progress") if card.get("latest_session") else None,
            }
        )
    return _dashboard_schedule_payload(schedule_items)


def _teacher_schedule_item(exam, exam_payload, now=None):
    now = now or datetime.utcnow()
    pending_review_count = int(exam_payload.get("pending_review_count") or 0)
    if pending_review_count:
        state = "review_due"
        primary_at = _iso_datetime(exam.end_time or exam.updated_at or now)
        label = f"{pending_review_count} pending review"
    elif exam.status == "active" and exam.is_open_for_student(now):
        state = "live"
        primary_at = _iso_datetime(now)
        label = "Live now"
    elif exam.status == "active" and exam.start_time and exam.start_time > now:
        state = "upcoming"
        primary_at = _iso_datetime(exam.start_time)
        label = "Scheduled"
    elif exam.status == "draft":
        state = "draft"
        primary_at = _iso_datetime(exam.start_time or exam.updated_at or exam.created_at)
        label = "Draft"
    else:
        state = "closed" if exam.status == "closed" or exam.has_ended(now) else exam.status
        primary_at = _iso_datetime(exam.end_time or exam.updated_at or exam.created_at)
        label = state.replace("_", " ").title() if state else "Exam"

    return {
        "id": f"teacher-exam-{exam.id}",
        "exam_id": exam.id,
        "title": exam.exam_name,
        "subject": exam.subject,
        "set_code": exam.set_code,
        "state": state,
        "label": label,
        "starts_at": _iso_datetime(exam.start_time),
        "ends_at": _iso_datetime(exam.end_time),
        "primary_at": primary_at,
        "date_key": _schedule_date_key(primary_at),
        "duration_minutes": exam.duration_minutes,
        "question_count": exam_payload.get("question_count"),
        "enrolled_count": exam_payload.get("enrolled_count"),
        "submitted_count": exam_payload.get("submitted_count"),
        "pending_review_count": pending_review_count,
        "href": f"/react/teacher/exam/{exam.id}/review" if pending_review_count else f"/react/teacher/exam/{exam.id}/edit",
    }


def _student_attempt_history_payload(student_session, progress_data=None):
    exam = student_session.exam_set
    result = student_session.result if student_session.result and student_session.result.published else None
    progress_data = progress_data or {}
    progress = _student_session_progress_payload(
        student_session,
        questions=progress_data.get("questions"),
        answers=progress_data.get("answers"),
    )
    return {
        "id": student_session.id,
        "session_code": student_session.session_code,
        "exam_id": exam.id,
        "exam_name": exam.exam_name,
        "subject": exam.subject,
        "set_code": exam.set_code,
        "teacher_name": exam.creator.name if exam.creator else None,
        "status": student_session.status,
        "started_at": _iso_datetime(student_session.start_time),
        "submitted_at": _iso_datetime(student_session.submitted_at),
        "created_at": _iso_datetime(student_session.created_at),
        "duration_minutes": exam.duration_minutes + int(student_session.extra_time_minutes or 0),
        "remaining_seconds": ExamService.remaining_seconds_for_session(student_session),
        "focus_violations": student_session.focus_violations,
        "autosubmit_reason": student_session.autosubmit_reason,
        "progress": progress,
        "result": {
            "total_marks_obtained": result.total_marks_obtained,
            "total_marks": result.total_marks,
            "percentage": result.percentage,
            **_result_status_payload(result, exam),
            "published_at": _iso_datetime(result.published_at),
            "href": f"/react/student/submitted/{student_session.session_code}",
            "pdf_href": _student_result_pdf_url(result),
        }
        if result
        else None,
        "links": {
            "submitted": f"/react/student/submitted/{student_session.session_code}",
            "result": f"/react/student/submitted/{student_session.session_code}" if result else None,
            "pdf": _student_result_pdf_url(result) if result else None,
        },
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
    questions = ExamService.get_session_questions(student_session)
    total_questions = len(questions)
    question_ids = {question.id for question in questions}
    answers_by_question = {
        answer.question_id: answer
        for answer in student_session.answers
        if not question_ids or answer.question_id in question_ids
    }
    answered_count = sum(1 for answer in answers_by_question.values() if _answered_answer(answer))
    status_counts = {state: 0 for state in EXAM_NAVIGATOR_STATUSES}
    for answer in answers_by_question.values():
        visit_status = answer.visit_status if answer.visit_status in EXAM_NAVIGATOR_STATUSES else None
        if not visit_status:
            visit_status = "ANSWERED" if _answered_answer(answer) else "VISITED_UNANSWERED"
        status_counts[visit_status] = status_counts.get(visit_status, 0) + 1
    status_counts["NOT_VISITED"] = max(
        status_counts.get("NOT_VISITED", 0) + total_questions - len(answers_by_question),
        0,
    )
    total_time_spent_seconds = sum(
        int(getattr(answer, "total_time_spent_seconds", 0) or 0)
        for answer in answers_by_question.values()
    )
    locked_for_review = student_session.status in LOCKED_SESSION_STATUSES
    if not locked_for_review:
        review_status = "in_progress"
    elif not result:
        review_status = "pending"
    elif result.published:
        review_status = "published"
    else:
        review_status = "evaluated"
    max_warnings = SettingsService.max_violations_allowed()
    if review_status == "pending" and (
        int(student_session.focus_violations or 0) >= max_warnings
        or int(student_session.suspicion_score or 0) >= 75
        or student_session.status == "terminated"
    ):
        review_priority = "critical"
    elif review_status == "pending" and (
        int(student_session.focus_violations or 0) > 0
        or student_session.status == "auto_submitted"
        or student_session.autosubmit_reason
    ):
        review_priority = "high"
    elif review_status == "pending":
        review_priority = "normal"
    else:
        review_priority = "complete"
    return {
        "id": student_session.id,
        "session_code": student_session.session_code,
        "student_name": student_session.student_name,
        "roll_no": student_session.roll_no,
        "status": student_session.status,
        "review_status": review_status,
        "review_priority": review_priority,
        "locked_for_review": locked_for_review,
        "focus_violations": student_session.focus_violations,
        "suspicion_score": student_session.suspicion_score,
        "autosubmit_reason": student_session.autosubmit_reason,
        "answered_count": answered_count,
        "unanswered_count": max(total_questions - answered_count, 0),
        "not_visited_count": status_counts.get("NOT_VISITED", 0),
        "review_count": status_counts.get("MARKED_REVIEW", 0) + status_counts.get("ANSWERED_MARKED", 0),
        "progress_percent": round((answered_count / total_questions) * 100) if total_questions else 0,
        "total_questions": total_questions,
        "time_spent_seconds": total_time_spent_seconds,
        "time_spent_minutes": round(total_time_spent_seconds / 60, 1) if total_time_spent_seconds else 0,
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


def _question_review_suggestion(question, answer, question_mark):
    answer_text = (answer.answer_text or "").strip() if answer else ""
    question_type = _exam_question_type(question)
    is_auto_gradable = question_type == "mcq"
    if is_auto_gradable:
        suggested_marks = float(question.marks or 0) if answer_text and answer_text == (question.correct_answer or "").strip() else 0
    elif not answer_text:
        suggested_marks = 0
    else:
        suggested_marks = question_mark.marks_awarded if question_mark else None

    if question_mark:
        mark_status = "marked"
    elif not answer_text:
        mark_status = "no_answer"
    elif is_auto_gradable:
        mark_status = "suggested"
    else:
        mark_status = "unmarked"

    max_marks = float(question.marks or 0)
    half_marks = round(max_marks / 2, 2)
    rubric = [
        {"label": "No credit", "marks": 0, "hint": "Incorrect, missing, or unrelated answer."},
        {"label": "Partial", "marks": half_marks, "hint": "Shows partial understanding or incomplete method."},
        {"label": "Full", "marks": max_marks, "hint": "Meets the expected answer fully."},
    ]
    return {
        "is_auto_gradable": is_auto_gradable,
        "needs_manual_review": bool(answer_text and not is_auto_gradable and not question_mark),
        "suggested_marks": suggested_marks,
        "has_saved_mark": bool(question_mark),
        "mark_status": mark_status,
        "rubric": rubric,
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


def _require_draft_user_api():
    role = session.get("role")
    if role == "admin":
        return _require_admin_api()
    if role == "teacher":
        return _require_teacher_api()
    return None, _role_error("Admin or teacher login required", 403)


def _admin_password_matches(payload):
    password = (payload or {}).get("admin_password") or ""
    admin = User.query.get(session.get("admin_id"))
    return bool(password and admin and admin.check_password(password))


def _proctor_session_payload(student_session):
    exam = student_session.exam_set
    student_user = _find_student_by_identifier(student_session.roll_no)
    questions = ExamService.get_session_questions(student_session)
    total_questions = len(questions)
    question_by_id = {question.id: question for question in questions}
    answers = Answer.query.filter_by(session_id=student_session.id).all()
    answered_question_ids = set()
    status_counts = {state: 0 for state in EXAM_NAVIGATOR_STATUSES}
    total_time_spent_seconds = 0
    for answer in answers:
        total_time_spent_seconds += int(getattr(answer, "total_time_spent_seconds", 0) or 0)
        if (answer.answer_text or "").strip():
            answered_question_ids.add(answer.question_id)
        visit_status = answer.visit_status if answer.visit_status in EXAM_NAVIGATOR_STATUSES else None
        if not visit_status:
            visit_status = "ANSWERED" if (answer.answer_text or "").strip() else "VISITED_UNANSWERED"
        status_counts[visit_status] = status_counts.get(visit_status, 0) + 1
    status_counts["NOT_VISITED"] = max(
        status_counts.get("NOT_VISITED", 0) + total_questions - len({answer.question_id for answer in answers}),
        0,
    )
    answered_count = len(answered_question_ids)
    review_count = status_counts.get("MARKED_REVIEW", 0) + status_counts.get("ANSWERED_MARKED", 0)
    progress_percent = round((answered_count / total_questions) * 100) if total_questions else 0
    latest_violation = (
        ViolationLog.query.filter_by(session_id=student_session.id)
        .order_by(ViolationLog.occurred_at.desc())
        .first()
    )

    heartbeat_age = None
    if student_session.last_heartbeat:
        heartbeat_age = int((datetime.utcnow() - student_session.last_heartbeat).total_seconds())
    if heartbeat_age is None:
        online_status = "offline"
    elif heartbeat_age <= 35:
        online_status = "online"
    elif heartbeat_age <= 90:
        online_status = "stale"
    else:
        online_status = "offline"

    current_question = None
    current_question_id = getattr(student_session, "current_question_id", None)
    if current_question_id:
        current_question = question_by_id.get(current_question_id)
    current_question_index = getattr(student_session, "current_question_index", None)
    if current_question is None and current_question_index is not None and 0 <= current_question_index < len(questions):
        current_question = questions[current_question_index]
        current_question_id = current_question.id
    if current_question and current_question_index is None:
        for index, question in enumerate(questions):
            if question.id == current_question.id:
                current_question_index = index
                break

    max_warnings = SettingsService.max_violations_allowed()
    if student_session.focus_violations >= max_warnings or student_session.suspicion_score >= 75:
        risk_level = "critical"
    elif student_session.focus_violations > 0 or online_status == "offline" or student_session.pause_requested_at:
        risk_level = "warning"
    else:
        risk_level = "normal"

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
        "not_answered_count": status_counts.get("VISITED_UNANSWERED", 0),
        "not_visited_count": status_counts.get("NOT_VISITED", 0),
        "review_count": review_count,
        "answered_marked_count": status_counts.get("ANSWERED_MARKED", 0),
        "progress_percent": progress_percent,
        "status_counts": status_counts,
        "total_questions": total_questions,
        "focus_violations": student_session.focus_violations,
        "suspicion_score": student_session.suspicion_score,
        "max_warnings": max_warnings,
        "risk_level": risk_level,
        "online_status": online_status,
        "last_heartbeat_age": heartbeat_age,
        "time_spent_seconds": total_time_spent_seconds,
        "average_time_per_answered_seconds": round(total_time_spent_seconds / answered_count) if answered_count else 0,
        "current_question_index": current_question_index,
        "current_question_id": current_question_id,
        "current_question_number": current_question.question_number if current_question else None,
        "current_question_type": _exam_question_type(current_question) if current_question else None,
        "latest_violation": latest_violation.violation_type if latest_violation else None,
        "latest_violation_at": _iso_datetime(latest_violation.occurred_at) if latest_violation else None,
        "latest_violation_detail": latest_violation.detail if latest_violation else None,
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
        "online_sessions": sum(1 for item in snapshots if item.get("online_status") == "online"),
        "stale_sessions": sum(1 for item in snapshots if item.get("online_status") == "stale"),
        "offline_sessions": sum(1 for item in snapshots if item.get("online_status") == "offline"),
        "critical_sessions": sum(1 for item in snapshots if item.get("risk_level") == "critical"),
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
    user = None
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
            user = None
    if user_id and user:
        _run_due_notification_reminders(user)
    return jsonify(
        {
            "ok": True,
            "csrf_token": get_csrf_token(),
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
                "counts": _notification_counts_payload(user_id) if user_id else {},
                "recent": [
                    _notification_payload(item)
                    for item in NotificationService.unread_for_user(user_id, limit=6)
                ],
            },
        }
    )


@api_bp.route("/settings/public")
def public_settings_api():
    return jsonify({
        "ok": True,
        "csrf_token": get_csrf_token(),
        "settings": _public_settings_payload(SettingsService.get_settings()),
    })


@api_bp.route("/registration-requests", methods=["POST"])
@rate_limit("registration_request", limit=5, window_seconds=300)
def registration_request_api():
    settings = SettingsService.get_settings()
    if settings.student_self_registration:
        return jsonify({"ok": False, "message": "Student self-registration is currently open. Please create your account from this page."}), 409

    payload = request.get_json(silent=True) or {}
    full_name = _compact_text(payload.get("full_name") or payload.get("name"), 120)
    preferred_username = _compact_text(payload.get("preferred_username") or payload.get("username"), 80) or None
    email = (_compact_text(payload.get("email"), 120) or "").lower() or None
    raw_phone = _compact_text(payload.get("phone"), 30)
    phone = normalize_phone_10(raw_phone)
    roll_number = _compact_text(payload.get("roll_number") or payload.get("roll_no"), 50).upper()
    class_name = _compact_text(payload.get("class_name") or payload.get("className"), 80) or None
    message = _compact_text(payload.get("message"), 1500)

    if not full_name or not roll_number or not message:
        return jsonify({"ok": False, "message": "Please share your name, roll number, and message for the admin."}), 400
    if len(message) < 10:
        return jsonify({"ok": False, "message": "Please write a little more so the admin understands what you need."}), 400
    if raw_phone and not phone:
        return jsonify({"ok": False, "message": "Phone number must contain exactly 10 digits."}), 400
    if not email and not phone:
        return jsonify({"ok": False, "message": "Please provide an email address or phone number so the admin can reach you."}), 400
    if email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        return jsonify({"ok": False, "message": "Please enter a valid email address."}), 400

    registration_request = RegistrationRequest(
        full_name=full_name,
        preferred_username=preferred_username,
        email=email,
        phone=phone,
        roll_number=roll_number,
        class_name=class_name,
        message=message,
        ip_address=get_client_ip(),
        user_agent=(request.headers.get("User-Agent") or "")[:255],
    )
    db.session.add(registration_request)
    db.session.flush()

    NotificationService.notify_role(
        "admin",
        f"{full_name} requested registration access for roll {roll_number}.",
        notification_type="registration_request",
        related_entity_type="registration_request",
        related_entity_id=registration_request.id,
    )
    db.session.commit()

    emit_data_changed(
        {
            "role": "public",
            "resource": "registration_requests",
            "method": "POST",
            "registration_request_id": registration_request.id,
            "path": request.path,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }
    )

    return jsonify(
        {
            "ok": True,
            "message": "Your request was sent to the admin. Please keep an eye on the contact details you shared.",
            "request": _registration_request_payload(registration_request),
        }
    ), 201


@api_bp.route("/search")
def universal_search_api():
    user, error_response = _current_session_user()
    if error_response:
        return error_response

    role = user.role
    query = (request.args.get("q") or "").strip().lower()
    limit = min(max(request.args.get("limit", 10, type=int), 1), 20)
    items = _search_pages_for_role(role)

    if query:
        pattern = f"%{query}%"
        if role == "admin":
            users = (
                User.query.filter(
                    or_(
                        db.func.lower(User.name).like(pattern),
                        db.func.lower(User.username).like(pattern),
                        db.func.lower(User.email).like(pattern),
                        db.func.lower(User.roll_number).like(pattern),
                        db.func.lower(User.role).like(pattern),
                    )
                )
                .order_by(User.updated_at.desc())
                .limit(8)
                .all()
            )
            items.extend(
                _search_item(
                    "user",
                    found_user.name,
                    f"{found_user.role.title()} | @{found_user.username}{f' | {found_user.roll_number}' if found_user.roll_number else ''}",
                    f"/react/admin/users?edit={found_user.id}",
                    f"{found_user.email or ''} {found_user.role} {found_user.roll_number or ''}",
                )
                for found_user in users
            )

            exams = (
                ExamSet.query.filter(
                    or_(
                        db.func.lower(ExamSet.exam_name).like(pattern),
                        db.func.lower(ExamSet.subject).like(pattern),
                        db.func.lower(ExamSet.set_code).like(pattern),
                        db.func.lower(ExamSet.status).like(pattern),
                    )
                )
                .order_by(ExamSet.updated_at.desc())
                .limit(8)
                .all()
            )
            items.extend(
                _search_item(
                    "exam",
                    exam.exam_name,
                    f"{exam.subject} | {exam.status}",
                    "/react/admin/exams",
                    f"{exam.set_code} {exam.creator.name if exam.creator else ''}",
                )
                for exam in exams
            )

            groups = (
                StudentGroup.query.filter(
                    or_(
                        db.func.lower(StudentGroup.name).like(pattern),
                        db.func.lower(StudentGroup.description).like(pattern),
                        db.func.lower(StudentGroup.join_code).like(pattern),
                    )
                )
                .order_by(StudentGroup.updated_at.desc())
                .limit(6)
                .all()
            )
            items.extend(
                _search_item(
                    "group",
                    group.name,
                    f"{len(group.members)} member(s) | Code {group.join_code or '-'}",
                    "/react/admin/groups",
                    group.description,
                )
                for group in groups
            )

            audit_logs = (
                AuditLog.query.filter(
                    or_(
                        db.func.lower(AuditLog.action).like(pattern),
                        db.func.lower(AuditLog.resource_type).like(pattern),
                        db.func.lower(AuditLog.changes).like(pattern),
                    )
                )
                .order_by(AuditLog.created_at.desc())
                .limit(6)
                .all()
            )
            items.extend(
                _search_item(
                    "audit",
                    _audit_formatted_message(log),
                    f"{_humanize_audit_action(log.action)} | {log.status or 'logged'}",
                    "/react/admin/reports",
                    f"{log.resource_type} {log.changes or ''}",
                )
                for log in audit_logs
            )

            registration_requests = (
                RegistrationRequest.query.filter(
                    or_(
                        db.func.lower(RegistrationRequest.full_name).like(pattern),
                        db.func.lower(RegistrationRequest.preferred_username).like(pattern),
                        db.func.lower(RegistrationRequest.email).like(pattern),
                        db.func.lower(RegistrationRequest.phone).like(pattern),
                        db.func.lower(RegistrationRequest.roll_number).like(pattern),
                        db.func.lower(RegistrationRequest.class_name).like(pattern),
                        db.func.lower(RegistrationRequest.message).like(pattern),
                        db.func.lower(RegistrationRequest.status).like(pattern),
                    )
                )
                .order_by(RegistrationRequest.created_at.desc())
                .limit(6)
                .all()
            )
            items.extend(
                _search_item(
                    "request",
                    registration_request.full_name,
                    f"{registration_request.roll_number} | {registration_request.status}",
                    f"/react/notifications?request={registration_request.id}",
                    f"{registration_request.email or ''} {registration_request.phone or ''} {registration_request.message}",
                )
                for registration_request in registration_requests
            )

            settings = SettingsService.get_settings()
            settings_text = " ".join(
                str(value or "")
                for value in (
                    settings.platform_name,
                    settings.welcome_message,
                    settings.announcement_message,
                    settings.login_page_heading,
                    settings.login_page_tagline,
                    settings.login_page_subheading,
                    settings.login_page_security_badge_text,
                    settings.quote_pool,
                )
            ).lower()
            if any(token in settings_text for token in query.split()):
                items.append(
                    _search_item(
                        "settings",
                        "Platform Settings",
                        "Login page copy, registration, security, logo, and announcements.",
                        "/react/admin/settings",
                        settings_text,
                        score=7,
                    )
                )

        elif role == "teacher":
            exams = (
                ExamSet.query.filter(
                    ExamSet.created_by == user.id,
                    or_(
                        db.func.lower(ExamSet.exam_name).like(pattern),
                        db.func.lower(ExamSet.subject).like(pattern),
                        db.func.lower(ExamSet.set_code).like(pattern),
                        db.func.lower(ExamSet.status).like(pattern),
                    ),
                )
                .order_by(ExamSet.updated_at.desc())
                .limit(10)
                .all()
            )
            items.extend(
                _search_item(
                    "exam",
                    exam.exam_name,
                    f"{exam.subject} | {exam.status}",
                    f"/react/teacher/exam/{exam.id}/edit",
                    exam.set_code,
                )
                for exam in exams
            )

            bank_items = (
                QuestionBankItem.query.filter(
                    QuestionBankItem.teacher_id == user.id,
                    or_(
                        db.func.lower(QuestionBankItem.question_text).like(pattern),
                        db.func.lower(QuestionBankItem.question_type).like(pattern),
                        db.func.lower(QuestionBankItem.exam_title).like(pattern),
                        db.func.lower(QuestionBankItem.code_language).like(pattern),
                    ),
                )
                .order_by(QuestionBankItem.updated_at.desc())
                .limit(8)
                .all()
            )
            items.extend(
                _search_item(
                    "question",
                    (item.question_text or "Question")[:90],
                    f"{item.question_type} | {(item.marks or 0):g} mark(s)",
                    "/react/teacher/question-bank",
                    f"{item.exam_title or ''} {item.code_language or ''}",
                )
                for item in bank_items
            )

            sessions = (
                StudentSession.query.join(ExamSet, StudentSession.exam_set_id == ExamSet.id)
                .filter(
                    ExamSet.created_by == user.id,
                    or_(
                        db.func.lower(StudentSession.student_name).like(pattern),
                        db.func.lower(StudentSession.roll_no).like(pattern),
                        db.func.lower(StudentSession.status).like(pattern),
                        db.func.lower(ExamSet.exam_name).like(pattern),
                    ),
                )
                .order_by(StudentSession.updated_at.desc())
                .limit(8)
                .all()
            )
            items.extend(
                _search_item(
                    "session",
                    session_row.student_name,
                    f"{session_row.exam_set.exam_name} | {session_row.status}",
                    f"/react/teacher/session/{session_row.id}/review",
                    session_row.roll_no,
                )
                for session_row in sessions
            )

        elif role == "student":
            roll_no = (user.roll_number or session.get("roll_no") or "").strip().upper()
            exams = (
                ExamSet.query.outerjoin(ExamEnrollment, ExamEnrollment.exam_set_id == ExamSet.id)
                .filter(
                    or_(
                        ExamSet.access_mode == "open",
                        db.func.upper(ExamEnrollment.roll_no) == roll_no,
                    ),
                    or_(
                        db.func.lower(ExamSet.exam_name).like(pattern),
                        db.func.lower(ExamSet.subject).like(pattern),
                        db.func.lower(ExamSet.set_code).like(pattern),
                        db.func.lower(ExamSet.status).like(pattern),
                    ),
                )
                .order_by(ExamSet.updated_at.desc())
                .limit(10)
                .all()
            )
            items.extend(
                _search_item(
                    "exam",
                    exam.exam_name,
                    f"{exam.subject} | {exam.status}",
                    "/react/student/exams",
                    exam.set_code,
                )
                for exam in exams
            )

            student_sessions = (
                StudentSession.query.join(ExamSet, StudentSession.exam_set_id == ExamSet.id)
                .filter(
                    db.func.upper(StudentSession.roll_no) == roll_no,
                    or_(
                        db.func.lower(StudentSession.student_name).like(pattern),
                        db.func.lower(StudentSession.status).like(pattern),
                        db.func.lower(ExamSet.exam_name).like(pattern),
                        db.func.lower(ExamSet.subject).like(pattern),
                    ),
                )
                .order_by(StudentSession.updated_at.desc())
                .limit(8)
                .all()
            )
            items.extend(
                _search_item(
                    "attempt",
                    student_session.exam_set.exam_name,
                    f"{student_session.status} | {student_session.student_name}",
                    "/react/student/history",
                    student_session.roll_no,
                )
                for student_session in student_sessions
            )

            results = (
                Result.query.join(StudentSession, Result.session_id == StudentSession.id)
                .join(ExamSet, StudentSession.exam_set_id == ExamSet.id)
                .filter(
                    Result.published.is_(True),
                    db.func.upper(StudentSession.roll_no) == roll_no,
                    or_(
                        db.func.lower(ExamSet.exam_name).like(pattern),
                        db.func.lower(ExamSet.subject).like(pattern),
                        db.func.lower(StudentSession.student_name).like(pattern),
                    ),
                )
                .order_by(Result.updated_at.desc())
                .limit(6)
                .all()
            )
            items.extend(
                _search_item(
                    "result",
                    result.session.exam_set.exam_name,
                    f"{(result.percentage or 0):g}% | {(result.total_marks_obtained or 0):g}/{(result.total_marks or 0):g}",
                    "/react/student/results",
                    result.teacher_remarks,
                )
                for result in results
            )

    return jsonify(
        {
            "ok": True,
            "query": query,
            "role": role,
            "items": _filter_search_items(items, query, limit),
        }
    )


@api_bp.route("/drafts", methods=["GET", "POST", "DELETE"])
@rate_limit("admin_action", methods=("POST", "DELETE"))
def drafts_api():
    user, error_response = _require_draft_user_api()
    if error_response:
        return error_response

    if request.method == "GET":
        draft_type = (request.args.get("draft_type") or "").strip()
        query = Draft.query.filter_by(user_id=user.id)
        if draft_type:
            query = query.filter_by(draft_type=draft_type)
        drafts = query.order_by(Draft.updated_at.desc()).all()
        return jsonify({"ok": True, "drafts": [_draft_payload(draft) for draft in drafts]})

    if request.method == "DELETE":
        deleted = Draft.query.filter_by(user_id=user.id).delete()
        db.session.commit()
        return jsonify({"ok": True, "message": "Drafts deleted.", "deleted": deleted})

    payload = _get_json_payload()
    draft_type = str(payload.get("draft_type") or "").strip()
    if not draft_type:
        return jsonify({"ok": False, "message": "Draft type is required."}), 400
    draft_data = payload.get("draft_data")
    if not isinstance(draft_data, dict):
        draft_data = {}
    title_preview = (payload.get("title_preview") or _draft_title_preview(draft_type, draft_data)).strip()[:240]

    draft = Draft.query.filter_by(user_id=user.id, draft_type=draft_type).first()
    status_code = 200
    if not draft:
        draft = Draft(user_id=user.id, user_role=user.role, draft_type=draft_type, created_at=datetime.utcnow())
        db.session.add(draft)
        status_code = 201

    draft.user_role = user.role
    draft.draft_data = json.dumps(draft_data)
    draft.title_preview = title_preview
    draft.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify({"ok": True, "message": "Draft saved.", "draft": _draft_payload(draft)}), status_code


@api_bp.route("/drafts/<int:draft_id>", methods=["GET", "PUT", "DELETE"])
@rate_limit("admin_action", methods=("PUT", "DELETE"))
def draft_detail_api(draft_id):
    user, error_response = _require_draft_user_api()
    if error_response:
        return error_response

    draft = Draft.query.filter_by(id=draft_id, user_id=user.id).first()
    if not draft:
        return jsonify({"ok": False, "message": "Draft not found."}), 404

    if request.method == "GET":
        return jsonify({"ok": True, "draft": _draft_payload(draft)})

    if request.method == "DELETE":
        db.session.delete(draft)
        db.session.commit()
        return jsonify({"ok": True, "message": "Draft deleted."})

    payload = _get_json_payload()
    draft_data = payload.get("draft_data")
    if not isinstance(draft_data, dict):
        draft_data = {}
    draft.draft_data = json.dumps(draft_data)
    draft.title_preview = (payload.get("title_preview") or _draft_title_preview(draft.draft_type, draft_data)).strip()[:240]
    draft.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify({"ok": True, "message": "Draft saved.", "draft": _draft_payload(draft)})


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
        return jsonify({"ok": False, "message": "Password must be at least 8 characters and include uppercase, lowercase, number, and special character (!@#$%^&*)."}), 400
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


@api_bp.route("/account", methods=["GET"])
def account_api():
    user, error_response = _current_session_user()
    if error_response:
        return error_response

    details = {}
    if user.role == "student":
        details["batches"] = [
            membership.group.name
            for membership in StudentGroupMember.query.filter_by(student_id=user.id)
            .join(StudentGroup)
            .order_by(StudentGroup.name.asc())
            .all()
        ]

    return jsonify({
        "ok": True,
        "user": _user_payload(user),
        "details": details,
        "preferences": _account_preferences(user),
        "stats": _account_stats(user),
        "session": {
            "last_login": _iso_datetime(user.last_login),
            "active_sessions": 1 if session.get("auth_session_token") else 0,
            "started_at": _iso_datetime(user.active_session_started_at),
        },
    })


@api_bp.route("/account/avatar", methods=["POST"])
@rate_limit("admin_action")
def account_avatar_api():
    user, error_response = _current_session_user()
    if error_response:
        return error_response

    upload = request.files.get("avatar")
    if not upload or not upload.filename:
        return jsonify({"ok": False, "message": "Choose a profile image to upload."}), 400

    max_bytes = 10 * 1024 * 1024
    if request.content_length and request.content_length > max_bytes + 8192:
        return jsonify({"ok": False, "message": "Profile image must be 10 MB or smaller."}), 400

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


@api_bp.route("/account/preferences", methods=["PATCH", "POST"])
@rate_limit("admin_action")
def account_preferences_api():
    user, error_response = _current_session_user()
    if error_response:
        return error_response

    payload = _get_json_payload()
    current_preferences = _account_preferences(user)
    reminder_lead_minutes = _parse_int_field(payload, "reminder_lead_minutes", minimum=10, maximum=1440, max_digits=4)
    if reminder_lead_minutes is None:
        reminder_lead_minutes = current_preferences.get("reminder_lead_minutes", 30)
    preferences = {
        "exam_reminders": bool(payload.get("exam_reminders", current_preferences.get("exam_reminders", True))),
        "review_reminders": bool(payload.get("review_reminders", current_preferences.get("review_reminders", True))),
        "registration_reminders": bool(payload.get("registration_reminders", current_preferences.get("registration_reminders", True))),
        "reminder_lead_minutes": reminder_lead_minutes,
        "announcement_banners": bool(payload.get("announcement_banners", current_preferences.get("announcement_banners", True))),
    }
    user.account_preferences = json.dumps(preferences)
    db.session.commit()
    return jsonify({"ok": True, "message": "Preferences saved.", "preferences": preferences})


@api_bp.route("/account/deactivate", methods=["POST"])
@rate_limit("admin_action")
def account_deactivate_api():
    user, error_response = _current_session_user()
    if error_response:
        return error_response
    if user.role == "student":
        return jsonify({"ok": False, "message": "Students cannot deactivate their own account."}), 403

    user.is_active = False
    user.clear_active_session_token(session.get("auth_session_token"))
    db.session.add(
        AuditLog(
            user_id=user.id,
            action="deactivate_own_account",
            resource_type="user",
            resource_id=user.id,
            status="success",
            ip_address=get_client_ip(),
            user_agent=request.headers.get("User-Agent"),
        )
    )
    db.session.commit()
    role = user.role
    session.clear()
    return jsonify({"ok": True, "message": "Account deactivated.", "redirect": f"/{role}/login"})


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
    if student_user:
        _run_due_notification_reminders(student_user)
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
        .options(selectinload(ExamEnrollment.exam_set).selectinload(ExamSet.questions))
        .join(ExamSet)
        .order_by(ExamSet.created_at.desc())
        .all()
    )
    exam_ids = [enrollment.exam_set_id for enrollment in enrollments]
    student_sessions_for_exams = (
        StudentSession.query.options(selectinload(StudentSession.result))
        .filter(
            StudentSession.exam_set_id.in_(exam_ids),
            db.func.upper(StudentSession.roll_no) == roll_no,
        )
        .order_by(StudentSession.created_at.desc())
        .all()
    ) if exam_ids else []
    latest_session_by_exam = {}
    attempt_count_by_exam = {}
    for student_session in student_sessions_for_exams:
        attempt_count_by_exam[student_session.exam_set_id] = attempt_count_by_exam.get(student_session.exam_set_id, 0) + 1
        latest_session_by_exam.setdefault(student_session.exam_set_id, student_session)
    attempt_sessions = (
        StudentSession.query.options(
            selectinload(StudentSession.exam_set).selectinload(ExamSet.creator),
            selectinload(StudentSession.result),
        )
        .filter(db.func.upper(StudentSession.roll_no) == roll_no)
        .order_by(StudentSession.created_at.desc())
        .limit(80)
        .all()
    )
    progress_cache = _student_progress_cache([
        *latest_session_by_exam.values(),
        *attempt_sessions,
    ])
    settings = SettingsService.get_settings()
    cards = []
    stats = {
        "assigned": 0,
        "available": 0,
        "upcoming": 0,
        "in_progress": 0,
        "submitted": 0,
        "pending_results": 0,
        "published_results": 0,
    }
    for enrollment in enrollments:
        exam = enrollment.exam_set
        latest_session = latest_session_by_exam.get(exam.id)
        attempt_count = attempt_count_by_exam.get(exam.id, 0)
        attempt_limit = int(exam.attempt_limit or 1)
        attempts_remaining = None if attempt_limit <= 0 else max(attempt_limit - attempt_count, 0)
        window = _student_exam_window_payload(exam, latest_session, now=now)
        action = _student_exam_action_payload(exam, latest_session, attempts_remaining, window)
        published_result = (
            latest_session.result
            if latest_session and latest_session.result and latest_session.result.published
            else None
        )
        latest_progress = (
            _student_session_progress_payload(latest_session, **progress_cache.get(latest_session.id, {}))
            if latest_session
            else None
        )
        exam_state = _student_exam_state_label(exam, latest_session, window, published_result)

        stats["assigned"] += 1
        if window["is_open"] and exam.status == "active":
            stats["available"] += 1
        if window["time_state"] == "not_started":
            stats["upcoming"] += 1
        if exam_state == "in_progress":
            stats["in_progress"] += 1
        if latest_session and latest_session.status in LOCKED_SESSION_STATUSES:
            stats["submitted"] += 1
        if exam_state == "submitted":
            stats["pending_results"] += 1
        if published_result:
            stats["published_results"] += 1

        cards.append(
            {
                "exam_id": exam.id,
                "exam_name": exam.exam_name,
                "subject": exam.subject,
                "set_code": exam.set_code,
                "status": exam.status,
                "state": exam_state,
                "passing_percentage": _exam_passing_percentage(exam),
                "start_time": _iso_datetime(exam.start_time),
                "end_time": _iso_datetime(exam.end_time),
                "duration_minutes": exam.duration_minutes,
                "extra_time_minutes": enrollment.extra_time_minutes or 0,
                "effective_duration_minutes": exam.duration_minutes + int(enrollment.extra_time_minutes or 0),
                "total_marks": exam.total_marks,
                "question_count": len(exam.questions),
                "attempt_limit": exam.attempt_limit,
                "attempt_count": attempt_count,
                "attempts_remaining": attempts_remaining,
                "window": window,
                "action": action,
                "latest_session": {
                    "session_code": latest_session.session_code,
                    "status": latest_session.status,
                    "remaining_seconds": ExamService.remaining_seconds_for_session(latest_session),
                    "focus_violations": latest_session.focus_violations,
                    "started_at": _iso_datetime(latest_session.start_time),
                    "submitted_at": _iso_datetime(latest_session.submitted_at),
                    "autosubmit_reason": latest_session.autosubmit_reason,
                    "progress": latest_progress,
                }
                if latest_session
                else None,
                "result": {
                    "total_marks_obtained": published_result.total_marks_obtained,
                    "total_marks": published_result.total_marks,
                    "percentage": published_result.percentage,
                    **_result_status_payload(published_result, exam),
                    "published_at": _iso_datetime(published_result.published_at),
                    "href": f"/react/student/submitted/{latest_session.session_code}",
                    "pdf_href": _student_result_pdf_url(published_result),
                }
                if published_result
                else None,
            }
        )

    focus_priority = {
        "in_progress": 0,
        "available": 1,
        "upcoming": 2,
        "submitted": 3,
        "result_published": 4,
        "closed": 5,
    }
    focus_exam = min(
        cards,
        key=lambda item: (
            focus_priority.get(item.get("state"), 9),
            item.get("window", {}).get("seconds_until_start") or 0,
            item.get("exam_name") or "",
        ),
        default=None,
    )
    attempt_history = [
        _student_attempt_history_payload(student_session, progress_cache.get(student_session.id))
        for student_session in attempt_sessions
        if student_session.start_time
        or student_session.submitted_at
        or student_session.result
        or student_session.status in {"active", "paused", "submitted", "auto_submitted", "terminated", "evaluated"}
    ]
    schedule = _student_schedule_payload(cards, now=now)

    hour = datetime.now().hour
    if hour < 12:
        greeting = "Good morning"
    elif hour < 17:
        greeting = "Good afternoon"
    else:
        greeting = "Good evening"

    show_announcements = True
    if student_user:
        show_announcements = _account_preferences(student_user).get("announcement_banners", True)

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
            "announcement_message": settings.announcement_message if settings and show_announcements else None,
            "server_time": _iso_datetime(now),
            "stats": stats,
            "exams": cards,
            "focus_exam": focus_exam,
            "schedule": schedule,
            "activity": attempt_history[:6],
            "attempt_history": attempt_history,
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
@rate_limit("student_batch_join")
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
@rate_limit("exam_start")
def react_start_exam_api(exam_id):
    student_name, roll_no, error_response = _require_student_api_details()
    if error_response:
        return error_response

    exam = ExamSet.query.get_or_404(exam_id)
    if not _student_is_enrolled(exam.id, roll_no):
        return jsonify({"ok": False, "message": "This exam is not assigned to your roll number."}), 403
    if exam.status == "draft":
        return jsonify({"ok": False, "message": "This exam is temporarily inactive while changes are being made. Please wait for it to be published again."}), 403
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
@rate_limit("exam_join")
def react_join_exam_api():
    student_name, roll_no, error_response = _require_student_api_details()
    if error_response:
        return error_response

    payload = _get_json_payload()
    access_code = (payload.get("access_code") or "").strip().upper()
    if not access_code:
        return jsonify({"ok": False, "message": "Exam access code is required."}), 400

    exam = ExamSet.query.filter_by(access_code=access_code).first()
    if not exam or getattr(exam, "access_mode", "open") != "access_code":
        return jsonify({"ok": False, "message": "Invalid exam access code."}), 404
    if _exam_requires_enrollment(exam.id) and not _student_is_enrolled(exam.id, roll_no):
        return jsonify({"ok": False, "message": "This exam is assigned by roll number and is not available for your login."}), 403
    if exam.status == "draft":
        return jsonify({"ok": False, "message": "This exam is temporarily inactive while changes are being made. Please wait for it to be published again."}), 403
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
@rate_limit("exam_precheck", methods=("POST",))
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
    _run_due_notification_reminders(teacher)

    now = datetime.utcnow()
    exams = ExamSet.query.filter_by(created_by=teacher.id).order_by(ExamSet.created_at.desc()).all()
    exam_ids = [exam.id for exam in exams]
    counts = _exam_summary_count_maps(exam_ids)
    exam_items = []
    schedule_items = []
    for exam in exams:
        exam_payload = {
            "id": exam.id,
            "exam_name": exam.exam_name,
            "subject": exam.subject,
            "set_code": exam.set_code,
            "status": exam.status,
            "total_marks": exam.total_marks,
            "duration_minutes": exam.duration_minutes,
            "question_count": _exam_count(counts, "questions", exam.id),
            "enrolled_count": _exam_count(counts, "enrollments", exam.id),
            "session_count": _exam_count(counts, "sessions", exam.id),
            "submitted_count": _exam_count(counts, "submitted", exam.id),
            "pending_review_count": _exam_count(counts, "pending_review", exam.id),
            "start_time": _iso_datetime(exam.start_time),
            "end_time": _iso_datetime(exam.end_time),
            "review_url": f"/react/teacher/exam/{exam.id}/review",
        }
        exam_items.append(exam_payload)
        schedule_items.append(_teacher_schedule_item(exam, exam_payload, now=now))

    return jsonify(
        {
            "ok": True,
            "teacher": {"id": teacher.id, "name": teacher.name},
            "exams": exam_items,
            "schedule": _dashboard_schedule_payload(schedule_items),
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
            first_error = errors[0]
            if isinstance(first_error, dict) and first_error.get("error") == "duplicate":
                return jsonify({"ok": False, **first_error}), 409
            return jsonify({"ok": False, "message": first_error, "errors": errors}), 400
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

    columns = [
        "Exam",
        "Subject",
        "Set Code",
        "Student Name",
        "Roll Number",
        "Session Status",
        "Started At",
        "Submitted At",
        "Marks Awarded",
        "Total Marks",
        "Percentage",
        "Published",
        "Published At",
        "Violation Count",
        "Teacher Remarks",
    ]
    return build_csv_response(
        "Exam Results",
        teacher,
        [_teacher_result_export_base_row(item) for item in sessions],
        columns,
        filename=f"Teacher_ExamResults_{datetime.utcnow().strftime('%Y%m%d')}.csv",
        extra_metadata=[("Teacher", teacher.name), ("Total Students", len(sessions))],
    )


@api_bp.route("/teacher/reports/exams/<int:exam_id>/results.csv")
def teacher_reports_exam_results_csv_api(exam_id):
    exam, error_response = _require_teacher_owner(exam_id=exam_id)
    if error_response:
        return error_response

    sessions = (
        StudentSession.query.options(
            selectinload(StudentSession.answers),
            selectinload(StudentSession.result),
        )
        .filter_by(exam_set_id=exam.id)
        .order_by(StudentSession.created_at.desc())
        .all()
    )
    questions = Question.query.filter_by(exam_set_id=exam.id).order_by(Question.question_number.asc()).all()

    headers = [
        "Student Name",
        "Roll Number",
        "Email",
        "Submission Date",
        "Submission Time",
        "Total Marks",
        "Marks Awarded",
        "Percentage",
        "Pass/Fail",
    ]
    for question in questions:
        headers.extend([f"Q{question.question_number} ({question.marks}pts)", f"Q{question.question_number} Remark"])

    rows = []
    for student_session in sessions:
        result = student_session.result
        submitted_at = student_session.submitted_at
        student = _find_student_by_identifier(student_session.roll_no)
        pass_fail = "N/A"
        if result:
            pass_fail = "Pass" if float(result.percentage or 0) >= _exam_passing_percentage(exam) else "Fail"
        row = [
            student_session.student_name,
            student_session.roll_no,
            student.email if student else "",
            submitted_at.strftime("%Y-%m-%d") if submitted_at else "",
            submitted_at.strftime("%H:%M:%S") if submitted_at else "",
            result.total_marks if result else exam.total_marks,
            result.total_marks_obtained if result else "",
            result.percentage if result else "",
            pass_fail,
        ]
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

    safe_name = "".join(ch if ch.isalnum() else "_" for ch in exam.exam_name or str(exam.id))
    return build_csv_response(
        "Exam Results",
        exam.creator,
        rows,
        headers,
        filename=f"ExamResults_{safe_name}_{datetime.utcnow().strftime('%Y%m%d')}.csv",
        extra_metadata=[
            ("Exam", exam.exam_name),
            ("Teacher", exam.creator.name if exam.creator else ""),
            ("Total Students", len(sessions)),
            ("Published", "Yes" if any(item.result and item.result.published for item in sessions) else "No"),
        ],
    )


@api_bp.route("/teacher/reports/sessions/<int:session_id>/answer.pdf")
def teacher_reports_answer_pdf_api(session_id):
    student_session = StudentSession.query.get_or_404(session_id)
    exam, error_response = _require_teacher_owner(student_session=student_session)
    if error_response:
        return error_response

    pdf_buffer = create_submission_pdf(student_session, include_unpublished_feedback=True)
    filename = f"answer_sheet_{student_session.roll_no}_{student_session.session_code}.pdf"
    return pdf_response(pdf_buffer, filename)


@api_bp.route("/teacher/activity")
def teacher_activity_api():
    teacher, error_response = _require_teacher_api()
    if error_response:
        return error_response
    page = max(request.args.get("page", 1, type=int), 1)
    per_page = min(max(request.args.get("per_page", 20, type=int), 1), 100)
    base_query = _teacher_audit_query(teacher)
    query = _apply_audit_filters(base_query, request.args)
    pagination = query.order_by(AuditLog.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
    important_items = (
        base_query.filter(_audit_important_condition())
        .order_by(AuditLog.created_at.desc())
        .limit(8)
        .all()
    )
    return jsonify(
        {
            "ok": True,
            "items": _audit_payloads(pagination.items),
            "summary": _audit_summary_payload(query),
            "important_events": _audit_payloads(important_items),
            "filters": _audit_filter_options_payload(base_query),
            "pagination": {
                "page": pagination.page,
                "per_page": pagination.per_page,
                "pages": pagination.pages,
                "total": pagination.total,
            },
        }
    )


@api_bp.route("/teacher/activity/export.csv")
def teacher_activity_export_api():
    teacher, error_response = _require_teacher_api()
    if error_response:
        return error_response
    return _audit_csv_response(
        _apply_audit_filters(_teacher_audit_query(teacher), request.args),
        teacher,
        filename_prefix="TeacherActivity",
    )


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
        marks = _parse_float_field(
            {"marks": question.get("max_marks") or question.get("marks") or 1},
            "marks",
            minimum=0.01,
            maximum=10000,
        ) or 1
        options = parse_options(question.get("options") or [])
        if q_type == "mcq" and len(options) < 2:
            raise ValueError(f"Question {index} needs at least two MCQ options.")
        rows.append(
            {
                "number": index,
                "text": text,
                "type": q_type,
                "marks": marks,
                "options": options,
                "answer": (question.get("correct_answer") or "").strip(),
                "model_answer": (question.get("model_answer") or "").strip(),
                "image_paths": question.get("image_paths") or [],
                "code_snippet": (question.get("code_snippet") or "").strip(),
                "code_language": (question.get("code_language") or "").strip() or None,
                "time_limit_seconds": 0,
                "execution_time_limit_seconds": _parse_int_field(
                    {"execution_time_limit_seconds": question.get("execution_time_limit_seconds") or 10},
                    "execution_time_limit_seconds",
                    minimum=1,
                    maximum=60,
                    max_digits=2,
                ) or 10,
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
    q_execution_time_limits = request.form.getlist("execution_time_limit_seconds")

    rows = []
    for index, raw_text in enumerate(q_texts):
        text = (raw_text or "").strip()
        if not text:
            continue
        number = _parse_int_field(
            {"question_number": q_numbers[index] if index < len(q_numbers) else ""},
            "question_number",
            minimum=1,
            maximum=999,
            max_digits=3,
        ) or index + 1
        q_type = (q_types[index] if index < len(q_types) else "short").strip().lower()
        marks = _parse_float_field(
            {"marks": q_marks[index] if index < len(q_marks) else ""},
            "marks",
            minimum=0.01,
            maximum=10000,
        ) or 1
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
        execution_time_limit_seconds = _parse_int_field(
            {
                "execution_time_limit_seconds": (
                    q_execution_time_limits[index]
                    if index < len(q_execution_time_limits)
                    else ""
                )
            },
            "execution_time_limit_seconds",
            minimum=1,
            maximum=60,
            max_digits=2,
        ) or 10
        rows.append(
            {
                "number": number,
                "text": text,
                "type": q_type,
                "marks": marks,
                "options": options,
                "answer": (q_answers[index] if index < len(q_answers) else "").strip(),
                "model_answer": (q_model_answers[index] if index < len(q_model_answers) else "").strip(),
                "image_paths": image_paths,
                "code_snippet": (q_code_snippets[index] if index < len(q_code_snippets) else "").strip(),
                "code_language": (q_code_languages[index] if index < len(q_code_languages) else "").strip() or None,
                "time_limit_seconds": 0,
                "execution_time_limit_seconds": min(max(execution_time_limit_seconds, 1), 60),
            }
        )
    return rows


def _auto_add_exam_questions_to_bank(exam, teacher, question_rows):
    added_count = 0
    existing_identities = {
        _question_identity(item.question_type, item.question_text)
        for item in QuestionBankItem.query.filter_by(teacher_id=teacher.id).all()
    }
    for row in question_rows:
        identity = _question_identity(row["type"], row["text"])
        if identity in existing_identities:
            continue
        item = QuestionBankItem(
            teacher_id=teacher.id,
            question_text=row["text"],
            question_type=row["type"],
            marks=row["marks"],
            correct_answer=row["answer"],
            model_answer=row["model_answer"],
            code_snippet=row["code_snippet"],
            code_language=row["code_language"],
            time_limit_seconds=0,
            execution_time_limit_seconds=row["execution_time_limit_seconds"],
            source="auto",
            exam_title=exam.exam_name,
        )
        item.set_options(row["options"])
        item.set_image_paths(row["image_paths"])
        db.session.add(item)
        existing_identities.add(identity)
        added_count += 1
    return added_count


def _save_teacher_exam_from_request(teacher, exam=None):
    is_multipart = bool(request.content_type and "multipart/form-data" in request.content_type)
    payload = {} if is_multipart else _get_json_payload()

    if exam and exam.status == "active":
        return None, (jsonify({"ok": False, "message": "Deactivate this published exam before editing it."}), 400)

    exam_name = _clean_text_value(
        request.form.get("exam_name") if is_multipart else payload.get("exam_name") or payload.get("name")
    )
    set_code = _clean_text_value(
        request.form.get("set_code") if is_multipart else payload.get("set_code")
    ).upper()
    subject = _clean_text_value(
        request.form.get("subject") if is_multipart else payload.get("subject")
    )
    duration_raw = request.form.get("duration_minutes") if is_multipart else payload.get("duration_minutes")
    passing_percentage = _parse_int_field(request.form if is_multipart else payload, "passing_percentage")
    access_mode = _clean_text_value(
        request.form.get("access_mode") if is_multipart else payload.get("access_mode"),
        "open",
    ).lower()
    access_code = _clean_text_value(
        request.form.get("access_code") if is_multipart else payload.get("access_code")
    ).upper()
    start_time = _parse_datetime_local_value(request.form.get("start_time") if is_multipart else payload.get("start_time"))
    shuffle_questions = request.form.get("shuffle_questions") == "on" if is_multipart else bool(payload.get("shuffle_questions"))
    shuffle_options = request.form.get("shuffle_options") == "on" if is_multipart else bool(payload.get("shuffle_options"))
    attempt_limit = _parse_int_field(request.form if is_multipart else payload, "attempt_limit")
    random_question_count = _parse_int_field(request.form if is_multipart else payload, "random_question_count")

    if not exam_name or not subject:
        return None, (jsonify({"ok": False, "message": "Exam name and subject are required."}), 400)
    duration_minutes = _parse_int_field({"duration_minutes": duration_raw}, "duration_minutes") or 0
    if duration_minutes <= 0:
        return None, (jsonify({"ok": False, "message": "Duration must be a positive number."}), 400)
    if passing_percentage is None:
        passing_percentage = getattr(exam, "passing_percentage", 40) if exam else 40
    passing_percentage = min(max(int(passing_percentage), 0), 100)
    end_time = ExamService.calculate_end_time(start_time, duration_minutes)
    if not set_code:
        try:
            set_code = exam.set_code if exam and exam.set_code else ExamService.generate_unique_set_code()
        except ValueError as exc:
            return None, (jsonify({"ok": False, "message": str(exc)}), 400)
    duplicate = ExamSet.query.filter(ExamSet.set_code == set_code)
    if exam:
        duplicate = duplicate.filter(ExamSet.id != exam.id)
    if duplicate.first():
        return None, (jsonify({"ok": False, "message": "Set code already exists. Choose another."}), 400)
    if access_mode == "access_code":
        if not access_code:
            try:
                access_code = ExamService.generate_unique_access_code()
            except ValueError as exc:
                return None, (jsonify({"ok": False, "message": str(exc)}), 400)
        duplicate_access = ExamSet.query.filter(ExamSet.access_code == access_code)
        if exam:
            duplicate_access = duplicate_access.filter(ExamSet.id != exam.id)
        if duplicate_access.first():
            return None, (jsonify({"ok": False, "message": "Access code already exists. Choose another."}), 400)
    else:
        access_code = exam.access_code if exam and exam.access_code else ExamService.generate_unique_access_code(length=10)

    try:
        question_rows = _multipart_exam_question_rows() if is_multipart else _json_exam_question_rows(payload)
    except ValueError as exc:
        return None, (jsonify({"ok": False, "message": str(exc)}), 400)
    if not question_rows:
        return None, (jsonify({"ok": False, "message": "Add at least one question."}), 400)

    if exam:
        Question.query.filter_by(exam_set_id=exam.id).delete()
        exam.exam_name = exam_name
        exam.set_code = set_code
        exam.subject = subject
        exam.duration_minutes = duration_minutes
        exam.passing_percentage = passing_percentage
        exam.start_time = start_time
        exam.end_time = end_time
        exam.shuffle_questions = shuffle_questions
        exam.shuffle_options = shuffle_options
        exam.random_question_count = max(random_question_count or 0, 0)
        exam.attempt_limit = max(attempt_limit if attempt_limit is not None else 1, 0)
        exam.access_mode = access_mode
        exam.access_code = access_code
    else:
        exam = ExamSet(
            exam_name=exam_name,
            set_code=set_code,
            subject=subject,
            duration_minutes=duration_minutes,
            total_marks=0,
            passing_percentage=passing_percentage,
            access_mode=access_mode,
            access_code=access_code,
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
            first_error = enrollment_errors[0]
            if isinstance(first_error, dict):
                first_error = first_error.get("message", "Enrollment could not be saved.")
            return None, (
                jsonify(
                    {
                        "ok": False,
                        "message": first_error,
                        "errors": enrollment_errors,
                    }
                ),
                400,
            )

    db.session.flush()
    ExamService.recalculate_exam_total_marks(exam.id, commit=False)
    bank_added_count = _auto_add_exam_questions_to_bank(exam, teacher, question_rows)
    db.session.commit()
    return {"exam": exam, "bank_added_count": bank_added_count}, None


@api_bp.route("/teacher/exams", methods=["POST"])
@rate_limit("admin_action")
def teacher_create_exam_api():
    teacher, error_response = _require_teacher_api()
    if error_response:
        return error_response
    saved, save_error = _save_teacher_exam_from_request(teacher)
    if save_error:
        return save_error
    message = "Exam saved successfully."
    if saved["bank_added_count"]:
        message = f"Exam saved successfully. {saved['bank_added_count']} new questions added to your question bank."
    return (
        jsonify(
            {
                "ok": True,
                "message": message,
                "bank_added_count": saved["bank_added_count"],
                "exam": _exam_editor_payload(saved["exam"]),
            }
        ),
        201,
    )


@api_bp.route("/teacher/exams/<int:exam_id>", methods=["GET", "PATCH"])
@rate_limit("admin_action", methods=("PATCH",))
def teacher_exam_editor_api(exam_id):
    exam, error_response = _require_teacher_owner(exam_id=exam_id)
    if error_response:
        return error_response
    if request.method == "GET":
        return jsonify(_exam_editor_payload(exam))
    saved, save_error = _save_teacher_exam_from_request(exam.creator, exam=exam)
    if save_error:
        return save_error
    message = "Exam saved successfully."
    if saved["bank_added_count"]:
        message = f"Exam saved successfully. {saved['bank_added_count']} new questions added to your question bank."
    return jsonify(
        {
            "ok": True,
            "message": message,
            "bank_added_count": saved["bank_added_count"],
            "exam": _exam_editor_payload(saved["exam"]),
        }
    )


@api_bp.route("/teacher/exams/<int:exam_id>/status", methods=["POST"])
@rate_limit("admin_action")
def teacher_exam_status_api(exam_id):
    exam, error_response = _require_teacher_owner(exam_id=exam_id)
    if error_response:
        return error_response

    payload = _get_json_payload()
    action = (payload.get("action") or "").strip().lower()
    if action in {"activate", "publish", "published"}:
        if exam.status != "draft":
            return jsonify({"ok": False, "message": "Only draft exams can be published."}), 400
        if not exam.questions:
            return jsonify({"ok": False, "message": "Add at least one question before publishing."}), 400
        exam.activate()
        message = f"{exam.exam_name} published."
    elif action in {"deactivate", "deactive", "draft"}:
        if exam.status != "active":
            return jsonify({"ok": False, "message": "Only published exams can be deactivated."}), 400
        exam.deactivate()
        message = f"{exam.exam_name} deactivated. You can edit it now."
    elif action in {"close", "end", "ended", "closed"}:
        if exam.status != "active":
            return jsonify({"ok": False, "message": "Only published exams can be ended."}), 400
        exam.close()
        message = f"{exam.exam_name} ended. Students can no longer join or submit."
    else:
        return jsonify({"ok": False, "message": "Unsupported exam status action."}), 400

    return jsonify({"ok": True, "message": message, "exam": _exam_editor_payload(exam)})


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

    def normalize_text(value):
        return re.sub(r"\s+", " ", (value or "").strip().lower())

    def text_signature(value):
        compact = normalize_text(value)
        words = {word for word in re.findall(r"[a-z0-9_]{3,}", compact)}
        if len(compact) < 8:
            return words or {compact}
        char_grams = {compact[index:index + 4] for index in range(max(len(compact) - 3, 0))}
        return words | char_grams

    def jaccard_score(left_signature, right_signature):
        if not left_signature or not right_signature:
            return 0
        intersection_size = len(left_signature & right_signature)
        if not intersection_size:
            return 0
        return intersection_size / len(left_signature | right_signature)

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

        valid_answers = []
        for session, answer in answers:
            text = (answer.answer_text or "").strip()
            normalized = normalize_text(text)
            if len(normalized) < 40:
                continue
            valid_answers.append(
                {
                    "session": session,
                    "text": text,
                    "normalized": normalized,
                    "length": len(normalized),
                    "signature": text_signature(normalized),
                }
            )

        valid_answers.sort(key=lambda item: item["length"])
        compare_all_pairs = len(valid_answers) <= 120
        compared_pairs = set()
        for index, left in enumerate(valid_answers):
            for right in valid_answers[index + 1:]:
                length_upper_bound = (2 * left["length"]) / (left["length"] + right["length"])
                if length_upper_bound < threshold:
                    break

                pair_key = (left["session"].id, right["session"].id)
                if pair_key in compared_pairs:
                    continue
                compared_pairs.add(pair_key)

                if not compare_all_pairs:
                    signature_score = jaccard_score(left["signature"], right["signature"])
                    same_opening = left["normalized"][:80] == right["normalized"][:80]
                    if signature_score < 0.34 and not same_opening:
                        continue

                score = SequenceMatcher(None, left["normalized"], right["normalized"]).ratio()
                if score >= threshold:
                    flags.append({
                        "question_id": question.id,
                        "question_text": question.question_text,
                        "question_type": question.question_type,
                        "student_a": {
                            "session_id": left["session"].id,
                            "name": left["session"].student_name,
                            "roll_no": left["session"].roll_no,
                            "answer": left["text"],
                        },
                        "student_b": {
                            "session_id": right["session"].id,
                            "name": right["session"].student_name,
                            "roll_no": right["session"].roll_no,
                            "answer": right["text"],
                        },
                        "score": round(score * 100, 1),
                    })

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
    session_payloads = [_session_review_summary(student_session) for student_session in sessions]
    evaluated_count = sum(1 for item in session_payloads if item.get("result"))
    published_count = sum(
        1 for item in session_payloads if (item.get("result") or {}).get("published")
    )
    locked_count = sum(1 for item in session_payloads if item.get("locked_for_review"))
    pending_count = sum(1 for item in session_payloads if item.get("review_status") == "pending")
    flagged_count = sum(
        1
        for item in session_payloads
        if item.get("review_priority") in {"high", "critical"}
        or int(item.get("focus_violations") or 0) > 0
        or int(item.get("suspicion_score") or 0) >= 75
    )
    results = [item["result"] for item in session_payloads if item.get("result")]
    average_score = round(sum(float(item.get("percentage") or 0) for item in results) / len(results), 1) if results else 0

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
                "pending_review": pending_count,
                "flagged": flagged_count,
                "average_score": average_score,
                "manual_questions": sum(1 for question in questions if _exam_question_type(question) != "mcq"),
                "auto_gradable_questions": sum(1 for question in questions if _exam_question_type(question) == "mcq"),
            },
            "questions": [_question_payload(question) for question in questions],
            "sessions": session_payloads,
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
    sessions = (
        StudentSession.query.options(selectinload(StudentSession.result))
        .filter_by(exam_set_id=exam.id)
        .all()
    )
    changed_count = 0
    notification_targets = []
    now = datetime.utcnow()

    for student_session in sessions:
        result = student_session.result
        if not result:
            continue
        was_published = bool(result.published)
        if was_published == publish and (not publish or result.published_at):
            continue
        result.published = publish
        result.published_at = now if publish else None
        if publish and not was_published:
            notification_targets.append(student_session)
        changed_count += 1

    if notification_targets:
        roll_numbers = {
            (student_session.roll_no or "").strip().upper()
            for student_session in notification_targets
            if (student_session.roll_no or "").strip()
        }
        students_by_roll = {
            (student.roll_number or "").strip().upper(): student
            for student in User.query.filter(
                User.role == "student",
                db.func.upper(User.roll_number).in_(roll_numbers),
            ).all()
        } if roll_numbers else {}
        notifications = []
        for student_session in notification_targets:
            student = students_by_roll.get((student_session.roll_no or "").strip().upper())
            if not student:
                continue
            notifications.append(
                Notification(
                    recipient_user_id=student.id,
                    message=f"Results published for {exam.exam_name}.",
                    notification_type="result_published",
                    related_entity_type="exam",
                    related_entity_id=exam.id,
                )
            )
        if notifications:
            db.session.add_all(notifications)

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

        marks_by_question = {}
        for item in marks_items:
            question_id = _parse_int_field(item, "question_id", minimum=1, max_digits=9)
            if question_id:
                marks_by_question[question_id] = item
        total_obtained = 0
        total_possible = sum(question.marks for question in questions)
        clean_marks = {}
        clean_remarks = {}

        for question in questions:
            item = marks_by_question.get(question.id, {})
            marks_awarded = _parse_float_field(
                {"marks_awarded": item.get("marks_awarded", 0)},
                "marks_awarded",
                minimum=0,
                maximum=question.marks,
            )
            if marks_awarded is None:
                return jsonify({"ok": False, "message": f"Q{question.question_number} marks must be a number."}), 400
            clean_marks[question.id] = marks_awarded
            clean_remarks[question.id] = (item.get("teacher_remark") or "").strip()
            total_obtained += marks_awarded

        if not result:
            result = Result(session_id=student_session.id)
            db.session.add(result)
            db.session.flush()
            was_published = False
        else:
            was_published = bool(result.published)
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
        if result.published and not was_published:
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
        suggestion = _question_review_suggestion(question, answer, question_mark)
        review_questions.append(
            {
                **_question_payload(question),
                "answer": {
                    "answer_text": answer.answer_text if answer else "",
                    "code_output": answer.code_output if answer else "",
                    "execution_status": answer.execution_status if answer else None,
                    "execution_time_ms": answer.execution_time_ms if answer else None,
                    "visit_status": answer.visit_status if answer else "NOT_VISITED",
                    "answered": _answered_answer(answer),
                    "time_spent_seconds": int(getattr(answer, "total_time_spent_seconds", 0) or 0) if answer else 0,
                    "visit_count": int(getattr(answer, "visit_count", 0) or 0) if answer else 0,
                    "saved_at": _iso_datetime(answer.saved_at) if answer else None,
                },
                "mark": {
                    "marks_awarded": question_mark.marks_awarded if question_mark else 0,
                    "teacher_remark": question_mark.teacher_remark if question_mark else "",
                    **suggestion,
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
    _run_due_notification_reminders(admin)

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
            "recent_activity": _audit_payloads(recent_activity),
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
        return jsonify({"ok": True, "settings": _settings_payload(SettingsService.get_settings(), include_private=True)})

    payload = _get_json_payload()
    if payload.get("registration_code_required") and not (payload.get("registration_code") or "").strip():
        return jsonify({"ok": False, "message": "Enter a registration code before requiring one."}), 400
    settings_payload = {
        "platform_name": payload.get("platform_name"),
        "welcome_message": payload.get("welcome_message"),
        "announcement_message": payload.get("announcement_message"),
        "login_page_heading": payload.get("login_page_heading"),
        "login_page_tagline": payload.get("login_page_tagline"),
        "login_page_subheading": payload.get("login_page_subheading"),
        "login_page_features": payload.get("login_page_features"),
        "login_page_security_badge_text": payload.get("login_page_security_badge_text"),
        "login_page_security_badge_enabled": "on" if payload.get("login_page_security_badge_enabled") else "",
        "login_form_content": payload.get("login_form_content"),
        "registration_page_content": payload.get("registration_page_content"),
        "quote_pool": payload.get("quote_pool"),
        "max_violations_before_alert": payload.get("max_violations_before_alert"),
        "student_self_registration": "on" if payload.get("student_self_registration") else "",
        "registration_code_required": "on" if payload.get("registration_code_required") else "",
        "registration_code": payload.get("registration_code"),
        "admin_lockout_count": payload.get("admin_lockout_count"),
        "admin_idle_timeout_minutes": payload.get("admin_idle_timeout_minutes"),
    }
    previous_announcement = (SettingsService.get_settings().announcement_message or "").strip()
    settings = SettingsService.update_settings(settings_payload, updated_by=admin.id)
    current_announcement = (settings.announcement_message or "").strip()
    if current_announcement and current_announcement != previous_announcement:
        NotificationService.notify_role(
            "student",
            current_announcement,
            notification_type="announcement",
            related_entity_type="announcement",
            related_entity_id=settings.id,
        )
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
    return jsonify({"ok": True, "message": "Settings saved successfully.", "settings": _settings_payload(settings, include_private=True)})


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

    return jsonify({"ok": True, "message": "Logo uploaded successfully.", "settings": _settings_payload(settings, include_private=True)})


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

    return jsonify({"ok": True, "message": "Logo removed successfully.", "settings": _settings_payload(settings, include_private=True)})


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

    query = User.query.filter(or_(User.is_active.is_(True), User.is_verified.is_(True), User.role == "admin"))
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
        name = _row_payload_value(row, "name", "full_name", "full name", "student_name")
        email = _row_payload_value(row, "email", "email_address") or None
        roll_no = _row_payload_value(row, "roll", "roll_no", "roll_number", "roll number", "registration").upper()
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


@api_bp.route("/admin/students/import-template")
def admin_students_import_template_api():
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response
    return build_student_import_template_response(admin)


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


@api_bp.route("/admin/users/<int:user_id>", methods=["DELETE"])
@rate_limit("admin_action")
def admin_delete_user_api(user_id):
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response
    payload = _get_json_payload()
    if not _admin_password_matches(payload):
        return jsonify({"ok": False, "message": "Admin password confirmation failed."}), 403

    user = User.query.get_or_404(user_id)
    if user.id == admin.id:
        return jsonify({"ok": False, "message": "You cannot delete your own account."}), 400
    if user.role == "admin":
        return jsonify({"ok": False, "message": "Cannot delete admin accounts."}), 400

    username = user.username
    archived_exams = 0
    if user.role == "teacher":
        archived_exams = ExamSet.query.filter_by(created_by=user.id).update({"status": "archived"})
    user.is_active = False
    user.is_verified = False
    user.updated_at = datetime.utcnow()
    user.clear_active_session_token()
    db.session.commit()

    AuditLog(
        user_id=admin.id,
        action="delete_user_api",
        resource_type="user",
        resource_id=user.id,
        changes=f"Soft deleted user: {username}; archived_exams={archived_exams}",
        status="success",
        ip_address=get_client_ip(),
    ).save()
    return jsonify({"ok": True, "message": f"User {username} deleted.", "deleted_user_id": user.id})


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

    pagination = (
        query.options(selectinload(ExamSet.creator))
        .order_by(ExamSet.created_at.desc())
        .paginate(page=page, per_page=per_page, error_out=False)
    )
    counts = _exam_summary_count_maps([exam.id for exam in pagination.items])
    all_query = ExamSet.query
    return jsonify(
        {
            "ok": True,
            "exams": [_admin_exam_payload(exam, counts) for exam in pagination.items],
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
    elif action in {"deactivate", "deactive", "draft"}:
        if exam.status != "active":
            return jsonify({"ok": False, "message": "Only active exams can be deactivated."}), 400
        exam.deactivate()
        for enrollment in ExamEnrollment.query.filter_by(exam_set_id=exam.id).all():
            student = User.query.filter(
                User.role == "student",
                db.func.upper(User.roll_number) == (enrollment.roll_no or "").upper(),
            ).first()
            if student:
                NotificationService.notify_user(
                    student.id,
                    f"{exam.exam_name} is temporarily inactive while changes are being made.",
                    notification_type="exam_deactivated",
                    related_entity_type="exam",
                    related_entity_id=exam.id,
                )
        audit_action = "deactivate_exam_api"
        message = "Exam deactivated. It is now editable as a draft."
    elif action in {"close", "end", "ended", "closed", "archive", "archived"}:
        if exam.status == "closed":
            return jsonify({"ok": False, "message": "Exam is already closed."}), 400
        exam.close()
        audit_action = "close_exam_api"
        message = "Exam ended. Students can no longer join or submit."
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
    if not _admin_password_matches(payload):
        return jsonify({"ok": False, "message": "Admin password confirmation failed."}), 403
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

    safe_code = "".join(ch if ch.isalnum() else "_" for ch in (exam.set_code or str(exam.id)))
    return pdf_response(create_exam_report_pdf(exam, sessions, questions), f"exam_report_{safe_code}.pdf")


@api_bp.route("/admin/audit-log")
def admin_audit_log_api():
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response
    page = max(request.args.get("page", 1, type=int), 1)
    per_page = min(max(request.args.get("per_page", 20, type=int), 1), 100)
    base_query = AuditLog.query
    query = _apply_audit_filters(base_query, request.args)
    pagination = query.order_by(AuditLog.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
    item_payloads = _audit_payloads(pagination.items)
    important_items = (
        base_query.filter(_audit_important_condition())
        .order_by(AuditLog.created_at.desc())
        .limit(8)
        .all()
    )
    return jsonify(
        {
            "ok": True,
            "items": [
                {
                    **payload,
                    "admin_user": payload["actor_name"],
                    "target_user": item.resource_id if item.resource_type == "user" else None,
                }
                for item, payload in zip(pagination.items, item_payloads)
            ],
            "summary": _audit_summary_payload(query),
            "important_events": _audit_payloads(important_items),
            "filters": _audit_filter_options_payload(base_query),
            "pagination": {
                "page": pagination.page,
                "per_page": pagination.per_page,
                "pages": pagination.pages,
                "total": pagination.total,
            },
        }
    )


@api_bp.route("/admin/audit-log/export.csv")
def admin_audit_log_export_api():
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response
    return _audit_csv_response(
        _apply_audit_filters(AuditLog.query, request.args),
        admin,
        filename_prefix="AuditLog",
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
        marks = _parse_float_field(payload, "marks") or 1
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
        duplicate_identity = _question_identity(question_type, question_text)
        duplicate_item = next(
            (
                item
                for item in QuestionBankItem.query.filter_by(
                    teacher_id=teacher.id,
                    question_type=question_type,
                ).all()
                if _bank_item_matches_identity(item, duplicate_identity)
            ),
            None,
        )
        if duplicate_item:
            return (
                jsonify(
                    {
                        "ok": False,
                        "message": "This question already exists in your question bank.",
                        "duplicate_item": _question_bank_payload(duplicate_item),
                    }
                ),
                409,
            )
        item = QuestionBankItem(
            teacher_id=teacher.id,
            question_text=question_text,
            question_type=question_type,
            marks=max(marks, 0.01),
            correct_answer=(payload.get("correct_answer") or "").strip(),
            model_answer=(payload.get("model_answer") or "").strip(),
            explanation=(payload.get("explanation") or "").strip(),
            code_snippet=(payload.get("code_snippet") or "").strip(),
            code_language=(payload.get("code_language") or "").strip() or None,
            time_limit_seconds=0,
            execution_time_limit_seconds=min(
                max(_parse_int_field(payload, "execution_time_limit_seconds") or 10, 1),
                60,
            ),
            source="manual",
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
        item.marks = max(_parse_float_field(payload, "marks") or 1, 0.01)
    if "options" in payload:
        item.set_options(parse_options(payload.get("options") or []))
    for field in ["correct_answer", "model_answer", "explanation", "code_snippet", "code_language"]:
        if field in payload:
            setattr(item, field, (payload.get(field) or "").strip() or None)
    if "time_limit_seconds" in payload:
        item.time_limit_seconds = 0
    if "execution_time_limit_seconds" in payload:
        item.execution_time_limit_seconds = min(
            max(_parse_int_field(payload, "execution_time_limit_seconds") or 10, 1),
            60,
        )
    if not item.question_text:
        return jsonify({"ok": False, "message": "Question text is required."}), 400
    duplicate_identity = _question_identity(item.question_type, item.question_text)
    duplicate_item = next(
        (
            bank_item
            for bank_item in QuestionBankItem.query.filter(
                QuestionBankItem.teacher_id == teacher.id,
                QuestionBankItem.question_type == item.question_type,
                QuestionBankItem.id != item.id,
            ).all()
            if _bank_item_matches_identity(bank_item, duplicate_identity)
        ),
        None,
    )
    if duplicate_item:
        return (
            jsonify(
                {
                    "ok": False,
                    "message": "This question already exists in your question bank.",
                    "duplicate_item": _question_bank_payload(duplicate_item),
                }
            ),
            409,
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
        return jsonify({"ok": False, "message": "Cannot import bank questions while the exam is active. Deactivate it first."}), 400

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
    skipped_items = []
    existing_questions = Question.query.filter_by(exam_set_id=exam.id).all()
    existing_identities = {
        _question_identity(question.question_type, question.question_text)
        for question in existing_questions
    }

    for item in bank_items:
        item_identity = _question_identity(item.question_type, item.question_text)
        if item_identity in existing_identities:
            skipped_items.append(item)
            continue
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
            time_limit_seconds=0,
            execution_time_limit_seconds=item.execution_time_limit_seconds,
        )
        question.set_options(item.options_as_list())
        question.set_image_paths(item.image_paths_as_list())
        db.session.add(question)
        imported_questions.append(question)
        existing_identities.add(item_identity)
        next_number += 1

    if not imported_questions:
        return (
            jsonify(
                {
                    "ok": False,
                    "message": "Selected question(s) are already imported in this exam.",
                    "imported_count": 0,
                    "skipped_count": len(skipped_items),
                }
            ),
            409,
        )

    db.session.flush()
    ExamService.recalculate_exam_total_marks(exam.id, commit=False)
    db.session.commit()
    skipped_count = len(skipped_items)
    message = f"Imported {len(imported_questions)} question(s)."
    if skipped_count:
        message += f" {skipped_count} already imported question(s) skipped."
    return jsonify(
        {
            "ok": True,
            "message": message,
            "imported_count": len(imported_questions),
            "skipped_count": skipped_count,
            "questions": [_question_payload(question) for question in imported_questions],
        }
    )


@api_bp.route("/student/results/<int:result_id>/pdf")
def student_result_pdf_api(result_id):
    _student_name, roll_no, error_response = _require_student_api_details()
    if error_response:
        return error_response

    result = Result.query.filter_by(id=result_id, published=True).first_or_404()
    student_session = result.session
    if (student_session.roll_no or "").strip().upper() != (roll_no or "").strip().upper():
        return jsonify({"ok": False, "message": "You do not have permission to download this result."}), 403

    pdf_buffer = create_submission_pdf(student_session, include_unpublished_feedback=False)
    safe_roll = re.sub(r"[^A-Za-z0-9_-]+", "_", student_session.roll_no or "student").strip("_") or "student"
    safe_exam = re.sub(r"[^A-Za-z0-9_-]+", "_", student_session.exam_set.set_code or str(student_session.exam_set_id)).strip("_") or "exam"
    filename = f"result_{safe_roll}_{safe_exam}.pdf"
    return pdf_response(pdf_buffer, filename)


@api_bp.route("/student/results/<int:exam_id>/certificate")
def student_result_certificate_api(exam_id):
    _student_name, roll_no, error_response = _require_student_api_details()
    if error_response:
        return error_response
    result = (
        Result.query.join(StudentSession, Result.session_id == StudentSession.id)
        .filter(
            db.func.upper(StudentSession.roll_no) == (roll_no or "").strip().upper(),
            StudentSession.exam_set_id == exam_id,
            Result.published.is_(True),
        )
        .order_by(Result.published_at.desc(), Result.updated_at.desc())
        .first_or_404()
    )
    safe_roll = re.sub(r"[^A-Za-z0-9_-]+", "_", result.session.roll_no or "student").strip("_") or "student"
    safe_exam = re.sub(r"[^A-Za-z0-9_-]+", "_", result.session.exam_set.set_code or str(exam_id)).strip("_") or "exam"
    return pdf_response(create_result_certificate_pdf(result), f"certificate_{safe_roll}_{safe_exam}.pdf")


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
        payload.append(_student_result_payload(result))
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

    return jsonify(
        {
            "ok": True,
            "result": _student_result_payload(result),
        }
    )


@api_bp.route("/admin/registration-requests")
def admin_registration_requests_api():
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response

    filter_name = (request.args.get("status") or "all").strip().lower()
    search = (request.args.get("q") or "").strip().lower()
    page = max(request.args.get("page", 1, type=int), 1)
    per_page = min(max(request.args.get("per_page", 20, type=int), 1), 100)
    query = RegistrationRequest.query

    if filter_name in {"new", "reviewed", "closed"}:
        query = query.filter_by(status=filter_name)
    if search:
        pattern = f"%{search}%"
        query = query.filter(
            or_(
                db.func.lower(RegistrationRequest.full_name).like(pattern),
                db.func.lower(RegistrationRequest.preferred_username).like(pattern),
                db.func.lower(RegistrationRequest.email).like(pattern),
                db.func.lower(RegistrationRequest.phone).like(pattern),
                db.func.lower(RegistrationRequest.roll_number).like(pattern),
                db.func.lower(RegistrationRequest.class_name).like(pattern),
                db.func.lower(RegistrationRequest.message).like(pattern),
            )
        )

    pagination = query.order_by(RegistrationRequest.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
    return jsonify(
        {
            "ok": True,
            "items": [_registration_request_payload(item) for item in pagination.items],
            "pagination": {
                "page": pagination.page,
                "per_page": pagination.per_page,
                "pages": pagination.pages,
                "total": pagination.total,
            },
        }
    )


@api_bp.route("/admin/registration-requests/<int:request_id>", methods=["GET", "PATCH"])
@rate_limit("admin_action", methods=("PATCH",))
def admin_registration_request_detail_api(request_id):
    admin, error_response = _require_admin_api()
    if error_response:
        return error_response

    registration_request = RegistrationRequest.query.get_or_404(request_id)
    if request.method == "PATCH":
        payload = request.get_json(silent=True) or {}
        status = (payload.get("status") or registration_request.status or "new").strip().lower()
        if status not in {"new", "reviewed", "closed"}:
            return jsonify({"ok": False, "message": "Invalid request status."}), 400
        note = _compact_text(payload.get("admin_note"), 1200) if "admin_note" in payload else registration_request.admin_note
        registration_request.mark_status(status, admin=admin, note=note)
        db.session.add(
            AuditLog(
                user_id=admin.id,
                action="registration_request_update",
                resource_type="registration_request",
                resource_id=registration_request.id,
                changes=f"status={status}",
                ip_address=get_client_ip(),
                user_agent=request.headers.get("User-Agent"),
            )
        )
        db.session.commit()
        emit_data_changed(
            {
                "role": "admin",
                "user_id": admin.id,
                "resource": "registration_requests",
                "method": "PATCH",
                "registration_request_id": registration_request.id,
                "path": request.path,
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }
        )

    return jsonify({"ok": True, "request": _registration_request_payload(registration_request)})


@api_bp.route("/notifications")
def notifications_api():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"ok": False, "message": "Not logged in"}), 401
    user = User.query.get(user_id)
    if not user or not user.is_active or not current_session_matches_user(user):
        session.clear()
        return jsonify({"ok": False, "message": "This account is active in another browser. Please log in again here."}), 401
    _run_due_notification_reminders(user)
    filter_name = (request.args.get("filter") or "all").strip().lower()
    page = max(request.args.get("page", 1, type=int), 1)
    per_page = min(max(request.args.get("per_page", 20, type=int), 1), 100)
    query = _notification_filter_query(Notification.query.filter_by(recipient_user_id=user_id), filter_name)
    pagination = query.order_by(Notification.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
    items = [_notification_payload(item) for item in pagination.items]
    return jsonify(
        {
            "ok": True,
            "items": items,
            "unread_count": NotificationService.unread_count_for_user(user_id),
            "counts": _notification_counts_payload(user_id),
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
    return jsonify(
        {
            "ok": True,
            "notification": _notification_payload(notification),
            "unread_count": NotificationService.unread_count_for_user(user_id),
            "counts": _notification_counts_payload(user_id),
        }
    )


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
        minutes = _parse_int_field(payload, "minutes", minimum=1, maximum=480) or 0
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
    return jsonify(
        {
            "ok": True,
            "read": count,
            "unread_count": NotificationService.unread_count_for_user(user_id),
            "counts": _notification_counts_payload(user_id),
        }
    )


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
            "message": "This exam is temporarily inactive while changes are being made. Please wait for it to be published again." if exam.status == "draft" else None,
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
        student_user = _find_student_by_identifier(student_session.roll_no)
        max_warnings = SettingsService.max_violations_allowed()
        return jsonify(
            {
                "ok": True,
                "session_code": student_session.session_code,
                "session_token": ExamSessionGuard.ensure_token(student_session),
                "status": _api_session_status(student_session),
                "remaining_seconds": 0,
                "warning_count": student_session.focus_violations,
                "max_warnings": max_warnings,
                "is_paused": False,
                "redirect": _submitted_results_redirect(student_session),
                "exam": {
                    "id": exam.id,
                    "title": exam.exam_name,
                    "set_code": exam.set_code,
                    "instructions": getattr(exam, "instructions", "") or "",
                    "total_marks": exam.total_marks,
                    "total_questions": Question.query.filter_by(exam_set_id=exam.id).count(),
                    "duration_minutes": exam.duration_minutes,
                    "shuffle_questions": bool(getattr(exam, "shuffle_questions", False)),
                    "allow_code_execution": True,
                },
                "student": {
                    "name": student_session.student_name,
                    "roll_number": student_session.roll_no,
                    "email": student_user.email if student_user else None,
                },
                "questions": [],
                "saved_answers": {},
                "admin_message": None,
                "attempt_number": _attempt_number(student_session),
            }
        )
    if exam.status != "active" or time_state == "not_started":
        return _forbidden_session_response(
            "This exam is temporarily inactive while changes are being made." if exam.status == "draft" else "This exam has not opened yet.",
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
    student_user = _find_student_by_identifier(student_session.roll_no)
    admin_message, session_messages = _pop_latest_admin_message(student_session)

    question_payloads = []
    saved_answers = {}
    status_counts = {state: 0 for state in EXAM_NAVIGATOR_STATUSES}
    for order_index, question in enumerate(questions, start=1):
        answer = answers_by_question.get(question.id)
        visit_status = (
            answer.visit_status
            if answer and answer.visit_status in EXAM_NAVIGATOR_STATUSES
            else "ANSWERED"
            if answer and (answer.answer_text or "").strip()
            else "NOT_VISITED"
        )
        status_counts[visit_status] = status_counts.get(visit_status, 0) + 1
        question_type = _exam_question_type(question)
        answer_text = answer.answer_text if answer else ""
        saved_answers[str(question.id)] = {
            "answer_text": answer_text if question_type != "code" else "",
            "selected_option": answer_text if question_type == "mcq" else None,
            "code_text": answer_text if question_type == "code" else "",
            "code_output": answer.code_output if answer else "",
            "navigator_status": visit_status,
            "time_spent_seconds": int(getattr(answer, "total_time_spent_seconds", 0) or 0) if answer else 0,
            "visit_count": int(getattr(answer, "visit_count", 0) or 0) if answer else 0,
        }
        question_payloads.append(
            {
                "id": question.id,
                "order_index": order_index,
                "type": question_type,
                "question_number": question.question_number,
                "question_text": question.question_text,
                "question_type": question.question_type,
                "marks": question.marks,
                "max_marks": question.marks,
                "options": _question_options_payload(question, student_session),
                "image_urls": [url_for("static", filename=path) for path in question.image_paths_as_list()],
                "code_snippet": question.code_snippet,
                "code_language": question.code_language or "python",
                "starter_code": "",
                "time_limit_seconds": question.time_limit_seconds or 0,
                "execution_time_limit_seconds": question.execution_time_limit_seconds or 10,
                "navigator_status": visit_status,
                "answer": {
                    "answer_text": answer_text,
                    "selected_option": answer_text if question_type == "mcq" else None,
                    "code_text": answer_text if question_type == "code" else "",
                    "code_output": answer.code_output if answer else "",
                    "execution_status": answer.execution_status if answer else None,
                    "execution_time_ms": answer.execution_time_ms if answer else None,
                    "visit_status": visit_status,
                    "navigator_status": visit_status,
                    "time_spent_seconds": int(getattr(answer, "total_time_spent_seconds", 0) or 0) if answer else 0,
                    "visit_count": int(getattr(answer, "visit_count", 0) or 0) if answer else 0,
                    "question_time_expired": bool(answer and answer.question_time_expired),
                    "question_expires_at": _iso_datetime(answer.question_expires_at) if answer else None,
                    "saved_at": _iso_datetime(answer.saved_at) if answer else None,
                },
            }
        )

    remaining_seconds = ExamService.remaining_seconds_for_session(student_session)
    max_warnings = SettingsService.max_violations_allowed()
    session_token = ExamSessionGuard.ensure_token(student_session)
    return jsonify(
        {
            "ok": True,
            "session_code": student_session.session_code,
            "session_token": session_token,
            "attempt_token": session_token,
            "status": _api_session_status(student_session),
            "remaining_seconds": remaining_seconds,
            "warning_count": student_session.focus_violations,
            "max_warnings": max_warnings,
            "is_paused": student_session.status == "paused",
            "max_violations_allowed": max_warnings,
            "status_counts": status_counts,
            "exam": {
                "id": exam.id,
                "title": exam.exam_name,
                "exam_name": exam.exam_name,
                "subject": exam.subject,
                "set_code": exam.set_code,
                "instructions": getattr(exam, "instructions", "") or "",
                "duration_minutes": exam.duration_minutes,
                "total_marks": exam.total_marks,
                "total_questions": len(questions),
                "shuffle_questions": bool(getattr(exam, "shuffle_questions", False)),
                "allow_code_execution": True,
                "start_time": _iso_datetime(exam.start_time),
                "end_time": _iso_datetime(exam.end_time),
            },
            "student": {
                "name": student_session.student_name,
                "roll_number": student_session.roll_no,
                "email": student_user.email if student_user else None,
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
            "saved_answers": saved_answers,
            "admin_message": admin_message,
            "session_messages": session_messages,
            "attempt_number": _attempt_number(student_session),
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


def _autosave_response(student_session, data, require_window=False, legacy=False):
    if require_window and not ExamSessionGuard.request_window_owns_attempt(student_session, data):
        return _window_lock_response(student_session)

    question_id = _parse_int_field(data, "question_id")
    if question_id is None:
        return jsonify({"ok": False, "saved": False, "message": "Valid question_id is required"}), 400

    question = Question.query.filter_by(id=question_id, exam_set_id=student_session.exam_set_id).first()
    if not question:
        return jsonify({"ok": False, "saved": False, "message": "Question not found for this exam."}), 404

    answer_text = _answer_text_for_question(question, data)
    navigator_status = _navigator_status(data, answer_text)
    time_spent_seconds = _parse_int_field(data, "time_spent_seconds", minimum=0, maximum=86400, max_digits=6)
    time_spent_delta_seconds = _parse_int_field(data, "time_spent_delta_seconds", minimum=0, maximum=3600, max_digits=5)
    success, message = AutoSaveService.save_answer(
        student_session.session_code,
        question_id,
        answer_text,
        visit_status=navigator_status,
        time_spent_seconds=time_spent_seconds,
        time_spent_delta_seconds=time_spent_delta_seconds,
    )

    if legacy:
        return jsonify({"ok": success, "message": message}), 200 if success else 400

    admin_message, _messages = _pop_latest_admin_message(student_session)
    payload = {
        "ok": success,
        "saved": bool(success),
        "message": message,
        "remaining_seconds": ExamService.remaining_seconds_for_session(student_session),
        "warning_count": student_session.focus_violations,
        "max_warnings": SettingsService.max_violations_allowed(),
        "is_paused": student_session.status == "paused",
        "admin_message": admin_message,
    }
    return jsonify(payload), 200 if success else 400


@api_bp.route("/student/session/<session_code>/save", methods=["POST"])
@rate_limit("autosave")
def save_answer(session_code):
    """Autosave answer using service"""
    data = _get_json_payload()
    student_session, error_response = _require_attempt(
        session_code,
        data,
        require_active=True,
        require_window=False,
    )
    if error_response:
        return error_response

    return _autosave_response(student_session, data, require_window=True, legacy=True)


@api_bp.route("/student/session/<session_code>/autosave", methods=["POST"])
@rate_limit("autosave")
def autosave_answer(session_code):
    data = _get_json_payload()
    student_session, error_response = _require_attempt(
        session_code,
        data,
        require_active=True,
        require_window=False,
        allowed_statuses={"active", "paused"},
    )
    if error_response:
        return error_response

    return _autosave_response(student_session, data, require_window=False, legacy=False)


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
    visit_status = data.get("navigator_status") or data.get("visit_status")

    if question_id is None:
        return jsonify({"ok": False, "message": "Valid question_id is required"}), 400

    success, message = AutoSaveService.save_visit_status(
        session_code,
        question_id,
        visit_status,
        time_spent_seconds=_parse_int_field(data, "time_spent_seconds", minimum=0, maximum=86400, max_digits=6),
        time_spent_delta_seconds=_parse_int_field(data, "time_spent_delta_seconds", minimum=0, maximum=3600, max_digits=5),
    )
    return jsonify({"ok": success, "message": message}), 200 if success else 400


@api_bp.route("/student/session/<session_code>/navigator-update", methods=["POST"])
@rate_limit("autosave")
def navigator_update(session_code):
    data = _get_json_payload()
    student_session, error_response = _require_attempt(
        session_code,
        data,
        require_active=True,
        require_window=False,
        allowed_statuses={"active", "paused"},
    )
    if error_response:
        return error_response

    question_id = _parse_int_field(data, "question_id")
    if question_id is None:
        return jsonify({"ok": False, "updated": False, "message": "Valid question_id is required"}), 400

    requested_status = data.get("navigator_status") or data.get("visit_status") or "VISITED_UNANSWERED"
    existing_answer = Answer.query.filter_by(session_id=student_session.id, question_id=question_id).first()
    if not existing_answer:
        requested_status = "VISITED_UNANSWERED"
    success, message = AutoSaveService.save_visit_status(
        student_session.session_code,
        question_id,
        requested_status,
        time_spent_seconds=_parse_int_field(data, "time_spent_seconds", minimum=0, maximum=86400, max_digits=6),
        time_spent_delta_seconds=_parse_int_field(data, "time_spent_delta_seconds", minimum=0, maximum=3600, max_digits=5),
    )
    return jsonify({"ok": success, "updated": bool(success), "message": message}), 200 if success else 400


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

    answer_text = data.get("answer_text", "")
    answer_text = "" if answer_text is None else str(answer_text)
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


def _normalize_terminal_text(value):
    return str(value or "").replace("\r\n", "\n").replace("\r", "\n")


def _sanitize_input_prompts(value):
    if not isinstance(value, list):
        return []
    prompts = []
    for prompt in value[:20]:
        prompts.append(str(prompt or "")[:240])
    return prompts


def _strip_prompt_echoes(output_text, prompts):
    remaining = _normalize_terminal_text(output_text)
    for prompt in prompts:
        clean_prompt = str(prompt or "")
        if clean_prompt and remaining.startswith(clean_prompt):
            remaining = remaining[len(clean_prompt):]
    return remaining.lstrip("\n")


def _compose_terminal_output(transcript, output_text, error_text, prompts, timed_out=False, timeout_seconds=10):
    parts = []
    clean_transcript = _normalize_terminal_text(transcript).strip()
    if clean_transcript:
        parts.append(clean_transcript)
    clean_output = _strip_prompt_echoes(output_text, prompts).rstrip()
    if clean_output:
        parts.append(clean_output)
    if timed_out and not error_text:
        parts.append(f"Execution timed out after {timeout_seconds}s")
    clean_error = _normalize_terminal_text(error_text).rstrip()
    if clean_error and clean_error != clean_output:
        parts.append(clean_error)
    return "\n".join(parts)


def _code_run_response(student_session, data, legacy=False):
    question_id = _parse_int_field(data, "question_id")
    code = data.get("code")
    if code is None:
        code = data.get("code_text")
    code = code or ""
    stdin_text = data.get("stdin") or ""
    input_prompts = _sanitize_input_prompts(data.get("input_prompts"))
    terminal_transcript = _normalize_terminal_text(data.get("terminal_transcript") or "")[:12000]

    if question_id is None:
        return jsonify({"ok": False, "message": "Valid question_id is required"}), 400

    question = Question.query.filter_by(id=question_id, exam_set_id=student_session.exam_set_id).first()
    if not question:
        return jsonify({"ok": False, "message": "Question not found for this exam."}), 404
    if _exam_question_type(question) != "code":
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
        allow_unsafe_subprocess=current_app.config.get("CODE_EXECUTION_ALLOW_UNSAFE_SUBPROCESS", True),
    )

    output_parts = []
    if result.stdout:
        output_parts.append(result.stdout)
    if result.message and not result.stdout:
        output_parts.append(result.message)
    output_text = "\n".join(part for part in output_parts if part)
    error_text = result.stderr or (result.message if result.status in {"error", "timeout", "rejected"} and not result.stdout else "")
    terminal_output = _compose_terminal_output(
        terminal_transcript,
        output_text,
        error_text,
        input_prompts,
        timed_out=result.status == "timeout",
        timeout_seconds=timeout_seconds,
    )

    answer.answer_text = code
    answer.code_output = terminal_output or output_text or error_text or result.message
    answer.execution_status = result.status
    answer.execution_time_ms = result.execution_time_ms
    answer.visit_status = AutoSaveService.normalize_visit_status(data.get("navigator_status") or data.get("visit_status"), code)
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

    if legacy:
        legacy_payload = result.as_dict()
        legacy_payload["message"] = result.message
        return jsonify(legacy_payload), 200 if result.status in ["success", "error", "timeout", "rejected"] else 400

    return jsonify(
        {
            "ok": True,
            "output": output_text,
            "error": error_text,
            "execution_time_seconds": round((result.execution_time_ms or 0) / 1000, 3),
            "timed_out": result.status == "timeout",
            "status": result.status,
            "message": result.message,
            "terminal_output": terminal_output,
            "input_prompts": input_prompts,
        }
    )


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

    return _code_run_response(student_session, data, legacy=True)


@api_bp.route("/student/session/<session_code>/code-run", methods=["POST"])
@rate_limit("code_execution")
def code_run(session_code):
    data = _get_json_payload()
    student_session, error_response = _require_attempt(
        session_code,
        data,
        require_active=True,
        require_window=False,
    )
    if error_response:
        return error_response

    return _code_run_response(student_session, data, legacy=False)


@api_bp.route("/student/session/<session_code>/heartbeat", methods=["POST"])
@rate_limit("heartbeat")
def heartbeat(session_code):
    """Handle heartbeat and proctoring violations"""
    data = _get_json_payload()
    student_session, error_response = _require_attempt(
        session_code,
        data,
        require_active=False,
        require_window=False,
    )
    if error_response:
        return error_response

    if ExamSessionGuard.request_window_token(data):
        ExamSessionGuard.request_window_owns_attempt(student_session, data)

    ExamService.enforce_time_window(student_session)
    remaining_seconds = ExamService.remaining_seconds_for_session(student_session)
    focused = bool(data.get("focused", True))
    violation_count = _parse_int_field(data, "violation_count")
    violation_count = violation_count if violation_count is not None else 0
    current_question_index = _parse_int_field(data, "current_question_index", minimum=0, maximum=10000, max_digits=5)
    current_question_id = _parse_int_field(data, "current_question_id", minimum=1, max_digits=9)
    if current_question_id:
        question = Question.query.filter_by(id=current_question_id, exam_set_id=student_session.exam_set_id).first()
        if question:
            student_session.current_question_id = question.id
            student_session.current_question_index = current_question_index
    elif current_question_index is not None:
        student_session.current_question_index = current_question_index
        session_questions = ExamService.get_session_questions(student_session)
        if current_question_index < len(session_questions):
            student_session.current_question_id = session_questions[current_question_index].id

    if current_question_id:
        AutoSaveService.record_question_time(
            session_code,
            current_question_id,
            time_spent_seconds=_parse_int_field(data, "time_spent_seconds", minimum=0, maximum=86400, max_digits=6),
            time_spent_delta_seconds=_parse_int_field(data, "time_spent_delta_seconds", minimum=0, maximum=3600, max_digits=5),
        )

    if student_session.status == "active":
        SecurityService.record_heartbeat(session_code, focused, violation_count)
    else:
        student_session.last_heartbeat = datetime.utcnow()
        db.session.commit()

    should_submit = student_session.status == "active" and SecurityService.should_auto_submit(session_code)

    if should_submit and student_session.status == "active":
        ExamService.end_exam(session_code, reason="Auto-submitted due to security violations")
        remaining_seconds = 0

    is_locked = ExamSessionGuard.is_locked(student_session)
    terminated = student_session.status == "terminated"
    max_warnings = SettingsService.max_violations_allowed()
    admin_message, session_messages = _pop_latest_admin_message(student_session)

    emit_to_proctors(
        student_session.exam_set_id,
        "proctor:student_status",
        _proctor_session_payload(student_session),
    )

    return jsonify(
        {
            "ok": True,
            "submitted": is_locked,
            "session_status": student_session.status,
            "redirect": _submitted_results_redirect(student_session) if is_locked else None,
            "remaining_seconds": remaining_seconds,
            "warning_count": student_session.focus_violations,
            "focus_violations": student_session.focus_violations,
            "max_warnings": max_warnings,
            "max_violations_allowed": max_warnings,
            "is_paused": student_session.status == "paused",
            "paused": student_session.status == "paused",
            "pause_requested": bool(student_session.pause_requested_at),
            "pause_reason": student_session.pause_reason,
            "terminated": terminated,
            "second_chance": False,
            "time_reduced": False,
            "admin_message": admin_message,
            "session_messages": session_messages,
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
        require_window=False,
        allowed_statuses={"active", "paused"},
    )
    if error_response:
        return error_response

    violation_type = (data.get("violation_type") or data.get("type") or "UNKNOWN").strip()
    normalized_type = violation_type.upper().replace(" ", "_")
    if normalized_type not in EXAM_VIOLATION_TYPES:
        return jsonify({"ok": False, "message": "Unsupported violation_type."}), 400
    detail = (data.get("detail") or "").strip()
    client_count = _parse_int_field(data, "violation_count") or 0
    should_warn = normalized_type not in {"RIGHT_CLICK"} and not bool(data.get("silent"))

    violation = SecurityService.record_violation(
        session_code=session_code,
        violation_type=normalized_type,
        detail=detail,
        client_count=client_count,
        ip_address=get_client_ip(),
        user_agent=request.headers.get("User-Agent"),
        count_warning=should_warn,
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
            "type": violation.violation_type if violation else normalized_type,
            "detail": detail,
            "count": student_session.focus_violations,
            "admin_review_required": admin_review_required,
        },
    )

    return jsonify(
        {
            "ok": True,
            "warning_count": student_session.focus_violations,
            "focus_violations": student_session.focus_violations,
            "max_warnings": max_violations,
            "max_violations_allowed": max_violations,
            "should_warn": should_warn,
            "admin_review_required": admin_review_required,
            "message": "Violation recorded",
        }
    )


@api_bp.route("/student/session/<session_code>/submit", methods=["POST"])
@rate_limit("exam_submit")
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
    final_answer = data.get("final_answer") if isinstance(data.get("final_answer"), dict) else None
    if final_answer:
        question_id = _parse_int_field(final_answer, "question_id")
        if question_id is not None:
            question = Question.query.filter_by(id=question_id, exam_set_id=student_session.exam_set_id).first()
            if question:
                answer_text = _answer_text_for_question(question, final_answer)
                navigator_status = _navigator_status(final_answer, answer_text)
                time_spent_seconds = _parse_int_field(
                    final_answer,
                    "time_spent_seconds",
                    minimum=0,
                    maximum=86400,
                    max_digits=6,
                )
                AutoSaveService.save_answer(
                    student_session.session_code,
                    question_id,
                    answer_text,
                    visit_status=navigator_status,
                    time_spent_seconds=time_spent_seconds,
                )

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
                    "submitted": True,
                    "warning": "Submission saved, but result calculation failed",
                    "redirect": _submitted_results_redirect(student_session),
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
        {"message": "Your exam has been submitted.", "redirect": _submitted_results_redirect(student_session)},
    )

    return jsonify({"ok": True, "submitted": True, "redirect": _submitted_results_redirect(student_session)})
