import secrets
from datetime import datetime
from app.models.database import db


def generate_session_code():
    """Generate unique session code for each student exam attempt"""
    code = secrets.token_urlsafe(20).replace("-", "").replace("_", "").upper()
    return code[:16]


def generate_session_token():
    """Generate the private per-attempt token stored in the browser session."""
    return secrets.token_urlsafe(32)


class StudentSession(db.Model):
    __tablename__ = "student_sessions"

    id = db.Column(db.Integer, primary_key=True)

    # Student Info
    student_name = db.Column(db.String(100), nullable=False)
    roll_no = db.Column(db.String(50), nullable=False, index=True)

    # Exam Relation
    exam_set_id = db.Column(db.Integer, db.ForeignKey("exam_sets.id"), nullable=False)
    exam_set = db.relationship("ExamSet", backref=db.backref("sessions", lazy=True))

    # Session Info
    session_code = db.Column(db.String(64), unique=True, nullable=False, default=generate_session_code)
    session_token = db.Column(db.String(128), unique=True, nullable=True, index=True)

    start_time = db.Column(db.DateTime, nullable=True)
    end_time = db.Column(db.DateTime, nullable=True)
    submitted_at = db.Column(db.DateTime, nullable=True)

    status = db.Column(db.String(20), default="waiting")
    # waiting / active / submitted / auto_submitted / terminated / evaluated

    # Proctoring & Security
    focus_violations = db.Column(db.Integer, default=0)
    tab_switch_count = db.Column(db.Integer, default=0)
    screenshot_count = db.Column(db.Integer, default=0)
    suspicion_score = db.Column(db.Integer, default=0)   # 0-100

    autosubmit_reason = db.Column(db.Text, nullable=True)
    last_heartbeat = db.Column(db.DateTime, nullable=True)

    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<StudentSession {self.student_name} - {self.session_code}>"

    def mark_as_submitted(self, reason=None):
        self.status = "submitted"
        self.submitted_at = datetime.utcnow()
        if reason:
            self.autosubmit_reason = reason
        db.session.commit()

    def increment_violation(self, violation_type="focus"):
        if violation_type == "focus":
            self.focus_violations += 1
        elif violation_type == "tab":
            self.tab_switch_count += 1
        self.suspicion_score = min(100, self.suspicion_score + 15)
        db.session.commit()


class Answer(db.Model):
    __tablename__ = "answers"

    id = db.Column(db.Integer, primary_key=True)

    session_id = db.Column(db.Integer, db.ForeignKey("student_sessions.id"), nullable=False)
    session = db.relationship("StudentSession", backref=db.backref("answers", lazy=True, cascade="all, delete-orphan"))

    question_id = db.Column(db.Integer, db.ForeignKey("questions.id"), nullable=False)
    question = db.relationship("Question")

    answer_text = db.Column(db.Text, default="")
    code_output = db.Column(db.Text, nullable=True)
    execution_status = db.Column(db.String(30), nullable=True)
    execution_time_ms = db.Column(db.Integer, nullable=True)
    saved_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f"<Answer Session:{self.session_id} Q:{self.question_id}>"
