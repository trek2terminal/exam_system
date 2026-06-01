from datetime import datetime

from app.models.audit_model import AuditLog, ViolationLog
from app.models.database import db
from app.models.exam_model import ExamSet, Question
from app.models.notification_model import Notification
from app.models.submission_model import Answer, StudentSession
from app.models.user_model import User
from app.utils.csrf import CSRF_HEADER, CSRF_SESSION_KEY


SMOKE_CSRF_TOKEN = "realtime-smoke-csrf-token"


def _event_names(received):
    return [event.get("name") for event in received]


def _has_event(received, event_name):
    return any(event.get("name") == event_name for event in received)


def _print_step(label, passed, detail=""):
    marker = "PASS" if passed else "FAIL"
    suffix = f" - {detail}" if detail else ""
    print(f"[{marker}] {label}{suffix}")


def _seed_smoke_data():
    stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S%f")

    admin = User(
        name="Codex Realtime Admin",
        username=f"rt_admin_{stamp}",
        role="admin",
        is_active=True,
        email=f"rt_admin_{stamp}@example.test",
    )
    admin.set_password("RealtimeSmoke123")

    teacher = User(
        name="Codex Realtime Teacher",
        username=f"rt_teacher_{stamp}",
        role="teacher",
        is_active=True,
        email=f"rt_teacher_{stamp}@example.test",
    )
    teacher.set_password("RealtimeSmoke123")

    other_teacher = User(
        name="Codex Other Teacher",
        username=f"rt_other_teacher_{stamp}",
        role="teacher",
        is_active=True,
        email=f"rt_other_teacher_{stamp}@example.test",
    )
    other_teacher.set_password("RealtimeSmoke123")

    student = User(
        name="Codex Realtime Student",
        username=f"rt_student_{stamp}",
        role="student",
        is_active=True,
        email=f"rt_student_{stamp}@example.test",
        roll_number=f"RTR{stamp[-6:]}",
    )
    student.set_password("RealtimeSmoke123")

    db.session.add_all([admin, teacher, other_teacher, student])
    db.session.flush()

    exam = ExamSet(
        exam_name="Realtime Smoke Exam",
        set_code=f"RT{stamp[-8:]}",
        subject="Smoke",
        duration_minutes=10,
        total_marks=1,
        access_code=f"RS{stamp[-8:]}",
        status="active",
        created_by=teacher.id,
    )
    db.session.add(exam)
    db.session.flush()

    question = Question(
        exam_set_id=exam.id,
        question_number=1,
        question_text="Realtime smoke question?",
        question_type="short",
        marks=1,
        time_limit_seconds=0,
    )
    db.session.add(question)
    db.session.flush()

    student_session = StudentSession(
        student_name=student.name,
        roll_no=student.roll_number,
        exam_set_id=exam.id,
        status="active",
        start_time=datetime.utcnow(),
        last_heartbeat=datetime.utcnow(),
        session_token=f"rt-token-{stamp}",
    )
    db.session.add(student_session)
    db.session.commit()

    return {
        "admin": admin,
        "teacher": teacher,
        "other_teacher": other_teacher,
        "student": student,
        "exam": exam,
        "question": question,
        "student_session": student_session,
    }


def _cleanup_smoke_data(ids):
    if not ids:
        return

    session_id = ids["session_id"]
    question_id = ids["question_id"]
    exam_id = ids["exam_id"]
    user_ids = ids["user_ids"]

    Notification.query.filter_by(session_id=session_id).delete()
    AuditLog.query.filter_by(resource_type="student_session", resource_id=session_id).delete()
    ViolationLog.query.filter_by(session_id=session_id).delete()
    Answer.query.filter_by(session_id=session_id).delete()
    StudentSession.query.filter_by(id=session_id).delete()
    Question.query.filter_by(id=question_id).delete()
    ExamSet.query.filter_by(id=exam_id).delete()
    User.query.filter(User.id.in_(user_ids)).delete(synchronize_session=False)
    db.session.commit()


def _make_proctor_client(app, socketio, user, role):
    auth_session_token = user.issue_active_session_token()
    db.session.commit()
    http_client = app.test_client()
    with http_client.session_transaction() as browser_session:
        browser_session["role"] = role
        browser_session[f"{role}_id"] = user.id
        browser_session["user_id"] = user.id
        browser_session[f"{role}_name"] = user.name
        browser_session["auth_session_token"] = auth_session_token
        browser_session[CSRF_SESSION_KEY] = SMOKE_CSRF_TOKEN
        if role == "admin":
            browser_session["admin_last_activity"] = datetime.utcnow().isoformat()
    return socketio.test_client(app, flask_test_client=http_client), http_client


