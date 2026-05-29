from datetime import datetime

from app.models.database import db


class Notification(db.Model):
    __tablename__ = "notifications"
    __table_args__ = (
        db.Index('ix_notifications_recipient_read_created', 'recipient_user_id', 'is_read', 'created_at'),
        db.Index('ix_notifications_session_read_created', 'session_id', 'is_read', 'created_at'),
        db.Index('ix_notifications_entity', 'related_entity_type', 'related_entity_id'),
    )

    id = db.Column(db.Integer, primary_key=True)
    recipient_user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True, index=True)
    session_id = db.Column(db.Integer, db.ForeignKey("student_sessions.id"), nullable=True, index=True)
    notification_type = db.Column(db.String(60), nullable=False, default="info")
    message = db.Column(db.Text, nullable=False)
    related_entity_type = db.Column(db.String(60), nullable=True)
    related_entity_id = db.Column(db.Integer, nullable=True)
    is_read = db.Column(db.Boolean, default=False, nullable=False)
    read_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    recipient = db.relationship("User")
    student_session = db.relationship("StudentSession")

    def mark_read(self):
        self.is_read = True
        self.read_at = datetime.utcnow()
