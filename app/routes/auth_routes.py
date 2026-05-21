from flask import Blueprint, render_template, redirect, url_for, request, session, flash
from datetime import datetime, timedelta
from app.models.database import db
from app.models.user_model import User
from app.models.audit_model import AuditLog
from app.services.settings_service import SettingsService
from app.utils.rate_limiter import rate_limit
from app.utils.network import get_client_ip

auth_bp = Blueprint("auth", __name__)


def _valid_student_password(password):
    return (
        len(password or "") >= 8
        and any(ch.isupper() for ch in password or "")
        and any(ch.isdigit() for ch in password or "")
        and any(not ch.isalnum() for ch in password or "")
    )


def _set_student_session(student_name, roll_no, student_id=None, username=None):
    session.clear()
    session.permanent = True
    session["student_id"] = student_id or hash(f"{student_name}_{roll_no}_{datetime.utcnow().isoformat()}")
    if student_id:
        session["user_id"] = student_id
        session["student_user_id"] = student_id
    if username:
        session["student_username"] = username
    session["student_name"] = student_name
    session["roll_no"] = (roll_no or "").strip().upper()
    session["role"] = "student"
    session["login_time"] = datetime.utcnow().isoformat()


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
@rate_limit("auth_login", methods=("POST",), json_response=False)
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
            admin.failed_login_attempts += 1
            if admin.failed_login_attempts >= 3:
                admin.locked_until = datetime.utcnow() + timedelta(days=3650)
                flash("Admin account is locked. Unlock it from the server CLI.", "danger")
            else:
                flash("Invalid credentials.", "danger")
            db.session.commit()
            AuditLog(
                user_id=admin.id,
                action="failed_login",
                resource_type="user",
                resource_id=admin.id,
                status="failed",
                ip_address=get_client_ip()
            ).save()
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
@rate_limit("auth_login", methods=("POST",), json_response=False)
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

        if user.must_change_password:
            flash("Please set a new password before continuing.", "warning")
            return redirect(url_for("auth.teacher_change_password"))

        flash("Login successful. Welcome back!", "success")
        return redirect(url_for("teacher.dashboard"))

    return render_template("teacher/login.html")


@auth_bp.route("/teacher/change-password", methods=["GET", "POST"])
def teacher_change_password():
    teacher_id = session.get("teacher_id")
    if not teacher_id or session.get("role") != "teacher":
        flash("Please log in as teacher first.", "danger")
        return redirect(url_for("auth.teacher_login"))

    user = User.query.get_or_404(teacher_id)
    if request.method == "POST":
        current_password = request.form.get("current_password", "")
        new_password = request.form.get("new_password", "")
        confirm_password = request.form.get("confirm_password", "")

        if not user.check_password(current_password):
            flash("Current password is not correct.", "danger")
            return redirect(url_for("auth.teacher_change_password"))
        if new_password != confirm_password:
            flash("New passwords do not match.", "danger")
            return redirect(url_for("auth.teacher_change_password"))
        if (
            len(new_password) < 10
            or not any(ch.isupper() for ch in new_password)
            or not any(ch.isdigit() for ch in new_password)
        ):
            flash("New password must be at least 10 characters and include uppercase and number.", "danger")
            return redirect(url_for("auth.teacher_change_password"))

        user.set_password(new_password)
        user.must_change_password = False
        db.session.commit()
        flash("Password updated. You can continue now.", "success")
        return redirect(url_for("teacher.dashboard"))

    return render_template("teacher/change_password.html")


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
@rate_limit("student_login", methods=("POST",), json_response=False)
def student_login():
    """Student Login"""
    platform_settings = SettingsService.get_settings()

    if request.method == "POST":
        login_mode = request.form.get("login_mode", "quick")

        if login_mode == "account":
            identifier = request.form.get("identifier", "").strip()
            password = request.form.get("password", "").strip()

            if not identifier or not password:
                flash("Username/roll number and password are required.", "danger")
                return redirect(url_for("auth.student_login"))

            user = User.query.filter(
                User.role == "student",
                db.or_(
                    User.username == identifier,
                    User.email == identifier,
                    User.roll_number == identifier.upper(),
                ),
            ).first()

            if not user:
                flash("Invalid student login details.", "danger")
                return redirect(url_for("auth.student_login"))

            if not user.is_active:
                flash("Your student account is disabled. Contact the administrator.", "danger")
                return redirect(url_for("auth.student_login"))

            if user.is_account_locked():
                flash("Account is temporarily locked. Try again later.", "danger")
                return redirect(url_for("auth.student_login"))

            if not user.check_password(password):
                user.increment_failed_attempts()
                AuditLog(
                    user_id=user.id,
                    action="failed_student_login",
                    resource_type="user",
                    resource_id=user.id,
                    status="failed",
                    ip_address=get_client_ip(),
                ).save()
                flash("Invalid student login details.", "danger")
                return redirect(url_for("auth.student_login"))

            user.reset_failed_attempts()
            _set_student_session(user.name, user.roll_number or user.username, student_id=user.id, username=user.username)

            AuditLog(
                user_id=user.id,
                action="student_login",
                resource_type="user",
                resource_id=user.id,
                status="success",
                ip_address=get_client_ip(),
            ).save()

            flash(f"Welcome {user.name}!", "success")
            return redirect(url_for("student.dashboard"))

        student_name = request.form.get("student_name", "").strip()
        roll_no = request.form.get("roll_no", "").strip().upper()

        if not student_name or not roll_no:
            flash("Student name and roll number are required.", "danger")
            return redirect(url_for("auth.student_login"))

        _set_student_session(student_name, roll_no)

        flash(f"Welcome {student_name}!", "success")
        return redirect(url_for("student.dashboard"))

    return render_template("auth/student_login.html", settings=platform_settings)


