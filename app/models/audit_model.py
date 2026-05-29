from datetime import datetime
from app.models.database import db


class AuditLog(db.Model):
    """Tracks all administrative and important system actions"""
    __tablename__ = "audit_logs"
    __table_args__ = (
        db.Index('ix_audit_logs_created', 'created_at'),
        db.Index('ix_audit_logs_user', 'user_id'),
        db.Index('ix_audit_logs_resource', 'resource_type', 'resource_id'),
        db.Index('ix_audit_logs_user_action_created', 'user_id', 'action', 'created_at'),
        db.Index('ix_audit_logs_status_created', 'status', 'created_at'),
    )

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
        try:
            from flask import has_request_context, request, session
            from app.socketio.realtime_events import emit_data_changed

            payload = {
                "method": "AUDIT",
                "resource": "audit_logs",
                "audit_log_id": self.id,
                "action": self.action,
            }
            if has_request_context():
                payload.update(
                    {
                        "role": session.get("role"),
                        "user_id": session.get("user_id") or session.get("admin_id") or session.get("teacher_id") or session.get("student_user_id"),
                        "path": request.path,
                    }
                )
            emit_data_changed(payload)
        except Exception:
            pass


class ViolationLog(db.Model):
    """Append-only exam integrity event log."""
    __tablename__ = "violation_logs"

    id = db.Column(db.Integer, primary_key=True)

    session_id = db.Column(db.Integer, db.ForeignKey("student_sessions.id"), nullable=False, index=True)
    student_session = db.relationship("StudentSession", backref=db.backref("violation_logs", lazy=True))

    violation_type = db.Column(db.String(80), nullable=False, index=True)
    detail = db.Column(db.Text, nullable=True)
    client_count = db.Column(db.Integer, default=0, nullable=False)
    admin_notified = db.Column(db.Boolean, default=False, nullable=False)

    ip_address = db.Column(db.String(50), nullable=True)
    user_agent = db.Column(db.String(255), nullable=True)
    occurred_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False, index=True)

    def __repr__(self):
        return f"<ViolationLog Session:{self.session_id} {self.violation_type}>"

    def save(self):
        db.session.add(self)
        db.session.commit()
        return self
