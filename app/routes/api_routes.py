from datetime import datetime

from flask import Blueprint, current_app, jsonify, request, session

from app.models.audit_model import AuditLog
from app.models.submission_model import StudentSession
from app.services.autosave_service import AutoSaveService
from app.services.exam_service import ExamService
from app.services.result_service import ResultService
from app.services.security_service import SecurityService
from app.utils.helpers import get_remaining_seconds
from app.utils.network import get_client_ip
from app.utils.rate_limiter import rate_limit

api_bp = Blueprint("api", __name__, url_prefix="/api")


def _student_session_authorized(session_code):
    return session.get("student_session_code") == session_code


def _forbidden_session_response():
    return jsonify({"ok": False, "message": "Unauthorized exam session"}), 403


def _get_student_session(session_code):
    return StudentSession.query.filter_by(session_code=session_code).first_or_404()


def _get_json_payload():
    payload = request.get_json(silent=True)
    return payload if isinstance(payload, dict) else {}


def _parse_int_field(payload, field_name):
    value = payload.get(field_name)
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


@api_bp.route("/student/session/<session_code>/status")
def session_status(session_code):
    if not _student_session_authorized(session_code):
        return _forbidden_session_response()

    student_session = _get_student_session(session_code)
    exam = student_session.exam_set

    remaining_seconds = get_remaining_seconds(exam, student_session.start_time)

    return jsonify(
        {
            "ok": True,
            "exam_status": exam.status,
            "session_status": student_session.status,
            "remaining_seconds": remaining_seconds,
            "focus_violations": student_session.focus_violations,
            "max_violations_allowed": current_app.config.get("MAX_VIOLATIONS_ALLOWED", 3),
            "suspicion_score": getattr(student_session, "suspicion_score", 0),
            "submitted": student_session.status in ["submitted", "evaluated"],
        }
    )


@api_bp.route("/student/session/<session_code>/save", methods=["POST"])
@rate_limit("autosave")
def save_answer(session_code):
    """Autosave answer using service"""
    if not _student_session_authorized(session_code):
        return _forbidden_session_response()

    student_session = _get_student_session(session_code)

    if student_session.status not in ["active", "waiting"]:
        return jsonify({"ok": False, "message": "Session is not active"}), 400

    data = _get_json_payload()
    question_id = _parse_int_field(data, "question_id")
    answer_text = (data.get("answer_text", "") or "").strip()

    if question_id is None:
        return jsonify({"ok": False, "message": "Valid question_id is required"}), 400

    success, message = AutoSaveService.save_answer(session_code, question_id, answer_text)

    return jsonify({"ok": success, "message": message}), 200 if success else 400


@api_bp.route("/student/session/<session_code>/heartbeat", methods=["POST"])
@rate_limit("heartbeat")
def heartbeat(session_code):
    """Handle heartbeat and proctoring violations"""
    if not _student_session_authorized(session_code):
        return _forbidden_session_response()

    student_session = _get_student_session(session_code)
    data = _get_json_payload()
    remaining_seconds = get_remaining_seconds(student_session.exam_set, student_session.start_time)

    focused = bool(data.get("focused", True))
    violation_count = _parse_int_field(data, "violation_count")
    violation_count = violation_count if violation_count is not None else 0

    SecurityService.record_heartbeat(session_code, focused, violation_count)

    should_submit = SecurityService.should_auto_submit(session_code)

    if should_submit and student_session.status == "active":
        ExamService.end_exam(session_code, reason="Auto-submitted due to security violations")

    return jsonify(
        {
            "ok": True,
            "submitted": student_session.status in ["submitted", "evaluated"],
            "session_status": student_session.status,
            "remaining_seconds": remaining_seconds,
            "focus_violations": student_session.focus_violations,
            "max_violations_allowed": current_app.config.get("MAX_VIOLATIONS_ALLOWED", 3),
            "should_submit": should_submit,
        }
    )


@api_bp.route("/student/session/<session_code>/violation", methods=["POST"])
@rate_limit("violation")
def record_violation(session_code):
    """Record an append-only browser integrity violation."""
    if not _student_session_authorized(session_code):
        return _forbidden_session_response()

    student_session = _get_student_session(session_code)
    if student_session.status != "active":
        return jsonify({"ok": False, "message": "Session is not active"}), 400

    data = _get_json_payload()
    violation_type = (data.get("type") or "UNKNOWN").strip()
    detail = (data.get("detail") or "").strip()
    client_count = _parse_int_field(data, "violation_count") or 0

    SecurityService.record_violation(
        session_code=session_code,
        violation_type=violation_type,
        detail=detail,
        client_count=client_count,
        ip_address=get_client_ip(),
        user_agent=request.headers.get("User-Agent"),
    )

    max_violations = current_app.config.get("MAX_VIOLATIONS_ALLOWED", 3)
    admin_review_required = student_session.focus_violations >= max_violations

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
    if not _student_session_authorized(session_code):
        return _forbidden_session_response()

    student_session = _get_student_session(session_code)

    data = _get_json_payload()
    reason = (data.get("reason") or "Manual submission").strip()

    if student_session.status not in ["submitted", "evaluated"]:
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

    return jsonify({"ok": True, "redirect": f"/student/submitted/{session_code}"})
