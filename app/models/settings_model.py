from datetime import datetime

from app.models.database import db


class PlatformSettings(db.Model):
    __tablename__ = "platform_settings"

    id = db.Column(db.Integer, primary_key=True)

    platform_name = db.Column(db.String(120), nullable=False, default="Exam System")
    welcome_message = db.Column(db.String(255), nullable=False, default="Calm assessment space")
    announcement_message = db.Column(db.Text, nullable=True)
    login_page_heading = db.Column(db.Text, nullable=False, default="Exam Platform")
    login_page_tagline = db.Column(
        db.Text,
        nullable=False,
        default="The future of secure, intelligent assessment.",
    )
    login_page_subheading = db.Column(
        db.Text,
        nullable=False,
        default="Focused, secure, and ready for every exam session.",
    )
    login_page_features = db.Column(
        db.Text,
        nullable=False,
        default=(
            '["Real-time proctoring and monitoring", '
            '"Multiple question types and formats", '
            '"Instant results and detailed analytics", '
            '"Code execution support with live testing"]'
        ),
    )
    login_page_security_badge_text = db.Column(
        db.String(160),
        nullable=False,
        default="Secured by end-to-end encryption",
    )
    login_page_security_badge_enabled = db.Column(db.Boolean, default=True, nullable=False)
    student_self_registration = db.Column(db.Boolean, default=False, nullable=False)
    registration_code_required = db.Column(db.Boolean, default=False, nullable=False)
    registration_code = db.Column(db.String(80), nullable=True)
    max_violations_before_alert = db.Column(db.Integer, default=3, nullable=False)
    admin_lockout_count = db.Column(db.Integer, default=3, nullable=False)
    admin_idle_timeout_minutes = db.Column(db.Integer, default=120, nullable=False)
    quote_pool = db.Column(db.Text, nullable=False, default="")
    logo_path = db.Column(db.String(255), nullable=True)

    updated_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    updater = db.relationship("User")

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<PlatformSettings {self.platform_name}>"
