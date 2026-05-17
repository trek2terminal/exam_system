from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

# Initialize SQLAlchemy (only once)
db = SQLAlchemy()


class BaseModel(db.Model):
    """Base model with common fields and methods"""
    __abstract__ = True

    id = db.Column(db.Integer, primary_key=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow,
                          onupdate=datetime.utcnow, nullable=False)

    def save(self):
        db.session.add(self)
        db.session.commit()
        return self

    def delete(self):
        db.session.delete(self)
        db.session.commit()


def init_db(app):
    """Initialize database - Call this only once"""
    # IMPORTANT: Initialize the app with SQLAlchemy first
    db.init_app(app)

    with app.app_context():
        # Import all models so they are registered
        from app.models.user_model import User
        from app.models.exam_model import ExamSet, Question
        from app.models.submission_model import StudentSession, Answer
        from app.models.result_model import Result, QuestionMark

        db.create_all()
        app.logger.info("✅ Database tables created/verified successfully.")