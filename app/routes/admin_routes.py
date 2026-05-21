import csv
import io
import re
import os
import secrets
import shutil
import subprocess
from flask import Blueprint, render_template, request, jsonify, redirect, url_for, flash, session, current_app, send_file
from datetime import datetime, timedelta
from werkzeug.utils import secure_filename
from app.models.database import db
from app.models.user_model import User
from app.models.exam_model import ExamSet, Question
from app.models.submission_model import StudentSession, Answer
from app.models.result_model import Result
from app.models.audit_model import AuditLog, ViolationLog
from app.models.group_model import StudentGroup, StudentGroupMember
from app.services.exam_service import ExamService
from app.services.exam_session_guard import LOCKED_SESSION_STATUSES
from app.services.notification_service import NotificationService
from app.services.settings_service import SettingsService
from app.utils.export_utils import csv_response, format_datetime
from app.utils.helpers import admin_required
from app.utils.network import get_client_ip
from app.utils.rate_limiter import rate_limit

admin_bp = Blueprint("admin", __name__, url_prefix="/admin")


def _validate_username(username):
    return bool(re.fullmatch(r"[A-Za-z0-9_.@-]{4,50}", username or ""))


def _validate_password(password):
    return (
        len(password or "") >= 10
        and re.search(r"[A-Z]", password or "")
        and re.search(r"[a-z]", password or "")
        and re.search(r"\d", password or "")
    )


def _save_profile_photo(file_storage, user_id):
    if not file_storage or not file_storage.filename:
        return None

    allowed = {"png", "jpg", "jpeg", "webp", "gif"}
    filename = secure_filename(file_storage.filename)
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in allowed:
        raise ValueError("Photo must be PNG, JPG, WEBP, or GIF.")

    upload_root = os.path.join(current_app.static_folder, "uploads", "profiles")
    os.makedirs(upload_root, exist_ok=True)
    stored_name = f"user_{user_id}_{int(datetime.utcnow().timestamp())}.{ext}"
    file_storage.save(os.path.join(upload_root, stored_name))
    return f"uploads/profiles/{stored_name}"


def _render_create_teacher(status_code=200):
    return render_template("admin/create_teacher.html", form_data=request.form), status_code


def _row_value(row, *keys):
    normalized = {str(key).strip().lower().replace(" ", "_"): value for key, value in row.items()}
    for key in keys:
        value = normalized.get(key)
        if value is not None:
            return str(value).strip()
    return ""


def _find_student_for_group(identifier):
    value = (identifier or "").strip()
    if not value:
        return None
    normalized = value.upper()
    return User.query.filter(
        User.role == "student",
        db.or_(
            db.func.upper(User.roll_number) == normalized,
            db.func.upper(User.username) == normalized,
            db.func.upper(User.email) == normalized,
        ),
    ).first()


def _admin_password_confirmed():
    password = request.form.get("admin_password", "")
    if not password:
        flash("Enter your admin password to confirm this action.", "danger")
        return False
    admin = User.query.get(session.get("admin_id"))
    if not admin or not admin.check_password(password):
        flash("Admin password confirmation failed.", "danger")
        return False
    return True


def _session_snapshot(student_session):
    exam = student_session.exam_set
    total_questions = Question.query.filter_by(exam_set_id=exam.id).count()
    answered_count = Answer.query.filter_by(session_id=student_session.id).filter(Answer.answer_text != "").count()
    latest_violation = (
        ViolationLog.query.filter_by(session_id=student_session.id)
        .order_by(ViolationLog.occurred_at.desc())
        .first()
    )

    heartbeat_age = None
    if student_session.last_heartbeat:
        heartbeat_age = int((datetime.utcnow() - student_session.last_heartbeat).total_seconds())

    return {
        "id": student_session.id,
        "student_name": student_session.student_name,
        "roll_no": student_session.roll_no,
        "exam_name": exam.exam_name,
        "set_code": exam.set_code,
        "status": student_session.status,
        "remaining_seconds": ExamService.remaining_seconds_for_session(student_session),
        "answered_count": answered_count,
        "total_questions": total_questions,
        "focus_violations": student_session.focus_violations,
        "suspicion_score": student_session.suspicion_score,
        "last_heartbeat_age": heartbeat_age,
        "latest_violation": latest_violation.violation_type if latest_violation else None,
        "latest_violation_at": latest_violation.occurred_at.isoformat() if latest_violation else None,
        "pause_requested": bool(student_session.pause_requested_at),
        "pause_reason": student_session.pause_reason,
        "paused_at": student_session.paused_at.isoformat() if student_session.paused_at else None,
    }


# ==================== DASHBOARD & OVERVIEW ====================

