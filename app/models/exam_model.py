import json
import secrets
from datetime import datetime
from app.models.database import db


def generate_access_code():
    """Generate a secure random access code for exams"""
    code = secrets.token_urlsafe(8).replace("-", "").replace("_", "").upper()
    return code[:10]


class ExamSet(db.Model):
    __tablename__ = "exam_sets"

    id = db.Column(db.Integer, primary_key=True)

    # Exam Details
    exam_name = db.Column(db.String(200), nullable=False)
    set_code = db.Column(db.String(20), nullable=False, unique=True, index=True)
    subject = db.Column(db.String(100), nullable=False)
    duration_minutes = db.Column(db.Integer, nullable=False)
    total_marks = db.Column(db.Integer, nullable=False, default=0)

    # Access & Status
    access_code = db.Column(db.String(32), unique=True, nullable=False, default=generate_access_code)
    status = db.Column(db.String(20), default="draft")  # draft / active / closed / archived

    activated_at = db.Column(db.DateTime, nullable=True)
    closed_at = db.Column(db.DateTime, nullable=True)

    # Relationships
    created_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    creator = db.relationship("User", backref=db.backref("created_exams", lazy=True))

    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<ExamSet {self.exam_name} ({self.access_code})>"

    def total_questions_marks(self):
        """Calculate total marks from all questions"""
        return sum(q.marks for q in self.questions)

    def is_active(self):
        return self.status == "active"

    def activate(self):
        self.status = "active"
        self.activated_at = datetime.utcnow()
        db.session.commit()

    def close(self):
        self.status = "closed"
        self.closed_at = datetime.utcnow()
        db.session.commit()


class Question(db.Model):
    __tablename__ = "questions"

    id = db.Column(db.Integer, primary_key=True)

    exam_set_id = db.Column(db.Integer, db.ForeignKey("exam_sets.id"), nullable=False)
    exam_set = db.relationship("ExamSet", backref=db.backref("questions", lazy=True, cascade="all, delete-orphan"))

    question_number = db.Column(db.Integer, nullable=False)
    question_text = db.Column(db.Text, nullable=False)
    question_type = db.Column(db.String(20), nullable=False)  # mcq, short, long, coding, true_false

    marks = db.Column(db.Integer, nullable=False, default=1)
    options = db.Column(db.Text, default="[]")          # JSON string for MCQ options
    correct_answer = db.Column(db.Text, nullable=True)  # Can be JSON for complex answers
    explanation = db.Column(db.Text, nullable=True)

    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<Question {self.question_number} - {self.question_type}>"

    def options_as_list(self):
        try:
            return json.loads(self.options or "[]")
        except Exception:
            return []

    def set_options(self, options_list):
        self.options = json.dumps(options_list or [])

    def is_mcq(self):
        return self.question_type == "mcq"