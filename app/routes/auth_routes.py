from flask import Blueprint, render_template, redirect, url_for, request, session, flash
from datetime import datetime
from app.models.database import db
from app.models.user_model import User
from app.models.audit_model import AuditLog
from app.utils.network import get_client_ip

auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/")
def root():
    """Redirect to appropriate login based on user role"""
    if session.get("admin_id"):
        return redirect(url_for("admin.dashboard"))
    elif session.get("teacher_id"):
        return redirect(url_for("teacher.dashboard"))
    else:
        return redirect(url_for("auth.login_selector"))


@auth_bp.route("/login")
def login_selector():
    """Login selector page"""
    return render_template("auth/login_selector.html")


# ==================== ADMIN SETUP & LOGIN ====================

@auth_bp.route("/admin/setup", methods=["GET", "POST"])
def admin_setup():
    """Initial admin setup - only allowed if no admin exists"""
    admin_exists = User.query.filter_by(role="admin").first()
    if admin_exists:
        return redirect(url_for("auth.admin_login"))

    if request.method == "POST":
        name = request.form.get("name", "").strip()
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "").strip()
        confirm_password = request.form.get("confirm_password", "").strip()

        # Validation
        if not name or not username or not password or not confirm_password:
            flash("All fields are required.", "danger")
            return redirect(url_for("auth.admin_setup"))

        if password != confirm_password:
            flash("Passwords do not match.", "danger")
            return redirect(url_for("auth.admin_setup"))

        if len(password) < 10:
            flash("Admin password must be at least 10 characters long.", "danger")
            return redirect(url_for("auth.admin_setup"))

        if len(username) < 5:
            flash("Username must be at least 5 characters long.", "danger")
            return redirect(url_for("auth.admin_setup"))

        if User.query.filter_by(username=username).first():
            flash("Username already exists. Please choose another.", "danger")
            return redirect(url_for("auth.admin_setup"))

        # Create admin user
        admin = User(
            name=name,
            username=username,
            role="admin",
            is_active=True,
            is_verified=True,
            created_at=datetime.utcnow()
        )
        admin.set_password(password)

        db.session.add(admin)
        db.session.commit()

        # Log audit
        AuditLog(
            user_id=admin.id,
            action="admin_setup",
            resource_type="user",
            resource_id=admin.id,
            status="success",
            ip_address=get_client_ip()
        ).save()

        flash("Admin account created successfully. Please login.", "success")
        return redirect(url_for("auth.admin_login"))

    return render_template("auth/admin_setup.html")


@auth_bp.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    """Admin Login"""
    if not User.query.filter_by(role="admin").first():
        return redirect(url_for("auth.admin_setup"))

    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "").strip()

        if not username or not password:
            flash("Username and password are required.", "danger")
            return redirect(url_for("auth.admin_login"))

        admin = User.query.filter_by(username=username, role="admin").first()

        if not admin:
            flash("Invalid credentials.", "danger")
            return redirect(url_for("auth.admin_login"))

        if not admin.is_active:
            flash("Admin account is disabled.", "danger")
            return redirect(url_for("auth.admin_login"))

        if admin.is_account_locked():
            flash("Account is temporarily locked. Try again later.", "danger")
            return redirect(url_for("auth.admin_login"))

        if not admin.check_password(password):
            admin.increment_failed_attempts()
            AuditLog(
                user_id=admin.id,
                action="failed_login",
                resource_type="user",
                resource_id=admin.id,
                status="failed",
                ip_address=get_client_ip()
            ).save()
            flash("Invalid credentials.", "danger")
            return redirect(url_for("auth.admin_login"))

        # Successful login
        admin.reset_failed_attempts()
        session.clear()
        session.permanent = True

        session["user_id"] = admin.id
        session["admin_id"] = admin.id
        session["admin_name"] = admin.name
        session["admin_username"] = admin.username
        session["role"] = "admin"
        session["login_time"] = datetime.utcnow().isoformat()

        AuditLog(
            user_id=admin.id,
            action="login",
            resource_type="user",
            resource_id=admin.id,
            status="success",
            ip_address=get_client_ip()
        ).save()

        flash("Welcome Admin! You are logged in.", "success")
        return redirect(url_for("admin.dashboard"))

    return render_template("auth/admin_login.html")


