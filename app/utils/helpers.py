import secrets
from functools import wraps
from io import BytesIO
from datetime import datetime
from flask import session, redirect, url_for, flash, current_app

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen import canvas

from app.models.exam_model import Question
from app.models.submission_model import Answer
from app.models.result_model import Result


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


def get_remaining_seconds(exam_set, start_time=None):
    """Calculate remaining exam time in seconds"""
    if not exam_set:
        return 0

    reference_time = start_time or exam_set.activated_at
    if not reference_time:
        return exam_set.duration_minutes * 60

    elapsed = (datetime.utcnow() - reference_time).total_seconds()
    return max((exam_set.duration_minutes * 60) - int(elapsed), 0)


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


def create_submission_pdf(student_session):
    """Generate detailed PDF report of student submission"""
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    page_width, page_height = A4
    left = 18 * mm
    right_width = page_width - (2 * left)
    y = page_height - 20 * mm

    exam = student_session.exam_set
    questions = Question.query.filter_by(exam_set_id=exam.id) \
        .order_by(Question.question_number.asc()).all()
    answers = Answer.query.filter_by(session_id=student_session.id).all()
    answers_map = {a.question_id: a.answer_text for a in answers}

    result = Result.query.filter_by(session_id=student_session.id).first()
    marks_map = {}
    remarks_map = {}
    if result:
        for qm in result.question_marks:
            marks_map[qm.question_id] = qm.marks_awarded
            remarks_map[qm.question_id] = qm.teacher_remark or ""

    def heading(text, size=16):
        nonlocal y
        pdf.setFont("Helvetica-Bold", size)
        pdf.drawString(left, y, text)
        y -= 10 * mm

    # Header
    heading("Exam Submission Report", 18)
    pdf.setFont("Helvetica", 11)
    pdf.drawString(left, y, f"Student: {student_session.student_name} | Roll No: {student_session.roll_no}")
    y -= 6 * mm
    pdf.drawString(left, y, f"Exam: {exam.exam_name} | Subject: {exam.subject}")
    y -= 6 * mm
    pdf.drawString(left, y, f"Access Code: {exam.access_code} | Date: {datetime.utcnow().strftime('%d %b %Y %H:%M')}")
    y -= 12 * mm

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

        pdf.setFont("Helvetica-Bold", 10)
        pdf.drawString(left, y, "Student Answer:")
        y -= 5 * mm

        answer_text = answers_map.get(q.id, "[No answer submitted]")
        y = draw_wrapped_text(pdf, answer_text, left, y, right_width, font_size=10, leading=13)

        # Show marks if evaluated
        if result:
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