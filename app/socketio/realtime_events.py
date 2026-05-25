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
from app.models.user_model import User
from app.services.exam_session_guard import ExamSessionGuard, LOCKED_SESSION_STATUSES
from app.services.security_service import SecurityService
from app.utils.helpers import current_session_matches_user


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


def app_updates_room():
    return "app:updates"


def role_updates_room(role):
    return f"app:role:{role}"


def user_updates_room(user_id):
    return f"app:user:{user_id}"


def emit_to_proctors(exam_id, event_name, payload):
    if realtime_enabled():
        socketio.emit(event_name, payload, room=proctor_room(exam_id))


def emit_to_session(student_session, event_name, payload):
    if realtime_enabled() and student_session:
        socketio.emit(event_name, payload, room=session_room(student_session.id))


def emit_data_changed(payload=None):
    if not realtime_enabled():
        return
    clean_payload = payload or {}
    socketio.emit("app:data_changed", clean_payload, room=app_updates_room())


def _current_user_context():
    role = session.get("role")
    user_id = (
        session.get("user_id")
        or session.get("admin_id")
        or session.get("teacher_id")
        or session.get("student_user_id")
    )
    if not role or not user_id:
        return None
    user = User.query.get(user_id)
    if not user or not user.is_active or not current_session_matches_user(user):
        return None
    return {"role": role, "user_id": user_id}


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
    if not token or token != ExamSessionGuard.ensure_token(student_session):
        return False
    if student_session.status in LOCKED_SESSION_STATUSES:
        return False
    if session.get("role") != "student":
        return False
    student_user_id = session.get("student_user_id")
    if student_user_id:
        student = User.query.get(student_user_id)
        if not student or student.role != "student" or not student.is_active:
            return False
        if not current_session_matches_user(student):
            return False
    return ExamSessionGuard.browser_owns_attempt(student_session)


def _can_join_proctor_room(exam_id):
    admin_id = session.get("admin_id")
    if admin_id:
        admin = User.query.get(admin_id)
        return bool(admin and admin.role == "admin" and admin.is_active and current_session_matches_user(admin))

    teacher_id = session.get("teacher_id")
    if not teacher_id:
        return False

    teacher = User.query.get(teacher_id)
    if not teacher or teacher.role != "teacher" or not teacher.is_active:
        return False
    if not current_session_matches_user(teacher):
        return False

    if ExamSet.query.filter_by(id=exam_id, created_by=teacher_id).first() is not None:
        return True
    return False


if SOCKETIO_AVAILABLE:

    @socketio.on("connect")
    def handle_connect():
        context = _current_user_context()
        if context:
            join_room(app_updates_room())
            join_room(role_updates_room(context["role"]))
            join_room(user_updates_room(context["user_id"]))
        emit("realtime:connected", {"ok": True, **(context or {})})

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
