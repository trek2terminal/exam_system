from datetime import datetime
from flask import Blueprint, render_template, redirect, url_for, request, session, flash, jsonify
from app.models.database import db
from app.models.exam_model import ExamSet, Question
from app.models.submission_model import StudentSession, Answer
from app.models.result_model import Result, QuestionMark
from app.services.exam_service import ExamService
from app.utils.helpers import teacher_required, parse_options

teacher_bp = Blueprint("teacher", __name__, url_prefix="/teacher")


@teacher_bp.route("/dashboard")
@teacher_required
def dashboard():
    # Only show exams created by the current teacher
    teacher_id = session.get("teacher_id")
    exams = ExamSet.query.filter_by(created_by=teacher_id).order_by(ExamSet.created_at.desc()).all()
    active_count = ExamSet.query.filter_by(created_by=teacher_id, status="active").count()
    draft_count = ExamSet.query.filter_by(created_by=teacher_id, status="draft").count()
    closed_count = ExamSet.query.filter_by(created_by=teacher_id, status="closed").count()
    # Only count sessions from their own exams
    their_exam_ids = [e.id for e in exams]
    submitted_count = StudentSession.query.filter(
        StudentSession.exam_set_id.in_(their_exam_ids) if their_exam_ids else False,
        StudentSession.status.in_(["submitted", "evaluated"])
    ).count()

    return render_template(
        "teacher/dashboard.html",
        exams=exams,
        active_count=active_count,
        draft_count=draft_count,
        closed_count=closed_count,
        submitted_count=submitted_count,
    )


@teacher_bp.route("/setup", methods=["GET", "POST"])
@teacher_bp.route("/setup/<int:exam_id>", methods=["GET", "POST"])
@teacher_required
def setup_exam(exam_id=None):
    exam = ExamSet.query.get(exam_id) if exam_id else None

    # Verify ownership: only allow teacher to edit their own exams
    if exam and exam.created_by != session.get("teacher_id"):
        flash("You do not have permission to edit this exam.", "danger")
        return redirect(url_for("teacher.dashboard"))

    questions = Question.query.filter_by(exam_set_id=exam.id).order_by(Question.question_number.asc()).all() if exam else []

    if request.method == "POST":
        if exam and exam.status == "active":
            flash("Cannot edit an active exam. Close it first.", "danger")
            return redirect(url_for("teacher.setup_exam", exam_id=exam.id))

        exam_name = request.form.get("exam_name", "").strip()
        set_code = request.form.get("set_code", "").strip().upper()
        subject = request.form.get("subject", "").strip()
        duration_minutes = request.form.get("duration_minutes", "0").strip()
        access_code = request.form.get("access_code", "").strip().upper()

        if not exam_name or not set_code or not subject:
            flash("Exam name, set code and subject are required.", "danger")
            return redirect(request.url)

        try:
            duration_minutes = int(duration_minutes)
        except ValueError:
            duration_minutes = 0

        if duration_minutes <= 0:
            flash("Duration must be a positive number.", "danger")
            return redirect(request.url)

        # Question parsing logic (kept as is - you can improve later)
        q_numbers = request.form.getlist("question_number")
        q_texts = request.form.getlist("question_text")
        q_types = request.form.getlist("question_type")
        q_marks = request.form.getlist("marks")
        q_options = request.form.getlist("options")
        q_answers = request.form.getlist("correct_answer")

        question_rows = []
        for i in range(len(q_texts)):
            text = (q_texts[i] or "").strip()
            if not text:
                continue
            try:
                number = int(q_numbers[i]) if i < len(q_numbers) and q_numbers[i].strip() else i + 1
            except ValueError:
                number = i + 1

            q_type = (q_types[i] if i < len(q_types) else "short").strip().lower()
            try:
                marks = int(q_marks[i]) if i < len(q_marks) and q_marks[i].strip() else 1
            except ValueError:
                marks = 1

            raw_options = q_options[i] if i < len(q_options) else ""
            options_list = parse_options(raw_options)
            correct_answer = (q_answers[i] if i < len(q_answers) else "").strip()

            if q_type == "mcq" and len(options_list) < 2:
                flash(f"Question {number} needs at least two MCQ options.", "danger")
                return redirect(request.url)

            question_rows.append({
                "number": number,
                "text": text,
                "type": q_type,
                "marks": marks,
                "options": options_list,
                "answer": correct_answer,
            })

        if not question_rows:
            flash("Add at least one question.", "danger")
            return redirect(request.url)

        total_marks = sum(q["marks"] for q in question_rows)

        # Create or update exam
        if exam:
            Question.query.filter_by(exam_set_id=exam.id).delete()
            exam.exam_name = exam_name
            exam.set_code = set_code
            exam.subject = subject
            exam.duration_minutes = duration_minutes
            exam.total_marks = total_marks
            if access_code:
                exam.access_code = access_code
        else:
            exam = ExamSet(
                exam_name=exam_name,
                set_code=set_code,
                subject=subject,
                duration_minutes=duration_minutes,
                total_marks=total_marks,
                access_code=access_code or ExamSet.access_code.default(),
                status="draft",
                created_by=session.get("teacher_id")
            )
            db.session.add(exam)
            db.session.flush()

        for row in question_rows:
            question = Question(
                exam_set_id=exam.id,
                question_number=row["number"],
                question_text=row["text"],
                question_type=row["type"],
                marks=row["marks"],
                correct_answer=row["answer"],
            )
            question.set_options(row["options"])
            db.session.add(question)

        db.session.commit()
        flash("Exam saved successfully.", "success")
        return redirect(url_for("teacher.dashboard"))

    return render_template("teacher/exam_setup.html", exam=exam, questions=questions)


