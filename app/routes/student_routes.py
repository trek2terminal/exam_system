from datetime import datetime
from flask import Blueprint, render_template, redirect, url_for, request, flash, session, send_file
from app.models.database import db
from app.models.exam_model import ExamEnrollment, ExamSet, Question
from app.models.submission_model import StudentSession, Answer
from app.models.result_model import Result
from app.models.user_model import User
from app.services.exam_service import ExamService
from app.services.exam_session_guard import ExamSessionGuard
from app.services.settings_service import SettingsService
from app.utils.helpers import create_submission_pdf

student_bp = Blueprint("student", __name__, url_prefix="/student")


def _owns_session(session_code):
    """Keep student exam URLs bound to the browser session that joined them."""
    student_session = StudentSession.query.filter_by(session_code=session_code).first()
    return bool(student_session and ExamSessionGuard.browser_owns_attempt(student_session))


def _redirect_if_not_owner(session_code):
    if _owns_session(session_code):
        return None
    flash("This exam session is not available in this browser. Please join again.", "danger")
    return redirect(url_for("student.dashboard"))


def _require_student_details():
    student_user_id = session.get("student_user_id")
    if student_user_id:
        user = User.query.get(student_user_id)
        if not user or user.role != "student" or not user.is_active:
            session.clear()
            flash("Your student account is no longer active. Please contact the administrator.", "danger")
            return None, None, redirect(url_for("auth.student_login"))

    student_name = session.get("student_name", "").strip()
    roll_no = session.get("roll_no", "").strip()
    if not student_name or not roll_no:
        flash("Please enter your student details first.", "warning")
        return None, None, redirect(url_for("auth.student_login"))
    return student_name, roll_no, None


def _normalize_roll(roll_no):
    return ExamEnrollment.normalize_roll_no(roll_no)


def _latest_session_for_exam(exam_id, roll_no):
    return (
        StudentSession.query.filter(
            StudentSession.exam_set_id == exam_id,
            db.func.upper(StudentSession.roll_no) == _normalize_roll(roll_no),
        )
        .order_by(StudentSession.created_at.desc())
        .first()
    )


def _exam_requires_enrollment(exam_id):
    return ExamEnrollment.query.filter_by(exam_set_id=exam_id).first() is not None


def _is_enrolled(exam_id, roll_no):
    return (
        ExamEnrollment.query.filter(
            ExamEnrollment.exam_set_id == exam_id,
            db.func.upper(ExamEnrollment.roll_no) == _normalize_roll(roll_no),
        ).first()
        is not None
    )


def _remember_student_session(student_session):
    session.permanent = True
    session["role"] = "student"
    session["student_id"] = student_session.id
    session["student_name"] = student_session.student_name
    session["roll_no"] = student_session.roll_no
    ExamSessionGuard.remember_browser_attempt(student_session)


def _precheck_key(session_code):
    return f"exam_precheck_ok_{session_code}"


def _has_precheck_clearance(session_code):
    return bool(session.get(_precheck_key(session_code)))


def _grant_precheck_clearance(session_code):
    session[_precheck_key(session_code)] = True
    session.modified = True


@student_bp.route("/")
def index():
    return redirect(url_for("student.dashboard"))


@student_bp.route("/dashboard")
def dashboard():
    student_name, roll_no, redirect_response = _require_student_details()
    if redirect_response:
        return redirect_response

    normalized_roll = _normalize_roll(roll_no)
    enrollments = (
        ExamEnrollment.query.filter(db.func.upper(ExamEnrollment.roll_no) == normalized_roll)
        .join(ExamSet)
        .order_by(ExamSet.created_at.desc())
        .all()
    )

    assigned_exams = []
    for enrollment in enrollments:
        student_session = _latest_session_for_exam(enrollment.exam_set_id, normalized_roll)
        assigned_exams.append(
            {
                "enrollment": enrollment,
                "exam": enrollment.exam_set,
                "session": student_session,
            }
        )

    hour = datetime.now().hour
    if hour < 12:
        greeting = "Good morning"
    elif hour < 17:
        greeting = "Good afternoon"
    else:
        greeting = "Good evening"

    platform_settings = SettingsService.get_settings()
    quote = SettingsService.random_quote(platform_settings)

    return render_template(
        "student/dashboard.html",
        student_name=student_name,
        roll_no=normalized_roll,
        assigned_exams=assigned_exams,
        greeting=greeting,
        quote=quote,
        platform_settings=platform_settings,
    )


