from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from sqlalchemy import inspect, text


def apply_lightweight_schema_updates(app):
    """Apply safe additive schema updates for the local SQLite-first app."""
    inspector = inspect(db.engine)
    if "answers" not in inspector.get_table_names():
        return

    existing_columns = {column["name"] for column in inspector.get_columns("answers")}
    additive_columns = {
        "code_output": "TEXT",
        "execution_status": "VARCHAR(30)",
        "execution_time_ms": "INTEGER",
    }

    for column_name, column_type in additive_columns.items():
        if column_name in existing_columns:
            continue
        with db.engine.begin() as connection:
            connection.execute(text(f"ALTER TABLE answers ADD COLUMN {column_name} {column_type}"))
        app.logger.info("Added missing answers.%s column.", column_name)

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
        from app.models.exam_model import ExamEnrollment, ExamSet, Question
        from app.models.submission_model import StudentSession, Answer
        from app.models.result_model import Result, QuestionMark
        from app.models.audit_model import AuditLog, ViolationLog
        from app.models.settings_model import PlatformSettings

        db.create_all()
        apply_lightweight_schema_updates(app)
        app.logger.info("✅ Database tables created/verified successfully.")