@admin_bp.route("/")
@admin_required
def dashboard():
    """Admin Dashboard with statistics and overview"""
    # Statistics
    total_users = User.query.count()
    total_teachers = User.query.filter_by(role="teacher").count()
    total_exams = ExamSet.query.count()
    active_exams = ExamSet.query.filter_by(status="active").count()
    total_sessions = StudentSession.query.count()
    completed_sessions = StudentSession.query.filter(StudentSession.status.in_(LOCKED_SESSION_STATUSES)).count()
    violation_alerts = ViolationLog.query.count()

    # Recent activity
    recent_logs = AuditLog.query.order_by(AuditLog.created_at.desc()).limit(10).all()

    # Exam status breakdown
    draft_exams = ExamSet.query.filter_by(status="draft").count()
    closed_exams = ExamSet.query.filter_by(status="closed").count()

    # Charts data
    last_7_days = datetime.utcnow() - timedelta(days=7)
    daily_sessions = db.session.query(
        db.func.date(StudentSession.created_at).label('date'),
        db.func.count(StudentSession.id).label('count')
    ).filter(StudentSession.created_at >= last_7_days).group_by('date').all()

    return render_template(
        "admin/dashboard.html",
        total_users=total_users,
        total_teachers=total_teachers,
        total_exams=total_exams,
        active_exams=active_exams,
        total_sessions=total_sessions,
        completed_sessions=completed_sessions,
        violation_alerts=violation_alerts,
        draft_exams=draft_exams,
        closed_exams=closed_exams,
        recent_logs=recent_logs,
        daily_sessions=daily_sessions
    )


# ==================== USER MANAGEMENT ====================

@admin_bp.route("/users")
@admin_required
def users():
    """Manage all users (admin, teachers)"""
    page = request.args.get("page", 1, type=int)
    role_filter = request.args.get("role", "all")

    query = User.query

    if role_filter != "all":
        query = query.filter_by(role=role_filter)

    users_paginated = query.order_by(User.created_at.desc()).paginate(page=page, per_page=20)

    return render_template(
        "admin/users.html",
        users=users_paginated.items,
        pagination=users_paginated,
        role_filter=role_filter
    )


@admin_bp.route("/groups", methods=["GET", "POST"])
@admin_required
def groups():
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        description = request.form.get("description", "").strip() or None
        if not name:
            flash("Group name is required.", "danger")
            return redirect(url_for("admin.groups"))
        if StudentGroup.query.filter(db.func.lower(StudentGroup.name) == name.lower()).first():
            flash("A group with this name already exists.", "danger")
            return redirect(url_for("admin.groups"))

        db.session.add(
            StudentGroup(
                name=name,
                description=description,
                created_by=session.get("admin_id"),
            )
        )
        db.session.commit()
        flash(f"Group {name} created.", "success")
        return redirect(url_for("admin.groups"))

    student_groups = StudentGroup.query.order_by(StudentGroup.name.asc()).all()
    return render_template("admin/groups.html", groups=student_groups)


@admin_bp.route("/groups/<int:group_id>/members", methods=["POST"])
@admin_required
def add_group_members(group_id):
    group = StudentGroup.query.get_or_404(group_id)
    raw_members = request.form.get("members", "")
    added_count = 0
    skipped_count = 0
    existing_student_ids = {member.student_id for member in group.members}

    for line in raw_members.splitlines():
        student = _find_student_for_group(line)
        if not student or student.id in existing_student_ids:
            skipped_count += 1
            continue
        db.session.add(StudentGroupMember(group_id=group.id, student_id=student.id))
        existing_student_ids.add(student.id)
        added_count += 1

    if added_count:
        db.session.commit()
    flash(f"Group updated: {added_count} added, {skipped_count} skipped.", "success" if added_count else "warning")
    return redirect(url_for("admin.groups"))


@admin_bp.route("/groups/<int:group_id>/delete", methods=["POST"])
@admin_required
def delete_group(group_id):
    if not _admin_password_confirmed():
        return redirect(url_for("admin.groups"))
    group = StudentGroup.query.get_or_404(group_id)
    group_name = group.name
    db.session.delete(group)
    db.session.commit()
    flash(f"Deleted group {group_name}.", "info")
    return redirect(url_for("admin.groups"))


