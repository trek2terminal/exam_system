from datetime import datetime
from flask import Blueprint, current_app, render_template, redirect, url_for, request, flash, session, send_file
from app.models.database import db
from app.models.exam_model import ExamSet, Question
from app.models.submission_model import StudentSession, Answer
from app.models.result_model import Result
from app.services.exam_service import ExamService
from app.utils.helpers import create_submission_pdf

student_bp = Blueprint("student", __name__, url_prefix="/student")


def _owns_session(session_code):
    """Keep student exam URLs bound to the browser session that joined them."""
    return session.get("student_session_code") == session_code


def _redirect_if_not_owner(session_code):
    if _owns_session(session_code):
        return None
    flash("This exam session is not available in this browser. Please join again.", "danger")
    return redirect(url_for("student.join_exam"))


@student_bp.route("/join", methods=["GET", "POST"])
def join_exam():
    student_name = session.get("student_name", "").strip()
    roll_no = session.get("roll_no", "").strip()

    if not student_name or not roll_no:
        flash("Please enter your student details first.", "warning")
        return redirect(url_for("auth.student_login"))

    if request.method == "POST":
        access_code = request.form.get("access_code", "").strip().upper()

        if not access_code:
            flash("Exam access code is required.", "danger")
            return redirect(url_for("student.join_exam"))

        exam = ExamSet.query.filter_by(access_code=access_code).first()
        if not exam:
            flash("Invalid exam access code.", "danger")
            return redirect(url_for("student.join_exam"))

        if exam.status == "closed":
            flash("This exam has been closed by the teacher.", "danger")
            return redirect(url_for("student.join_exam"))

        # Create student session
        student_session = ExamService.create_student_session(
            exam_set_id=exam.id,
            student_name=student_name,
            roll_no=roll_no
        )

        session.permanent = True
        session["role"] = "student"
        session["student_id"] = student_session.id
        session["student_name"] = student_name
        session["roll_no"] = roll_no
        session["student_session_code"] = student_session.session_code

        if exam.status == "active":
            ExamService.start_exam(student_session.session_code)

        if student_session.status == "waiting":
            return redirect(url_for("student.waiting", session_code=student_session.session_code))

        return redirect(url_for("student.exam", session_code=student_session.session_code))

    return render_template("student/join.html", student_name=student_name, roll_no=roll_no)


@student_bp.route("/waiting/<session_code>")
def waiting(session_code):
    owner_redirect = _redirect_if_not_owner(session_code)
    if owner_redirect:
        return owner_redirect

    student_session = StudentSession.query.filter_by(session_code=session_code).first_or_404()
    exam = student_session.exam_set

    if student_session.status == "submitted":
        return redirect(url_for("student.submitted", session_code=session_code))

    if exam.status == "active":
        ExamService.start_exam(session_code)
        return redirect(url_for("student.exam", session_code=session_code))

    return render_template("student/waiting.html",
                           student_session=student_session,
                           exam=exam)


@student_bp.route("/exam/<session_code>")
def exam(session_code):
    owner_redirect = _redirect_if_not_owner(session_code)
    if owner_redirect:
        return owner_redirect

    student_session = StudentSession.query.filter_by(session_code=session_code).first_or_404()
    exam = student_session.exam_set

    if student_session.status == "submitted":
        return redirect(url_for("student.submitted", session_code=session_code))

    if exam.status != "active":
        return redirect(url_for("student.waiting", session_code=session_code))

    # Start exam if not started
    if not student_session.start_time:
        ExamService.start_exam(session_code)

    questions = Question.query.filter_by(exam_set_id=exam.id) \
        .order_by(Question.question_number.asc()).all()

    saved_answers = Answer.query.filter_by(session_id=student_session.id).all()
    saved_map = {a.question_id: a.answer_text for a in saved_answers}

    # Calculate remaining time
    remaining_seconds = 0
    if student_session.start_time:
        elapsed = (datetime.utcnow() - student_session.start_time).total_seconds()
        remaining_seconds = max((exam.duration_minutes * 60) - int(elapsed), 0)

    return render_template(
        "student/exam.html",
        student_session=student_session,
        exam=exam,
        questions=questions,
        saved_map=saved_map,
        remaining_seconds=remaining_seconds,
        max_violations_allowed=current_app.config.get("MAX_VIOLATIONS_ALLOWED", 3),
    )


@student_bp.route("/submitted/<session_code>")
def submitted(session_code):
    owner_redirect = _redirect_if_not_owner(session_code)
    if owner_redirect:
        return owner_redirect

    student_session = StudentSession.query.filter_by(session_code=session_code).first_or_404()
    result = Result.query.filter_by(session_id=student_session.id).first()

    questions = Question.query.filter_by(exam_set_id=student_session.exam_set_id) \
        .order_by(Question.question_number.asc()).all()

    question_marks = {}
    if result:
        for qm in result.question_marks:
            question_marks[qm.question_id] = qm

    return render_template(
        "student/submitted.html",
        student_session=student_session,
        result=result,
        questions=questions,
        question_marks=question_marks,
    )


@student_bp.route("/export/<session_code>")
def export_pdf(session_code):
    owner_redirect = _redirect_if_not_owner(session_code)
    if owner_redirect:
        return owner_redirect

    student_session = StudentSession.query.filter_by(session_code=session_code).first_or_404()
    pdf_buffer = create_submission_pdf(student_session)
    filename = f"submission_{student_session.roll_no}_{student_session.session_code}.pdf"

    return send_file(
        pdf_buffer,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=filename,
    )
