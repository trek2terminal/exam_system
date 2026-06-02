import os
import unittest
from types import SimpleNamespace

from flask import Flask, session

os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("EXPIRED_EXAM_SWEEP_BACKGROUND", "false")

from app.routes.api_routes import (  # noqa: E402
    _pending_manual_mark_count,
    _settings_payload,
    _valid_student_password as api_valid_student_password,
    require_csrf_for_mutating_api_requests,
)
from app.routes.auth_routes import _valid_student_password as form_valid_student_password  # noqa: E402
from app.models.database import db  # noqa: E402
from app.models.exam_model import ExamSet, Question  # noqa: E402
from app.models.result_model import QuestionMark  # noqa: E402
from app.models.submission_model import Answer, StudentSession  # noqa: E402
from app.models.user_model import User  # noqa: E402
from app.services.code_execution_service import CodeExecutionService  # noqa: E402
from app.services.result_service import ResultService  # noqa: E402
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


class ResultServiceRegressionTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            TESTING=True,
        )
        db.init_app(self.app)
        self.ctx = self.app.app_context()
        self.ctx.push()
        db.create_all()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.ctx.pop()

    def _make_exam_session(self, questions, answers, status="submitted"):
        teacher = User(name="Teacher", username="teacher", password_hash="hash", role="teacher", is_active=True)
        db.session.add(teacher)
        db.session.flush()
        exam = ExamSet(
            exam_name="Midterm",
            set_code="SET1",
            subject="CS",
            duration_minutes=30,
            total_marks=sum(question["marks"] for question in questions),
            created_by=teacher.id,
            status="active",
        )
        db.session.add(exam)
        db.session.flush()

        question_models = []
        for index, question in enumerate(questions, start=1):
            model = Question(
                exam_set_id=exam.id,
                question_number=index,
                question_text=question["text"],
                question_type=question["type"],
                marks=question["marks"],
                correct_answer=question.get("correct_answer"),
            )
            db.session.add(model)
            question_models.append(model)
        db.session.flush()

        student_session = StudentSession(
            student_name="Student",
            roll_no="ROLL1",
            exam_set_id=exam.id,
            session_code="SESSION1",
            session_token="TOKEN1",
            status=status,
        )
        db.session.add(student_session)
        db.session.flush()

        for question, answer_text in zip(question_models, answers):
            db.session.add(
                Answer(
                    session_id=student_session.id,
                    question_id=question.id,
                    answer_text=answer_text,
                    visit_status="ANSWERED" if answer_text else "VISITED_UNANSWERED",
                )
            )
        db.session.commit()
        return student_session, question_models

    def test_auto_result_keeps_answered_manual_questions_pending(self):
        student_session, questions = self._make_exam_session(
            [
                {"text": "Pick A", "type": "mcq", "marks": 2, "correct_answer": "A"},
                {"text": "Explain", "type": "long", "marks": 5},
            ],
            ["A", "Detailed answer"],
        )

        result = ResultService.calculate_result(student_session.session_code)
        db.session.refresh(student_session)

        marks = QuestionMark.query.filter_by(result_id=result.id).all()
        marks_by_question = {mark.question_id: mark for mark in marks}
        answers_by_question = {answer.question_id: answer for answer in student_session.answers}

        self.assertEqual(student_session.status, "submitted")
        self.assertEqual(result.total_marks_obtained, 2)
        self.assertEqual(len(marks), 1)
        self.assertIn(questions[0].id, marks_by_question)
        self.assertEqual(_pending_manual_mark_count(questions, answers_by_question, marks_by_question), 1)

    def test_auto_result_evaluates_fully_auto_gradable_session(self):
        student_session, _questions = self._make_exam_session(
            [{"text": "Pick A", "type": "mcq", "marks": 2, "correct_answer": "A"}],
            ["A"],
        )

        result = ResultService.calculate_result(student_session.session_code)
        db.session.refresh(student_session)

        self.assertEqual(student_session.status, "evaluated")
        self.assertEqual(result.total_marks_obtained, 2)
        self.assertEqual(QuestionMark.query.filter_by(result_id=result.id).count(), 1)


if __name__ == "__main__":
    unittest.main()