@admin_bp.route("/users/import-students", methods=["POST"])
@admin_required
@rate_limit("admin_action", json_response=False)
def import_students():
    upload = request.files.get("students_file")
    if not upload or not upload.filename:
        flash("Choose a CSV file to import students.", "danger")
        return redirect(url_for("admin.users", role="student"))

    if not upload.filename.lower().endswith(".csv"):
        flash("Only CSV files are supported for student import.", "danger")
        return redirect(url_for("admin.users", role="student"))

    try:
        raw = upload.stream.read().decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(raw))
    except Exception:
        flash("Could not read that CSV file.", "danger")
        return redirect(url_for("admin.users", role="student"))

    created_count = 0
    skipped_count = 0
    failed_rows = []

    for index, row in enumerate(reader, start=2):
        name = _row_value(row, "name", "full_name", "student_name")
        email = _row_value(row, "email", "email_address") or None
        roll_no = _row_value(row, "roll", "roll_no", "roll_number", "registration").upper()
        username = _row_value(row, "username", "user_name") or roll_no or (email.split("@")[0] if email else "")
        password = _row_value(row, "password", "temporary_password")

        if not name or not username or not roll_no:
            failed_rows.append(f"row {index}: missing name, username/roll, or roll number")
            continue

        if not _validate_username(username):
            failed_rows.append(f"row {index}: invalid username")
            continue

        if User.query.filter_by(username=username).first():
            skipped_count += 1
            continue

        if email and User.query.filter_by(email=email).first():
            skipped_count += 1
            continue

        if User.query.filter_by(role="student", roll_number=roll_no).first():
            skipped_count += 1
            continue

        if not password:
            password = f"{secrets.token_urlsafe(8)}A1!"

        student = User(
            name=name,
            username=username,
            email=email,
            role="student",
            roll_number=roll_no,
            is_active=True,
            is_verified=True,
            created_at=datetime.utcnow(),
        )
        student.set_password(password)
        db.session.add(student)
        created_count += 1

    if created_count:
        db.session.commit()

    AuditLog(
        user_id=session.get("admin_id"),
        action="bulk_import_students",
        resource_type="user",
        changes=f"created={created_count}, skipped={skipped_count}, failed={len(failed_rows)}",
        status="success" if not failed_rows else "warning",
        ip_address=get_client_ip(),
    ).save()

    flash(f"Student import finished: {created_count} created, {skipped_count} skipped, {len(failed_rows)} failed.", "success" if not failed_rows else "warning")
    if failed_rows:
        flash("; ".join(failed_rows[:5]), "warning")

    return redirect(url_for("admin.users", role="student"))


@admin_bp.route("/users/create-teacher", methods=["GET", "POST"])
@admin_required
def create_teacher():
    """Create a new teacher account"""
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        username = request.form.get("username", "").strip()
        email = request.form.get("email", "").strip()
        password = request.form.get("password", "").strip()
        department = request.form.get("department", "").strip()
        designation = request.form.get("designation", "").strip()

        # Validation
        if not name or not username or not password:
            flash("Name, username, and password are required.", "danger")
            return _render_create_teacher(400)

        if not _validate_username(username):
            flash("Username must be 4-50 characters and use only letters, numbers, dot, @, dash, or underscore.", "danger")
            return _render_create_teacher(400)

        if not _validate_password(password):
            flash("Password must be at least 10 characters and include uppercase, lowercase, and a number.", "danger")
            return _render_create_teacher(400)

        if User.query.filter_by(username=username).first():
            flash("Username already exists.", "danger")
            return _render_create_teacher(400)

        if email and User.query.filter_by(email=email).first():
            flash("Email already exists.", "danger")
            return _render_create_teacher(400)

        # Create teacher
        teacher = User(
            name=name,
            username=username,
            email=email,
            role="teacher",
            department=department,
            designation=designation,
            is_active=True,
            is_verified=True,
            must_change_password=True,
            created_at=datetime.utcnow()
        )
        teacher.set_password(password)

        db.session.add(teacher)
        db.session.commit()

        # Log audit
        AuditLog(
            user_id=session.get("admin_id"),
            action="create_user",
            resource_type="user",
            resource_id=teacher.id,
            changes=f"Created teacher: {name}",
            status="success",
            ip_address=get_client_ip()
        ).save()

        flash(f"Teacher account for {name} created successfully!", "success")
        return redirect(url_for("admin.users"))

    return render_template("admin/create_teacher.html", form_data={})


@admin_bp.route("/users/<int:user_id>/toggle-status", methods=["POST"])
@admin_required
def toggle_user_status(user_id):
    """Enable/Disable user account"""
    user = User.query.get_or_404(user_id)

    if user.id == session.get("admin_id"):
        return jsonify({"ok": False, "message": "You cannot disable your own account"}), 400

    user.is_active = not user.is_active
    db.session.commit()

    AuditLog(
        user_id=session.get("admin_id"),
        action="toggle_user_status",
        resource_type="user",
        resource_id=user_id,
        changes= f"Status changed to {'active' if user.is_active else 'inactive'}",
        status="success",
        ip_address=get_client_ip()
    ).save()

    return jsonify({
        "ok": True,
        "message": f"User {'activated' if user.is_active else 'deactivated'}",
        "is_active": user.is_active
    })


