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
    random_question_count = db.Column(db.Integer, default=0, nullable=False)
    shuffle_questions = db.Column(db.Boolean, default=False, nullable=False)
    attempt_limit = db.Column(db.Integer, default=1, nullable=False)

    # Access & Status
    access_code = db.Column(db.String(32), unique=True, nullable=False, default=generate_access_code)
    status = db.Column(db.String(20), default="draft")  # draft / active / closed / archived

    activated_at = db.Column(db.DateTime, nullable=True)
    closed_at = db.Column(db.DateTime, nullable=True)
    start_time = db.Column(db.DateTime, nullable=True)
    end_time = db.Column(db.DateTime, nullable=True)

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

    def has_started(self, now=None):
        now = now or datetime.utcnow()
        return not self.start_time or now >= self.start_time

    def has_ended(self, now=None):
        now = now or datetime.utcnow()
        return bool(self.end_time and now >= self.end_time)

    def is_open_for_student(self, now=None):
        return self.status == "active" and self.has_started(now) and not self.has_ended(now)

    def activate(self):
        self.status = "active"
        self.activated_at = datetime.utcnow()
        db.session.commit()

    def close(self):
        self.status = "closed"
        self.closed_at = datetime.utcnow()
        db.session.commit()


class ExamEnrollment(db.Model):
    __tablename__ = "exam_enrollments"
    __table_args__ = (
        db.UniqueConstraint("exam_set_id", "roll_no", name="uq_exam_enrollment_roll"),
    )

    id = db.Column(db.Integer, primary_key=True)

    exam_set_id = db.Column(db.Integer, db.ForeignKey("exam_sets.id"), nullable=False, index=True)
    exam_set = db.relationship(
        "ExamSet",
        backref=db.backref("enrollments", lazy=True, cascade="all, delete-orphan"),
    )

    roll_no = db.Column(db.String(50), nullable=False, index=True)
    student_name = db.Column(db.String(100), nullable=True)
    extra_time_minutes = db.Column(db.Integer, default=0, nullable=False)

    created_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    creator = db.relationship("User")

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<ExamEnrollment {self.roll_no} -> Exam {self.exam_set_id}>"

    @staticmethod
    def normalize_roll_no(roll_no):
        return (roll_no or "").strip().upper()


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
    model_answer = db.Column(db.Text, nullable=True)
    image_paths = db.Column(db.Text, default="[]", nullable=False)
    code_snippet = db.Column(db.Text, nullable=True)
    code_language = db.Column(db.String(40), nullable=True)
    time_limit_seconds = db.Column(db.Integer, default=0, nullable=False)

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

    def image_paths_as_list(self):
        try:
            return json.loads(self.image_paths or "[]")
        except Exception:
            return []

    def set_image_paths(self, paths):
        self.image_paths = json.dumps(paths or [])


class QuestionBankItem(db.Model):
    __tablename__ = "question_bank_items"

    id = db.Column(db.Integer, primary_key=True)

    teacher_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    teacher = db.relationship("User")

    question_text = db.Column(db.Text, nullable=False)
    question_type = db.Column(db.String(20), nullable=False, default="short")
    marks = db.Column(db.Integer, nullable=False, default=1)
    options = db.Column(db.Text, default="[]")
    correct_answer = db.Column(db.Text, nullable=True)
    explanation = db.Column(db.Text, nullable=True)
    model_answer = db.Column(db.Text, nullable=True)
    image_paths = db.Column(db.Text, default="[]", nullable=False)
    code_snippet = db.Column(db.Text, nullable=True)
    code_language = db.Column(db.String(40), nullable=True)
    time_limit_seconds = db.Column(db.Integer, default=0, nullable=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    def options_as_list(self):
        try:
            return json.loads(self.options or "[]")
        except Exception:
            return []

    def set_options(self, options_list):
        self.options = json.dumps(options_list or [])

    def image_paths_as_list(self):
        try:
            return json.loads(self.image_paths or "[]")
        except Exception:
            return []

    def set_image_paths(self, paths):
        self.image_paths = json.dumps(paths or [])

    @classmethod
    def from_question(cls, question, teacher_id):
        item = cls(
            teacher_id=teacher_id,
            question_text=question.question_text,
            question_type=question.question_type,
            marks=question.marks,
            correct_answer=question.correct_answer,
            explanation=question.explanation,
            model_answer=question.model_answer,
            code_snippet=question.code_snippet,
            code_language=question.code_language,
            time_limit_seconds=question.time_limit_seconds,
        )
        item.set_options(question.options_as_list())
        item.set_image_paths(question.image_paths_as_list())
        return item
