from datetime import datetime

from app.models.database import db


class RegistrationRequest(db.Model):
    __tablename__ = "registration_requests"

    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(120), nullable=False, index=True)
    preferred_username = db.Column(db.String(80), nullable=True)
    email = db.Column(db.String(120), nullable=True, index=True)
    phone = db.Column(db.String(10), nullable=True)
    roll_number = db.Column(db.String(50), nullable=False, index=True)
    class_name = db.Column(db.String(80), nullable=True)
    message = db.Column(db.Text, nullable=False)
    status = db.Column(db.String(30), default="new", nullable=False, index=True)
    admin_note = db.Column(db.Text, nullable=True)
    reviewed_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    reviewed_at = db.Column(db.DateTime, nullable=True)
    ip_address = db.Column(db.String(50), nullable=True)
    user_agent = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    reviewer = db.relationship("User")

    def mark_status(self, status, admin=None, note=None):
        self.status = status
        if note is not None:
            self.admin_note = note
        if admin:
            self.reviewed_by = admin.id
        self.reviewed_at = datetime.utcnow()
