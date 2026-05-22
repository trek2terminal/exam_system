import secrets
import os
from functools import wraps
from io import BytesIO
from datetime import datetime
from flask import session, redirect, url_for, flash, current_app

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfgen import canvas

from app.models.exam_model import Question
from app.models.submission_model import Answer
from app.models.result_model import Result
from app.services.exam_service import ExamService


def _active_user(user_id, expected_role):
    if not user_id:
        return None

    from app.models.user_model import User

    user = User.query.get(user_id)
    if not user or user.role != expected_role or not user.is_active:
        return None
    return user


def current_session_matches_user(user):
    """Return True only when this browser holds the user's latest login token."""
    if not user:
        return False

    session_token = session.get("auth_session_token")
    active_token = getattr(user, "active_session_token", None)
    if not session_token or not active_token:
        return False

    return secrets.compare_digest(str(session_token), str(active_token))


def _stale_login_redirect(login_endpoint, message):
    session.clear()
    flash(message, "warning")
    return redirect(url_for(login_endpoint))


def teacher_required(view):
    """Decorator to protect teacher-only routes"""

    @wraps(view)
    def wrapper(*args, **kwargs):
        if not session.get("teacher_id"):
            flash("Please log in as teacher to access this page.", "danger")
            return redirect(url_for("auth.teacher_login"))
        if session.get("role") != "teacher":
            flash("Unauthorized access.", "danger")
            return redirect(url_for("auth.teacher_login"))
        teacher = _active_user(session.get("teacher_id"), "teacher")
        if not teacher:
            session.clear()
            flash("Your teacher account is no longer active. Please contact the administrator.", "danger")
            return redirect(url_for("auth.teacher_login"))
        if not current_session_matches_user(teacher):
            return _stale_login_redirect(
                "auth.teacher_login",
                "This teacher account is active in another browser. Please log in again here.",
            )
        if getattr(teacher, "must_change_password", False) and view.__name__ != "teacher_change_password":
            flash("Please change your temporary password first.", "warning")
            return redirect(url_for("auth.teacher_change_password"))
        return view(*args, **kwargs)

    return wrapper


def admin_required(view):
    """Decorator to protect admin-only routes"""

    @wraps(view)
    def wrapper(*args, **kwargs):
        if not session.get("admin_id"):
            flash("Please log in as admin to access this page.", "danger")
            return redirect(url_for("auth.admin_login"))
        if session.get("role") != "admin":
            flash("Unauthorized access. Admin privileges required.", "danger")
            return redirect(url_for("auth.admin_login"))
        admin = _active_user(session.get("admin_id"), "admin")
        if not admin:
            session.clear()
            flash("Your admin session is no longer active. Please log in again.", "danger")
            return redirect(url_for("auth.admin_login"))
        if not current_session_matches_user(admin):
            return _stale_login_redirect(
                "auth.admin_login",
                "This admin account is active in another browser. Please log in again here.",
            )
        idle_timeout = int(current_app.config.get("ADMIN_IDLE_TIMEOUT_SECONDS", 2 * 60 * 60))
        last_activity = session.get("admin_last_activity")
        if last_activity:
            try:
                elapsed = (datetime.utcnow() - datetime.fromisoformat(last_activity)).total_seconds()
            except ValueError:
                elapsed = 0
            if elapsed > idle_timeout:
                session.clear()
                flash("Your admin session expired due to inactivity. Please log in again.", "warning")
                return redirect(url_for("auth.admin_login"))
        session["admin_last_activity"] = datetime.utcnow().isoformat()
        session.modified = True
        return view(*args, **kwargs)

    return wrapper


def student_required(view):
    """Decorator to protect student-only routes"""

    @wraps(view)
    def wrapper(*args, **kwargs):
        if not session.get("student_id"):
            flash("Please log in as student to access this page.", "danger")
            return redirect(url_for("auth.student_login"))
        if session.get("role") != "student":
            flash("Unauthorized access.", "danger")
            return redirect(url_for("auth.student_login"))
        student_user_id = session.get("student_user_id")
        if student_user_id:
            student = _active_user(student_user_id, "student")
            if not student:
                session.clear()
                flash("Your student account is no longer active. Please contact the administrator.", "danger")
                return redirect(url_for("auth.student_login"))
            if not current_session_matches_user(student):
                return _stale_login_redirect(
                    "auth.student_login",
                    "This student account is active in another browser. Please log in again here.",
                )
        return view(*args, **kwargs)

    return wrapper


