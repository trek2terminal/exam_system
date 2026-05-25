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
from reportlab.platypus import Spacer, Table, TableStyle

from app.models.exam_model import Question
from app.models.submission_model import Answer
from app.models.result_model import Result
from app.services.exam_service import ExamService
from app.services.settings_service import SettingsService
from app.utils.pdf_base import (
    BRAND_LIGHT,
    BRAND_PRIMARY,
    BORDER,
    DANGER,
    SUCCESS,
    SURFACE,
    TEXT_MUTED,
    TEXT_PRIMARY,
    TEXT_SECONDARY,
    WARNING,
    WHITE,
    PDF_STYLES,
    build_pdf,
    clean_text,
    code_box,
    draw_star,
    horizontal_rule,
    image_flowable,
    info_table,
    landscape_a4,
    marks_bar,
    page_break,
    paragraph,
    section_heading,
    status_badge,
)


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
    """Generate a standardized result/answer sheet PDF."""
    exam = student_session.exam_set
    questions = ExamService.get_session_questions(student_session)
    answers = Answer.query.filter_by(session_id=student_session.id).all()
    answers_map = {answer.question_id: answer for answer in answers}
    result = Result.query.filter_by(session_id=student_session.id).first()
    result_visible = bool(result and (result.published or include_unpublished_feedback))
    marks_map = {mark.question_id: mark for mark in result.question_marks} if result_visible else {}
    doc_type = "ANSWER SHEET" if include_unpublished_feedback else "RESULT SHEET"

    def question_category(question):
        if question.question_type == "mcq":
            return "MCQ"
        if question.question_type == "coding":
            return "Code"
        return "Written"

    def add_question(story, question):
        answer = answers_map.get(question.id)
        question_mark = marks_map.get(question.id)
        awarded = question_mark.marks_awarded if question_mark else 0
        header = Table(
            [[
                paragraph(f"Q{question.question_number}", "H3"),
                status_badge(question.question_type, BRAND_PRIMARY),
                paragraph(f"{awarded if result_visible else '-'} / {question.marks} marks", "H3"),
            ]],
            colWidths=[250, 100, 120],
        )
        header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
        story.extend([header, Spacer(1, 6), paragraph(question.question_text), Spacer(1, 6)])
        for image_path in question.image_paths_as_list():
            image = image_flowable(image_path)
            if image:
                story.extend([image, Spacer(1, 6)])
        if question.code_snippet:
            story.extend([paragraph("Question Code Snippet", "LABEL"), code_box(question.code_snippet), Spacer(1, 6)])
        answer_text = answer.answer_text if answer and answer.answer_text else "[No answer submitted]"
        story.append(paragraph("Your Answer", "LABEL"))
        if question.question_type == "coding":
            story.append(code_box(answer_text))
            if answer and answer.code_output:
                story.extend([Spacer(1, 4), paragraph("Captured Output", "LABEL"), code_box(answer.code_output)])
        else:
            story.append(code_box(answer_text) if len(answer_text) > 180 else paragraph(answer_text))
        if question.question_type == "mcq" and question.correct_answer and answer_text != question.correct_answer:
            story.append(paragraph(f"Correct Answer: {question.correct_answer}", "BODY_SMALL"))
        if result_visible:
            story.extend([Spacer(1, 6), paragraph(f"Marks Awarded: {awarded} / {question.marks}", "LABEL"), marks_bar(awarded, question.marks)])
            if question_mark and question_mark.teacher_remark:
                story.extend([Spacer(1, 6), paragraph("Feedback", "LABEL"), paragraph(question_mark.teacher_remark, "BODY_SMALL")])
            if question.model_answer:
                story.extend([Spacer(1, 6), paragraph("Model Answer", "LABEL"), code_box(question.model_answer)])
        story.extend([Spacer(1, 10), horizontal_rule(), Spacer(1, 10)])

    def build_story(story):
        story.append(paragraph(exam.exam_name, "H1"))
        story.append(horizontal_rule())
        story.append(Spacer(1, 10))
        story.append(
            info_table(
                [
                    (("Exam Date", exam.activated_at or exam.created_at), ("Student Name", student_session.student_name)),
                    (("Duration", f"{exam.duration_minutes} minutes"), ("Roll Number", student_session.roll_no)),
                    (("Total Questions", len(questions)), ("Submitted At", student_session.submitted_at or "-")),
                    (("Total Marks", exam.total_marks), ("Attempt", student_session.session_code)),
                ]
            )
        )
        story.append(Spacer(1, 12))
        if include_unpublished_feedback:
            story.append(section_heading("Teacher Review Copy"))
            story.append(info_table([(("Reviewed By", getattr(result.evaluator, "name", "-") if result else "-"), ("Review Date", result.updated_at if result else "-"))]))
            story.append(Spacer(1, 12))
        if result_visible:
            passed = float(result.percentage or 0) >= int(getattr(exam, "passing_percentage", 40) or 40)
            score_card = Table(
                [[
                    paragraph(f"{result.total_marks_obtained} / {result.total_marks}", "H1"),
                    paragraph(f"{result.percentage}%", "H2"),
                    "" if include_unpublished_feedback else status_badge("PASSED" if passed else "FAILED", SUCCESS if passed else DANGER),
                ]],
                colWidths=[180, 120, 120],
            )
            score_card.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, -1), BRAND_LIGHT),
                        ("BOX", (0, 0), (-1, -1), 1, BRAND_PRIMARY),
                        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                        ("TOPPADDING", (0, 0), (-1, -1), 12),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
                    ]
                )
            )
            story.extend([score_card, Spacer(1, 8), marks_bar(result.total_marks_obtained, result.total_marks), Spacer(1, 14)])
        story.append(section_heading("Answer Review"))
        story.append(Spacer(1, 10))
        for question in questions:
            add_question(story, question)
        summary = {"MCQ": [0, 0], "Written": [0, 0], "Code": [0, 0]}
        for question in questions:
            category = question_category(question)
            summary[category][0] += 1
            summary[category][1] += question.marks
        rows = [["Category", "Questions", "Marks"]] + [[key, values[0], values[1]] for key, values in summary.items()] + [["Total", len(questions), sum(q.marks for q in questions)]]
        table = Table(rows, colWidths=[180, 120, 120])
        table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), BRAND_PRIMARY), ("TEXTCOLOR", (0, 0), (-1, 0), WHITE), ("GRID", (0, 0), (-1, -1), 0.5, BORDER), ("BACKGROUND", (0, -1), (-1, -1), BRAND_LIGHT)]))
        story.extend([section_heading("Result Summary"), Spacer(1, 8), table])

    safe_roll = "".join(ch if ch.isalnum() else "_" for ch in student_session.roll_no or "student")
    return build_pdf(
        f"{doc_type.lower().replace(' ', '_')}_{safe_roll}.pdf",
        build_story,
        doc_type,
        {"watermark": "Teacher Review Copy" if include_unpublished_feedback else None},
    )


