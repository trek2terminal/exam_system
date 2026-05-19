from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash, check_password_hash
from app.models.database import db


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)

    # Basic Information
    name = db.Column(db.String(100), nullable=False)
    username = db.Column(db.String(50), unique=True, nullable=False, index=True)

    # Password
    password_hash = db.Column(db.String(255), nullable=False)

    # Role & Status
    role = db.Column(db.String(20), nullable=False, default="student")  # admin, teacher, or student
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    is_verified = db.Column(db.Boolean, default=False, nullable=False)

    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    last_login = db.Column(db.DateTime, nullable=True)

    # Additional Security Fields
    failed_login_attempts = db.Column(db.Integer, default=0, nullable=False)
    locked_until = db.Column(db.DateTime, nullable=True)

    # Optional fields for future use
    email = db.Column(db.String(120), unique=True, nullable=True, index=True)
    phone = db.Column(db.String(20), nullable=True)
    profile_picture = db.Column(db.String(255), nullable=True)

    # Teacher specific fields
    department = db.Column(db.String(100), nullable=True)
    designation = db.Column(db.String(100), nullable=True)

    # Student specific fields
    roll_number = db.Column(db.String(50), nullable=True, index=True)
    class_name = db.Column(db.String(50), nullable=True)
    batch = db.Column(db.String(20), nullable=True)

    def __repr__(self):
        return f"<User {self.username} ({self.role})>"

    # ====================== PASSWORD METHODS ======================
    def set_password(self, password: str):
        """Set password with strong hashing"""
        self.password_hash = generate_password_hash(
            password,
            method='pbkdf2:sha256:600000'  # Stronger than default
        )

    def check_password(self, password: str) -> bool:
        """Verify password"""
        if not self.password_hash:
            return False
        return check_password_hash(self.password_hash, password)

    # ====================== ACCOUNT SECURITY ======================
    def increment_failed_attempts(self):
        """Increment failed login attempts"""
        self.failed_login_attempts += 1
        if self.failed_login_attempts >= 5:
            # Lock account for 30 minutes
            self.locked_until = datetime.utcnow() + timedelta(minutes=30)
        db.session.commit()

    def reset_failed_attempts(self):
        """Reset failed attempts after successful login"""
        self.failed_login_attempts = 0
        self.locked_until = None
        self.last_login = datetime.utcnow()
        db.session.commit()

    def is_account_locked(self) -> bool:
        """Check if account is temporarily locked"""
        if not self.locked_until:
            return False
        if datetime.utcnow() > self.locked_until:
            self.locked_until = None
            self.failed_login_attempts = 0
            db.session.commit()
            return False
        return True

    # ====================== ROLE CHECKS ======================
    def is_admin(self) -> bool:
        return self.role == "admin"

    def is_teacher(self) -> bool:
        return self.role == "teacher"

    def is_student(self) -> bool:
        return self.role == "student"

    # ====================== UTILITY METHODS ======================
    def update_last_login(self):
        """Update last login timestamp"""
        self.last_login = datetime.utcnow()
        db.session.commit()

    def activate(self):
        """Activate user account"""
        self.is_active = True
        db.session.commit()

    def deactivate(self):
        """Deactivate user account"""
        self.is_active = False
        db.session.commit()


# Optional: Create Admin / Superuser helper (if needed later)
class AnonymousUser:
    """For Flask-Login compatibility in future"""
    id = None
    role = None

    def is_admin(self):
        return False

    def is_teacher(self):
        return False

    def is_student(self):
        return False