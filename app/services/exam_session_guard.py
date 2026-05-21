import secrets

from flask import request, session as browser_session

from app.models.database import db


LOCKED_SESSION_STATUSES = {"submitted", "evaluated", "terminated", "auto_submitted"}
MUTABLE_SESSION_STATUS = "active"


class ExamSessionGuard:
    """Browser/session ownership checks for student exam attempts."""

    @staticmethod
    def is_locked(student_session):
        return student_session.status in LOCKED_SESSION_STATUSES

    @staticmethod
    def ensure_token(student_session):
        if not student_session.session_token:
            student_session.session_token = secrets.token_urlsafe(32)
            db.session.commit()
        return student_session.session_token

    @staticmethod
    def remember_browser_attempt(student_session):
        token = ExamSessionGuard.ensure_token(student_session)
        tokens = dict(browser_session.get("exam_attempt_tokens") or {})
        tokens[student_session.session_code] = token
        browser_session["exam_attempt_tokens"] = tokens
        browser_session["student_session_code"] = student_session.session_code
        browser_session["student_session_token"] = token
        browser_session.modified = True
        return token

    @staticmethod
    def browser_token_for(session_code):
        tokens = browser_session.get("exam_attempt_tokens") or {}
        return tokens.get(session_code) or browser_session.get("student_session_token")

    @staticmethod
    def browser_owns_attempt(student_session):
        if browser_session.get("student_session_code") != student_session.session_code:
            return False

        expected_token = ExamSessionGuard.ensure_token(student_session)
        stored_token = ExamSessionGuard.browser_token_for(student_session.session_code)
        if not stored_token:
            stored_token = ExamSessionGuard.remember_browser_attempt(student_session)

        return stored_token == expected_token

    @staticmethod
    def request_token(payload=None):
        payload = payload or {}
        return (
            request.headers.get("X-Exam-Token")
            or payload.get("session_token")
            or request.form.get("session_token")
        )

    @staticmethod
    def request_owns_attempt(student_session, payload=None):
        submitted_token = ExamSessionGuard.request_token(payload)
        return (
            bool(submitted_token)
            and submitted_token == ExamSessionGuard.ensure_token(student_session)
            and ExamSessionGuard.browser_owns_attempt(student_session)
        )
