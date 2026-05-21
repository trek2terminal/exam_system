from datetime import datetime
from app.models.database import db
from app.models.exam_model import Question
from app.models.submission_model import StudentSession, Answer


class AutoSaveService:

    @staticmethod
    def save_answer(session_code: str, question_id: int, answer_text: str):
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

        # Check if answer already exists
        answer = Answer.query.filter_by(
            session_id=session.id,
            question_id=question_id
        ).first()

        if answer:
            answer.answer_text = answer_text
            answer.saved_at = datetime.utcnow()
        else:
            answer = Answer(
                session_id=session.id,
                question_id=question_id,
                answer_text=answer_text
            )
            db.session.add(answer)

        db.session.commit()
        return True, "Answer saved successfully"


    @staticmethod
    def get_saved_answers(session_code: str):
        """Get all saved answers for a session"""
        session = StudentSession.query.filter_by(session_code=session_code).first()
        if not session:
            return {}

        answers = Answer.query.filter_by(session_id=session.id).all()
        return {ans.question_id: ans.answer_text for ans in answers}
