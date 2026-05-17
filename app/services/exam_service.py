from datetime import datetime, timedelta
from app.models.database import db
from app.models.exam_model import ExamSet, Question
from app.models.submission_model import StudentSession
from app.services.autosave_service import AutoSaveService


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
        """Create a new student exam session"""
        session = StudentSession(
            student_name=student_name,
            roll_no=roll_no,
            exam_set_id=exam_set_id,
            status="waiting",
            start_time=datetime.utcnow()
        )
        db.session.add(session)
        db.session.commit()
        return session


    @staticmethod
    def start_exam(session_code: str):
        session = StudentSession.query.filter_by(session_code=session_code).first()
        if session and session.status == "waiting":
            session.status = "active"
            session.start_time = datetime.utcnow()
            session.last_heartbeat = datetime.utcnow()
            db.session.commit()
            return True
        return False


    @staticmethod
    def get_questions_for_exam(exam_set_id: int, shuffle=False):
        questions = Question.query.filter_by(exam_set_id=exam_set_id)\
                    .order_by(Question.question_number).all()
        return questions


    @staticmethod
    def end_exam(session_code: str, reason="Manual"):
        session = StudentSession.query.filter_by(session_code=session_code).first()
        if session:
            session.status = "submitted"
            session.end_time = datetime.utcnow()
            session.submitted_at = datetime.utcnow()
            session.autosubmit_reason = reason
            db.session.commit()
            return True
        return False