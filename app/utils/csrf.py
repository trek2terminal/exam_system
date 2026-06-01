import secrets

from flask import session


CSRF_HEADER = "X-CSRF-Token"
CSRF_SESSION_KEY = "_csrf_token"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def get_csrf_token():
    token = session.get(CSRF_SESSION_KEY)
    if not token:
        token = secrets.token_urlsafe(32)
        session[CSRF_SESSION_KEY] = token
        session.modified = True
    return token


def csrf_token_matches(submitted_token):
    expected_token = session.get(CSRF_SESSION_KEY)
    return bool(
        expected_token
        and submitted_token
        and secrets.compare_digest(str(expected_token), str(submitted_token))
    )