def create_exam_report_pdf(exam, sessions, questions):
    results = [student_session.result for student_session in sessions if student_session.result]
    evaluated = len(results)
    average_score = round(sum(result.percentage or 0 for result in results) / evaluated, 1) if evaluated else 0
    pass_threshold = int(getattr(exam, "passing_percentage", 40) or 40)
    pass_count = sum(1 for result in results if float(result.percentage or 0) >= pass_threshold)
    pass_rate = round((pass_count / evaluated) * 100, 1) if evaluated else 0

    def build_story(story):
        story.append(paragraph(exam.exam_name, "H1"))
        story.append(Spacer(1, 8))
        story.append(
            info_table(
                [
                    (("Created By Teacher", getattr(exam.creator, "name", "-")), ("Total Enrolled", len(sessions))),
                    (("Published Date", exam.activated_at or "-"), ("Total Submitted", sum(1 for item in sessions if item.status in {"submitted", "evaluated", "terminated", "auto_submitted"}))),
                    (("Duration", f"{exam.duration_minutes} minutes"), ("Average Score", f"{average_score}%")),
                    (("Total Questions", len(questions)), ("Pass Rate", f"{pass_rate}%")),
                ]
            )
        )
        story.extend([Spacer(1, 16), section_heading("Score Distribution"), Spacer(1, 8)])
        ranges = [(0, 20), (21, 40), (41, 60), (61, 80), (81, 100)]
        counts = []
        for start, end in ranges:
            counts.append(sum(1 for result in results if start <= float(result.percentage or 0) <= end))
        max_count = max(counts or [1]) or 1
        chart_rows = [["Range", "Students", "Distribution"]]
        for (start, end), count in zip(ranges, counts):
            blocks = "#" * max(1, round((count / max_count) * 20)) if count else ""
            chart_rows.append([f"{start}-{end}%", count, blocks])
        chart = Table(chart_rows, colWidths=[100, 80, 300])
        chart.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), BRAND_PRIMARY), ("TEXTCOLOR", (0, 0), (-1, 0), WHITE), ("GRID", (0, 0), (-1, -1), 0.5, BORDER)]))
        story.append(chart)
        story.extend([page_break(), section_heading("All Student Results"), Spacer(1, 8)])
        rows = [["Name", "Roll", "Submitted At", "Score", "Percentage", "Status"]]
        for student_session in sessions:
            result = student_session.result
            percent = float(result.percentage or 0) if result else 0
            rows.append(
                [
                    student_session.student_name,
                    student_session.roll_no,
                    student_session.submitted_at or "-",
                    f"{result.total_marks_obtained}/{result.total_marks}" if result else "Not evaluated",
                    f"{percent}%" if result else "-",
                    "Pass" if result and percent >= pass_threshold else "Fail" if result else "Pending",
                ]
            )
        table = Table(rows, colWidths=[110, 70, 110, 80, 75, 70], repeatRows=1)
        table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), BRAND_PRIMARY), ("TEXTCOLOR", (0, 0), (-1, 0), WHITE), ("GRID", (0, 0), (-1, -1), 0.5, BORDER), ("BOX", (0, 0), (-1, -1), 1, BRAND_PRIMARY)]))
        story.append(table)
        story.extend([page_break(), section_heading("Violation Summary"), Spacer(1, 8)])
        violation_rows = [["Student Name", "Roll", "Violation Count", "Types", "Outcome"]]
        for student_session in sessions:
            violations = getattr(student_session, "violation_logs", []) or []
            if not violations and not student_session.focus_violations:
                continue
            types = ", ".join(sorted({item.violation_type.replace("_", " ").title() for item in violations})) or "Focus"
            violation_rows.append([student_session.student_name, student_session.roll_no, student_session.focus_violations, types, student_session.status])
        if len(violation_rows) == 1:
            story.append(paragraph("No violations recorded for this exam.", "BODY_SMALL"))
        else:
            violation_table = Table(violation_rows, colWidths=[120, 70, 80, 170, 80], repeatRows=1)
            violation_table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), BRAND_PRIMARY), ("TEXTCOLOR", (0, 0), (-1, 0), WHITE), ("GRID", (0, 0), (-1, -1), 0.5, BORDER)]))
            story.append(violation_table)
        story.extend([Spacer(1, 16), section_heading("Question Difficulty Analysis"), Spacer(1, 8)])
        analysis_rows = [["Q#", "Type", "Max Marks", "Avg Score", "Avg %", "Difficulty Tag"]]
        for question in questions:
            scores = []
            for result in results:
                mark = next((item for item in result.question_marks if item.question_id == question.id), None)
                if mark:
                    scores.append(mark.marks_awarded)
            avg = round(sum(scores) / len(scores), 1) if scores else 0
            avg_percent = round((avg / question.marks) * 100, 1) if question.marks else 0
            tag = "Easy" if avg_percent >= 70 else "Medium" if avg_percent >= 40 else "Hard"
            analysis_rows.append([question.question_number, question.question_type, question.marks, avg, f"{avg_percent}%", tag])
        analysis_table = Table(analysis_rows, colWidths=[45, 80, 80, 80, 80, 120], repeatRows=1)
        analysis_table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), BRAND_PRIMARY), ("TEXTCOLOR", (0, 0), (-1, 0), WHITE), ("GRID", (0, 0), (-1, -1), 0.5, BORDER)]))
        story.append(analysis_table)

    return build_pdf(f"exam_report_{exam.id}.pdf", build_story, "EXAM REPORT", {})


