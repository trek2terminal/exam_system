from datetime import datetime

from app.models.database import db


class PlatformSettings(db.Model):
    __tablename__ = "platform_settings"

    id = db.Column(db.Integer, primary_key=True)

    platform_name = db.Column(db.String(120), nullable=False, default="Exam System")
    welcome_message = db.Column(db.String(255), nullable=False, default="Calm assessment space")
    announcement_message = db.Column(db.Text, nullable=True)
    student_self_registration = db.Column(db.Boolean, default=False, nullable=False)
    max_violations_before_alert = db.Column(db.Integer, default=3, nullable=False)
    quote_pool = db.Column(db.Text, nullable=False, default="")

    updated_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    updater = db.relationship("User")

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<PlatformSettings {self.platform_name}>"
