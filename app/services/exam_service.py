import json
import random
from datetime import datetime, timedelta
from app.models.database import db
from app.models.exam_model import ExamEnrollment, ExamSet, Question
from app.models.submission_model import StudentSession, generate_session_token
from app.services.exam_session_guard import LOCKED_SESSION_STATUSES


class ExamService:

    @staticmethod
    def create_exam(data: dict, teacher_id: int):
        """Create new exam set"""
        exam = ExamSet(
            exam_name=data['exam_name'],
            set_code=data.get('set_code'),
            subject=data['subject'],
            duration_minutes=int(data['duration_minutes']),
            total_marks=int(data.get('total_marks', 0)),
            created_by=teacher_id,
            start_time=data.get("start_time"),
            end_time=data.get("end_time"),
            status="draft"
        )
        db.session.add(exam)
        db.session.commit()
        return exam


    @staticmethod
    def get_exam_by_access_code(access_code: str):
        return ExamSet.query.filter_by(access_code=access_code).first()


    @staticmethod
    def activate_exam(exam_id: int):
        exam = ExamSet.query.get(exam_id)
        if exam:
            exam.activate()
            return True
        return False


    @staticmethod
    def create_student_session(exam_set_id: int, student_name: str, roll_no: str):
        """Create or reuse one student exam session for an exam and roll number."""
        normalized_roll = (roll_no or "").strip().upper()
        clean_name = (student_name or "").strip()
        exam = ExamSet.query.get(exam_set_id)

        existing_session = (
            StudentSession.query.filter(
                StudentSession.exam_set_id == exam_set_id,
                db.func.upper(StudentSession.roll_no) == normalized_roll,
            )
            .order_by(StudentSession.created_at.desc())
            .first()
        )

        if existing_session:
            if existing_session.status in ["waiting", "active", "paused"]:
                enrollment = (
                    ExamEnrollment.query.filter(
                        ExamEnrollment.exam_set_id == exam_set_id,
                        db.func.upper(ExamEnrollment.roll_no) == normalized_roll,
                    ).first()
                )
                if clean_name and existing_session.student_name != clean_name:
                    existing_session.student_name = clean_name
                    existing_session.updated_at = datetime.utcnow()
                    db.session.commit()
                if enrollment:
                    existing_session.extra_time_minutes = enrollment.extra_time_minutes or 0
                    existing_session.updated_at = datetime.utcnow()
                    db.session.commit()
                if not existing_session.session_token:
                    existing_session.session_token = generate_session_token()
                    existing_session.updated_at = datetime.utcnow()
                    db.session.commit()
                return existing_session

            if not ExamService.can_start_new_attempt(exam_set_id, normalized_roll):
                return existing_session

        enrollment = (
            ExamEnrollment.query.filter(
                ExamEnrollment.exam_set_id == exam_set_id,
                db.func.upper(ExamEnrollment.roll_no) == normalized_roll,
            ).first()
        )

        student_session = StudentSession(
            student_name=clean_name,
            roll_no=normalized_roll,
            exam_set_id=exam_set_id,
            status="waiting",
            start_time=None,
            extra_time_minutes=enrollment.extra_time_minutes if enrollment else 0,
            session_token=generate_session_token(),
        )
        db.session.add(student_session)
        db.session.commit()
        return student_session

    @staticmethod
    def attempt_count(exam_set_id, roll_no):
        return StudentSession.query.filter(
            StudentSession.exam_set_id == exam_set_id,
            db.func.upper(StudentSession.roll_no) == (roll_no or "").strip().upper(),
        ).count()

    @staticmethod
    def can_start_new_attempt(exam_set_id, roll_no):
        exam = ExamSet.query.get(exam_set_id)
        if not exam:
            return False
        limit = int(exam.attempt_limit or 1)
        if limit <= 0:
            return True
        return ExamService.attempt_count(exam_set_id, roll_no) < limit

    @staticmethod
    def attempts_remaining(exam_set_id, roll_no):
        exam = ExamSet.query.get(exam_set_id)
        if not exam:
            return 0
        limit = int(exam.attempt_limit or 1)
        if limit <= 0:
            return None
        return max(limit - ExamService.attempt_count(exam_set_id, roll_no), 0)

    @staticmethod
    def latest_locked_attempt(exam_set_id, roll_no):
        return (
            StudentSession.query.filter(
                StudentSession.exam_set_id == exam_set_id,
                db.func.upper(StudentSession.roll_no) == (roll_no or "").strip().upper(),
                StudentSession.status.in_(LOCKED_SESSION_STATUSES),
            )
            .order_by(StudentSession.created_at.desc())
            .first()
        )


    @staticmethod
    def start_exam(session_code: str):
        session = StudentSession.query.filter_by(session_code=session_code).first()
        if session and session.status == "waiting" and session.exam_set.is_open_for_student():
            session.status = "active"
            session.start_time = datetime.utcnow()
            session.last_heartbeat = datetime.utcnow()
            ExamService.ensure_question_order(session)
            db.session.commit()
            return True
        return False

    @staticmethod
    def remaining_seconds_for_session(student_session):
        if not student_session:
            return 0

        if student_session.status == "paused" and student_session.paused_remaining_seconds is not None:
            return max(int(student_session.paused_remaining_seconds or 0), 0)

        if not student_session.start_time:
            return (student_session.exam_set.duration_minutes + int(student_session.extra_time_minutes or 0)) * 60

        exam = student_session.exam_set
        total_seconds = (exam.duration_minutes + int(student_session.extra_time_minutes or 0)) * 60
        elapsed = (datetime.utcnow() - student_session.start_time).total_seconds()
        duration_remaining = max(int(total_seconds - elapsed), 0)

        if getattr(exam, "end_time", None):
            window_remaining = max(int((exam.end_time - datetime.utcnow()).total_seconds()), 0)
            return min(duration_remaining, window_remaining)

        return duration_remaining

    @staticmethod
    def request_pause(session_code, reason):
        student_session = StudentSession.query.filter_by(session_code=session_code).first()
        if not student_session or student_session.status != "active":
            return False

        student_session.pause_requested_at = datetime.utcnow()
        student_session.pause_reason = (reason or "").strip()[:1000] or "Pause requested by student"
        student_session.updated_at = datetime.utcnow()
        db.session.commit()
        try:
            from app.services.notification_service import NotificationService
            from app.socketio.realtime_events import emit_to_proctors

            NotificationService.notify_role(
                "admin",
                f"{student_session.student_name} requested a pause in {student_session.exam_set.exam_name}.",
                notification_type="pause_request",
                related_entity_type="student_session",
                related_entity_id=student_session.id,
            )
            db.session.commit()
            emit_to_proctors(
                student_session.exam_set_id,
                "proctor:student_status",
                {
                    "session_id": student_session.id,
                    "student_name": student_session.student_name,
                    "roll_no": student_session.roll_no,
                    "status": student_session.status,
                    "pause_requested": True,
                    "pause_reason": student_session.pause_reason,
                },
            )
        except Exception:
            pass
        return True

    @staticmethod
    def pause_session(student_session):
        if not student_session or student_session.status != "active":
            return False

        student_session.paused_remaining_seconds = ExamService.remaining_seconds_for_session(student_session)
        student_session.paused_at = datetime.utcnow()
        student_session.status = "paused"
        student_session.updated_at = datetime.utcnow()
        db.session.commit()
        return True

    @staticmethod
    def resume_session(student_session):
        if not student_session or student_session.status != "paused":
            return False

        remaining_seconds = max(int(student_session.paused_remaining_seconds or 0), 0)
        total_seconds = (
            student_session.exam_set.duration_minutes + int(student_session.extra_time_minutes or 0)
        ) * 60
        elapsed_seconds = max(total_seconds - remaining_seconds, 0)

        student_session.start_time = datetime.utcnow() - timedelta(seconds=elapsed_seconds)
        student_session.status = "active"
        student_session.paused_at = None
        student_session.paused_remaining_seconds = None
        student_session.pause_requested_at = None
        student_session.pause_reason = None
        student_session.last_heartbeat = datetime.utcnow()
        student_session.updated_at = datetime.utcnow()
        db.session.commit()
        return True


    @staticmethod
    def get_questions_for_exam(exam_set_id: int, shuffle=False):
        questions = Question.query.filter_by(exam_set_id=exam_set_id)\
                    .order_by(Question.question_number).all()
        return questions


    @staticmethod
    def ensure_question_order(student_session):
        if student_session.question_order:
            return json.loads(student_session.question_order)

        questions = Question.query.filter_by(exam_set_id=student_session.exam_set_id).order_by(Question.question_number).all()
        question_ids = [question.id for question in questions]
        exam = student_session.exam_set

        if exam.shuffle_questions or exam.random_question_count:
            rng = random.SystemRandom()
            rng.shuffle(question_ids)

        if exam.random_question_count and exam.random_question_count > 0:
            question_ids = question_ids[: min(exam.random_question_count, len(question_ids))]

        student_session.question_order = json.dumps(question_ids)
        student_session.updated_at = datetime.utcnow()
        return question_ids


    @staticmethod
    def get_session_questions(student_session):
        question_ids = ExamService.ensure_question_order(student_session)
        questions = Question.query.filter(Question.id.in_(question_ids)).all() if question_ids else []
        by_id = {question.id: question for question in questions}
        return [by_id[question_id] for question_id in question_ids if question_id in by_id]


    @staticmethod
    def end_exam(session_code: str, reason="Manual", status="submitted"):
        session = StudentSession.query.filter_by(session_code=session_code).first()
        if session:
            session.status = status
            session.end_time = datetime.utcnow()
            session.submitted_at = datetime.utcnow()
            session.autosubmit_reason = reason
            session.active_window_token = None
            session.active_window_heartbeat_at = None
            session.paused_at = None
            session.paused_remaining_seconds = None
            db.session.commit()
            return True
        return False


    @staticmethod
    def enforce_time_window(student_session):
        """Apply scheduled start/end rules to a student attempt."""
        if not student_session:
            return "missing"

        exam = student_session.exam_set
        now = datetime.utcnow()

        if exam.has_ended(now):
            if student_session.status in ["waiting", "active", "paused"]:
                ExamService.end_exam(
                    student_session.session_code,
                    reason="Auto-submitted because the exam window ended",
                    status="auto_submitted",
                )
            return "ended"

        if not exam.has_started(now):
            return "not_started"

        return "open"


    @staticmethod
    def auto_submit_expired_sessions(limit=200):
        """Close in-progress attempts whose exam end time has passed."""
        now = datetime.utcnow()
        sessions = (
            StudentSession.query.join(ExamSet, StudentSession.exam_set_id == ExamSet.id)
            .filter(
                ExamSet.end_time.isnot(None),
                ExamSet.end_time <= now,
                StudentSession.status.in_(["waiting", "active", "paused"]),
            )
            .limit(limit)
            .all()
        )

        for student_session in sessions:
            student_session.status = "auto_submitted"
            student_session.end_time = now
            student_session.submitted_at = now
            student_session.autosubmit_reason = "Auto-submitted because the exam window ended"
            student_session.active_window_token = None
            student_session.active_window_heartbeat_at = None
            student_session.paused_at = None
            student_session.paused_remaining_seconds = None

        if sessions:
            db.session.commit()

        return len(sessions)