def create_result_certificate_pdf(result, admin_name="Platform Administrator"):
    student_session = result.session
    exam = student_session.exam_set
    teacher_name = getattr(exam.creator, "name", None) or "Examiner"
    passing = int(getattr(exam, "passing_percentage", 40) or 40)
    passed = float(result.percentage or 0) >= passing
    settings = SettingsService.get_settings()
    platform_name = getattr(settings, "platform_name", None) or "Exam System"
    generated_at = datetime.utcnow()
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=landscape_a4())
    width, height = landscape_a4()
    pdf.setStrokeColor(BRAND_PRIMARY)
    pdf.setLineWidth(3)
    pdf.rect(36, 36, width - 72, height - 72)
    pdf.setStrokeColor(BRAND_LIGHT)
    pdf.setLineWidth(1)
    pdf.rect(44, 44, width - 88, height - 88)
    pdf.setFillColor(BRAND_PRIMARY)
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawCentredString(width / 2, height - 96, platform_name)
    pdf.setFillColor(WARNING if passed else BRAND_PRIMARY)
    pdf.setFont("Helvetica-Bold", 12)
    pdf.drawCentredString(width / 2, height - 124, "MERIT CERTIFICATE" if passed else "PARTICIPATION CERTIFICATE")
    if passed:
        draw_star(pdf, width / 2 - 210, height / 2 + 32, 18)
    pdf.setFillColor(TEXT_SECONDARY)
    pdf.setFont("Helvetica", 12)
    pdf.drawCentredString(width / 2, height / 2 + 70, "This is to certify that")
    pdf.setFillColor(TEXT_PRIMARY)
    pdf.setFont("Helvetica-Bold", 24)
    pdf.drawCentredString(width / 2, height / 2 + 36, student_session.student_name)
    pdf.setFillColor(TEXT_SECONDARY)
    pdf.setFont("Helvetica", 12)
    pdf.drawCentredString(width / 2, height / 2 + 8, "has successfully completed")
    pdf.setFillColor(BRAND_PRIMARY)
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawCentredString(width / 2, height / 2 - 24, exam.exam_name)
    pdf.setFillColor(SUCCESS)
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawCentredString(width / 2, height / 2 - 58, f"with a score of {result.total_marks_obtained}/{result.total_marks} ({result.percentage}%)")
    pdf.setFillColor(TEXT_MUTED)
    pdf.setFont("Helvetica-Oblique", 8)
    pdf.drawCentredString(width / 2, height / 2 - 82, f"on {(result.published_at or generated_at).strftime('%b %d, %Y')}")
    left_x, right_x, sig_y = 145, width - 300, 112
    pdf.setStrokeColor(TEXT_MUTED)
    pdf.line(left_x, sig_y, left_x + 180, sig_y)
    pdf.line(right_x, sig_y, right_x + 180, sig_y)
    pdf.setFillColor(TEXT_SECONDARY)
    pdf.setFont("Helvetica", 8)
    pdf.drawCentredString(left_x + 90, sig_y - 14, "Examiner / Teacher")
    pdf.drawCentredString(left_x + 90, sig_y - 27, teacher_name)
    pdf.drawCentredString(right_x + 90, sig_y - 14, "Platform Administrator")
    pdf.drawCentredString(right_x + 90, sig_y - 27, admin_name)
    cert_no = f"CERT-{generated_at.year}-{exam.id}-{student_session.id}"
    pdf.setFillColor(TEXT_MUTED)
    pdf.drawCentredString(width / 2, 82, f"Certificate No: {cert_no}")
    pdf.drawCentredString(width / 2, 66, f"{platform_name} | Generated {generated_at.strftime('%b %d, %Y')}")
    pdf.showPage()
    pdf.save()
    buffer.seek(0)
    return buffer