@auth_bp.route("/student/register", methods=["GET", "POST"])
@rate_limit("student_login", methods=("POST",), json_response=False)
def student_register():
    """Student self-registration, controlled by admin settings."""
    platform_settings = SettingsService.get_settings()
    if not platform_settings.student_self_registration:
        flash("Student registration is currently closed. Please use the details provided by your teacher.", "warning")
        return redirect(url_for("auth.student_login"))

    if request.method == "POST":
        name = request.form.get("name", "").strip()
        username = request.form.get("username", "").strip()
        email = request.form.get("email", "").strip() or None
        roll_no = request.form.get("roll_no", "").strip().upper()
        password = request.form.get("password", "").strip()
        confirm_password = request.form.get("confirm_password", "").strip()

        if not name or not username or not roll_no or not password or not confirm_password:
            flash("Name, username, roll number, password, and confirmation are required.", "danger")
            return redirect(url_for("auth.student_register"))

        if len(username) < 4:
            flash("Username must be at least 4 characters.", "danger")
            return redirect(url_for("auth.student_register"))

        if password != confirm_password:
            flash("Passwords do not match.", "danger")
            return redirect(url_for("auth.student_register"))

        if not _valid_student_password(password):
            flash("Password must be at least 8 characters and include uppercase, number, and special character.", "danger")
            return redirect(url_for("auth.student_register"))

        if User.query.filter_by(username=username).first():
            flash("Username already exists.", "danger")
            return redirect(url_for("auth.student_register"))

        if email and User.query.filter_by(email=email).first():
            flash("Email already exists.", "danger")
            return redirect(url_for("auth.student_register"))

        if User.query.filter_by(role="student", roll_number=roll_no).first():
            flash("A student account with this roll number already exists.", "danger")
            return redirect(url_for("auth.student_register"))

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
        db.session.commit()

        AuditLog(
            user_id=student.id,
            action="student_self_register",
            resource_type="user",
            resource_id=student.id,
            status="success",
            ip_address=get_client_ip(),
        ).save()

        _set_student_session(student.name, student.roll_number, student_id=student.id, username=student.username)
        flash("Student account created. Welcome!", "success")
        return redirect(url_for("student.dashboard"))

    return render_template("auth/student_register.html", settings=platform_settings)


@auth_bp.route("/student/logout")
def student_logout():
    """Student Logout"""
    session.clear()
    flash("You have been logged out.", "info")
    return redirect(url_for("auth.login_selector"))
