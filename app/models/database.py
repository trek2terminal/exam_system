from datetime import datetime

from flask_sqlalchemy import SQLAlchemy

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
        from app.models.exam_model import ExamEnrollment, ExamSet, Question, QuestionBankItem
        from app.models.submission_model import StudentSession, Answer
        from app.models.result_model import Result, QuestionMark
        from app.models.audit_model import AuditLog, ViolationLog
        from app.models.settings_model import PlatformSettings
        from app.models.migration_model import SchemaMigration
        from app.models.group_model import StudentGroup, StudentGroupMember
        from app.models.notification_model import Notification

        db.create_all()
        from app.services.migration_service import MigrationService

        MigrationService.run_pending(app)
        app.logger.info("✅ Database tables created/verified successfully.")
