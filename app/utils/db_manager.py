from app import create_app
from app.models.database import db
from app.services.migration_service import MigrationService


def reset_database():
    """Drop all tables and recreate them. Development/local helper only."""
    app = create_app()
    with app.app_context():
        try:
            db.drop_all()
            db.create_all()
            MigrationService.run_pending(app)
            print("Database has been successfully reset.")
            print("You can now run `python run.py` normally.")
            app.logger.info("Database reset completed successfully.")
        except Exception as exc:
            print(f"Error resetting database: {exc}")
            app.logger.error("Database reset failed: %s", exc)


def init_database():
    """Initialize database tables and run pending migrations."""
    app = create_app()
    with app.app_context():
        db.create_all()
        applied = MigrationService.run_pending(app)
        print("Database initialized successfully.")
        if applied:
            print(f"Applied migrations: {', '.join(applied)}")


def show_tables():
    """Show all database tables."""
    app = create_app()
    with app.app_context():
        inspector = db.inspect(db.engine)
        tables = inspector.get_table_names()
        print(f"Total tables: {len(tables)}")
        for table in tables:
            print(f"   - {table}")


def show_migrations():
    """Show recorded migration status."""
    app = create_app()
    with app.app_context():
        rows = MigrationService.status_rows()
        print(f"Schema migrations: {len(rows)}")
        for row in rows:
            status = "applied" if row["applied"] else "pending"
            print(f"   {status:<8} {row['version']} - {row['description']}")


def migrate_database():
    """Run pending recorded migrations."""
    app = create_app()
    with app.app_context():
        applied = MigrationService.run_pending(app)
        if applied:
            print("Applied migrations:")
            for version in applied:
                print(f"   {version}")
        else:
            print("No pending migrations.")
