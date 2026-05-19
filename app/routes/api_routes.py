from datetime import datetime
from flask import Blueprint, jsonify, request, session
from app.models.database import db
from app.models.submission_model import StudentSession, Answer
from app.models.exam_model import Question
from app.services.autosave_service import AutoSaveService
from app.services.security_service import SecurityService
from app.services.exam_service import ExamService
from app.services.result_service import ResultService

api_bp = Blueprint("api", __name__, url_prefix="/api")


def _student_session_authorized(session_code):
    return session.get("student_session_code") == session_code


def _forbidden_session_response():
    return jsonify({"ok": False, "message": "Unauthorized exam session"}), 403


@api_bp.route("/student/session/<session_code>/status")
def session_status(session_code):
    if not _student_session_authorized(session_code):
        return _forbidden_session_response()

    student_session = StudentSession.query.filter_by(session_code=session_code).first_or_404()
    exam = student_session.exam_set

    remaining_seconds = 0
    if student_session.start_time:
        elapsed = (datetime.utcnow() - student_session.start_time).total_seconds()
        remaining_seconds = max((exam.duration_minutes * 60) - int(elapsed), 0)
    elif exam.activated_at:
        elapsed = (datetime.utcnow() - exam.activated_at).total_seconds()
        remaining_seconds = max((exam.duration_minutes * 60) - int(elapsed), 0)
    else:
        remaining_seconds = exam.duration_minutes * 60

    return jsonify({
        "ok": True,
        "exam_status": exam.status,
        "session_status": student_session.status,
        "remaining_seconds": remaining_seconds,
        "focus_violations": student_session.focus_violations,
        "suspicion_score": getattr(student_session, 'suspicion_score', 0),
        "submitted": student_session.status in ["submitted", "evaluated"],
    })


@api_bp.route("/student/session/<session_code>/save", methods=["POST"])
def save_answer(session_code):
    """Autosave answer using service"""
    if not _student_session_authorized(session_code):
        return _forbidden_session_response()

    student_session = StudentSession.query.filter_by(session_code=session_code).first_or_404()

    if student_session.status not in ["active", "waiting"]:
        return jsonify({"ok": False, "message": "Session is not active"}), 400

    data = request.get_json(silent=True) or {}
    question_id = int(data.get("question_id", 0))
    answer_text = (data.get("answer_text", "") or "").strip()

    if not question_id:
        return jsonify({"ok": False, "message": "Question ID is required"}), 400

    success, message = AutoSaveService.save_answer(session_code, question_id, answer_text)

    return jsonify({
        "ok": success,
        "message": message
    }), 200 if success else 400


@api_bp.route("/student/session/<session_code>/heartbeat", methods=["POST"])
def heartbeat(session_code):
    """Handle heartbeat and proctoring violations"""
    if not _student_session_authorized(session_code):
        return _forbidden_session_response()

    student_session = StudentSession.query.filter_by(session_code=session_code).first_or_404()
    data = request.get_json(silent=True) or {}

    focused = bool(data.get("focused", True))
    violation_count = int(data.get("violation_count", 0))

    SecurityService.record_heartbeat(session_code, focused, violation_count)

    should_submit = SecurityService.should_auto_submit(session_code)

    if should_submit and student_session.status == "active":
        ExamService.end_exam(session_code, reason="Auto-submitted due to security violations")

    return jsonify({
        "ok": True,
        "submitted": student_session.status in ["submitted", "evaluated"],
        "focus_violations": student_session.focus_violations,
        "should_submit": should_submit
    })


@api_bp.route("/student/session/<session_code>/submit", methods=["POST"])
def submit_session(session_code):
    """Manual or auto exam submission"""
    if not _student_session_authorized(session_code):
        return _forbidden_session_response()

    student_session = StudentSession.query.filter_by(session_code=session_code).first_or_404()

    data = request.get_json(silent=True) or {}
    reason = data.get("reason", "Manual submission")

    if student_session.status not in ["submitted", "evaluated"]:
        ExamService.end_exam(session_code, reason=reason)

    # Trigger result calculation in background (can be improved with Celery later)
    try:
        ResultService.calculate_result(session_code)
    except Exception:
        pass  # Don't block submission if result calc fails

    return jsonify({
        "ok": True,
        "redirect": f"/student/submitted/{session_code}"
    })
