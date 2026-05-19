from flask import Blueprint, render_template, request, jsonify, redirect, url_for, flash, session
from datetime import datetime, timedelta
from app.models.database import db
from app.models.user_model import User
from app.models.exam_model import ExamSet, Question
from app.models.submission_model import StudentSession, Answer
from app.models.result_model import Result
from app.models.audit_model import AuditLog
from app.utils.helpers import admin_required
from app.utils.network import get_client_ip

admin_bp = Blueprint("admin", __name__, url_prefix="/admin")


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
            return redirect(url_for("admin.create_teacher"))

        if len(password) < 8:
            flash("Password must be at least 8 characters long.", "danger")
            return redirect(url_for("admin.create_teacher"))

        if User.query.filter_by(username=username).first():
            flash("Username already exists.", "danger")
            return redirect(url_for("admin.create_teacher"))

        if email and User.query.filter_by(email=email).first():
            flash("Email already exists.", "danger")
            return redirect(url_for("admin.create_teacher"))

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

    return render_template("admin/create_teacher.html")


@admin_bp.route("/users/<int:user_id>/toggle-status", methods=["POST"])
@admin_required
def toggle_user_status(user_id):
    """Enable/Disable user account"""
    user = User.query.get_or_404(user_id)

    if user.role == "admin":
        return jsonify({"ok": False, "message": "Cannot disable admin accounts"}), 400

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
    ).join(StudentSession).outerjoin(Result).group_by(ExamSet.id).order_by(
        db.desc('avg_percentage')
    ).limit(10).all()

    # Teacher activity
    teacher_activity = db.session.query(
        User.name,
        db.func.count(ExamSet.id).label('exams_created'),
        db.func.count(StudentSession.id).label('total_students')
    ).join(ExamSet).outerjoin(StudentSession).filter(
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


# ==================== SYSTEM SETTINGS ====================

@admin_bp.route("/settings")
@admin_required
def settings():
    """System settings and configuration"""
    return render_template("admin/settings.html")


@admin_bp.route("/settings/save", methods=["POST"])
@admin_required
def save_settings():
    """Save system settings"""
    # Future: Save to config table
    flash("Settings saved successfully!", "success")
    return redirect(url_for("admin.settings"))



