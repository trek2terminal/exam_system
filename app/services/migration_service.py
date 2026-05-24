import json

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
    def _migration_student_session_window_lock():
        MigrationService._add_column_if_missing("student_sessions", "active_window_token", "VARCHAR(128)")
        MigrationService._add_column_if_missing("student_sessions", "active_window_heartbeat_at", "DATETIME")
        MigrationService._create_index_if_missing(
            "student_sessions",
            "ix_student_sessions_active_window_token",
            "active_window_token",
        )

    @staticmethod
    def _migration_exam_time_windows():
        MigrationService._add_column_if_missing("exam_sets", "start_time", "DATETIME")
        MigrationService._add_column_if_missing("exam_sets", "end_time", "DATETIME")

    @staticmethod
    def _migration_answer_visit_status():
        MigrationService._add_column_if_missing(
            "answers",
            "visit_status",
            "VARCHAR(30) NOT NULL DEFAULT 'NOT_VISITED'",
        )

    @staticmethod
    def _migration_model_answers_and_time_extensions():
        MigrationService._add_column_if_missing("questions", "model_answer", "TEXT")
        MigrationService._add_column_if_missing(
            "exam_enrollments",
            "extra_time_minutes",
            "INTEGER NOT NULL DEFAULT 0",
        )

    @staticmethod
    def _migration_announcement_message():
        MigrationService._add_column_if_missing("platform_settings", "announcement_message", "TEXT")

    @staticmethod
    def _migration_question_bank_items():
        if MigrationService._has_table("question_bank_items"):
            return
        from app.models.exam_model import QuestionBankItem

        QuestionBankItem.__table__.create(db.engine, checkfirst=True)

    @staticmethod
    def _migration_question_media_and_randomization():
        MigrationService._add_column_if_missing(
            "exam_sets",
            "random_question_count",
            "INTEGER NOT NULL DEFAULT 0",
        )
        MigrationService._add_column_if_missing(
            "exam_sets",
            "shuffle_questions",
            "BOOLEAN NOT NULL DEFAULT 0",
        )
        MigrationService._add_column_if_missing(
            "student_sessions",
            "question_order",
            "TEXT",
        )
        for table_name in ("questions", "question_bank_items"):
            MigrationService._add_column_if_missing(
                table_name,
                "image_paths",
                "TEXT NOT NULL DEFAULT '[]'",
            )
            MigrationService._add_column_if_missing(table_name, "code_snippet", "TEXT")
            MigrationService._add_column_if_missing(table_name, "code_language", "VARCHAR(40)")
        MigrationService._add_column_if_missing(
            "student_sessions",
            "extra_time_minutes",
            "INTEGER NOT NULL DEFAULT 0",
        )

    @staticmethod
    def _migration_pause_requests():
        MigrationService._add_column_if_missing("student_sessions", "pause_requested_at", "DATETIME")
        MigrationService._add_column_if_missing("student_sessions", "pause_reason", "TEXT")
        MigrationService._add_column_if_missing("student_sessions", "paused_at", "DATETIME")
        MigrationService._add_column_if_missing("student_sessions", "paused_remaining_seconds", "INTEGER")

    @staticmethod
    def _migration_student_groups():
        from app.models.group_model import StudentGroup, StudentGroupMember

        StudentGroup.__table__.create(db.engine, checkfirst=True)
        StudentGroupMember.__table__.create(db.engine, checkfirst=True)

    @staticmethod
    def _migration_must_change_password():
        MigrationService._add_column_if_missing(
            "users",
            "must_change_password",
            "BOOLEAN NOT NULL DEFAULT 0",
        )

    @staticmethod
    def _migration_notifications_attempts_timers():
        from app.models.notification_model import Notification

        Notification.__table__.create(db.engine, checkfirst=True)
        MigrationService._add_column_if_missing(
            "exam_sets",
            "attempt_limit",
            "INTEGER NOT NULL DEFAULT 1",
        )
        for table_name in ("questions", "question_bank_items"):
            MigrationService._add_column_if_missing(
                table_name,
                "time_limit_seconds",
                "INTEGER NOT NULL DEFAULT 0",
            )
        MigrationService._add_column_if_missing("answers", "question_started_at", "DATETIME")
        MigrationService._add_column_if_missing("answers", "question_expires_at", "DATETIME")
        MigrationService._add_column_if_missing(
            "answers",
            "question_time_expired",
            "BOOLEAN NOT NULL DEFAULT 0",
        )

    @staticmethod
    def _migration_active_login_sessions():
        MigrationService._add_column_if_missing("users", "active_session_token", "VARCHAR(128)")
        MigrationService._add_column_if_missing("users", "active_session_started_at", "DATETIME")
        MigrationService._create_index_if_missing(
            "users",
            "ix_users_active_session_token",
            "active_session_token",
        )

    @staticmethod
    def _migration_platform_logo_path():
        MigrationService._add_column_if_missing("platform_settings", "logo_path", "VARCHAR(255)")

    @staticmethod
    def _migration_admin_settings_controls():
        MigrationService._add_column_if_missing(
            "platform_settings",
            "registration_code_required",
            "BOOLEAN NOT NULL DEFAULT 0",
        )
        MigrationService._add_column_if_missing("platform_settings", "registration_code", "VARCHAR(80)")
        MigrationService._add_column_if_missing(
            "platform_settings",
            "admin_lockout_count",
            "INTEGER NOT NULL DEFAULT 3",
        )
        MigrationService._add_column_if_missing(
            "platform_settings",
            "admin_idle_timeout_minutes",
            "INTEGER NOT NULL DEFAULT 120",
        )

    @staticmethod
    def _migration_exam_shuffle_options_and_code_timeout():
        MigrationService._add_column_if_missing(
            "exam_sets",
            "shuffle_options",
            "BOOLEAN NOT NULL DEFAULT 0",
        )
        for table_name in ("questions", "question_bank_items"):
            MigrationService._add_column_if_missing(
                table_name,
                "execution_time_limit_seconds",
                "INTEGER NOT NULL DEFAULT 10",
            )

    @staticmethod
    def _migration_login_page_content():
        MigrationService._add_column_if_missing("platform_settings", "login_page_heading", "TEXT")
        MigrationService._add_column_if_missing("platform_settings", "login_page_subheading", "TEXT")
        MigrationService._add_column_if_missing("platform_settings", "login_page_features", "TEXT")

        default_features = json.dumps(
            [
                "Real-time proctoring and monitoring",
                "Multiple question types and formats",
                "Instant results and detailed analytics",
                "Code execution support with live testing",
            ]
        )
        with db.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    UPDATE platform_settings
                    SET
                        login_page_heading = COALESCE(NULLIF(login_page_heading, ''), :heading),
                        login_page_subheading = COALESCE(NULLIF(login_page_subheading, ''), :subheading),
                        login_page_features = COALESCE(NULLIF(login_page_features, ''), :features)
                    """
                ),
                {
                    "heading": "Assessment made simple.",
                    "subheading": "Focused, secure, and ready for every exam session.",
                    "features": default_features,
                },
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
        (
            "20260521_004_student_session_window_lock",
            "Add active browser window lock for student exam attempts",
            _migration_student_session_window_lock.__func__,
        ),
        (
            "20260521_005_exam_time_windows",
            "Add optional start and end windows to exams",
            _migration_exam_time_windows.__func__,
        ),
        (
            "20260521_006_answer_visit_status",
            "Track per-question navigator state on answers",
            _migration_answer_visit_status.__func__,
        ),
        (
            "20260521_007_model_answers_time_extensions",
            "Add model answers and per-student extra time",
            _migration_model_answers_and_time_extensions.__func__,
        ),
        (
            "20260521_008_announcement_message",
            "Add admin announcement banner message",
            _migration_announcement_message.__func__,
        ),
        (
            "20260521_009_question_bank_items",
            "Add teacher question bank table",
            _migration_question_bank_items.__func__,
        ),
        (
            "20260521_010_question_media_randomization",
            "Add question media, snippets, and random delivery fields",
            _migration_question_media_and_randomization.__func__,
        ),
        (
            "20260521_011_pause_requests",
            "Add student pause request and timer freeze fields",
            _migration_pause_requests.__func__,
        ),
        (
            "20260521_012_student_groups",
            "Add student groups and group membership tables",
            _migration_student_groups.__func__,
        ),
        (
            "20260521_013_must_change_password",
            "Add forced password change flag for temporary teacher credentials",
            _migration_must_change_password.__func__,
        ),
        (
            "20260521_014_notifications_attempts_timers",
            "Add notifications, exam attempt limits, and per-question timer fields",
            _migration_notifications_attempts_timers.__func__,
        ),
        (
            "20260522_015_active_login_sessions",
            "Add one-current-browser session tokens to users",
            _migration_active_login_sessions.__func__,
        ),
        (
            "20260524_016_platform_logo_path",
            "Add uploaded platform logo path to settings",
            _migration_platform_logo_path.__func__,
        ),
        (
            "20260524_017_admin_settings_controls",
            "Add registration code and admin security controls",
            _migration_admin_settings_controls.__func__,
        ),
        (
            "20260524_018_exam_shuffle_options_code_timeout",
            "Add MCQ option shuffle and per-code-question execution timeout",
            _migration_exam_shuffle_options_and_code_timeout.__func__,
        ),
        (
            "20260524_019_login_page_content",
            "Add admin-editable login page content fields",
            _migration_login_page_content.__func__,
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
        if version == "20260521_004_student_session_window_lock":
            return (
                MigrationService._has_column("student_sessions", "active_window_token")
                and MigrationService._has_column("student_sessions", "active_window_heartbeat_at")
                and MigrationService._has_index("student_sessions", "ix_student_sessions_active_window_token")
            )
        if version == "20260521_005_exam_time_windows":
            return (
                MigrationService._has_column("exam_sets", "start_time")
                and MigrationService._has_column("exam_sets", "end_time")
            )
        if version == "20260521_006_answer_visit_status":
            return MigrationService._has_column("answers", "visit_status")
        if version == "20260521_007_model_answers_time_extensions":
            return (
                MigrationService._has_column("questions", "model_answer")
                and MigrationService._has_column("exam_enrollments", "extra_time_minutes")
                and MigrationService._has_column("student_sessions", "extra_time_minutes")
            )
        if version == "20260521_008_announcement_message":
            return MigrationService._has_column("platform_settings", "announcement_message")
        if version == "20260521_009_question_bank_items":
            return MigrationService._has_table("question_bank_items")
        if version == "20260521_010_question_media_randomization":
            return (
                MigrationService._has_column("exam_sets", "random_question_count")
                and MigrationService._has_column("exam_sets", "shuffle_questions")
                and MigrationService._has_column("student_sessions", "question_order")
                and MigrationService._has_column("questions", "image_paths")
                and MigrationService._has_column("questions", "code_snippet")
                and MigrationService._has_column("questions", "code_language")
                and MigrationService._has_column("question_bank_items", "image_paths")
                and MigrationService._has_column("question_bank_items", "code_snippet")
                and MigrationService._has_column("question_bank_items", "code_language")
            )
        if version == "20260521_011_pause_requests":
            return (
                MigrationService._has_column("student_sessions", "pause_requested_at")
                and MigrationService._has_column("student_sessions", "pause_reason")
                and MigrationService._has_column("student_sessions", "paused_at")
                and MigrationService._has_column("student_sessions", "paused_remaining_seconds")
            )
        if version == "20260521_012_student_groups":
            return (
                MigrationService._has_table("student_groups")
                and MigrationService._has_table("student_group_members")
            )
        if version == "20260521_013_must_change_password":
            return MigrationService._has_column("users", "must_change_password")
        if version == "20260521_014_notifications_attempts_timers":
            return (
                MigrationService._has_table("notifications")
                and MigrationService._has_column("exam_sets", "attempt_limit")
                and MigrationService._has_column("questions", "time_limit_seconds")
                and MigrationService._has_column("question_bank_items", "time_limit_seconds")
                and MigrationService._has_column("answers", "question_started_at")
                and MigrationService._has_column("answers", "question_expires_at")
                and MigrationService._has_column("answers", "question_time_expired")
            )
        if version == "20260522_015_active_login_sessions":
            return (
                MigrationService._has_column("users", "active_session_token")
                and MigrationService._has_column("users", "active_session_started_at")
                and MigrationService._has_index("users", "ix_users_active_session_token")
            )
        if version == "20260524_016_platform_logo_path":
            return MigrationService._has_column("platform_settings", "logo_path")
        if version == "20260524_017_admin_settings_controls":
            return (
                MigrationService._has_column("platform_settings", "registration_code_required")
                and MigrationService._has_column("platform_settings", "registration_code")
                and MigrationService._has_column("platform_settings", "admin_lockout_count")
                and MigrationService._has_column("platform_settings", "admin_idle_timeout_minutes")
            )
        if version == "20260524_018_exam_shuffle_options_code_timeout":
            return (
                MigrationService._has_column("exam_sets", "shuffle_options")
                and MigrationService._has_column("questions", "execution_time_limit_seconds")
                and MigrationService._has_column("question_bank_items", "execution_time_limit_seconds")
            )
        if version == "20260524_019_login_page_content":
            return (
                MigrationService._has_column("platform_settings", "login_page_heading")
                and MigrationService._has_column("platform_settings", "login_page_subheading")
                and MigrationService._has_column("platform_settings", "login_page_features")
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