@admin_bp.route("/users/<int:user_id>/edit", methods=["GET", "POST"])
@admin_required
def edit_user(user_id):
    """Admin can edit account details, profile photo, status, role, and password."""
    user = User.query.get_or_404(user_id)

    if request.method == "POST":
        name = request.form.get("name", "").strip()
        username = request.form.get("username", "").strip()
        email = request.form.get("email", "").strip() or None
        phone = request.form.get("phone", "").strip() or None
        role = request.form.get("role", user.role).strip()
        department = request.form.get("department", "").strip() or None
        designation = request.form.get("designation", "").strip() or None
        roll_number = request.form.get("roll_number", "").strip().upper() or None
        password = request.form.get("password", "").strip()
        profile_picture = request.form.get("profile_picture", "").strip() or None
        is_active = request.form.get("is_active") == "on"
        is_verified = request.form.get("is_verified") == "on"

        if not name or not username:
            flash("Name and username are required.", "danger")
            return render_template("admin/edit_user.html", user=user, form_data=request.form), 400

        if not _validate_username(username):
            flash("Username must be 4-50 characters and use only letters, numbers, dot, @, dash, or underscore.", "danger")
            return render_template("admin/edit_user.html", user=user, form_data=request.form), 400

        username_owner = User.query.filter(User.username == username, User.id != user.id).first()
        if username_owner:
            flash("Username already exists.", "danger")
            return render_template("admin/edit_user.html", user=user, form_data=request.form), 400

        if email:
            email_owner = User.query.filter(User.email == email, User.id != user.id).first()
            if email_owner:
                flash("Email already exists.", "danger")
                return render_template("admin/edit_user.html", user=user, form_data=request.form), 400

        if role not in {"admin", "teacher", "student"}:
            flash("Role must be admin, teacher, or student.", "danger")
            return render_template("admin/edit_user.html", user=user, form_data=request.form), 400

        if password and not _validate_password(password):
            flash("New password must be at least 10 characters and include uppercase, lowercase, and a number.", "danger")
            return render_template("admin/edit_user.html", user=user, form_data=request.form), 400

        user.name = name
        user.username = username
        user.email = email
        user.phone = phone
        user.role = role
        user.department = department
        user.designation = designation
        user.roll_number = roll_number
        user.profile_picture = profile_picture or user.profile_picture
        user.is_verified = is_verified

        if user.id == session.get("admin_id") and not is_active:
            flash("You cannot disable your own admin account.", "danger")
            return render_template("admin/edit_user.html", user=user, form_data=request.form), 400
        user.is_active = is_active

        if password:
            user.set_password(password)
            user.failed_login_attempts = 0
            user.locked_until = None

        try:
            uploaded = _save_profile_photo(request.files.get("photo"), user.id)
            if uploaded:
                user.profile_picture = uploaded
        except ValueError as exc:
            flash(str(exc), "danger")
            return render_template("admin/edit_user.html", user=user, form_data=request.form), 400

        db.session.commit()

        AuditLog(
            user_id=session.get("admin_id"),
            action="edit_user",
            resource_type="user",
            resource_id=user.id,
            changes=f"Edited user: {user.username}",
            status="success",
            ip_address=get_client_ip()
        ).save()

        flash(f"{user.name}'s account was updated.", "success")
        return redirect(url_for("admin.users"))

    return render_template("admin/edit_user.html", user=user, form_data={})


@admin_bp.route("/users/<int:user_id>/delete", methods=["POST"])
@admin_required
def delete_user(user_id):
    """Delete user account"""
    user = User.query.get_or_404(user_id)

    if user.role == "admin":
        return jsonify({"ok": False, "message": "Cannot delete admin accounts"}), 400

    username = user.username
    db.session.delete(user)
    db.session.commit()

    AuditLog(
        user_id=session.get("admin_id"),
        action="delete_user",
        resource_type="user",
        resource_id=user_id,
        changes=f"Deleted user: {username}",
        status="success",
        ip_address=get_client_ip()
    ).save()

    return jsonify({"ok": True, "message": f"User {username} deleted"})


# ==================== EXAM MANAGEMENT ====================

@admin_bp.route("/exams")
@admin_required
def exams():
    """Manage all exams"""
    page = request.args.get("page", 1, type=int)
    status_filter = request.args.get("status", "all")

    query = ExamSet.query

    if status_filter != "all":
        query = query.filter_by(status=status_filter)

    exams_paginated = query.order_by(ExamSet.created_at.desc()).paginate(page=page, per_page=20)

    return render_template(
        "admin/exams.html",
        exams=exams_paginated.items,
        pagination=exams_paginated,
        status_filter=status_filter
    )