@student_bp.route("/start/<int:exam_id>", methods=["POST"])
def start_assigned_exam(exam_id):
    student_name, roll_no, redirect_response = _require_student_details()
    if redirect_response:
        return redirect_response

    exam = ExamSet.query.get_or_404(exam_id)
    if not _is_enrolled(exam.id, roll_no):
        flash("This exam is not assigned to your roll number.", "danger")
        return redirect(url_for("student.dashboard"))

    existing_session = _latest_session_for_exam(exam.id, roll_no)
    if existing_session and ExamSessionGuard.is_locked(existing_session):
        _remember_student_session(existing_session)
        return redirect(url_for("student.submitted", session_code=existing_session.session_code))

    if exam.status == "closed":
        flash("This exam has been closed by the teacher.", "danger")
        return redirect(url_for("student.dashboard"))

    student_session = ExamService.create_student_session(
        exam_set_id=exam.id,
        student_name=student_name,
        roll_no=roll_no,
    )
    _remember_student_session(student_session)

    if ExamSessionGuard.is_locked(student_session):
        return redirect(url_for("student.submitted", session_code=student_session.session_code))

    if exam.status == "active" and not student_session.start_time:
        return redirect(url_for("student.precheck", session_code=student_session.session_code))

    if exam.status == "active":
        return redirect(url_for("student.exam", session_code=student_session.session_code))

    return redirect(url_for("student.waiting", session_code=student_session.session_code))


@student_bp.route("/results")
def results():
    student_name, roll_no, redirect_response = _require_student_details()
    if redirect_response:
        return redirect_response

    normalized_roll = _normalize_roll(roll_no)
    published_sessions = (
        StudentSession.query.join(Result)
        .filter(
            db.func.upper(StudentSession.roll_no) == normalized_roll,
            Result.published.is_(True),
        )
        .order_by(Result.published_at.desc())
        .all()
    )

    return render_template(
        "student/results.html",
        student_name=student_name,
        roll_no=normalized_roll,
        published_sessions=published_sessions,
    )


@student_bp.route("/join", methods=["GET", "POST"])
def join_exam():
    student_name, roll_no, redirect_response = _require_student_details()
    if redirect_response:
        return redirect_response

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
            existing_session = _latest_session_for_exam(exam.id, roll_no)
            if existing_session and ExamSessionGuard.is_locked(existing_session):
                _remember_student_session(existing_session)
                return redirect(url_for("student.submitted", session_code=existing_session.session_code))
            flash("This exam has been closed by the teacher.", "danger")
            return redirect(url_for("student.join_exam"))

        if _exam_requires_enrollment(exam.id) and not _is_enrolled(exam.id, roll_no):
            flash("This exam is assigned by roll number and is not available for your login.", "danger")
            return redirect(url_for("student.dashboard"))

        student_session = ExamService.create_student_session(
            exam_set_id=exam.id,
            student_name=student_name,
            roll_no=roll_no
        )
        _remember_student_session(student_session)

        if ExamSessionGuard.is_locked(student_session):
            return redirect(url_for("student.submitted", session_code=student_session.session_code))

        if exam.status == "active" and not student_session.start_time:
            return redirect(url_for("student.precheck", session_code=student_session.session_code))

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

    if ExamSessionGuard.is_locked(student_session):
        return redirect(url_for("student.submitted", session_code=session_code))

    if exam.status == "active":
        if student_session.start_time:
            return redirect(url_for("student.exam", session_code=session_code))
        return redirect(url_for("student.precheck", session_code=session_code))

    return render_template(
        "student/waiting.html",
        student_session=student_session,
        exam=exam,
        attempt_token=ExamSessionGuard.ensure_token(student_session),
    )


