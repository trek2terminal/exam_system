from sqlalchemy import inspect, text

from app.models.database import db
from app.models.migration_model import SchemaMigration
from app.models.settings_model import PlatformSettings


class MigrationService:
    """Tiny recorded migration runner for the local SQLite-first Flask app."""

    @staticmethod
    def _inspector():
        return inspect(db.engine)

    @staticmethod
    def _has_table(table_name):
        return table_name in MigrationService._inspector().get_table_names()

    @staticmethod
    def _has_column(table_name, column_name):
        if not MigrationService._has_table(table_name):
            return False
        columns = MigrationService._inspector().get_columns(table_name)
        return column_name in {column["name"] for column in columns}

    @staticmethod
    def _add_column_if_missing(table_name, column_name, column_type):
        if MigrationService._has_column(table_name, column_name):
            return False

        with db.engine.begin() as connection:
            connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"))
        return True

    @staticmethod
    def _has_index(table_name, index_name):
        if not MigrationService._has_table(table_name):
            return False
        indexes = MigrationService._inspector().get_indexes(table_name)
        return index_name in {index["name"] for index in indexes}

    @staticmethod
    def _create_index_if_missing(table_name, index_name, column_name, unique=False):
        if MigrationService._has_index(table_name, index_name):
            return False

        unique_sql = "UNIQUE " if unique else ""
        with db.engine.begin() as connection:
            connection.execute(
                text(f"CREATE {unique_sql}INDEX IF NOT EXISTS {index_name} ON {table_name} ({column_name})")
            )
        return True

    @staticmethod
    def _migration_answer_code_execution_columns():
        MigrationService._add_column_if_missing("answers", "code_output", "TEXT")
        MigrationService._add_column_if_missing("answers", "execution_status", "VARCHAR(30)")
        MigrationService._add_column_if_missing("answers", "execution_time_ms", "INTEGER")

    @staticmethod
    def _migration_student_session_tokens():
        MigrationService._add_column_if_missing("student_sessions", "session_token", "VARCHAR(128)")
        MigrationService._create_index_if_missing(
            "student_sessions",
            "ix_student_sessions_session_token",
            "session_token",
            unique=True,
        )

    @staticmethod
    def _migration_platform_settings_seed():
        if PlatformSettings.query.first():
            return

        settings = PlatformSettings(
            platform_name="Exam System",
            welcome_message="Calm assessment space",
            student_self_registration=False,
            max_violations_before_alert=3,
            quote_pool="\n".join(
                [
                    "One question at a time is enough.",
                    "Read calmly, answer clearly, and trust your preparation.",
                    "A steady mind does better work than a rushed one.",
                    "You do not need to be perfect. You only need to be present.",
                ]
            ),
        )
        db.session.add(settings)
        db.session.commit()

    MIGRATIONS = [
        (
            "20260521_001_answer_code_execution_columns",
            "Add code execution output columns to answers",
            _migration_answer_code_execution_columns.__func__,
        ),
        (
            "20260521_002_platform_settings_seed",
            "Seed default platform settings row",
            _migration_platform_settings_seed.__func__,
        ),
        (
            "20260521_003_student_session_tokens",
            "Add private attempt token to student exam sessions",
            _migration_student_session_tokens.__func__,
        ),
    ]

    @staticmethod
    def applied_versions():
        if not MigrationService._has_table("schema_migrations"):
            return set()
        return {migration.version for migration in SchemaMigration.query.all()}

    @staticmethod
    def _migration_already_satisfied(version):
        if version == "20260521_001_answer_code_execution_columns":
            return all(
                MigrationService._has_column("answers", column_name)
                for column_name in ("code_output", "execution_status", "execution_time_ms")
            )
        if version == "20260521_002_platform_settings_seed":
            return PlatformSettings.query.first() is not None
        if version == "20260521_003_student_session_tokens":
            return (
                MigrationService._has_column("student_sessions", "session_token")
                and MigrationService._has_index("student_sessions", "ix_student_sessions_session_token")
            )
        return False

    @staticmethod
    def run_pending(app=None):
        applied = MigrationService.applied_versions()
        applied_now = []

        for version, description, migration_fn in MigrationService.MIGRATIONS:
            if version in applied:
                continue

            if not MigrationService._migration_already_satisfied(version):
                migration_fn()
            db.session.add(SchemaMigration(version=version, description=description))
            db.session.commit()
            applied_now.append(version)
            if app:
                app.logger.info("Applied schema migration %s", version)

        return applied_now

    @staticmethod
    def status_rows():
        applied = MigrationService.applied_versions()
        return [
            {
                "version": version,
                "description": description,
                "applied": version in applied,
            }
            for version, description, _ in MigrationService.MIGRATIONS
        ]