@admin_bp.route("/exams/<int:exam_id>/activate", methods=["POST"])
@admin_required
def activate_exam(exam_id):
    """Only admin can activate exams"""
    exam = ExamSet.query.get_or_404(exam_id)

    if exam.status != "draft":
        return jsonify({"ok": False, "message": "Only draft exams can be activated"}), 400

    if not exam.questions:
        return jsonify({"ok": False, "message": "Add at least one question before activating"}), 400

    exam.activate()

    AuditLog(
        user_id=session.get("admin_id"),
        action="activate_exam",
        resource_type="exam",
        resource_id=exam_id,
        changes=f"Activated exam: {exam.exam_name}",
        status="success",
        ip_address=get_client_ip()
    ).save()

    return jsonify({"ok": True, "message": f"Exam {exam.exam_name} activated"})


@admin_bp.route("/exams/<int:exam_id>/close", methods=["POST"])
@admin_bp.route("/exams/<int:exam_id>/deactivate", methods=["POST"])
@admin_required
def close_exam(exam_id):
    """Close/deactivate exam"""
    exam = ExamSet.query.get_or_404(exam_id)

    if exam.status == "closed":
        return jsonify({"ok": False, "message": "Exam is already closed"}), 400

    exam.close()

    AuditLog(
        user_id=session.get("admin_id"),
        action="close_exam",
        resource_type="exam",
        resource_id=exam_id,
        changes=f"Closed exam: {exam.exam_name}",
        status="success",
        ip_address=get_client_ip()
    ).save()

    return jsonify({"ok": True, "message": "Exam closed"})


@admin_bp.route("/exams/<int:exam_id>")
@admin_required
def view_exam(exam_id):
    """View exam details and sessions"""
    exam = ExamSet.query.get_or_404(exam_id)
    sessions = StudentSession.query.filter_by(exam_set_id=exam_id).all()
    questions = Question.query.filter_by(exam_set_id=exam_id).order_by(Question.question_number).all()

    # Statistics
    total_sessions = len(sessions)
    submitted = sum(1 for s in sessions if s.status in LOCKED_SESSION_STATUSES)
    active_sessions = sum(1 for s in sessions if s.status == "active")

    return render_template(
        "admin/exam_detail.html",
        exam=exam,
        sessions=sessions,
        questions=questions,
        total_sessions=total_sessions,
        submitted=submitted,
        active_sessions=active_sessions
    )


# ==================== ANALYTICS & REPORTS ====================

@admin_bp.route("/analytics")
@admin_required
def analytics():
    """System analytics and statistics"""
    # Performance metrics
    total_exams = ExamSet.query.count()
    total_sessions = StudentSession.query.count()
    avg_pass_rate = db.session.query(
        db.func.avg(Result.percentage)
    ).scalar() or 0

    # Top performing exams
    top_exams = db.session.query(
        ExamSet.exam_name,
        db.func.count(StudentSession.id).label('sessions'),
        db.func.avg(Result.percentage).label('avg_percentage')
    ).select_from(ExamSet).outerjoin(
        StudentSession, StudentSession.exam_set_id == ExamSet.id
    ).outerjoin(
        Result, Result.session_id == StudentSession.id
    ).group_by(ExamSet.id).order_by(
        db.desc('avg_percentage')
    ).limit(10).all()

    # Teacher activity
    teacher_activity = db.session.query(
        User.name,
        db.func.count(db.distinct(ExamSet.id)).label('exams_created'),
        db.func.count(db.distinct(StudentSession.id)).label('total_students')
    ).select_from(User).outerjoin(
        ExamSet, ExamSet.created_by == User.id
    ).outerjoin(
        StudentSession, StudentSession.exam_set_id == ExamSet.id
    ).filter(
        User.role == "teacher"
    ).group_by(User.id).order_by(db.desc('exams_created')).limit(10).all()

    return render_template(
        "admin/analytics.html",
        total_exams=total_exams,
        total_sessions=total_sessions,
        avg_pass_rate=round(avg_pass_rate, 2),
        top_exams=top_exams,
        teacher_activity=teacher_activity
    )


# ==================== AUDIT LOGS ====================

@admin_bp.route("/audit-logs")
@admin_required
def audit_logs():
    """View system audit logs"""
    page = request.args.get("page", 1, type=int)
    action_filter = request.args.get("action", "all")

    query = AuditLog.query

    if action_filter != "all":
        query = query.filter_by(action=action_filter)

    logs_paginated = query.order_by(AuditLog.created_at.desc()).paginate(page=page, per_page=50)

    return render_template(
        "admin/audit_logs.html",
        logs=logs_paginated.items,
        pagination=logs_paginated,
        action_filter=action_filter
    )


# ==================== PROCTORING & VIOLATIONS ====================

