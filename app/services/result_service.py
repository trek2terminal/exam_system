from app.models.database import db
from app.models.result_model import Result, QuestionMark
from app.models.submission_model import StudentSession, Answer


class ResultService:

    @staticmethod
    def calculate_result(session_code: str):
        """Auto calculate result for MCQ based exams"""
        session = StudentSession.query.filter_by(session_code=session_code).first()
        if not session:
            return None

        answers = Answer.query.filter_by(session_id=session.id).all()
        questions = {q.id: q for q in session.exam_set.questions}

        total_obtained = 0
        total_possible = 0

        result = Result(
            session_id=session.id,
            total_marks=session.exam_set.total_marks or 0
        )
        db.session.add(result)
        db.session.commit()

        for ans in answers:
            question = questions.get(ans.question_id)
            if not question:
                continue

            marks_awarded = 0
            if question.question_type == "mcq" and question.correct_answer:
                if ans.answer_text.strip().upper() == question.correct_answer.strip().upper():
                    marks_awarded = question.marks

            total_obtained += marks_awarded

            q_mark = QuestionMark(
                result_id=result.id,
                question_id=question.id,
                marks_awarded=marks_awarded
            )
            db.session.add(q_mark)

        result.total_marks_obtained = total_obtained
        result.calculate_percentage()
        db.session.commit()

        session.status = "evaluated"
        db.session.commit()

        return result