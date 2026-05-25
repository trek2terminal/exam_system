from datetime import datetime

from app.models.database import db


class Draft(db.Model):
    __tablename__ = "drafts"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    user = db.relationship("User")
    user_role = db.Column(db.String(20), nullable=False, index=True)
    draft_type = db.Column(db.String(120), nullable=False, index=True)
    draft_data = db.Column(db.Text, nullable=False, default="{}")
    title_preview = db.Column(db.String(240), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False, index=True)

    __table_args__ = (
        db.UniqueConstraint("user_id", "draft_type", name="uq_drafts_user_type"),
    )

    def __repr__(self):
        return f"<Draft {self.user_id}:{self.draft_type}>"
