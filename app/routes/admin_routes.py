import re
import os
from flask import Blueprint, render_template, request, jsonify, redirect, url_for, flash, session, current_app
from datetime import datetime, timedelta
from werkzeug.utils import secure_filename
from app.models.database import db
from app.models.user_model import User
from app.models.exam_model import ExamSet, Question
from app.models.submission_model import StudentSession, Answer
from app.models.result_model import Result
from app.models.audit_model import AuditLog, ViolationLog
from app.services.exam_service import ExamService
from app.services.settings_service import SettingsService
from app.utils.export_utils import csv_response, format_datetime
from app.utils.helpers import admin_required, get_remaining_seconds
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
        "remaining_seconds": get_remaining_seconds(exam, student_session.start_time),
        "answered_count": answered_count,
        "total_questions": total_questions,
        "focus_violations": student_session.focus_violations,
        "suspicion_score": student_session.suspicion_score,
        "last_heartbeat_age": heartbeat_age,
        "latest_violation": latest_violation.violation_type if latest_violation else None,
        "latest_violation_at": latest_violation.occurred_at.isoformat() if latest_violation else None,
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
    completed_sessions = StudentSession.query.filter_by(status="submitted").count()
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

    query = User.query.filter(User.role != "student")

    if role_filter != "all":
        query = query.filter_by(role=role_filter)

    users_paginated = query.order_by(User.created_at.desc()).paginate(page=page, per_page=20)

    return render_template(
        "admin/users.html",
        users=users_paginated.items,
        pagination=users_paginated,
        role_filter=role_filter
    )


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

        if role not in {"admin", "teacher"}:
            flash("Role must be admin or teacher.", "danger")
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
    submitted = sum(1 for s in sessions if s.status in ["submitted", "evaluated"])
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
        StudentSession.query.filter(StudentSession.status.in_(["active", "waiting"]))
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


@admin_bp.route("/sessions/<int:session_id>/terminate", methods=["POST"])
@admin_required
@rate_limit("admin_action", json_response=False)
def terminate_session(session_id):
    student_session = StudentSession.query.get_or_404(session_id)
    reason = request.form.get("reason", "").strip() or "Terminated by admin"

    if student_session.status not in ["submitted", "evaluated"]:
        ExamService.end_exam(student_session.session_code, reason=reason)

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
    student_session = StudentSession.query.get_or_404(session_id)

    if student_session.status in ["submitted", "evaluated"]:
        flash("Submitted sessions cannot be resumed.", "danger")
        return redirect(request.referrer or url_for("admin.violations"))

    student_session.status = "active"
    student_session.focus_violations = 0
    student_session.tab_switch_count = 0
    student_session.suspicion_score = 0
    student_session.last_heartbeat = datetime.utcnow()
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
    student_session = StudentSession.query.get_or_404(session_id)
    raw_minutes = request.form.get("minutes", "0").strip()

    try:
        minutes = int(raw_minutes)
    except ValueError:
        minutes = 0

    if minutes <= 0:
        flash("Enter a positive number of minutes.", "danger")
        return redirect(request.referrer or url_for("admin.violations"))

    if student_session.status != "active":
        flash("Time can only be reduced for active sessions.", "danger")
        return redirect(request.referrer or url_for("admin.violations"))

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



