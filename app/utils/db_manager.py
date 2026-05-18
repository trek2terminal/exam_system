from app.models.database import db
from app import create_app


def reset_database():
    """Drop all tables and recreate them - Safe for CLI"""
    app = create_app()
    with app.app_context():
        try:
            db.drop_all()
            db.create_all()
            print("✅ Database has been successfully reset!")
            print("   You can now run `python run.py` and create a new teacher account.")
            app.logger.info("🗑️ Database reset completed successfully.")
        except Exception as e:
            print(f"❌ Error resetting database: {e}")
            app.logger.error(f"Database reset failed: {e}")


def init_database():
    """Initialize database tables"""
    app = create_app()
    with app.app_context():
        db.create_all()
        print("✅ Database initialized successfully.")


def show_tables():
    """Show all tables"""
    app = create_app()
    with app.app_context():
        inspector = db.inspect(db.engine)
        tables = inspector.get_table_names()
        print(f"📋 Total Tables: {len(tables)}")
        for table in tables:
            print(f"   • {table}")