def any_auth_required(view):
    """Decorator for routes that require any authentication"""

    @wraps(view)
    def wrapper(*args, **kwargs):
        if not session.get("user_id"):
            flash("Please log in to access this page.", "danger")
            return redirect(url_for("auth.admin_login"))
        from app.models.user_model import User

        user = User.query.get(session.get("user_id"))
        if not current_session_matches_user(user):
            return _stale_login_redirect(
                "auth.login_selector",
                "This account is active in another browser. Please log in again here.",
            )
        return view(*args, **kwargs)

    return wrapper


def generate_access_code():
    """Generate secure exam access code"""
    return secrets.token_urlsafe(8).replace("-", "").replace("_", "").upper()[:10]


def generate_session_code():
    """Generate unique student session code"""
    return secrets.token_urlsafe(20).replace("-", "").replace("_", "").upper()[:16]


def parse_options(raw_value):
    """Parse options from string or list"""
    if not raw_value:
        return []
    if isinstance(raw_value, list):
        return [x.strip() for x in raw_value if x and x.strip()]
    if isinstance(raw_value, str):
        # Support both comma and pipe separator
        separator = "|" if "|" in raw_value else ","
        return [part.strip() for part in raw_value.split(separator) if part.strip()]
    return []


def get_remaining_seconds(exam_set, start_time=None, extra_minutes=0):
    """Calculate remaining exam time in seconds"""
    if not exam_set:
        return 0

    reference_time = start_time or exam_set.activated_at
    if not reference_time:
        duration_remaining = (exam_set.duration_minutes + int(extra_minutes or 0)) * 60
    else:
        elapsed = (datetime.utcnow() - reference_time).total_seconds()
        duration_remaining = max(((exam_set.duration_minutes + int(extra_minutes or 0)) * 60) - int(elapsed), 0)

    if getattr(exam_set, "end_time", None):
        window_remaining = max(int((exam_set.end_time - datetime.utcnow()).total_seconds()), 0)
        return min(duration_remaining, window_remaining)

    return duration_remaining


def draw_wrapped_text(pdf, text, x, y, width, font_name="Helvetica", font_size=10, leading=13):
    """Draw wrapped text with page break support"""
    if not text:
        return y

    lines = simpleSplit(str(text), font_name, font_size, width)
    pdf.setFont(font_name, font_size)

    for line in lines:
        if y < 30 * mm:  # Leave margin at bottom
            pdf.showPage()
            y = A4[1] - 20 * mm
            pdf.setFont(font_name, font_size)

        pdf.drawString(x, y, line)
        y -= leading
    return y