@admin_bp.route("/proctoring")
@admin_required
def proctoring():
    """Live proctoring dashboard with polling updates."""
    return render_template("admin/proctoring.html")


@admin_bp.route("/proctoring/status")
@admin_required
def proctoring_status():
    """JSON status for active/recent exam sessions."""
    active_sessions = (
        StudentSession.query.filter(StudentSession.status.in_(["active", "waiting", "paused"]))
        .order_by(StudentSession.updated_at.desc())
        .limit(100)
        .all()
    )
    recent_violations = (
        ViolationLog.query.order_by(ViolationLog.occurred_at.desc())
        .limit(10)
        .all()
    )

    snapshots = [_session_snapshot(student_session) for student_session in active_sessions]

    return jsonify(
        {
            "ok": True,
            "updated_at": datetime.utcnow().isoformat(),
            "counts": {
                "active_sessions": sum(1 for item in snapshots if item["status"] == "active"),
                "waiting_sessions": sum(1 for item in snapshots if item["status"] == "waiting"),
                "paused_sessions": sum(1 for item in snapshots if item["status"] == "paused"),
                "flagged_sessions": sum(1 for item in snapshots if item["focus_violations"] > 0),
            },
            "sessions": snapshots,
            "recent_violations": [
                {
                    "id": violation.id,
                    "student_name": violation.student_session.student_name,
                    "roll_no": violation.student_session.roll_no,
                    "exam_name": violation.student_session.exam_set.exam_name,
                    "type": violation.violation_type,
                    "detail": violation.detail,
                    "occurred_at": violation.occurred_at.isoformat(),
                }
                for violation in recent_violations
            ],
        }
    )


@admin_bp.route("/violations")
@admin_required
def violations():
    """View exam integrity violations."""
    page = request.args.get("page", 1, type=int)
    active_only = request.args.get("active", "0") == "1"

    query = ViolationLog.query.join(StudentSession)
    if active_only:
        query = query.filter(StudentSession.status == "active")

    logs_paginated = query.order_by(ViolationLog.occurred_at.desc()).paginate(page=page, per_page=50)

    return render_template(
        "admin/violations.html",
        violations=logs_paginated.items,
        pagination=logs_paginated,
        active_only=active_only,
    )


@admin_bp.route("/violations/export")
@admin_required
def export_violations():
    """Export violation logs for audit/offline review."""
    active_only = request.args.get("active", "0") == "1"

    query = ViolationLog.query.join(StudentSession)
    if active_only:
        query = query.filter(StudentSession.status == "active")

    violations = query.order_by(ViolationLog.occurred_at.desc()).all()

    headers = [
        "Violation ID",
        "Occurred At",
        "Student Name",
        "Roll No",
        "Exam",
        "Set Code",
        "Session Code",
        "Session Status",
        "Violation Type",
        "Detail",
        "Client Count",
        "Session Violation Count",
        "Suspicion Score",
        "IP Address",
        "User Agent",
    ]

    rows = []
    for violation in violations:
        student_session = violation.student_session
        exam = student_session.exam_set
        rows.append(
            [
                violation.id,
                format_datetime(violation.occurred_at),
                student_session.student_name,
                student_session.roll_no,
                exam.exam_name,
                exam.set_code,
                student_session.session_code,
                student_session.status,
                violation.violation_type,
                violation.detail,
                violation.client_count,
                student_session.focus_violations,
                student_session.suspicion_score,
                violation.ip_address,
                violation.user_agent,
            ]
        )

    filename = "active_violation_logs.csv" if active_only else "violation_logs.csv"
    return csv_response(filename, headers, rows)


@admin_bp.route("/suspicious-activity")
@admin_required
def suspicious_activity():
    sessions = (
        StudentSession.query.filter(StudentSession.focus_violations > 0)
        .order_by(StudentSession.focus_violations.desc(), StudentSession.updated_at.desc())
        .all()
    )
    grouped = {}
    for student_session in sessions:
        key = (student_session.roll_no or "").upper() or f"session-{student_session.id}"
        entry = grouped.setdefault(
            key,
            {
                "student_name": student_session.student_name,
                "roll_no": student_session.roll_no,
                "exam_count": 0,
                "total_violations": 0,
                "max_suspicion_score": 0,
                "sessions": [],
            },
        )
        entry["exam_count"] += 1
        entry["total_violations"] += student_session.focus_violations
        entry["max_suspicion_score"] = max(entry["max_suspicion_score"], student_session.suspicion_score)
        entry["sessions"].append(student_session)

    rows = sorted(
        grouped.values(),
        key=lambda item: (item["exam_count"], item["total_violations"], item["max_suspicion_score"]),
        reverse=True,
    )
    return render_template("admin/suspicious_activity.html", rows=rows)


