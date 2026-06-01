import os
import unittest
from types import SimpleNamespace

from flask import Flask, session

os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("EXPIRED_EXAM_SWEEP_BACKGROUND", "false")

from app.routes.api_routes import (  # noqa: E402
    _settings_payload,
    _valid_student_password as api_valid_student_password,
    require_csrf_for_mutating_api_requests,
)
from app.routes.auth_routes import _valid_student_password as form_valid_student_password  # noqa: E402
from app.services.code_execution_service import CodeExecutionService  # noqa: E402
from app.utils.csrf import CSRF_HEADER, CSRF_SESSION_KEY, csrf_token_matches, get_csrf_token  # noqa: E402
from app.utils.network import get_client_ip  # noqa: E402


def make_settings(**overrides):
    values = {
        "platform_name": "Exam System",
        "welcome_message": "Welcome",
        "announcement_message": "",
        "login_page_heading": "Exam Platform",
        "login_page_tagline": "Focused exams",
        "login_page_subheading": "Stay calm",
        "login_page_features": "",
        "login_page_security_badge_text": "Secure",
        "login_page_security_badge_enabled": True,
        "login_form_content": None,
        "registration_page_content": None,
        "student_self_registration": True,
        "registration_code_required": True,
        "registration_code": "PRIVATE-CODE",
        "max_violations_before_alert": 3,
        "admin_lockout_count": 3,
        "admin_idle_timeout_minutes": 120,
        "quote_pool": "One question at a time.",
        "logo_path": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class SecurityRegressionTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.secret_key = "test-secret"

    def test_public_settings_payload_hides_registration_code(self):
        with self.app.test_request_context("/"):
            payload = _settings_payload(make_settings())

        self.assertTrue(payload["registration_code_required"])
        self.assertNotIn("registration_code", payload)

    def test_private_settings_payload_includes_registration_code(self):
        with self.app.test_request_context("/"):
            payload = _settings_payload(make_settings(), include_private=True)

        self.assertEqual(payload["registration_code"], "PRIVATE-CODE")

    def test_student_password_policy_requires_lowercase_in_all_entrypoints(self):
        self.assertFalse(api_valid_student_password("PASSWORD1!"))
        self.assertFalse(form_valid_student_password("PASSWORD1!"))
        self.assertTrue(api_valid_student_password("Password1!"))
        self.assertTrue(form_valid_student_password("Password1!"))

    def test_csrf_token_must_match_session_for_mutating_api_requests(self):
        with self.app.test_request_context("/api/example", method="POST"):
            missing = require_csrf_for_mutating_api_requests()
            self.assertEqual(missing[1], 403)

        with self.app.test_request_context(
            "/api/example",
            method="POST",
            headers={CSRF_HEADER: "known-token"},
        ):
            session[CSRF_SESSION_KEY] = "known-token"
            self.assertIsNone(require_csrf_for_mutating_api_requests())
            self.assertTrue(csrf_token_matches("known-token"))
            self.assertFalse(csrf_token_matches("wrong-token"))

    def test_csrf_token_is_created_in_session(self):
        with self.app.test_request_context("/"):
            token = get_csrf_token()
            self.assertEqual(token, session[CSRF_SESSION_KEY])
            self.assertTrue(csrf_token_matches(token))

    def test_client_ip_ignores_spoofed_forwarded_for_without_proxyfix(self):
        app = Flask(__name__)

        @app.route("/ip")
        def ip():
            return get_client_ip()

        response = app.test_client().get(
            "/ip",
            headers={"X-Forwarded-For": "1.2.3.4"},
            environ_base={"REMOTE_ADDR": "9.9.9.9"},
        )

        self.assertEqual(response.get_data(as_text=True), "9.9.9.9")

    def test_production_subprocess_code_execution_is_blocked_without_opt_in(self):
        result = CodeExecutionService.run_python(
            "print('hello')",
            execution_mode="subprocess",
            allow_unsafe_subprocess=False,
        )

        self.assertFalse(result.ok)
        self.assertEqual(result.status, "error")
        self.assertIn("sandbox is not available", result.message)


if __name__ == "__main__":
    unittest.main()
