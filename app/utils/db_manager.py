from app.models.database import db
from flask import current_app
import os


def reset_database():
    """Drop all tables and recreate them (Useful during development)"""
    with current_app.app_context():
        try:
            db.drop_all()
            db.create_all()
            current_app.logger.info("🗑️ All tables dropped and recreated successfully!")
            print("✅ Database has been reset successfully!")
        except Exception as e:
            current_app.logger.error(f"Error resetting database: {e}")
            print(f"❌ Error: {e}")


def init_database():
    """Initialize database (create tables if not exist)"""
    with current_app.app_context():
        db.create_all()
        current_app.logger.info("✅ Database initialized.")


def show_tables():
    """Show all tables in database"""
    with current_app.app_context():
        inspector = db.inspect(db.engine)
        tables = inspector.get_table_names()
        print(f"📋 Tables in database: {len(tables)}")
        for table in tables:
            print(f"   • {table}")