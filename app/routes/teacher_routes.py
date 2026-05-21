import csv
from difflib import SequenceMatcher
import json
from datetime import datetime
from flask import Blueprint, render_template, redirect, url_for, request, session, flash, jsonify
from sqlalchemy import and_
from app.models.database import db
from app.models.exam_model import ExamEnrollment, ExamSet, Question, QuestionBankItem
from app.models.submission_model import StudentSession, Answer
from app.models.result_model import Result, QuestionMark
from app.services.exam_service import ExamService
from app.services.exam_session_guard import LOCKED_SESSION_STATUSES
from app.services.parser_service import QuestionParserService
from app.utils.export_utils import csv_response, format_datetime
from app.utils.helpers import teacher_required, parse_options

teacher_bp = Blueprint("teacher", __name__, url_prefix="/teacher")


def _normalize_roll(roll_no):
    return ExamEnrollment.normalize_roll_no(roll_no)


def _parse_datetime_local(raw_value):
    raw_value = (raw_value or "").strip()
    if not raw_value:
        return None
    try:
        return datetime.fromisoformat(raw_value)
    except ValueError:
        return None


def _parse_enrollment_line(line):
    line = (line or "").strip()
    if not line:
        return None

    parts = next(csv.reader([line]), [])
    if len(parts) == 1:
        if "\t" in line:
            parts = line.split("\t")
        elif ";" in line:
            parts = line.split(";")

    roll_no = _normalize_roll(parts[0] if parts else "")
    student_name = (parts[1] if len(parts) > 1 else "").strip()
    try:
        extra_time_minutes = int((parts[2] if len(parts) > 2 else "0") or "0")
    except ValueError:
        extra_time_minutes = 0
    extra_time_minutes = max(0, extra_time_minutes)

    header_values = {"ROLL", "ROLLNO", "ROLL_NO", "ROLL NUMBER", "ROLL NO", "REGISTRATION"}
    if not roll_no or roll_no in header_values:
        return None

    return roll_no, student_name, extra_time_minutes


def _session_result_base_row(student_session):
    result = student_session.result
    return [
        student_session.exam_set.exam_name,
        student_session.exam_set.subject,
        student_session.exam_set.set_code,
        student_session.student_name,
        student_session.roll_no,
        student_session.status,
        format_datetime(student_session.start_time),
        format_datetime(student_session.submitted_at),
        result.total_marks_obtained if result else "",
        result.total_marks if result else "",
        result.percentage if result else "",
        "yes" if result and result.published else "no",
        format_datetime(result.published_at) if result else "",
        student_session.focus_violations,
        result.teacher_remarks if result else "",
    ]


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
        StudentSession.status.in_(LOCKED_SESSION_STATUSES)
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
        start_time = _parse_datetime_local(request.form.get("start_time"))
        end_time = _parse_datetime_local(request.form.get("end_time"))

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

        if request.form.get("start_time") and not start_time:
            flash("Start time is not valid.", "danger")
            return redirect(request.url)

        if request.form.get("end_time") and not end_time:
            flash("End time is not valid.", "danger")
            return redirect(request.url)

        if start_time and end_time and end_time <= start_time:
            flash("End time must be after start time.", "danger")
            return redirect(request.url)

        # Question parsing logic (kept as is - you can improve later)
        q_numbers = request.form.getlist("question_number")
        q_texts = request.form.getlist("question_text")
        q_types = request.form.getlist("question_type")
        q_marks = request.form.getlist("marks")
        q_options = request.form.getlist("options")
        q_answers = request.form.getlist("correct_answer")
        q_model_answers = request.form.getlist("model_answer")

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
            model_answer = (q_model_answers[i] if i < len(q_model_answers) else "").strip()

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
                "model_answer": model_answer,
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
            exam.start_time = start_time
            exam.end_time = end_time
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
                created_by=session.get("teacher_id"),
                start_time=start_time,
                end_time=end_time,
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
                model_answer=row["model_answer"],
            )
            question.set_options(row["options"])
            db.session.add(question)

        db.session.commit()
        flash("Exam saved successfully.", "success")
        return redirect(url_for("teacher.dashboard"))

    return render_template("teacher/exam_setup.html", exam=exam, questions=questions)


