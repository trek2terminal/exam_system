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
        raise ValueError("❌ No SECRET_KEY found! Please create a .env file in the project root.")

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
    MAX_VIOLATIONS_ALLOWED = 3
    AUTO_SUBMIT_ON_VIOLATION = True

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
