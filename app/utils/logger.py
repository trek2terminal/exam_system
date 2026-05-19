import logging
import os
from datetime import datetime
from logging.handlers import RotatingFileHandler

from flask import g, has_request_context, request


class RequestContextFilter(logging.Filter):
    """Inject request metadata into log records when available."""

    def filter(self, record):
        if has_request_context():
            record.remote_addr = request.headers.get("X-Forwarded-For", request.remote_addr) or "-"
            record.user_id = getattr(g, "user_id", "-")
        else:
            record.remote_addr = "-"
            record.user_id = "-"
        return True


def setup_logging(app):
    """Setup application logging with rotation"""
    log_dir = app.config.get("LOG_FOLDER", "logs")
    os.makedirs(log_dir, exist_ok=True)

    log_file = os.path.join(log_dir, "exam_system.log")

    file_handler = RotatingFileHandler(
        log_file,
        maxBytes=5_000_000,
        backupCount=10,
    )
    file_handler.setLevel(logging.INFO)
    file_handler.addFilter(RequestContextFilter())
    file_handler.setFormatter(
        logging.Formatter("%(asctime)s | %(levelname)s | %(name)s | %(message)s | IP:%(remote_addr)s | User:%(user_id)s")
    )

    # Console handler for development
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.DEBUG if app.debug else logging.INFO)
    console_handler.addFilter(RequestContextFilter())
    console_handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)s | %(message)s"))

    if not app.logger.handlers:
        app.logger.addHandler(file_handler)
        app.logger.addHandler(console_handler)

    app.logger.setLevel(logging.DEBUG if app.debug else logging.INFO)
    app.logger.info("Logging initialized at %s", datetime.utcnow())
