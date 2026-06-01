from flask import request


def get_client_ip():
    """Return the client IP after Flask/Werkzeug proxy handling."""
    return request.remote_addr or "unknown"


def get_user_agent():
    return request.headers.get('User-Agent', 'Unknown')


def log_security_event(event_type: str, user_id=None, session_code=None, details=None):
    """Log security related events"""
    from app.utils.logger import setup_logging
    # This will be called from services/routes
    current_app = request.application if hasattr(request, 'application') else None
    if current_app:
        current_app.logger.warning(f"SECURITY | {event_type} | User:{user_id} | Session:{session_code} | Details:{details}")