@teacher_bp.route("/exam/<int:exam_id>/import", methods=["GET", "POST"])
@teacher_required
def import_questions(exam_id):
    exam = ExamSet.query.get_or_404(exam_id)
    if exam.created_by != session.get("teacher_id"):
        flash("You do not have permission to import into this exam.", "danger")
        return redirect(url_for("teacher.dashboard"))

    if exam.status == "active":
        flash("Cannot import questions while the exam is active. Close it first.", "danger")
        return redirect(url_for("teacher.setup_exam", exam_id=exam.id))

    parsed = None
    import_mode = request.form.get("mode", "append")

    if request.method == "POST":
        action = request.form.get("action", "preview")

        if action == "confirm":
            payload = request.form.get("questions_payload", "[]")
            try:
                questions = json.loads(payload)
            except json.JSONDecodeError:
                questions = []

            if not questions:
                flash("No parsed questions were available to import.", "danger")
                return redirect(url_for("teacher.import_questions", exam_id=exam.id))

            imported_count = QuestionParserService.save_questions_to_exam(
                exam_set_id=exam.id,
                questions_list=questions,
                replace=import_mode == "replace",
            )
            exam.total_marks = sum(q.marks for q in Question.query.filter_by(exam_set_id=exam.id).all())
            db.session.commit()

            flash(f"Imported {imported_count} question(s) into {exam.exam_name}.", "success")
            return redirect(url_for("teacher.setup_exam", exam_id=exam.id))

        pasted_text = request.form.get("question_text", "")
        upload = request.files.get("question_file")

        try:
            if upload and upload.filename:
                parsed = QuestionParserService.parse_uploaded_file(upload)
            else:
                parsed = QuestionParserService.parse_text(pasted_text)
        except ValueError as exc:
            flash(str(exc), "danger")
            parsed = {"questions": [], "unmatched": []}
        except Exception:
            flash("Could not parse that file. Please try plain text or a clean .docx.", "danger")
            parsed = {"questions": [], "unmatched": []}

        if parsed and not parsed.get("questions"):
            flash("No questions were detected. Check the format and try again.", "warning")

    return render_template(
        "teacher/import_questions.html",
        exam=exam,
        parsed=parsed,
        import_mode=import_mode,
    )


@teacher_bp.route("/question-bank", methods=["GET", "POST"])
@teacher_required
def question_bank():
    teacher_id = session.get("teacher_id")

    if request.method == "POST":
        question_text = request.form.get("question_text", "").strip()
        question_type = request.form.get("question_type", "short").strip().lower()
        correct_answer = request.form.get("correct_answer", "").strip()
        model_answer = request.form.get("model_answer", "").strip()
        options = parse_options(request.form.get("options", ""))

        try:
            marks = int(request.form.get("marks", "1"))
        except ValueError:
            marks = 1
        marks = max(1, marks)

        if not question_text:
            flash("Question text is required.", "danger")
            return redirect(url_for("teacher.question_bank"))

        if question_type == "mcq" and len(options) < 2:
            flash("MCQ bank questions need at least two options.", "danger")
            return redirect(url_for("teacher.question_bank"))

        bank_item = QuestionBankItem(
            teacher_id=teacher_id,
            question_text=question_text,
            question_type=question_type,
            marks=marks,
            correct_answer=correct_answer,
            model_answer=model_answer,
        )
        bank_item.set_options(options)
        db.session.add(bank_item)
        db.session.commit()

        flash("Question saved to your question bank.", "success")
        return redirect(url_for("teacher.question_bank"))

    bank_items = (
        QuestionBankItem.query.filter_by(teacher_id=teacher_id)
        .order_by(QuestionBankItem.created_at.desc())
        .all()
    )
    return render_template("teacher/question_bank.html", bank_items=bank_items)


@teacher_bp.route("/question-bank/<int:item_id>/delete", methods=["POST"])
@teacher_required
def delete_question_bank_item(item_id):
    bank_item = QuestionBankItem.query.filter_by(id=item_id, teacher_id=session.get("teacher_id")).first_or_404()
    db.session.delete(bank_item)
    db.session.commit()
    flash("Question removed from your bank.", "info")
    return redirect(url_for("teacher.question_bank"))


@teacher_bp.route("/question-bank/save-question/<int:question_id>", methods=["POST"])
@teacher_required
def save_question_to_bank(question_id):
    question = Question.query.get_or_404(question_id)
    if question.exam_set.created_by != session.get("teacher_id"):
        flash("You do not have permission to save this question.", "danger")
        return redirect(url_for("teacher.dashboard"))

    bank_item = QuestionBankItem.from_question(question, session.get("teacher_id"))
    db.session.add(bank_item)
    db.session.commit()
    flash("Question copied to your bank.", "success")
    return redirect(url_for("teacher.setup_exam", exam_id=question.exam_set_id))


