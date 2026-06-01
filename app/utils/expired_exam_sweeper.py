import os
import threading


def sweep_expired_exams(app, source="manual"):
    """Auto-submit expired exam sessions once."""
    with app.app_context():
        try:
            from app.services.exam_service import ExamService

            submitted_count = ExamService.auto_submit_expired_sessions()
            if submitted_count:
                app.logger.info(
                    "Auto-submitted %s expired exam session(s). source=%s",
                    submitted_count,
                    source,
                )
            return submitted_count
        except Exception:
            app.logger.exception("Expired exam auto-submit sweep failed. source=%s", source)
            return 0


def _is_reloader_parent(app):
    return (
        app.debug
        and os.environ.get("FLASK_USE_RELOADER", "1") != "0"
        and os.environ.get("WERKZEUG_RUN_MAIN") != "true"
    )


def _sweep_loop(app, interval_seconds, stop_event):
    while not stop_event.is_set():
        sweep_expired_exams(app, source="background")
        stop_event.wait(interval_seconds)


def start_expired_exam_sweeper(app):
    """Start the background expired-exam sweeper for long-running app processes."""
    env_enabled = os.environ.get("EXPIRED_EXAM_SWEEP_BACKGROUND")
    if env_enabled is not None and env_enabled.lower() not in {"1", "true", "yes"}:
        return False
    if not app.config.get("EXPIRED_EXAM_SWEEP_BACKGROUND", True):
        return False
    if _is_reloader_parent(app):
        return False
    if app.extensions.get("expired_exam_sweeper_thread"):
        return True

    interval_seconds = int(app.config.get("EXPIRED_EXAM_SWEEP_SECONDS", 30) or 30)
    if interval_seconds <= 0:
        return False

    stop_event = threading.Event()
    thread = threading.Thread(
        target=_sweep_loop,
        args=(app, interval_seconds, stop_event),
        name="expired-exam-sweeper",
        daemon=True,
    )
    app.extensions["expired_exam_sweeper_stop"] = stop_event
    app.extensions["expired_exam_sweeper_thread"] = thread
    thread.start()
    app.logger.info("Expired exam sweeper started with %s second interval.", interval_seconds)
    return True