@auth_bp.route("/admin/logout")
def admin_logout():
    """Admin Logout"""
    if session.get("admin_id"):
        AuditLog(
            user_id=session.get("admin_id"),
            action="logout",
            resource_type="user",
            resource_id=session.get("admin_id"),
            status="success",
            ip_address=get_client_ip()
        ).save()
    session.clear()
    flash("You have been logged out.", "info")
    return redirect(url_for("auth.login_selector"))


# ==================== TEACHER LOGIN ====================

@auth_bp.route("/teacher/setup-account", methods=["GET", "POST"])
def teacher_setup():
    """Teacher account setup - Deprecated (use admin to create teachers)"""
    flash("Teacher accounts are now created by the admin. Contact your administrator.", "warning")
    return redirect(url_for("auth.teacher_login"))


@auth_bp.route("/teacher/login", methods=["GET", "POST"])
def teacher_login():
    """Teacher Login"""
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "").strip()

        if not username or not password:
            flash("Username and password are required.", "danger")
            return redirect(url_for("auth.teacher_login"))

        user = User.query.filter_by(username=username, role="teacher").first()

        if not user:
            flash("Invalid username or password.", "danger")
            return redirect(url_for("auth.teacher_login"))

        if not user.is_active:
            flash("Your account is disabled by the administrator.", "danger")
            return redirect(url_for("auth.teacher_login"))

        if user.is_account_locked():
            flash("Account is temporarily locked due to multiple failed attempts. Try again later.", "danger")
            return redirect(url_for("auth.teacher_login"))

        if not user.check_password(password):
            user.increment_failed_attempts()
            AuditLog(
                user_id=user.id,
                action="failed_login",
                resource_type="user",
                resource_id=user.id,
                status="failed",
                ip_address=get_client_ip()
            ).save()
            flash("Invalid username or password.", "danger")
            return redirect(url_for("auth.teacher_login"))

        # Successful login
        user.reset_failed_attempts()
        session.clear()
        session.permanent = True

        session["user_id"] = user.id
        session["teacher_id"] = user.id
        session["teacher_name"] = user.name
        session["teacher_username"] = user.username
        session["role"] = "teacher"
        session["login_time"] = datetime.utcnow().isoformat()

        AuditLog(
            user_id=user.id,
            action="login",
            resource_type="user",
            resource_id=user.id,
            status="success",
            ip_address=get_client_ip()
        ).save()

        flash("Login successful. Welcome back!", "success")
        return redirect(url_for("teacher.dashboard"))

    return render_template("teacher/login.html")


@auth_bp.route("/teacher/logout")
def teacher_logout():
    """Secure logout"""
    if session.get("teacher_id"):
        AuditLog(
            user_id=session.get("teacher_id"),
            action="logout",
            resource_type="user",
            resource_id=session.get("teacher_id"),
            status="success",
            ip_address=get_client_ip()
        ).save()
    session.clear()
    flash("You have been logged out successfully.", "info")
    return redirect(url_for("auth.login_selector"))


# ==================== STUDENT LOGIN ====================

@auth_bp.route("/student/login", methods=["GET", "POST"])
def student_login():
    """Student Login"""
    if request.method == "POST":
        student_name = request.form.get("student_name", "").strip()
        roll_no = request.form.get("roll_no", "").strip()

        if not student_name or not roll_no:
            flash("Student name and roll number are required.", "danger")
            return redirect(url_for("auth.student_login"))

        # For students, we create a session without persistent account
        session.clear()
        session.permanent = True
        session["student_id"] = hash(f"{student_name}_{roll_no}_{datetime.utcnow().isoformat()}")
        session["student_name"] = student_name
        session["roll_no"] = roll_no
        session["role"] = "student"
        session["login_time"] = datetime.utcnow().isoformat()

        flash(f"Welcome {student_name}!", "success")
        return redirect(url_for("student.join_exam"))

    return render_template("auth/student_login.html")


@auth_bp.route("/student/logout")
def student_logout():
    """Student Logout"""
    session.clear()
    flash("You have been logged out.", "info")
    return redirect(url_for("auth.login_selector"))