@student_bp.route("/precheck/<session_code>", methods=["GET", "POST"])
def precheck(session_code):
    owner_redirect = _redirect_if_not_owner(session_code)
    if owner_redirect:
        return owner_redirect

    student_session = StudentSession.query.filter_by(session_code=session_code).first_or_404()
    exam = student_session.exam_set
    question_count = Question.query.filter_by(exam_set_id=exam.id).count()

    if ExamSessionGuard.is_locked(student_session):
        return redirect(url_for("student.submitted", session_code=session_code))

    if exam.status != "active":
        flash("Your teacher has not started this exam yet.", "info")
        return redirect(url_for("student.waiting", session_code=session_code))

    if student_session.start_time:
        _grant_precheck_clearance(session_code)
        return redirect(url_for("student.exam", session_code=session_code))

    if request.method == "POST":
        if request.form.get("rules_ack") != "on":
            flash("Please confirm that you understand the exam rules.", "warning")
            return redirect(url_for("student.precheck", session_code=session_code))

        _grant_precheck_clearance(session_code)
        ExamService.start_exam(session_code)
        return redirect(url_for("student.exam", session_code=session_code))

    return render_template(
        "student/precheck.html",
        student_session=student_session,
        exam=exam,
        question_count=question_count,
        max_violations_allowed=SettingsService.max_violations_allowed(),
    )


@student_bp.route("/exam/<session_code>")
def exam(session_code):
    owner_redirect = _redirect_if_not_owner(session_code)
    if owner_redirect:
        return owner_redirect

    student_session = StudentSession.query.filter_by(session_code=session_code).first_or_404()
    exam = student_session.exam_set

    if ExamSessionGuard.is_locked(student_session):
        return redirect(url_for("student.submitted", session_code=session_code))

    if exam.status != "active":
        return redirect(url_for("student.waiting", session_code=session_code))

    if not student_session.start_time:
        if not _has_precheck_clearance(session_code):
            return redirect(url_for("student.precheck", session_code=session_code))
        ExamService.start_exam(session_code)

    questions = Question.query.filter_by(exam_set_id=exam.id) \
        .order_by(Question.question_number.asc()).all()

    saved_answers = Answer.query.filter_by(session_id=student_session.id).all()
    saved_map = {a.question_id: a.answer_text for a in saved_answers}
    code_output_map = {a.question_id: a.code_output for a in saved_answers if getattr(a, "code_output", None)}

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
        code_output_map=code_output_map,
        remaining_seconds=remaining_seconds,
        max_violations_allowed=SettingsService.max_violations_allowed(),
        attempt_token=ExamSessionGuard.ensure_token(student_session),
    )


@student_bp.route("/submitted/<session_code>")
def submitted(session_code):
    owner_redirect = _redirect_if_not_owner(session_code)
    if owner_redirect:
        return owner_redirect

    student_session = StudentSession.query.filter_by(session_code=session_code).first_or_404()
    result = Result.query.filter_by(session_id=student_session.id).first()

    if not ExamSessionGuard.is_locked(student_session):
        if student_session.status == "active":
            return redirect(url_for("student.exam", session_code=session_code))
        if student_session.exam_set.status == "active":
            return redirect(url_for("student.precheck", session_code=session_code))
        return redirect(url_for("student.waiting", session_code=session_code))

    questions = Question.query.filter_by(exam_set_id=student_session.exam_set_id) \
        .order_by(Question.question_number.asc()).all()

    question_marks = {}
    if result:
        for qm in result.question_marks:
            question_marks[qm.question_id] = qm

    answers = Answer.query.filter_by(session_id=student_session.id).all()
    answer_objects_map = {a.question_id: a for a in answers}

    return render_template(
        "student/submitted.html",
        student_session=student_session,
        result=result,
        questions=questions,
        question_marks=question_marks,
        answer_objects_map=answer_objects_map,
    )


@student_bp.route("/export/<session_code>")
def export_pdf(session_code):
    owner_redirect = _redirect_if_not_owner(session_code)
    if owner_redirect:
        return owner_redirect

    student_session = StudentSession.query.filter_by(session_code=session_code).first_or_404()
    if not ExamSessionGuard.is_locked(student_session):
        flash("Answer copies are available after the exam is submitted.", "info")
        return redirect(url_for("student.exam", session_code=session_code))

    pdf_buffer = create_submission_pdf(student_session)
    filename = f"submission_{student_session.roll_no}_{student_session.session_code}.pdf"

    return send_file(
        pdf_buffer,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=filename,
    )
