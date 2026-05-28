from datetime import datetime, timedelta
from app.models.database import db
from app.models.exam_model import Question
from app.models.submission_model import StudentSession, Answer


class AutoSaveService:
    VALID_VISIT_STATUSES = {
        "NOT_VISITED",
        "VISITED_UNANSWERED",
        "ANSWERED",
        "MARKED_REVIEW",
        "ANSWERED_MARKED",
    }

    @staticmethod
    def normalize_visit_status(raw_status, answer_text=""):
        status = (raw_status or "").strip().upper()
        if status in AutoSaveService.VALID_VISIT_STATUSES:
            return status
        return "ANSWERED" if (answer_text or "").strip() else "VISITED_UNANSWERED"

    @staticmethod
    def ensure_question_timer(answer, question):
        limit = int(getattr(question, "time_limit_seconds", 0) or 0)
        if limit <= 0:
            return False
        if not answer.question_started_at:
            answer.question_started_at = datetime.utcnow()
            answer.question_expires_at = answer.question_started_at + timedelta(seconds=limit)
        return True

    @staticmethod
    def answer_timer_expired(answer):
        return bool(
            answer
            and answer.question_expires_at
            and datetime.utcnow() > answer.question_expires_at
        )

    @staticmethod
    def apply_time_tracking(answer, time_spent_seconds=None, time_spent_delta_seconds=None, mark_visit=False):
        now = datetime.utcnow()
        if time_spent_seconds is not None:
            try:
                answer.total_time_spent_seconds = max(
                    int(answer.total_time_spent_seconds or 0),
                    max(int(time_spent_seconds), 0),
                )
            except (TypeError, ValueError):
                pass
        if time_spent_delta_seconds is not None:
            try:
                delta = max(int(time_spent_delta_seconds), 0)
            except (TypeError, ValueError):
                delta = 0
            answer.total_time_spent_seconds = int(answer.total_time_spent_seconds or 0) + min(delta, 3600)
        if mark_visit:
            answer.visit_count = int(answer.visit_count or 0) + 1
            answer.last_visited_at = now

    @staticmethod
    def save_answer(
        session_code: str,
        question_id: int,
        answer_text: str,
        visit_status=None,
        time_spent_seconds=None,
        time_spent_delta_seconds=None,
    ):
        """Save or update student answer with autosave"""
        session = StudentSession.query.filter_by(session_code=session_code).first()
        if not session:
            return False, "Invalid session"

        if session.status != "active":
            return False, "This exam attempt is locked."

        question = Question.query.filter_by(id=question_id, exam_set_id=session.exam_set_id).first()
        if not question:
            return False, "Question does not belong to this exam."

        # Update last heartbeat
        session.last_heartbeat = datetime.utcnow()
        session.updated_at = datetime.utcnow()

        answer = Answer.query.filter_by(
            session_id=session.id,
            question_id=question_id
        ).first()

        if answer:
            AutoSaveService.ensure_question_timer(answer, question)
            if AutoSaveService.answer_timer_expired(answer):
                answer.question_time_expired = True
                answer.saved_at = datetime.utcnow()
                db.session.commit()
                return False, "This question's time limit has expired."
            if answer.question_time_expired:
                return False, "This question's time limit has expired."
            answer.answer_text = answer_text
            answer.visit_status = AutoSaveService.normalize_visit_status(visit_status, answer_text)
            AutoSaveService.apply_time_tracking(
                answer,
                time_spent_seconds=time_spent_seconds,
                time_spent_delta_seconds=time_spent_delta_seconds,
            )
            answer.saved_at = datetime.utcnow()
        else:
            answer = Answer(
                session_id=session.id,
                question_id=question_id,
                answer_text=answer_text,
                visit_status=AutoSaveService.normalize_visit_status(visit_status, answer_text),
            )
            AutoSaveService.ensure_question_timer(answer, question)
            AutoSaveService.apply_time_tracking(
                answer,
                time_spent_seconds=time_spent_seconds,
                time_spent_delta_seconds=time_spent_delta_seconds,
                mark_visit=True,
            )
            db.session.add(answer)

        db.session.commit()
        return True, "Answer saved successfully"


    @staticmethod
    def save_visit_status(
        session_code: str,
        question_id: int,
        visit_status: str,
        time_spent_seconds=None,
        time_spent_delta_seconds=None,
    ):
        session = StudentSession.query.filter_by(session_code=session_code).first()
        if not session:
            return False, "Invalid session"

        if session.status != "active":
            return False, "This exam attempt is locked."

        question = Question.query.filter_by(id=question_id, exam_set_id=session.exam_set_id).first()
        if not question:
            return False, "Question does not belong to this exam."

        answer = Answer.query.filter_by(session_id=session.id, question_id=question_id).first()
        if not answer:
            answer = Answer(session_id=session.id, question_id=question_id, answer_text="")
            db.session.add(answer)

        AutoSaveService.ensure_question_timer(answer, question)
        answer.visit_status = AutoSaveService.normalize_visit_status(visit_status, answer.answer_text)
        AutoSaveService.apply_time_tracking(
            answer,
            time_spent_seconds=time_spent_seconds,
            time_spent_delta_seconds=time_spent_delta_seconds,
            mark_visit=True,
        )
        answer.saved_at = datetime.utcnow()
        session.last_heartbeat = datetime.utcnow()
        session.updated_at = datetime.utcnow()
        db.session.commit()
        return True, "Question status saved"

    @staticmethod
    def record_question_time(session_code: str, question_id: int, time_spent_seconds=None, time_spent_delta_seconds=None):
        session = StudentSession.query.filter_by(session_code=session_code).first()
        if not session or session.status not in {"active", "paused"}:
            return False

        question = Question.query.filter_by(id=question_id, exam_set_id=session.exam_set_id).first()
        if not question:
            return False

        answer = Answer.query.filter_by(session_id=session.id, question_id=question_id).first()
        if not answer:
            answer = Answer(session_id=session.id, question_id=question_id, answer_text="")
            db.session.add(answer)

        AutoSaveService.ensure_question_timer(answer, question)
        AutoSaveService.apply_time_tracking(
            answer,
            time_spent_seconds=time_spent_seconds,
            time_spent_delta_seconds=time_spent_delta_seconds,
        )
        answer.saved_at = datetime.utcnow()
        db.session.commit()
        return True

    @staticmethod
    def mark_question_expired(session_code: str, question_id: int):
        session = StudentSession.query.filter_by(session_code=session_code).first()
        if not session or session.status != "active":
            return False, "This exam attempt is locked."

        question = Question.query.filter_by(id=question_id, exam_set_id=session.exam_set_id).first()
        if not question:
            return False, "Question does not belong to this exam."

        answer = Answer.query.filter_by(session_id=session.id, question_id=question_id).first()
        if not answer:
            answer = Answer(session_id=session.id, question_id=question_id, answer_text="")
            db.session.add(answer)

        AutoSaveService.ensure_question_timer(answer, question)
        answer.question_time_expired = True
        answer.saved_at = datetime.utcnow()
        session.last_heartbeat = datetime.utcnow()
        session.updated_at = datetime.utcnow()
        db.session.commit()
        return True, "Question time limit recorded"


    @staticmethod
    def get_saved_answers(session_code: str):
        """Get all saved answers for a session"""
        session = StudentSession.query.filter_by(session_code=session_code).first()
        if not session:
            return {}

        answers = Answer.query.filter_by(session_id=session.id).all()
        return {ans.question_id: ans.answer_text for ans in answers}
