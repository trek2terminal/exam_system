try:
    from flask_socketio import SocketIO, emit, join_room

    SOCKETIO_AVAILABLE = True
except ImportError:
    SocketIO = None
    emit = None
    join_room = None
    SOCKETIO_AVAILABLE = False

from flask import session

from app.models.exam_model import ExamSet
from app.models.submission_model import StudentSession
from app.services.exam_session_guard import ExamSessionGuard
from app.services.security_service import SecurityService


socketio = SocketIO(async_mode="threading") if SOCKETIO_AVAILABLE else None


def init_socketio(app):
    if not SOCKETIO_AVAILABLE:
        app.logger.warning("Flask-SocketIO is not installed; realtime layer is disabled and polling remains active.")
        return None
    socketio.init_app(app, cors_allowed_origins="*", manage_session=False)
    app.extensions["socketio"] = socketio
    return socketio


def realtime_enabled():
    return bool(socketio and SOCKETIO_AVAILABLE)


def proctor_room(exam_id):
    return f"proctor:exam:{exam_id}"


def session_room(session_id):
    return f"student-session:{session_id}"


def emit_to_proctors(exam_id, event_name, payload):
    if realtime_enabled():
        socketio.emit(event_name, payload, room=proctor_room(exam_id))


def emit_to_session(student_session, event_name, payload):
    if realtime_enabled() and student_session:
        socketio.emit(event_name, payload, room=session_room(student_session.id))


def _parse_positive_int(value):
    try:
        clean_value = int(value or 0)
    except (TypeError, ValueError):
        return 0
    return clean_value if clean_value > 0 else 0


def _owns_student_socket(student_session, payload):
    if not student_session:
        return False
    token = (payload or {}).get("session_token")
    return bool(token and token == ExamSessionGuard.ensure_token(student_session))


def _can_join_proctor_room(exam_id):
    if session.get("admin_id"):
        return True
    teacher_id = session.get("teacher_id")
    if not teacher_id:
        return False
    return ExamSet.query.filter_by(id=exam_id, created_by=teacher_id).first() is not None


if SOCKETIO_AVAILABLE:

    @socketio.on("connect")
    def handle_connect():
        emit("realtime:connected", {"ok": True})

    @socketio.on("proctor:join")
    def handle_proctor_join(data):
        exam_id = _parse_positive_int((data or {}).get("exam_id"))
        if not exam_id:
            emit("realtime:error", {"message": "exam_id is required"})
            return
        if not _can_join_proctor_room(exam_id):
            emit("realtime:error", {"message": "Not authorized"})
            return
        join_room(proctor_room(exam_id))
        emit("proctor:joined", {"ok": True, "exam_id": exam_id})

    @socketio.on("student:join")
    def handle_student_join(data):
        data = data or {}
        session_code = data.get("session_code")
        student_session = StudentSession.query.filter_by(session_code=session_code).first()
        if not _owns_student_socket(student_session, data):
            emit("realtime:error", {"message": "Not authorized"})
            return
        join_room(session_room(student_session.id))
        emit("student:joined", {"ok": True, "session_id": student_session.id})

    @socketio.on("exam:heartbeat")
    def handle_heartbeat(data):
        data = data or {}
        student_session = StudentSession.query.filter_by(session_code=data.get("session_code")).first()
        if not _owns_student_socket(student_session, data):
            emit("realtime:error", {"message": "Not authorized"})
            return
        SecurityService.record_heartbeat(
            student_session.session_code,
            focused=bool(data.get("focused", True)),
            violation_count=int(data.get("violation_count") or 0),
        )
        emit("exam:heartbeat_ack", {"ok": True}, room=session_room(student_session.id))
        emit_to_proctors(
            student_session.exam_set_id,
            "proctor:student_status",
            {
                "session_id": student_session.id,
                "student_name": student_session.student_name,
                "roll_no": student_session.roll_no,
                "status": student_session.status,
                "focus_violations": student_session.focus_violations,
            },
        )

    @socketio.on("exam:violation")
    def handle_violation(data):
        data = data or {}
        student_session = StudentSession.query.filter_by(session_code=data.get("session_code")).first()
        if not _owns_student_socket(student_session, data):
            emit("realtime:error", {"message": "Not authorized"})
            return
        violation = SecurityService.record_violation(
            student_session.session_code,
            data.get("type") or "UNKNOWN",
            data.get("detail") or "",
            int(data.get("violation_count") or 0),
        )
        emit_to_proctors(
            student_session.exam_set_id,
            "proctor:violation_alert",
            {
                "session_id": student_session.id,
                "student_name": student_session.student_name,
                "roll_no": student_session.roll_no,
                "type": violation.violation_type if violation else data.get("type"),
                "count": student_session.focus_violations,
            },
        )
