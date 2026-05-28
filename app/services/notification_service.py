import json
from datetime import datetime, timedelta

from app.models.database import db
from app.models.notification_model import Notification
from app.models.user_model import User


class NotificationService:
    @staticmethod
    def notify_user_once(
        user_id,
        message,
        notification_type="info",
        related_entity_type=None,
        related_entity_id=None,
        dedupe_hours=24,
    ):
        if not user_id or not message:
            return None

        query = Notification.query.filter_by(
            recipient_user_id=user_id,
            notification_type=notification_type,
            message=message,
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
        )
        if dedupe_hours:
            query = query.filter(Notification.created_at >= datetime.utcnow() - timedelta(hours=dedupe_hours))
        if query.first():
            return None
        return NotificationService.notify_user(
            user_id,
            message,
            notification_type=notification_type,
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
        )

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

    @staticmethod
    def run_due_reminders_for_user(user):
        if not user or not getattr(user, "id", None) or not getattr(user, "is_active", False):
            return 0

        role = (user.role or "").strip().lower()
        preferences = NotificationService._preferences_for_user(user)
        created_count = 0
        if role == "student" and preferences.get("exam_reminders", True):
            created_count += NotificationService._student_exam_reminders(
                user,
                lead_minutes=preferences.get("reminder_lead_minutes", 30),
            )
        elif role == "teacher" and preferences.get("review_reminders", True):
            created_count += NotificationService._teacher_review_reminders(user)
        elif role == "admin" and preferences.get("registration_reminders", True):
            created_count += NotificationService._admin_registration_reminders(user)

        if created_count:
            db.session.commit()
        return created_count

    @staticmethod
    def _student_exam_reminders(user, lead_minutes=30):
        from app.models.exam_model import ExamEnrollment, ExamSet
        from app.services.exam_service import ExamService

        roll_no = (getattr(user, "roll_number", None) or "").strip().upper()
        if not roll_no:
            return 0

        lead_minutes = NotificationService._normalize_lead_minutes(lead_minutes)
        now = datetime.utcnow()
        upcoming_limit = now + timedelta(minutes=lead_minutes)
        enrollments = (
            ExamEnrollment.query.filter(db.func.upper(ExamEnrollment.roll_no) == roll_no)
            .join(ExamSet)
            .filter(ExamSet.status == "active")
            .order_by(ExamSet.start_time.asc(), ExamSet.created_at.desc())
            .all()
        )

        created_count = 0
        for enrollment in enrollments:
            exam = enrollment.exam_set
            if exam.end_time and exam.end_time <= now:
                continue

            attempts_remaining = ExamService.attempts_remaining(exam.id, roll_no)
            if attempts_remaining == 0:
                continue

            starts_soon = bool(exam.start_time and now <= exam.start_time <= upcoming_limit)
            is_available_now = (not exam.start_time or exam.start_time <= now) and (not exam.end_time or exam.end_time > now)

            if starts_soon:
                note = NotificationService.notify_user_once(
                    user.id,
                    f"{exam.exam_name} starts at {NotificationService._format_exam_time(exam.start_time)}. Please keep your device and internet ready.",
                    notification_type=f"exam_reminder_{lead_minutes}m",
                    related_entity_type="exam",
                    related_entity_id=exam.id,
                    dedupe_hours=24,
                )
                if note:
                    created_count += 1
            elif is_available_now:
                note = NotificationService.notify_user_once(
                    user.id,
                    f"{exam.exam_name} is available now. Open My Exams when you are ready to begin or resume.",
                    notification_type="exam_available",
                    related_entity_type="exam",
                    related_entity_id=exam.id,
                    dedupe_hours=8,
                )
                if note:
                    created_count += 1

        return created_count

    @staticmethod
    def _teacher_review_reminders(user):
        from app.models.exam_model import ExamSet
        from app.models.result_model import Result
        from app.models.submission_model import StudentSession

        exams = ExamSet.query.filter_by(created_by=user.id).all()
        if not exams:
            return 0

        exam_map = {exam.id: exam for exam in exams}
        pending_rows = (
            db.session.query(StudentSession.exam_set_id, db.func.count(StudentSession.id))
            .outerjoin(Result, Result.session_id == StudentSession.id)
            .filter(
                StudentSession.exam_set_id.in_(list(exam_map.keys())),
                StudentSession.status.in_(["submitted", "auto_submitted", "terminated", "evaluated"]),
                Result.id.is_(None),
            )
            .group_by(StudentSession.exam_set_id)
            .all()
        )

        created_count = 0
        for exam_id, pending_count in pending_rows:
            exam = exam_map.get(exam_id)
            if not exam or not pending_count:
                continue
            note = NotificationService.notify_user_once(
                user.id,
                f"{pending_count} submission{'s' if pending_count != 1 else ''} {'are' if pending_count != 1 else 'is'} waiting for review in {exam.exam_name}.",
                notification_type="pending_review_digest",
                related_entity_type="exam",
                related_entity_id=exam.id,
                dedupe_hours=12,
            )
            if note:
                created_count += 1
        return created_count

    @staticmethod
    def _admin_registration_reminders(user):
        from app.models.registration_request_model import RegistrationRequest

        pending_count = RegistrationRequest.query.filter_by(status="new").count()
        if not pending_count:
            return 0

        note = NotificationService.notify_user_once(
            user.id,
            f"{pending_count} registration request{'s' if pending_count != 1 else ''} need admin review.",
            notification_type="admin_pending_requests",
            related_entity_type="registration_queue",
            related_entity_id=None,
            dedupe_hours=12,
        )
        return 1 if note else 0

    @staticmethod
    def _format_exam_time(value):
        if not value:
            return "now"
        return value.strftime("%d %b, %I:%M %p")

    @staticmethod
    def _preferences_for_user(user):
        defaults = {
            "exam_reminders": True,
            "review_reminders": True,
            "registration_reminders": True,
            "reminder_lead_minutes": 30,
        }
        raw_preferences = getattr(user, "account_preferences", None)
        if not raw_preferences:
            return defaults
        try:
            loaded = json.loads(raw_preferences)
        except (TypeError, ValueError):
            return defaults
        if not isinstance(loaded, dict):
            return defaults
        return {
            **defaults,
            "exam_reminders": bool(loaded.get("exam_reminders", defaults["exam_reminders"])),
            "review_reminders": bool(loaded.get("review_reminders", defaults["review_reminders"])),
            "registration_reminders": bool(loaded.get("registration_reminders", defaults["registration_reminders"])),
            "reminder_lead_minutes": NotificationService._normalize_lead_minutes(
                loaded.get("reminder_lead_minutes", defaults["reminder_lead_minutes"])
            ),
        }

    @staticmethod
    def _normalize_lead_minutes(value):
        try:
            minutes = int(value)
        except (TypeError, ValueError):
            minutes = 30
        return min(max(minutes, 10), 1440)
