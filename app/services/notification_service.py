from datetime import datetime

from app.models.database import db
from app.models.notification_model import Notification
from app.models.user_model import User


class NotificationService:
    @staticmethod
    def notify_user(user_id, message, notification_type="info", related_entity_type=None, related_entity_id=None):
        if not user_id or not message:
            return None
        notification = Notification(
            recipient_user_id=user_id,
            notification_type=notification_type,
            message=message,
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
        )
        db.session.add(notification)
        return notification

    @staticmethod
    def notify_role(role, message, notification_type="info", related_entity_type=None, related_entity_id=None):
        users = User.query.filter_by(role=role, is_active=True).all()
        notifications = []
        for user in users:
            notifications.append(
                Notification(
                    recipient_user_id=user.id,
                    notification_type=notification_type,
                    message=message,
                    related_entity_type=related_entity_type,
                    related_entity_id=related_entity_id,
                )
            )
        if notifications:
            db.session.add_all(notifications)
        return notifications

    @staticmethod
    def notify_session(session_id, message, notification_type="admin_message", related_entity_type=None, related_entity_id=None):
        if not session_id or not message:
            return None
        notification = Notification(
            session_id=session_id,
            notification_type=notification_type,
            message=message,
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
        )
        db.session.add(notification)
        return notification

    @staticmethod
    def unread_for_user(user_id, limit=20):
        if not user_id:
            return []
        return (
            Notification.query.filter_by(recipient_user_id=user_id, is_read=False)
            .order_by(Notification.created_at.desc())
            .limit(limit)
            .all()
        )

    @staticmethod
    def unread_count_for_user(user_id):
        if not user_id:
            return 0
        return Notification.query.filter_by(recipient_user_id=user_id, is_read=False).count()

    @staticmethod
    def pop_unread_session_messages(session_id, limit=10):
        notifications = (
            Notification.query.filter_by(session_id=session_id, is_read=False)
            .order_by(Notification.created_at.asc())
            .limit(limit)
            .all()
        )
        payload = [
            {
                "id": item.id,
                "type": item.notification_type,
                "message": item.message,
                "created_at": item.created_at.isoformat(),
            }
            for item in notifications
        ]
        for item in notifications:
            item.is_read = True
            item.read_at = datetime.utcnow()
        if notifications:
            db.session.commit()
        return payload

    @staticmethod
    def mark_user_notifications_read(user_id):
        notifications = NotificationService.unread_for_user(user_id, limit=200)
        for notification in notifications:
            notification.mark_read()
        if notifications:
            db.session.commit()
        return len(notifications)