@teacher_bp.route("/exam/<int:exam_id>/question-bank/import", methods=["GET", "POST"])
@teacher_required
def import_from_question_bank(exam_id):
    exam = ExamSet.query.get_or_404(exam_id)
    teacher_id = session.get("teacher_id")
    if exam.created_by != teacher_id:
        flash("You do not have permission to manage this exam.", "danger")
        return redirect(url_for("teacher.dashboard"))

    if exam.status == "active":
        flash("Cannot import bank questions while the exam is active. Close it first.", "danger")
        return redirect(url_for("teacher.setup_exam", exam_id=exam.id))

    bank_items = (
        QuestionBankItem.query.filter_by(teacher_id=teacher_id)
        .order_by(QuestionBankItem.created_at.desc())
        .all()
    )

    if request.method == "POST":
        selected_ids = [int(item_id) for item_id in request.form.getlist("bank_item_id") if item_id.isdigit()]
        selected_items = [item for item in bank_items if item.id in selected_ids]
        if not selected_items:
            flash("Choose at least one bank question to import.", "warning")
            return redirect(url_for("teacher.import_from_question_bank", exam_id=exam.id))

        last_question = (
            Question.query.filter_by(exam_set_id=exam.id)
            .order_by(Question.question_number.desc())
            .first()
        )
        next_number = (last_question.question_number if last_question else 0) + 1

        for item in selected_items:
            question = Question(
                exam_set_id=exam.id,
                question_number=next_number,
                question_text=item.question_text,
                question_type=item.question_type,
                marks=item.marks,
                correct_answer=item.correct_answer,
                explanation=item.explanation,
                model_answer=item.model_answer,
            )
            question.set_options(item.options_as_list())
            db.session.add(question)
            next_number += 1

        db.session.flush()
        exam.total_marks = sum(q.marks for q in Question.query.filter_by(exam_set_id=exam.id).all())
        db.session.commit()
        flash(f"Imported {len(selected_items)} question(s) from your bank.", "success")
        return redirect(url_for("teacher.setup_exam", exam_id=exam.id))

    return render_template("teacher/import_bank.html", exam=exam, bank_items=bank_items)


@teacher_bp.route("/exam/<int:exam_id>/enrollments", methods=["GET", "POST"])
@teacher_required
def enrollments(exam_id):
    exam = ExamSet.query.get_or_404(exam_id)
    teacher_id = session.get("teacher_id")

    if exam.created_by != teacher_id:
        flash("You do not have permission to manage this exam.", "danger")
        return redirect(url_for("teacher.dashboard"))

    if request.method == "POST":
        raw_roster = request.form.get("enrollments", "")
        lines = raw_roster.splitlines()
        seen_rolls = set()
        added_count = 0
        updated_count = 0
        skipped_count = 0

        for line in lines:
            parsed = _parse_enrollment_line(line)
            if not parsed:
                continue

            roll_no, student_name, extra_time_minutes = parsed
            if roll_no in seen_rolls:
                skipped_count += 1
                continue
            seen_rolls.add(roll_no)

            existing = (
                ExamEnrollment.query.filter(
                    ExamEnrollment.exam_set_id == exam.id,
                    db.func.upper(ExamEnrollment.roll_no) == roll_no,
                ).first()
            )

            if existing:
                changed = False
                if student_name and existing.student_name != student_name:
                    existing.student_name = student_name
                    changed = True
                if existing.extra_time_minutes != extra_time_minutes:
                    existing.extra_time_minutes = extra_time_minutes
                    changed = True
                if changed:
                    existing_session = (
                        StudentSession.query.filter(
                            StudentSession.exam_set_id == exam.id,
                            db.func.upper(StudentSession.roll_no) == roll_no,
                            StudentSession.status.in_(["waiting", "active"]),
                        ).first()
                    )
                    if existing_session:
                        existing_session.extra_time_minutes = extra_time_minutes
                    updated_count += 1
                else:
                    skipped_count += 1
                continue

            db.session.add(
                ExamEnrollment(
                    exam_set_id=exam.id,
                    roll_no=roll_no,
                    student_name=student_name or None,
                    extra_time_minutes=extra_time_minutes,
                    created_by=teacher_id,
                )
            )
            added_count += 1

        db.session.commit()

        if added_count or updated_count:
            flash(
                f"Enrollment updated: {added_count} added, {updated_count} renamed, {skipped_count} skipped.",
                "success",
            )
        else:
            flash("No new students were added. Check the roll numbers and try again.", "warning")

        return redirect(url_for("teacher.enrollments", exam_id=exam.id))

    existing_enrollments = (
        ExamEnrollment.query.filter_by(exam_set_id=exam.id)
        .order_by(ExamEnrollment.roll_no.asc())
        .all()
    )
    sessions = (
        StudentSession.query.filter_by(exam_set_id=exam.id)
        .order_by(StudentSession.created_at.desc())
        .all()
    )
    sessions_by_roll = {}
    for student_session in sessions:
        sessions_by_roll.setdefault(_normalize_roll(student_session.roll_no), student_session)

    return render_template(
        "teacher/enrollments.html",
        exam=exam,
        enrollments=existing_enrollments,
        sessions_by_roll=sessions_by_roll,
    )


