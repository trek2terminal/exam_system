import json
import random
from datetime import datetime

from flask import current_app, g, has_request_context

from app.models.database import db
from app.models.settings_model import PlatformSettings


class SettingsService:
    DEFAULT_QUOTES = [
        "One question at a time is enough.",
        "Read calmly, answer clearly, and trust your preparation.",
        "A steady mind does better work than a rushed one.",
        "You do not need to be perfect. You only need to be present.",
    ]
    DEFAULT_LOGIN_PAGE_HEADING = "Exam Platform"
    DEFAULT_LOGIN_PAGE_TAGLINE = "The future of secure, intelligent assessment."
    DEFAULT_LOGIN_PAGE_SUBHEADING = "Focused, secure, and ready for every exam session."
    DEFAULT_LOGIN_PAGE_FEATURES = [
        {"icon": "Shield", "text": "Real-time proctoring and monitoring", "enabled": True},
        {"icon": "BarChart2", "text": "Multiple question types and formats", "enabled": True},
        {"icon": "Code2", "text": "Instant results and detailed analytics", "enabled": True},
        {"icon": "Layers", "text": "Code execution support with live testing", "enabled": True},
        {"icon": "UserCheck", "text": "Verified student identity checks", "enabled": False},
        {"icon": "BookOpen", "text": "Guided exam access for every learner", "enabled": False},
    ]
    DEFAULT_SECURITY_BADGE_TEXT = "Secured by end-to-end encryption"
    FEATURE_ICON_ALLOWLIST = {"Shield", "BarChart2", "Code2", "Layers", "UserCheck", "BookOpen", "Lock", "Zap"}

    @staticmethod
    def normalize_login_features(value):
        if isinstance(value, list):
            items = value
        elif isinstance(value, str):
            try:
                parsed = json.loads(value)
                items = parsed if isinstance(parsed, list) else []
            except (TypeError, ValueError):
                items = value.splitlines()
        else:
            items = []

        features = []
        for index, item in enumerate(items):
            if isinstance(item, dict):
                text = str(item.get("text") or item.get("label") or "").strip()[:160]
                icon = str(item.get("icon") or "").strip()
                enabled = bool(item.get("enabled", True))
            else:
                text = str(item).strip()[:160]
                icon = ""
                enabled = True
            if not text:
                continue
            if icon not in SettingsService.FEATURE_ICON_ALLOWLIST:
                icon = SettingsService.DEFAULT_LOGIN_PAGE_FEATURES[
                    min(index, len(SettingsService.DEFAULT_LOGIN_PAGE_FEATURES) - 1)
                ]["icon"]
            features.append({"icon": icon, "text": text, "enabled": enabled})
        return features[:6] or list(SettingsService.DEFAULT_LOGIN_PAGE_FEATURES)

    @staticmethod
    def serialize_login_features(value):
        return json.dumps(SettingsService.normalize_login_features(value))

    @staticmethod
    def get_settings():
        if has_request_context() and hasattr(g, "_platform_settings"):
            return g._platform_settings

        settings = PlatformSettings.query.order_by(PlatformSettings.id.asc()).first()
        if settings:
            if has_request_context():
                g._platform_settings = settings
            return settings

        settings = PlatformSettings(
            platform_name="Exam System",
            welcome_message="Calm assessment space",
            announcement_message="",
            login_page_heading=SettingsService.DEFAULT_LOGIN_PAGE_HEADING,
            login_page_tagline=SettingsService.DEFAULT_LOGIN_PAGE_TAGLINE,
            login_page_subheading=SettingsService.DEFAULT_LOGIN_PAGE_SUBHEADING,
            login_page_features=SettingsService.serialize_login_features(SettingsService.DEFAULT_LOGIN_PAGE_FEATURES),
            login_page_security_badge_text=SettingsService.DEFAULT_SECURITY_BADGE_TEXT,
            login_page_security_badge_enabled=True,
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
        if has_request_context():
            g._platform_settings = settings
        return settings

    @staticmethod
    def update_settings(data, updated_by=None):
        settings = SettingsService.get_settings()

        platform_name = (data.get("platform_name") or "Exam System").strip()
        welcome_message = (data.get("welcome_message") or "Calm assessment space").strip()
        announcement_message = (data.get("announcement_message") or "").strip()
        login_page_heading = (data.get("login_page_heading") or SettingsService.DEFAULT_LOGIN_PAGE_HEADING).strip()
        login_page_tagline = (data.get("login_page_tagline") or SettingsService.DEFAULT_LOGIN_PAGE_TAGLINE).strip()
        login_page_subheading = (
            data.get("login_page_subheading") or SettingsService.DEFAULT_LOGIN_PAGE_SUBHEADING
        ).strip()
        login_page_security_badge_text = (
            data.get("login_page_security_badge_text") or SettingsService.DEFAULT_SECURITY_BADGE_TEXT
        ).strip()
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
        if "login_page_heading" in data:
            settings.login_page_heading = login_page_heading[:240]
        elif not getattr(settings, "login_page_heading", None):
            settings.login_page_heading = SettingsService.DEFAULT_LOGIN_PAGE_HEADING
        if "login_page_tagline" in data:
            settings.login_page_tagline = login_page_tagline[:240]
        elif not getattr(settings, "login_page_tagline", None):
            settings.login_page_tagline = SettingsService.DEFAULT_LOGIN_PAGE_TAGLINE
        if "login_page_subheading" in data:
            settings.login_page_subheading = login_page_subheading[:360]
        elif not getattr(settings, "login_page_subheading", None):
            settings.login_page_subheading = SettingsService.DEFAULT_LOGIN_PAGE_SUBHEADING
        if "login_page_features" in data:
            settings.login_page_features = SettingsService.serialize_login_features(data.get("login_page_features"))
        elif not getattr(settings, "login_page_features", None):
            settings.login_page_features = SettingsService.serialize_login_features(SettingsService.DEFAULT_LOGIN_PAGE_FEATURES)
        if "login_page_security_badge_text" in data:
            settings.login_page_security_badge_text = login_page_security_badge_text[:160]
        elif not getattr(settings, "login_page_security_badge_text", None):
            settings.login_page_security_badge_text = SettingsService.DEFAULT_SECURITY_BADGE_TEXT
        if "login_page_security_badge_enabled" in data:
            settings.login_page_security_badge_enabled = data.get("login_page_security_badge_enabled") == "on"
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
        if has_request_context():
            g._platform_settings = settings
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
