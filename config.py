import os
from datetime import timedelta

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
APP_ENV = os.environ.get("APP_ENV", os.environ.get("FLASK_ENV", "development")).lower()
DATABASE_URL = os.environ.get("DATABASE_URL")


class Config:
    # ====================== SECURITY ======================
    SECRET_KEY = os.environ.get("SECRET_KEY")
    if not SECRET_KEY:
        raise ValueError("No SECRET_KEY found. Please create a .env file in the project root.")

    # Database
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # Session Security
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    PERMANENT_SESSION_LIFETIME = timedelta(minutes=45)

    # Automatically set secure cookie based on environment
    SESSION_COOKIE_SECURE = APP_ENV == "production"

    # File Upload Limits
    MAX_CONTENT_LENGTH = 25 * 1024 * 1024  # 25MB

    # Folders
    UPLOAD_FOLDER = os.path.join(BASE_DIR, "app", "static", "uploads")
    BACKUP_FOLDER = os.path.join(BASE_DIR, "data", "backups")
    LOG_FOLDER = os.path.join(BASE_DIR, "logs")
    SCREENSHOT_FOLDER = os.path.join(BASE_DIR, "app", "static", "screenshots")

    # Exam Configuration
    EXAM_HEARTBEAT_INTERVAL = 8
    EXAM_WINDOW_LOCK_TTL_SECONDS = 30
    EXPIRED_EXAM_SWEEP_SECONDS = 30
    MAX_VIOLATIONS_ALLOWED = 3
    AUTO_SUBMIT_ON_VIOLATION = False

    CODE_EXECUTION_TIMEOUT_SECONDS = int(os.environ.get("CODE_EXECUTION_TIMEOUT_SECONDS", "10"))
    CODE_EXECUTION_MAX_CHARS = int(os.environ.get("CODE_EXECUTION_MAX_CHARS", "12000"))
    CODE_EXECUTION_OUTPUT_MAX_CHARS = int(os.environ.get("CODE_EXECUTION_OUTPUT_MAX_CHARS", "8000"))

    # Local-first in-memory rate limits. For hosted multi-process deployment,
    # move these buckets to Redis or a reverse proxy limiter.
    RATE_LIMITS = {
        "auth_login": {"limit": 10, "window": 15 * 60},
        "student_login": {"limit": 30, "window": 15 * 60},
        "autosave": {"limit": 90, "window": 60},
        "heartbeat": {"limit": 30, "window": 60},
        "violation": {"limit": 30, "window": 60},
        "submit": {"limit": 10, "window": 60},
        "code_execution": {"limit": 5, "window": 60},
        "admin_action": {"limit": 40, "window": 60},
    }

    # Security
    SECURITY_HEADERS = True


class DevelopmentConfig(Config):
    DEBUG = True
    SESSION_COOKIE_SECURE = False
    SQLALCHEMY_ECHO = False


class ProductionConfig(Config):
    DEBUG = False
    SESSION_COOKIE_SECURE = True
    SQLALCHEMY_DATABASE_URI = DATABASE_URL
