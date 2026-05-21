from datetime import datetime

from app.models.database import db


class SchemaMigration(db.Model):
    __tablename__ = "schema_migrations"

    id = db.Column(db.Integer, primary_key=True)
    version = db.Column(db.String(80), unique=True, nullable=False, index=True)
    description = db.Column(db.String(255), nullable=False)
    applied_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<SchemaMigration {self.version}>"
