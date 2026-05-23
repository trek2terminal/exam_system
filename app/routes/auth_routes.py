from flask import Blueprint, redirect, url_for, request, session, flash, jsonify
from datetime import datetime, timedelta
from app.models.database import db
from app.models.user_model import User
from app.models.audit_model import AuditLog
from app.services.notification_service import NotificationService
from app.services.settings_service import SettingsService
from app.utils.helpers import current_session_matches_user
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


def _set_student_session(student_name, roll_no, student_id=None, username=None, auth_session_token=None):
    session.clear()
    session.permanent = True
    session["student_id"] = student_id or hash(f"{student_name}_{roll_no}_{datetime.utcnow().isoformat()}")
    if student_id:
        session["user_id"] = student_id
        session["student_user_id"] = student_id
    if auth_session_token:
        session["auth_session_token"] = auth_session_token
    if username:
        session["student_username"] = username
    session["student_name"] = student_name
    session["roll_no"] = (roll_no or "").strip().upper()
    session["role"] = "student"
    session["login_time"] = datetime.utcnow().isoformat()


def _wants_json_response():
    return (
        request.is_json
        or "application/json" in (request.headers.get("Accept") or "")
        or request.headers.get("X-Requested-With") == "XMLHttpRequest"
    )


def _admin_login_failure(message, status_code=400, **extra):
    if _wants_json_response():
        payload = {"ok": False, "message": message}
        payload.update(extra)
        return jsonify(payload), status_code
    flash(message, "danger")
    return redirect(url_for("auth.admin_login"))


