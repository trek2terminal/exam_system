import os
from time import monotonic
from flask import Flask, send_from_directory, session
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.utils import safe_join
from config import DevelopmentConfig, ProductionConfig

# Import extensions
from app.models.database import db, init_db
from app.utils.logger import setup_logging


def create_app(config_class=None):
    """Application factory"""
    app_dir = os.path.abspath(os.path.dirname(__file__))
    project_root = os.path.abspath(os.path.join(app_dir, ".."))

    template_dir = os.path.join(app_dir, "templates")
    static_dir = os.path.join(app_dir, "static")

    app = Flask(
        __name__,
        template_folder=template_dir,
        static_folder=static_dir,
        static_url_path="/static",
    )

    # ====================== CONFIG ======================
    if config_class is None:
        app_env = os.environ.get("APP_ENV", os.environ.get("FLASK_ENV", "development")).lower()
        config_class = ProductionConfig if app_env == "production" else DevelopmentConfig

    app.config.from_object(config_class)

    if app.config.get("TRUST_PROXY_HEADERS"):
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)

    # Database Path
    if not app.config.get("SQLALCHEMY_DATABASE_URI"):
        if config_class is ProductionConfig:
            raise ValueError("DATABASE_URL is required when APP_ENV=production.")
        instance_path = os.path.join(project_root, "instance")
        os.makedirs(instance_path, exist_ok=True)
        db_path = os.path.join(instance_path, "database.db")
        app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path}"

    # Create directories
    for folder in ["UPLOAD_FOLDER", "BACKUP_FOLDER", "LOG_FOLDER", "SCREENSHOT_FOLDER"]:
        path = app.config.get(folder)
        if path:
            os.makedirs(path, exist_ok=True)

    # ====================== INITIALIZE EXTENSIONS ======================
    setup_logging(app)

    if app.config.get("SESSION_TYPE") == "redis":
        try:
            from flask_session import Session
            from app.utils.redis_store import get_redis_client

            redis_client = get_redis_client(app.config.get("SESSION_REDIS_URL"))
            if not redis_client:
                raise RuntimeError("SESSION_TYPE=redis requires SESSION_REDIS_URL or REDIS_URL.")
            app.config["SESSION_REDIS"] = redis_client
            Session(app)
            app.logger.info("Redis-backed server-side sessions enabled.")
        except Exception:
            app.logger.exception("Redis session setup failed; signed cookie sessions remain active.")

    # ====================== DATABASE ======================
    init_db(app)

    # ====================== BLUEPRINTS ======================
    from app.routes.auth_routes import auth_bp
    from app.routes.admin_routes import admin_bp
    from app.routes.teacher_routes import teacher_bp
    from app.routes.student_routes import student_bp
    from app.routes.api_routes import api_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(teacher_bp)
    app.register_blueprint(student_bp)
    app.register_blueprint(api_bp)

    # Serve the React migration shell when a production build exists.
    frontend_dist = os.path.join(project_root, "frontend", "dist")
    frontend_index = os.path.join(frontend_dist, "index.html")
    if os.path.isfile(frontend_index):
        @app.route("/react")
        @app.route("/react/")
        @app.route("/react/<path:path>")
        def react_frontend(path=""):
            if path:
                requested_path = safe_join(frontend_dist, path)
                if requested_path and os.path.isfile(requested_path):
                    return send_from_directory(frontend_dist, path)
            return send_from_directory(frontend_dist, "index.html")

    try:
        from app.socketio.realtime_events import init_socketio

        realtime = init_socketio(app)
        app.config["REALTIME_ENABLED"] = bool(realtime)
    except Exception:
        app.config["REALTIME_ENABLED"] = False
        app.logger.exception("Realtime layer could not be initialized; polling fallback remains active.")

    app.config["_LAST_EXPIRED_EXAM_SWEEP"] = 0

    @app.before_request
    def auto_submit_expired_exam_windows():
        sweep_interval = app.config.get("EXPIRED_EXAM_SWEEP_SECONDS", 30)
        now = monotonic()
        if now - app.config.get("_LAST_EXPIRED_EXAM_SWEEP", 0) < sweep_interval:
            return None

        app.config["_LAST_EXPIRED_EXAM_SWEEP"] = now
        try:
            from app.services.exam_service import ExamService

            submitted_count = ExamService.auto_submit_expired_sessions()
            if submitted_count:
                app.logger.info("Auto-submitted %s expired exam session(s).", submitted_count)
        except Exception:
            app.logger.exception("Expired exam auto-submit sweep failed.")
        return None

    @app.context_processor
    def inject_platform_settings():
        try:
            from app.services.settings_service import SettingsService

            settings = SettingsService.get_settings()
        except Exception:
            settings = None
        try:
            from flask import session
            from app.services.notification_service import NotificationService

            user_id = session.get("user_id")
            notification_unread_count = NotificationService.unread_count_for_user(user_id)
            recent_notifications = NotificationService.unread_for_user(user_id, limit=6)
        except Exception:
            notification_unread_count = 0
            recent_notifications = []
        return {
            "platform_settings": settings,
            "notification_unread_count": notification_unread_count,
            "recent_notifications": recent_notifications,
        }

    # Security Headers
    @app.after_request
    def add_security_headers(response):
        if session.get("role") or session.get("user_id"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        if app.config.get("SECURITY_HEADERS", True):
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["X-Frame-Options"] = "DENY"
            response.headers["X-XSS-Protection"] = "1; mode=block"
            response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
            response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; "
                "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; "
                "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; "
                "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com data:; "
                "img-src 'self' data:; "
                "connect-src 'self' ws: wss:; "
                "worker-src 'self' blob: data:; "
                "frame-ancestors 'none'; "
                "base-uri 'self'; "
                "form-action 'self'"
            )
        return response

    app.logger.info("✅ Exam System started successfully!")
    return app