def _make_student_client(app, socketio, student, student_session, rotate_login=True):
    if rotate_login:
        auth_session_token = student.issue_active_session_token()
        db.session.commit()
    else:
        auth_session_token = student.active_session_token
    http_client = app.test_client()
    with http_client.session_transaction() as browser_session:
        browser_session["role"] = "student"
        browser_session["student_id"] = student.roll_number
        browser_session["student_user_id"] = student.id
        browser_session["user_id"] = student.id
        browser_session["auth_session_token"] = auth_session_token
        browser_session["student_name"] = student.name
        browser_session["roll_no"] = student.roll_number
        browser_session["student_session_code"] = student_session.session_code
        browser_session[CSRF_SESSION_KEY] = SMOKE_CSRF_TOKEN
        browser_session["student_session_token"] = student_session.session_token
        browser_session["exam_attempt_tokens"] = {
            student_session.session_code: student_session.session_token,
        }
    return socketio.test_client(app, flask_test_client=http_client), http_client


def run_realtime_smoke(app):
    socketio = app.extensions.get("socketio")
    if not socketio:
        print("Realtime smoke failed: Flask-SocketIO is not enabled.")
        return False

    ids = None
    clients = []
    all_passed = True

    with app.app_context():
        seeded = _seed_smoke_data()
        admin = seeded["admin"]
        teacher = seeded["teacher"]
        other_teacher = seeded["other_teacher"]
        student = seeded["student"]
        exam = seeded["exam"]
        student_session = seeded["student_session"]
        ids = {
            "session_id": student_session.id,
            "question_id": seeded["question"].id,
            "exam_id": exam.id,
            "user_ids": [admin.id, teacher.id, other_teacher.id, student.id],
        }

        try:
            admin_socket, admin_http = _make_proctor_client(app, socketio, admin, "admin")
            teacher_socket, _ = _make_proctor_client(app, socketio, teacher, "teacher")
            other_teacher_socket, _ = _make_proctor_client(app, socketio, other_teacher, "teacher")
            student_socket, _ = _make_student_client(app, socketio, student, student_session)
            bad_student_socket, _ = _make_student_client(app, socketio, student, student_session, rotate_login=False)
            clients = [admin_socket, teacher_socket, other_teacher_socket, student_socket, bad_student_socket]

            admin_socket.emit("proctor:join", {"exam_id": exam.id})
            admin_join = admin_socket.get_received()
            passed = _has_event(admin_join, "proctor:joined")
            all_passed = all_passed and passed
            _print_step("admin can join proctor room", passed, ", ".join(_event_names(admin_join)))

            teacher_socket.emit("proctor:join", {"exam_id": exam.id})
            teacher_join = teacher_socket.get_received()
            passed = _has_event(teacher_join, "proctor:joined")
            all_passed = all_passed and passed
            _print_step("owning teacher can join proctor room", passed, ", ".join(_event_names(teacher_join)))

            other_teacher_socket.emit("proctor:join", {"exam_id": exam.id})
            other_join = other_teacher_socket.get_received()
            passed = _has_event(other_join, "realtime:error")
            all_passed = all_passed and passed
            _print_step("non-owner teacher is blocked", passed, ", ".join(_event_names(other_join)))

            student_socket.emit(
                "student:join",
                {
                    "session_code": student_session.session_code,
                    "session_token": student_session.session_token,
                },
            )
            student_join = student_socket.get_received()
            passed = _has_event(student_join, "student:joined")
            all_passed = all_passed and passed
            _print_step("student can join private session room", passed, ", ".join(_event_names(student_join)))

            bad_student_socket.emit(
                "student:join",
                {
                    "session_code": student_session.session_code,
                    "session_token": "wrong-token",
                },
            )
            bad_join = bad_student_socket.get_received()
            passed = _has_event(bad_join, "realtime:error")
            all_passed = all_passed and passed
            _print_step("bad student token is blocked", passed, ", ".join(_event_names(bad_join)))

            student_socket.emit(
                "exam:violation",
                {
                    "session_code": student_session.session_code,
                    "session_token": student_session.session_token,
                    "type": "SMOKE_TEST",
                    "detail": "Realtime smoke violation",
                    "violation_count": 1,
                },
            )
            admin_violation = admin_socket.get_received()
            teacher_violation = teacher_socket.get_received()
            passed = _has_event(admin_violation, "proctor:violation_alert") and _has_event(
                teacher_violation,
                "proctor:violation_alert",
            )
            all_passed = all_passed and passed
            _print_step(
                "student violation reaches admin and teacher proctors",
                passed,
                f"admin={_event_names(admin_violation)}, teacher={_event_names(teacher_violation)}",
            )

            response = admin_http.post(
                f"/api/admin/proctoring/session/{student_session.id}/action",
                headers={CSRF_HEADER: SMOKE_CSRF_TOKEN},
                json={
                    "action": "message",
                    "admin_password": "RealtimeSmoke123",
                    "message": "Realtime smoke admin message",
                },
            )
            student_events = student_socket.get_received()
            passed = response.status_code == 200 and _has_event(student_events, "exam:admin_message")
            all_passed = all_passed and passed
            _print_step(
                "admin message reaches student socket",
                passed,
                f"http={response.status_code}, events={_event_names(student_events)}",
            )

        finally:
            for client in clients:
                if client and client.is_connected():
                    client.disconnect()
            _cleanup_smoke_data(ids)

    return all_passed
