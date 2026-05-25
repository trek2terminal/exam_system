import secrets
import string
from datetime import datetime

from app.models.database import db


def generate_group_join_code(length=8):
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


class StudentGroup(db.Model):
    __tablename__ = "student_groups"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), unique=True, nullable=False, index=True)
    description = db.Column(db.Text, nullable=True)
    join_code = db.Column(db.String(16), unique=True, nullable=True, index=True, default=generate_group_join_code)
    created_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    creator = db.relationship("User")
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    members = db.relationship(
        "StudentGroupMember",
        back_populates="group",
        lazy=True,
        cascade="all, delete-orphan",
    )


class StudentGroupMember(db.Model):
    __tablename__ = "student_group_members"
    __table_args__ = (
        db.UniqueConstraint("group_id", "student_id", name="uq_student_group_member"),
    )

    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey("student_groups.id"), nullable=False, index=True)
    student_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    group = db.relationship("StudentGroup", back_populates="members")
    student = db.relationship("User")
