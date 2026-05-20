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

        existing_result = Result.query.filter_by(session_id=session.id).first()
        if existing_result:
            return existing_result

        answers = {a.question_id: a.answer_text for a in Answer.query.filter_by(session_id=session.id).all()}
        questions = sorted(session.exam_set.questions, key=lambda q: q.question_number)

        total_obtained = 0
        total_possible = sum(q.marks for q in questions)

        result = Result(
            session_id=session.id,
            total_marks=session.exam_set.total_marks or total_possible
        )
        db.session.add(result)
        db.session.flush()

        for question in questions:
            answer_text = answers.get(question.id, "")
            marks_awarded = 0
            if question.question_type == "mcq" and question.correct_answer:
                if answer_text.strip().upper() == question.correct_answer.strip().upper():
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
        session.status = "evaluated"
        db.session.commit()

        return result
