from datetime import datetime
from app.models.database import db


class Result(db.Model):
    __tablename__ = "results"

    id = db.Column(db.Integer, primary_key=True)

    session_id = db.Column(db.Integer, db.ForeignKey("student_sessions.id"), unique=True, nullable=False)
    session = db.relationship("StudentSession", backref=db.backref("result", uselist=False))

    total_marks_obtained = db.Column(db.Integer, default=0)
    total_marks = db.Column(db.Integer, default=0)          # Total possible marks
    percentage = db.Column(db.Float, default=0.0)

    teacher_remarks = db.Column(db.Text, nullable=True)
    evaluated_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    evaluator = db.relationship("User", backref=db.backref("evaluated_results", lazy=True))

    published = db.Column(db.Boolean, default=False)
    published_at = db.Column(db.DateTime, nullable=True)

    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<Result Session:{self.session_id} - {self.total_marks_obtained}/{self.total_marks}>"

    def calculate_percentage(self):
        if self.total_marks > 0:
            self.percentage = round((self.total_marks_obtained / self.total_marks) * 100, 2)
        return self.percentage

    def publish(self):
        self.published = True
        self.published_at = datetime.utcnow()
        db.session.commit()


class QuestionMark(db.Model):
    __tablename__ = "question_marks"

    id = db.Column(db.Integer, primary_key=True)

    result_id = db.Column(db.Integer, db.ForeignKey("results.id"), nullable=False)
    result = db.relationship("Result", backref=db.backref("question_marks", lazy=True, cascade="all, delete-orphan"))

    question_id = db.Column(db.Integer, db.ForeignKey("questions.id"), nullable=False)
    question = db.relationship("Question")

    marks_awarded = db.Column(db.Integer, default=0)
    teacher_remark = db.Column(db.Text, nullable=True)

    def __repr__(self):
        return f"<QuestionMark Q:{self.question_id} - {self.marks_awarded} marks>"