@teacher_bp.route("/exam/<int:exam_id>/activate", methods=["POST"])
@teacher_required
def activate_exam(exam_id):
    exam = ExamSet.query.get_or_404(exam_id)
    if exam.created_by != session.get("teacher_id"):
        return jsonify({"ok": False, "message": "You do not own this exam."}), 403

    if exam.status != "draft":
        return jsonify({"ok": False, "message": "Only draft exams can be activated."}), 400

    if not exam.questions:
        return jsonify({"ok": False, "message": "Add at least one question before activating."}), 400

    exam.activate()
    return jsonify({"ok": True, "message": f"{exam.exam_name} activated."})


@teacher_bp.route("/exam/<int:exam_id>/close", methods=["POST"])
@teacher_required
def close_exam(exam_id):
    exam = ExamSet.query.get_or_404(exam_id)
    if exam.created_by != session.get("teacher_id"):
        return jsonify({"ok": False, "message": "You do not own this exam."}), 403

    if exam.status == "closed":
        return jsonify({"ok": False, "message": "Exam is already closed."}), 400

    exam.close()
    return jsonify({"ok": True, "message": f"{exam.exam_name} closed."})



@teacher_bp.route("/results")
@teacher_required
def results():
    # Only show sessions from exams created by the teacher
    teacher_id = session.get("teacher_id")
    their_exam_ids = [e.id for e in ExamSet.query.filter_by(created_by=teacher_id).all()]
    sessions = StudentSession.query.filter(
        StudentSession.exam_set_id.in_(their_exam_ids) if their_exam_ids else False
    ).order_by(StudentSession.created_at.desc()).all()
    return render_template("teacher/results.html", sessions=sessions)


@teacher_bp.route("/exam/<int:exam_id>/results")
@teacher_required
def exam_results(exam_id):
    exam = ExamSet.query.get_or_404(exam_id)
    if exam.created_by != session.get("teacher_id"):
        flash("You do not have permission to view this exam.", "danger")
        return redirect(url_for("teacher.dashboard"))

    sessions = StudentSession.query.filter_by(exam_set_id=exam.id)\
                .order_by(StudentSession.created_at.desc()).all()
    return render_template("teacher/exam_results.html", exam=exam, sessions=sessions)


@teacher_bp.route("/session/<int:session_id>", methods=["GET", "POST"])
@teacher_required
def student_view(session_id):
    # Your existing detailed student view logic (kept mostly same)
    student_session = StudentSession.query.get_or_404(session_id)
    if student_session.exam_set.created_by != session.get("teacher_id"):
        flash("You do not have permission to view this submission.", "danger")
        return redirect(url_for("teacher.results"))

    questions = Question.query.filter_by(exam_set_id=student_session.exam_set_id)\
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

    if request.method == "POST":
        if student_session.status not in ["submitted", "evaluated"]:
            flash("This attempt is still in progress. Marks can be saved after submission.", "warning")
            return redirect(url_for("teacher.student_view", session_id=session_id))

        marks_payload = {}
        remarks_payload = {}
        total_obtained = 0
        total_possible = sum(q.marks for q in questions)

        for q in questions:
            raw_marks = request.form.get(f"marks_{q.id}", "0").strip() or "0"
            try:
                marks_awarded = int(raw_marks)
            except ValueError:
                flash(f"Marks for question {q.question_number} must be a number.", "danger")
                return redirect(url_for("teacher.student_view", session_id=session_id))

            if marks_awarded < 0 or marks_awarded > q.marks:
                flash(f"Marks for question {q.question_number} must be between 0 and {q.marks}.", "danger")
                return redirect(url_for("teacher.student_view", session_id=session_id))

            marks_payload[q.id] = marks_awarded
            remarks_payload[q.id] = request.form.get(f"remark_{q.id}", "").strip()
            total_obtained += marks_awarded

        result = Result.query.filter_by(session_id=student_session.id).first()
        if not result:
            result = Result(session_id=student_session.id)
            db.session.add(result)
            db.session.flush()
        else:
            QuestionMark.query.filter_by(result_id=result.id).delete()

        result.total_marks = total_possible
        result.total_marks_obtained = total_obtained
        result.teacher_remarks = request.form.get("teacher_remarks", "").strip()
        result.evaluated_by = session.get("teacher_id")
        result.published = request.form.get("published") == "on"
        result.published_at = datetime.utcnow() if result.published else None
        result.calculate_percentage()

        for q in questions:
            db.session.add(
                QuestionMark(
                    result_id=result.id,
                    question_id=q.id,
                    marks_awarded=marks_payload[q.id],
                    teacher_remark=remarks_payload[q.id],
                )
            )

        student_session.status = "evaluated"
        db.session.commit()

        flash("Marks saved successfully.", "success")
        return redirect(url_for("teacher.student_view", session_id=session_id))

    return render_template(
        "teacher/student_view.html",
        student_session=student_session,
        questions=questions,
        answers_map=answers_map,
        result=result,
        marks_map=marks_map,
        remarks_map=remarks_map,
    )
