from flask import Blueprint, render_template, redirect, url_for, request, session, flash
from datetime import datetime
from app.models.database import db
from app.models.user_model import User

auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/")
def root():
    return redirect(url_for("auth.teacher_login"))


@auth_bp.route("/teacher/setup-account", methods=["GET", "POST"])
def teacher_setup():
    """Initial teacher account setup - Only allowed if no teacher exists"""
    teacher_exists = User.query.filter_by(role="teacher").first()
    if teacher_exists:
        return redirect(url_for("auth.teacher_login"))

    if request.method == "POST":
        name = request.form.get("name", "").strip()
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "").strip()

        # Server-side validation
        if not name or not username or not password:
            flash("All fields are required.", "danger")
            return redirect(url_for("auth.teacher_setup"))

        if len(password) < 8:
            flash("Password must be at least 8 characters long.", "danger")
            return redirect(url_for("auth.teacher_setup"))

        if len(username) < 4:
            flash("Username must be at least 4 characters long.", "danger")
            return redirect(url_for("auth.teacher_setup"))

        # Check if username already exists
        if User.query.filter_by(username=username).first():
            flash("Username already exists. Please choose another.", "danger")
            return redirect(url_for("auth.teacher_setup"))

        # Create new teacher
        user = User(
            name=name,
            username=username,
            role="teacher",
            is_active=True,
            is_verified=True,
            created_at=datetime.utcnow()
        )
        user.set_password(password)

        db.session.add(user)
        db.session.commit()

        flash("Teacher account created successfully. Please login.", "success")
        return redirect(url_for("auth.teacher_login"))

    return render_template("teacher/account_setup.html")


@auth_bp.route("/teacher/login", methods=["GET", "POST"])
def teacher_login():
    """Teacher Login with improved security"""
    # Redirect to setup if no teacher account exists
    if not User.query.filter_by(role="teacher").first():
        return redirect(url_for("auth.teacher_setup"))

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

        # Check if account is locked
        if user.is_account_locked():
            flash("Account is temporarily locked due to multiple failed attempts. Try again later.", "danger")
            return redirect(url_for("auth.teacher_login"))

        # Verify password
        if not user.check_password(password):
            user.increment_failed_attempts()
            flash("Invalid username or password.", "danger")
            return redirect(url_for("auth.teacher_login"))

        # Successful login
        user.reset_failed_attempts()

        # Secure session handling
        session.clear()                    # Clear any old session data
        session.permanent = True

        session["user_id"] = user.id
        session["teacher_id"] = user.id
        session["teacher_name"] = user.name
        session["teacher_username"] = user.username
        session["role"] = "teacher"
        session["login_time"] = datetime.utcnow().isoformat()

        flash("Login successful. Welcome back!", "success")
        return redirect(url_for("teacher.dashboard"))

    return render_template("teacher/login.html")


@auth_bp.route("/teacher/logout")
def teacher_logout():
    """Secure logout"""
    session.clear()
    flash("You have been logged out successfully.", "info")
    return redirect(url_for("auth.teacher_login"))


# ==================== FUTURE STUDENT AUTH (Ready for extension) ====================

@auth_bp.route("/student/login", methods=["GET", "POST"])
def student_login():
    """Placeholder for Student Login"""
    flash("Student login will be available soon.", "info")
    return redirect(url_for("auth.teacher_login"))  # Temporary redirect