def _lockout_payload(user):
    if not user or not user.locked_until:
        return {}
    remaining = max(int((user.locked_until - datetime.utcnow()).total_seconds()), 0)
    if remaining > 24 * 60 * 60:
        return {
            "locked": True,
            "server_unlock_required": True,
            "locked_until": user.locked_until.isoformat(),
        }
    return {
        "locked": True,
        "retry_after_seconds": remaining,
        "retry_after_minutes": max((remaining + 59) // 60, 1),
        "locked_until": user.locked_until.isoformat(),
    }


@auth_bp.route("/")
def root():
    """Redirect to appropriate login based on user role"""
    if session.get("admin_id"):
        return redirect("/react/admin")
    elif session.get("teacher_id"):
        return redirect("/react/teacher")
    elif session.get("student_id"):
        return redirect("/react/student")
    else:
        return redirect("/react/login")


@auth_bp.route("/login")
def login_selector():
    """Login selector page"""
    return redirect("/react/login")


# ==================== ADMIN SETUP & LOGIN ====================

@auth_bp.route("/admin/setup", methods=["GET", "POST"])
def admin_setup():
    """Initial admin setup - only allowed if no admin exists"""
    admin_exists = User.query.filter_by(role="admin").first()
    if admin_exists:
        return redirect("/react/admin/login")

    if request.method == "GET":
        return redirect("/react/admin/setup")

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
        return redirect("/react/admin/login")

    return redirect("/react/admin/setup")


@auth_bp.route("/admin/login", methods=["GET", "POST"])
@rate_limit("auth_login", methods=("POST",), json_response=False)
def admin_login():
    """Admin Login"""
    if not User.query.filter_by(role="admin").first():
        if _wants_json_response():
            return jsonify({"ok": False, "message": "Admin setup is required before sign in.", "setup_required": True}), 409
        return redirect(url_for("auth.admin_setup"))

    if request.method == "POST":
        payload = request.get_json(silent=True) if request.is_json else request.form
        payload = payload or {}
        username = (payload.get("username") or "").strip()
        password = (payload.get("password") or "").strip()

        if not username or not password:
            return _admin_login_failure("Username and password are required.")

        admin = User.query.filter_by(username=username, role="admin").first()

        if not admin:
            return _admin_login_failure("Invalid credentials.", 401)

        if not admin.is_active:
            return _admin_login_failure("Admin account is disabled.", 403)

        if admin.is_account_locked():
            return _admin_login_failure(
                "Account locked. Unlock it from the server CLI." if admin.locked_until and (admin.locked_until - datetime.utcnow()).days > 1 else "Account locked. Try again later.",
                423,
                **_lockout_payload(admin),
            )

        if not admin.check_password(password):
            admin.failed_login_attempts += 1
            if admin.failed_login_attempts >= 3:
                admin.locked_until = datetime.utcnow() + timedelta(days=3650)
                message = "Admin account is locked. Unlock it from the server CLI."
            else:
                message = "Invalid credentials."
            db.session.commit()
            AuditLog(
                user_id=admin.id,
                action="failed_login",
                resource_type="user",
                resource_id=admin.id,
                status="failed",
                ip_address=get_client_ip()
            ).save()
            return _admin_login_failure(
                message,
                423 if admin.failed_login_attempts >= 3 else 401,
                failed_attempts=admin.failed_login_attempts,
                attempts_remaining=max(3 - admin.failed_login_attempts, 0),
                **_lockout_payload(admin),
            )

        # Successful login
        admin.reset_failed_attempts()
        auth_session_token = admin.issue_active_session_token()
        db.session.commit()
        session.clear()
        session.permanent = True

        session["user_id"] = admin.id
        session["admin_id"] = admin.id
        session["admin_name"] = admin.name
        session["admin_username"] = admin.username
        session["role"] = "admin"
        session["auth_session_token"] = auth_session_token
        session["login_time"] = datetime.utcnow().isoformat()
        session["admin_last_activity"] = datetime.utcnow().isoformat()

        AuditLog(
            user_id=admin.id,
            action="login",
            resource_type="user",
            resource_id=admin.id,
            status="success",
            ip_address=get_client_ip()
        ).save()

        flash("Welcome Admin! You are logged in.", "success")
        if _wants_json_response():
            return jsonify({"ok": True, "message": "Welcome Admin!", "redirect": "/react/admin"})
        return redirect("/react/admin")

    return redirect("/react/admin/login")


@auth_bp.route("/admin/logout")
def admin_logout():
    """Admin Logout"""
    admin_id = session.get("admin_id")
    auth_session_token = session.get("auth_session_token")
    if admin_id:
        AuditLog(
            user_id=admin_id,
            action="logout",
            resource_type="user",
            resource_id=admin_id,
            status="success",
            ip_address=get_client_ip()
        ).save()
        admin = User.query.get(admin_id)
        if admin:
            admin.clear_active_session_token(auth_session_token)
            db.session.commit()
    session.clear()
    flash("You have been logged out.", "info")
    return redirect("/react/login")


# ==================== TEACHER LOGIN ====================

@auth_bp.route("/teacher/setup-account", methods=["GET", "POST"])
def teacher_setup():
    """Teacher account setup - Deprecated (use admin to create teachers)"""
    flash("Teacher accounts are now created by the admin. Contact your administrator.", "warning")
    return redirect("/react/login")


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
        auth_session_token = user.issue_active_session_token()
        db.session.commit()
        session.clear()
        session.permanent = True

        session["user_id"] = user.id
        session["teacher_id"] = user.id
        session["teacher_name"] = user.name
        session["teacher_username"] = user.username
        session["role"] = "teacher"
        session["auth_session_token"] = auth_session_token
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
        return redirect("/react/teacher")

    return redirect("/react/login")


@auth_bp.route("/teacher/change-password", methods=["GET", "POST"])
def teacher_change_password():
    teacher_id = session.get("teacher_id")
    if not teacher_id or session.get("role") != "teacher":
        flash("Please log in as teacher first.", "danger")
        return redirect("/react/login")

    user = User.query.get_or_404(teacher_id)
    if not current_session_matches_user(user):
        session.clear()
        flash("This teacher account is active in another browser. Please log in again here.", "warning")
        return redirect("/react/login")
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
        session["auth_session_token"] = user.issue_active_session_token()
        session.modified = True
        db.session.commit()
        flash("Password updated. You can continue now.", "success")
        return redirect("/react/teacher")

    return redirect("/react/settings")


@auth_bp.route("/teacher/logout")
def teacher_logout():
    """Secure logout"""
    teacher_id = session.get("teacher_id")
    auth_session_token = session.get("auth_session_token")
    if teacher_id:
        AuditLog(
            user_id=teacher_id,
            action="logout",
            resource_type="user",
            resource_id=teacher_id,
            status="success",
            ip_address=get_client_ip()
        ).save()
        teacher = User.query.get(teacher_id)
        if teacher:
            teacher.clear_active_session_token(auth_session_token)
            db.session.commit()
    session.clear()
    flash("You have been logged out successfully.", "info")
    return redirect("/react/login")


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
            auth_session_token = user.issue_active_session_token()
            db.session.commit()
            _set_student_session(
                user.name,
                user.roll_number or user.username,
                student_id=user.id,
                username=user.username,
                auth_session_token=auth_session_token,
            )

            AuditLog(
                user_id=user.id,
                action="student_login",
                resource_type="user",
                resource_id=user.id,
                status="success",
                ip_address=get_client_ip(),
            ).save()

            flash(f"Welcome {user.name}!", "success")
            return redirect("/react/student")

        student_name = request.form.get("student_name", "").strip()
        roll_no = request.form.get("roll_no", "").strip().upper()

        if not student_name or not roll_no:
            flash("Student name and roll number are required.", "danger")
            return redirect(url_for("auth.student_login"))

        _set_student_session(student_name, roll_no)

        flash(f"Welcome {student_name}!", "success")
        return redirect("/react/student")

    return redirect("/react/login")


@auth_bp.route("/student/register", methods=["GET", "POST"])
@rate_limit("student_login", methods=("POST",), json_response=False)
def student_register():
    """Student self-registration, controlled by admin settings."""
    platform_settings = SettingsService.get_settings()
    if not platform_settings.student_self_registration:
        flash("Student registration is currently closed. Please use the details provided by your teacher.", "warning")
        return redirect("/react/login")

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
        auth_session_token = student.issue_active_session_token()
        db.session.commit()

        AuditLog(
            user_id=student.id,
            action="student_self_register",
            resource_type="user",
            resource_id=student.id,
            status="success",
            ip_address=get_client_ip(),
        ).save()
        NotificationService.notify_role(
            "admin",
            f"New student registered: {student.name} ({student.roll_number}).",
            notification_type="student_registered",
            related_entity_type="user",
            related_entity_id=student.id,
        )
        db.session.commit()

        _set_student_session(
            student.name,
            student.roll_number,
            student_id=student.id,
            username=student.username,
            auth_session_token=auth_session_token,
        )
        flash("Student account created. Welcome!", "success")
        return redirect("/react/student")

    return redirect("/react/register")


@auth_bp.route("/student/logout")
def student_logout():
    """Student Logout"""
    student_user_id = session.get("student_user_id")
    auth_session_token = session.get("auth_session_token")
    if student_user_id:
        student = User.query.get(student_user_id)
        if student:
            student.clear_active_session_token(auth_session_token)
            db.session.commit()
    session.clear()
    flash("You have been logged out.", "info")
    return redirect("/react/login")
