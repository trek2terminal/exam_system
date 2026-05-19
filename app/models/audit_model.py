from datetime import datetime
from app.models.database import db


class AuditLog(db.Model):
    """Tracks all administrative and important system actions"""
    __tablename__ = "audit_logs"

    id = db.Column(db.Integer, primary_key=True)

    # User who performed the action
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    user = db.relationship("User", backref=db.backref("audit_logs", lazy=True))

    # Action details
    action = db.Column(db.String(100), nullable=False)  # create_exam, start_exam, delete_user, etc.
    resource_type = db.Column(db.String(50), nullable=False)  # exam, user, system, etc.
    resource_id = db.Column(db.Integer, nullable=True)

    # What changed
    changes = db.Column(db.Text, nullable=True)  # JSON string of old -> new values
    reason = db.Column(db.Text, nullable=True)

    # Status
    status = db.Column(db.String(20), default="success")  # success, failed, warning
    error_message = db.Column(db.Text, nullable=True)

    # Request details
    ip_address = db.Column(db.String(50), nullable=True)
    user_agent = db.Column(db.String(255), nullable=True)

    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<AuditLog {self.action} by User:{self.user_id} on {self.resource_type}>"

    def save(self):
        """Save audit log to database"""
        db.session.add(self)
        db.session.commit()