@admin_bp.route("/sessions/<int:session_id>/terminate", methods=["POST"])
@admin_required
@rate_limit("admin_action", json_response=False)
def terminate_session(session_id):
    if not _admin_password_confirmed():
        return redirect(request.referrer or url_for("admin.violations"))
    student_session = StudentSession.query.get_or_404(session_id)
    reason = request.form.get("reason", "").strip() or "Terminated by admin"

    if student_session.status not in ["submitted", "evaluated", "terminated"]:
        ExamService.end_exam(student_session.session_code, reason=reason, status="terminated")

    AuditLog(
        user_id=session.get("admin_id"),
        action="terminate_exam_session",
        resource_type="student_session",
        resource_id=student_session.id,
        reason=reason,
        status="success",
        ip_address=get_client_ip(),
    ).save()

    flash(f"Exam session for {student_session.student_name} was terminated.", "warning")
    return redirect(request.referrer or url_for("admin.violations"))


@admin_bp.route("/sessions/<int:session_id>/second-chance", methods=["POST"])
@admin_required
@rate_limit("admin_action", json_response=False)
def grant_second_chance(session_id):
    if not _admin_password_confirmed():
        return redirect(request.referrer or url_for("admin.violations"))
    student_session = StudentSession.query.get_or_404(session_id)

    if student_session.status in ["submitted", "evaluated", "terminated"]:
        flash("Locked sessions cannot be resumed.", "danger")
        return redirect(request.referrer or url_for("admin.violations"))

    student_session.status = "active"
    student_session.focus_violations = 0
    student_session.tab_switch_count = 0
    student_session.suspicion_score = 0
    student_session.last_heartbeat = datetime.utcnow()
    student_session.active_window_token = None
    student_session.active_window_heartbeat_at = None
    student_session.pause_requested_at = None
    student_session.pause_reason = None
    student_session.paused_at = None
    student_session.paused_remaining_seconds = None
    if not student_session.start_time:
        student_session.start_time = datetime.utcnow()
    db.session.commit()

    AuditLog(
        user_id=session.get("admin_id"),
        action="grant_second_chance",
        resource_type="student_session",
        resource_id=student_session.id,
        status="success",
        ip_address=get_client_ip(),
    ).save()

    flash(f"Second chance granted to {student_session.student_name}.", "success")
    return redirect(request.referrer or url_for("admin.violations"))


@admin_bp.route("/sessions/<int:session_id>/reduce-time", methods=["POST"])
@admin_required
@rate_limit("admin_action", json_response=False)
def reduce_session_time(session_id):
    if not _admin_password_confirmed():
        return redirect(request.referrer or url_for("admin.violations"))
    student_session = StudentSession.query.get_or_404(session_id)
    raw_minutes = request.form.get("minutes", "0").strip()

    try:
        minutes = int(raw_minutes)
    except ValueError:
        minutes = 0

    if minutes <= 0:
        flash("Enter a positive number of minutes.", "danger")
        return redirect(request.referrer or url_for("admin.violations"))

    if student_session.status not in ["active", "paused"]:
        flash("Time can only be reduced for active or paused sessions.", "danger")
        return redirect(request.referrer or url_for("admin.violations"))

    if student_session.status == "paused":
        student_session.paused_remaining_seconds = max(int(student_session.paused_remaining_seconds or 0) - minutes * 60, 60)
    else:
        student_session.start_time = (student_session.start_time or datetime.utcnow()) - timedelta(minutes=minutes)
    db.session.commit()

    AuditLog(
        user_id=session.get("admin_id"),
        action="reduce_exam_time",
        resource_type="student_session",
        resource_id=student_session.id,
        changes=f"Reduced remaining time by {minutes} minutes",
        status="success",
        ip_address=get_client_ip(),
    ).save()

    flash(f"Reduced {student_session.student_name}'s time by {minutes} minute(s).", "warning")
    return redirect(request.referrer or url_for("admin.violations"))


@admin_bp.route("/sessions/<int:session_id>/pause", methods=["POST"])
@admin_required
@rate_limit("admin_action", json_response=False)
def pause_session(session_id):
    if not _admin_password_confirmed():
        return redirect(request.referrer or url_for("admin.proctoring"))
    student_session = StudentSession.query.get_or_404(session_id)
    reason = request.form.get("reason", "").strip() or student_session.pause_reason or "Paused by admin"

    if not ExamService.pause_session(student_session):
        flash("Only active sessions can be paused.", "danger")
        return redirect(request.referrer or url_for("admin.proctoring"))

    AuditLog(
        user_id=session.get("admin_id"),
        action="pause_exam_session",
        resource_type="student_session",
        resource_id=student_session.id,
        reason=reason,
        status="success",
        ip_address=get_client_ip(),
    ).save()

    flash(f"Paused {student_session.student_name}'s exam timer.", "warning")
    return redirect(request.referrer or url_for("admin.proctoring"))