@teacher_bp.route("/exam/<int:exam_id>/enrollments/<int:enrollment_id>/delete", methods=["POST"])
@teacher_required
def delete_enrollment(exam_id, enrollment_id):
    exam = ExamSet.query.get_or_404(exam_id)
    if exam.created_by != session.get("teacher_id"):
        flash("You do not have permission to manage this exam.", "danger")
        return redirect(url_for("teacher.dashboard"))

    enrollment = ExamEnrollment.query.filter_by(id=enrollment_id, exam_set_id=exam.id).first_or_404()
    removed_roll = enrollment.roll_no
    db.session.delete(enrollment)
    db.session.commit()

    flash(f"Removed {removed_roll} from this exam.", "info")
    return redirect(url_for("teacher.enrollments", exam_id=exam.id))


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


@teacher_bp.route("/results/export")
@teacher_required
def export_results():
    teacher_id = session.get("teacher_id")
    their_exam_ids = [e.id for e in ExamSet.query.filter_by(created_by=teacher_id).all()]
    sessions = []
    if their_exam_ids:
        sessions = (
            StudentSession.query.filter(StudentSession.exam_set_id.in_(their_exam_ids))
            .order_by(StudentSession.created_at.desc())
            .all()
        )

    headers = [
        "Exam",
        "Subject",
        "Set Code",
        "Student Name",
        "Roll No",
        "Session Status",
        "Started At",
        "Submitted At",
        "Marks Obtained",
        "Total Marks",
        "Percentage",
        "Published",
        "Published At",
        "Violation Count",
        "Teacher Remarks",
    ]

    rows = [_session_result_base_row(student_session) for student_session in sessions]
    return csv_response("teacher_results.csv", headers, rows)


@teacher_bp.route("/exam/<int:exam_id>/results")
@teacher_required
def exam_results(exam_id):
    exam = ExamSet.query.get_or_404(exam_id)
    if exam.created_by != session.get("teacher_id"):
        flash("You do not have permission to view this exam.", "danger")
        return redirect(url_for("teacher.dashboard"))

    sessions = StudentSession.query.filter_by(exam_set_id=exam.id)\
                .order_by(StudentSession.created_at.desc()).all()
    questions = Question.query.filter_by(exam_set_id=exam.id).order_by(Question.question_number.asc()).all()
    evaluated_count = sum(1 for student_session in sessions if student_session.result)
    published_count = sum(1 for student_session in sessions if student_session.result and student_session.result.published)
    return render_template(
        "teacher/exam_results.html",
        exam=exam,
        sessions=sessions,
        questions=questions,
        evaluated_count=evaluated_count,
        published_count=published_count,
    )


@teacher_bp.route("/exam/<int:exam_id>/question/<int:question_id>/compare")
@teacher_required
def compare_question_answers(exam_id, question_id):
    exam = ExamSet.query.get_or_404(exam_id)
    if exam.created_by != session.get("teacher_id"):
        flash("You do not have permission to compare answers for this exam.", "danger")
        return redirect(url_for("teacher.dashboard"))

    question = Question.query.filter_by(id=question_id, exam_set_id=exam.id).first_or_404()
    rows = (
        db.session.query(StudentSession, Answer)
        .outerjoin(
            Answer,
            and_(Answer.session_id == StudentSession.id, Answer.question_id == question.id),
        )
        .filter(
            StudentSession.exam_set_id == exam.id,
            StudentSession.status.in_(LOCKED_SESSION_STATUSES),
        )
        .order_by(StudentSession.student_name.asc())
        .all()
    )

    return render_template(
        "teacher/compare_question.html",
        exam=exam,
        question=question,
        rows=rows,
    )


