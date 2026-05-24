import random
from datetime import datetime

from flask import current_app

from app.models.database import db
from app.models.settings_model import PlatformSettings


class SettingsService:
    DEFAULT_QUOTES = [
        "One question at a time is enough.",
        "Read calmly, answer clearly, and trust your preparation.",
        "A steady mind does better work than a rushed one.",
        "You do not need to be perfect. You only need to be present.",
    ]

    @staticmethod
    def get_settings():
        settings = PlatformSettings.query.order_by(PlatformSettings.id.asc()).first()
        if settings:
            return settings

        settings = PlatformSettings(
            platform_name="Exam System",
            welcome_message="Calm assessment space",
            announcement_message="",
            student_self_registration=False,
            registration_code_required=False,
            registration_code=None,
            max_violations_before_alert=current_app.config.get("MAX_VIOLATIONS_ALLOWED", 3),
            admin_lockout_count=3,
            admin_idle_timeout_minutes=120,
            quote_pool="\n".join(SettingsService.DEFAULT_QUOTES),
        )
        db.session.add(settings)
        db.session.commit()
        return settings

    @staticmethod
    def update_settings(data, updated_by=None):
        settings = SettingsService.get_settings()

        platform_name = (data.get("platform_name") or "Exam System").strip()
        welcome_message = (data.get("welcome_message") or "Calm assessment space").strip()
        announcement_message = (data.get("announcement_message") or "").strip()
        quote_pool = (data.get("quote_pool") or "").strip()
        registration_code = (data.get("registration_code") or "").strip()

        try:
            max_violations = int(data.get("max_violations_before_alert") or 3)
        except (TypeError, ValueError):
            max_violations = 3
        max_violations = min(max(max_violations, 1), 10)

        try:
            admin_lockout_count = int(data.get("admin_lockout_count") or 3)
        except (TypeError, ValueError):
            admin_lockout_count = 3
        admin_lockout_count = min(max(admin_lockout_count, 1), 10)

        try:
            admin_idle_timeout_minutes = int(data.get("admin_idle_timeout_minutes") or 120)
        except (TypeError, ValueError):
            admin_idle_timeout_minutes = 120
        admin_idle_timeout_minutes = min(max(admin_idle_timeout_minutes, 5), 24 * 60)

        settings.platform_name = platform_name[:120]
        settings.welcome_message = welcome_message[:255]
        settings.announcement_message = announcement_message[:600]
        settings.student_self_registration = data.get("student_self_registration") == "on"
        settings.registration_code_required = data.get("registration_code_required") == "on"
        settings.registration_code = registration_code[:80] or None
        settings.max_violations_before_alert = max_violations
        settings.admin_lockout_count = admin_lockout_count
        settings.admin_idle_timeout_minutes = admin_idle_timeout_minutes
        settings.quote_pool = quote_pool or "\n".join(SettingsService.DEFAULT_QUOTES)
        if "logo_path" in data:
            settings.logo_path = (data.get("logo_path") or "").strip() or None
        settings.updated_by = updated_by
        settings.updated_at = datetime.utcnow()

        db.session.commit()
        return settings

    @staticmethod
    def get_quotes(settings=None):
        settings = settings or SettingsService.get_settings()
        quotes = []
        for line in (settings.quote_pool or "").splitlines():
            quote = line.strip()
            if quote:
                quotes.append(quote[:240])
        return quotes or SettingsService.DEFAULT_QUOTES

    @staticmethod
    def random_quote(settings=None):
        return random.choice(SettingsService.get_quotes(settings))

    @staticmethod
    def max_violations_allowed():
        try:
            return SettingsService.get_settings().max_violations_before_alert
        except Exception:
            return current_app.config.get("MAX_VIOLATIONS_ALLOWED", 3)