@admin_bp.route("/sessions/<int:session_id>/resume", methods=["POST"])
@admin_required
@rate_limit("admin_action", json_response=False)
def resume_session(session_id):
    if not _admin_password_confirmed():
        return redirect(request.referrer or url_for("admin.proctoring"))
    student_session = StudentSession.query.get_or_404(session_id)
    reason = request.form.get("reason", "").strip() or "Resumed by admin"

    if not ExamService.resume_session(student_session):
        flash("Only paused sessions can be resumed.", "danger")
        return redirect(request.referrer or url_for("admin.proctoring"))

    AuditLog(
        user_id=session.get("admin_id"),
        action="resume_exam_session",
        resource_type="student_session",
        resource_id=student_session.id,
        reason=reason,
        status="success",
        ip_address=get_client_ip(),
    ).save()

    flash(f"Resumed {student_session.student_name}'s exam.", "success")
    return redirect(request.referrer or url_for("admin.proctoring"))


@admin_bp.route("/sessions/<int:session_id>/message", methods=["POST"])
@admin_required
@rate_limit("admin_action", json_response=False)
def send_session_message(session_id):
    if not _admin_password_confirmed():
        return redirect(request.referrer or url_for("admin.proctoring"))

    student_session = StudentSession.query.get_or_404(session_id)
    message = request.form.get("message", "").strip()
    if not message:
        flash("Enter a message to send.", "danger")
        return redirect(request.referrer or url_for("admin.proctoring"))

    NotificationService.notify_session(
        student_session.id,
        message[:500],
        notification_type="admin_message",
        related_entity_type="student_session",
        related_entity_id=student_session.id,
    )
    AuditLog(
        user_id=session.get("admin_id"),
        action="send_student_message",
        resource_type="student_session",
        resource_id=student_session.id,
        changes=message[:500],
        status="success",
        ip_address=get_client_ip(),
    ).save()
    db.session.commit()
    flash(f"Message sent to {student_session.student_name}.", "success")
    return redirect(request.referrer or url_for("admin.proctoring"))


# ==================== SYSTEM SETTINGS ====================

@admin_bp.route("/settings")
@admin_required
def settings():
    """System settings and configuration"""
    platform_settings = SettingsService.get_settings()
    return render_template("admin/settings.html", settings=platform_settings)


@admin_bp.route("/settings/save", methods=["POST"])
@admin_required
def save_settings():
    """Save system settings"""
    SettingsService.update_settings(request.form, updated_by=session.get("admin_id"))
    AuditLog(
        user_id=session.get("admin_id"),
        action="update_platform_settings",
        resource_type="settings",
        resource_id=1,
        changes="Updated platform settings",
        status="success",
        ip_address=get_client_ip(),
    ).save()
    flash("Settings saved successfully!", "success")
    return redirect(url_for("admin.settings"))


@admin_bp.route("/settings/backup", methods=["POST"])
@admin_required
@rate_limit("admin_action", json_response=False)
def backup_database():
    if not _admin_password_confirmed():
        return redirect(url_for("admin.settings"))
    backup_root = current_app.config.get("BACKUP_FOLDER")
    os.makedirs(backup_root, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    database_url = str(db.engine.url)

    if database_url.startswith("sqlite"):
        source_path = db.engine.url.database
        if not source_path or not os.path.exists(source_path):
            flash("SQLite database file could not be found.", "danger")
            return redirect(url_for("admin.settings"))
        backup_path = os.path.join(backup_root, f"exam_backup_{timestamp}.db")
        shutil.copy2(source_path, backup_path)
    elif database_url.startswith("postgres"):
        backup_path = os.path.join(backup_root, f"exam_backup_{timestamp}.sql")
        try:
            subprocess.run(
                ["pg_dump", database_url, "-f", backup_path],
                check=True,
                capture_output=True,
                text=True,
                timeout=60,
            )
        except Exception as exc:
            current_app.logger.exception("Database backup failed")
            flash(f"PostgreSQL backup failed. Ensure pg_dump is installed. Details: {exc}", "danger")
            return redirect(url_for("admin.settings"))
    else:
        flash("Database backup is not configured for this database engine.", "danger")
        return redirect(url_for("admin.settings"))

    download_name = os.path.basename(backup_path)
    AuditLog(
        user_id=session.get("admin_id"),
        action="backup_database",
        resource_type="system",
        changes=download_name,
        status="success",
        ip_address=get_client_ip(),
    ).save()

    return send_file(backup_path, as_attachment=True, download_name=download_name)