def create_submission_pdf(student_session, include_unpublished_feedback=False):
    """Generate detailed PDF report of student submission"""
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    page_width, page_height = A4
    left = 18 * mm
    right_width = page_width - (2 * left)
    y = page_height - 20 * mm

    exam = student_session.exam_set
    questions = ExamService.get_session_questions(student_session)
    answers = Answer.query.filter_by(session_id=student_session.id).all()
    answers_map = {a.question_id: a.answer_text for a in answers}
    code_output_map = {a.question_id: a.code_output for a in answers if getattr(a, "code_output", None)}

    result = Result.query.filter_by(session_id=student_session.id).first()
    result_visible = bool(result and (result.published or include_unpublished_feedback))
    marks_map = {}
    remarks_map = {}
    if result_visible:
        for qm in result.question_marks:
            marks_map[qm.question_id] = qm.marks_awarded
            remarks_map[qm.question_id] = qm.teacher_remark or ""

    def heading(text, size=16):
        nonlocal y
        pdf.setFont("Helvetica-Bold", size)
        pdf.drawString(left, y, text)
        y -= 10 * mm

    def ensure_pdf_space(required_height):
        nonlocal y
        if y - required_height < 30 * mm:
            pdf.showPage()
            y = page_height - 20 * mm

    def draw_question_images(question):
        nonlocal y
        image_paths = question.image_paths_as_list() if hasattr(question, "image_paths_as_list") else []
        if not image_paths:
            return

        static_root = current_app.static_folder
        for image_path in image_paths:
            disk_path = os.path.join(static_root, image_path.replace("/", os.sep))
            if not os.path.exists(disk_path):
                y = draw_wrapped_text(pdf, f"[Question image missing: {image_path}]", left, y, right_width, font_size=9)
                y -= 2 * mm
                continue

            try:
                image = ImageReader(disk_path)
                image_width, image_height = image.getSize()
                draw_width = min(right_width, 115 * mm)
                draw_height = draw_width * (image_height / image_width)
                if draw_height > 75 * mm:
                    draw_height = 75 * mm
                    draw_width = draw_height * (image_width / image_height)

                ensure_pdf_space(draw_height + 8 * mm)
                pdf.drawImage(image, left, y - draw_height, width=draw_width, height=draw_height, preserveAspectRatio=True, mask="auto")
                y -= draw_height + 5 * mm
            except Exception:
                y = draw_wrapped_text(pdf, f"[Question image could not be rendered: {image_path}]", left, y, right_width, font_size=9)
                y -= 2 * mm

    # Header
    heading("Exam Submission Report", 18)
    pdf.setFont("Helvetica", 11)
    pdf.drawString(left, y, f"Student: {student_session.student_name} | Roll No: {student_session.roll_no}")
    y -= 6 * mm
    pdf.drawString(left, y, f"Exam: {exam.exam_name} | Subject: {exam.subject}")
    y -= 6 * mm
    pdf.drawString(left, y, f"Access Code: {exam.access_code} | Date: {datetime.utcnow().strftime('%d %b %Y %H:%M')}")
    y -= 12 * mm
    if result_visible:
        pdf.setFont("Helvetica-Bold", 11)
        pdf.drawString(
            left,
            y,
            f"Result: {result.total_marks_obtained} / {result.total_marks} ({result.percentage}%)",
        )
        y -= 7 * mm
        if result.teacher_remarks:
            pdf.setFont("Helvetica-Bold", 10)
            pdf.drawString(left, y, "Overall Teacher Remark:")
            y -= 5 * mm
            y = draw_wrapped_text(pdf, result.teacher_remarks, left, y, right_width, font_size=10, leading=13)
            y -= 4 * mm

    # Questions & Answers
    for q in questions:
        if y < 50 * mm:
            pdf.showPage()
            y = page_height - 20 * mm

        pdf.setFont("Helvetica-Bold", 11)
        pdf.drawString(left, y, f"Q{q.question_number}. ({q.marks} marks) - {q.question_type.upper()}")
        y -= 6 * mm

        y = draw_wrapped_text(pdf, q.question_text, left, y, right_width, font_size=10, leading=14)
        y -= 4 * mm

        draw_question_images(q)

        if getattr(q, "code_snippet", None):
            pdf.setFont("Helvetica-Bold", 10)
            pdf.drawString(left, y, "Question Code Snippet:")
            y -= 5 * mm
            y = draw_wrapped_text(pdf, q.code_snippet, left, y, right_width, font_name="Courier", font_size=8.5, leading=11)
            y -= 3 * mm

        pdf.setFont("Helvetica-Bold", 10)
        pdf.drawString(left, y, "Student Answer:")
        y -= 5 * mm

        answer_text = answers_map.get(q.id, "[No answer submitted]")
        y = draw_wrapped_text(pdf, answer_text, left, y, right_width, font_size=10, leading=13)

        if result_visible and getattr(q, "model_answer", None):
            pdf.setFont("Helvetica-Bold", 10)
            y -= 3 * mm
            pdf.drawString(left, y, "Model Answer:")
            y -= 5 * mm
            y = draw_wrapped_text(pdf, q.model_answer, left, y, right_width, font_size=10, leading=13)

        if q.question_type == "coding" and code_output_map.get(q.id):
            pdf.setFont("Helvetica-Bold", 10)
            y -= 3 * mm
            pdf.drawString(left, y, "Last Code Output:")
            y -= 5 * mm
            y = draw_wrapped_text(pdf, code_output_map[q.id], left, y, right_width, font_size=9, leading=12)

        # Show marks if evaluated
        if result_visible:
            awarded = marks_map.get(q.id, 0)
            pdf.setFont("Helvetica-Bold", 10)
            y -= 3 * mm
            pdf.drawString(left, y, f"Marks Awarded: {awarded} / {q.marks}")
            y -= 5 * mm

            remark = remarks_map.get(q.id, "")
            if remark:
                pdf.setFont("Helvetica", 10)
                y = draw_wrapped_text(pdf, f"Teacher Remark: {remark}", left, y, right_width, font_size=10)

        y -= 8 * mm

    pdf.showPage()
    pdf.save()
    buffer.seek(0)
    return buffer