@teacher_bp.route("/exam/<int:exam_id>/similarity")
@teacher_required
def similarity_report(exam_id):
    exam = ExamSet.query.get_or_404(exam_id)
    if exam.created_by != session.get("teacher_id"):
        flash("You do not have permission to view this report.", "danger")
        return redirect(url_for("teacher.dashboard"))

    threshold = 0.8
    flags = []
    questions = Question.query.filter(
        Question.exam_set_id == exam.id,
        Question.question_type.in_(["long", "coding"]),
    ).order_by(Question.question_number.asc()).all()

    for question in questions:
        answers = (
            db.session.query(StudentSession, Answer)
            .join(Answer, Answer.session_id == StudentSession.id)
            .filter(
                StudentSession.exam_set_id == exam.id,
                StudentSession.status.in_(LOCKED_SESSION_STATUSES),
                Answer.question_id == question.id,
            )
            .all()
        )
        for index, (left_session, left_answer) in enumerate(answers):
            left_text = (left_answer.answer_text or "").strip()
            if len(left_text) < 40:
                continue
            for right_session, right_answer in answers[index + 1:]:
                right_text = (right_answer.answer_text or "").strip()
                if len(right_text) < 40:
                    continue
                score = SequenceMatcher(None, left_text.lower(), right_text.lower()).ratio()
                if score >= threshold:
                    flags.append(
                        {
                            "question": question,
                            "left_session": left_session,
                            "right_session": right_session,
                            "score": round(score * 100, 1),
                        }
                    )

    flags.sort(key=lambda item: item["score"], reverse=True)
    return render_template("teacher/similarity_report.html", exam=exam, flags=flags, threshold=int(threshold * 100))


@teacher_bp.route("/exam/<int:exam_id>/results/export")
@teacher_required
def export_exam_results(exam_id):
    exam = ExamSet.query.get_or_404(exam_id)
    if exam.created_by != session.get("teacher_id"):
        flash("You do not have permission to export this exam.", "danger")
        return redirect(url_for("teacher.dashboard"))

    sessions = (
        StudentSession.query.filter_by(exam_set_id=exam.id)
        .order_by(StudentSession.created_at.desc())
        .all()
    )
    questions = Question.query.filter_by(exam_set_id=exam.id).order_by(Question.question_number.asc()).all()

    headers = [
        "Exam",
        "Subject",
        "Set Code",
        "Student Name",
        "Roll No",
        "Session Status",
        "Started At",
        "Submitted At",
        "Marks Obtained",
        "Total Marks",
        "Percentage",
        "Published",
        "Published At",
        "Violation Count",
        "Teacher Remarks",
    ]
    for question in questions:
        headers.extend([f"Q{question.question_number} Marks", f"Q{question.question_number} Remark"])

    rows = []
    for student_session in sessions:
        row = _session_result_base_row(student_session)
        marks_by_question = {}
        if student_session.result:
            marks_by_question = {qm.question_id: qm for qm in student_session.result.question_marks}

        for question in questions:
            question_mark = marks_by_question.get(question.id)
            row.extend(
                [
                    question_mark.marks_awarded if question_mark else "",
                    question_mark.teacher_remark if question_mark else "",
                ]
            )
        rows.append(row)

    safe_name = "".join(ch if ch.isalnum() else "_" for ch in exam.set_code or exam.id)
    return csv_response(f"results_{safe_name}.csv", headers, rows)


@teacher_bp.route("/exam/<int:exam_id>/publish-results", methods=["POST"])
@teacher_required
def publish_exam_results(exam_id):
    exam = ExamSet.query.get_or_404(exam_id)
    if exam.created_by != session.get("teacher_id"):
        flash("You do not have permission to publish this exam.", "danger")
        return redirect(url_for("teacher.dashboard"))

    publish = request.form.get("publish") == "1"
    sessions = StudentSession.query.filter_by(exam_set_id=exam.id).all()
    changed_count = 0

    for student_session in sessions:
        result = student_session.result
        if not result:
            continue
        result.published = publish
        result.published_at = datetime.utcnow() if publish else None
        changed_count += 1

    db.session.commit()

    action = "published" if publish else "hidden"
    flash(f"{changed_count} evaluated result(s) {action}.", "success")
    return redirect(url_for("teacher.exam_results", exam_id=exam.id))


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
    answer_objects_map = {a.question_id: a for a in answers}

    result = Result.query.filter_by(session_id=student_session.id).first()
    marks_map = {}
    remarks_map = {}

    if result:
        for qm in result.question_marks:
            marks_map[qm.question_id] = qm.marks_awarded
            remarks_map[qm.question_id] = qm.teacher_remark or ""

    if request.method == "POST":
        if student_session.status not in LOCKED_SESSION_STATUSES:
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
        answer_objects_map=answer_objects_map,
        result=result,
        marks_map=marks_map,
        remarks_map=remarks_map,
    )
