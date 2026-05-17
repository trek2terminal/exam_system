from datetime import datetime
from app.models.database import db
from app.models.submission_model import StudentSession


class SecurityService:

    @staticmethod
    def record_heartbeat(session_code: str, focused: bool, violation_count: int = 0):
        session = StudentSession.query.filter_by(session_code=session_code).first()
        if not session:
            return False

        session.last_heartbeat = datetime.utcnow()

        if not focused:
            session.increment_violation("focus")

        if violation_count > session.focus_violations:
            session.focus_violations = violation_count

        db.session.commit()
        return True


    @staticmethod
    def should_auto_submit(session_code: str) -> bool:
        session = StudentSession.query.filter_by(session_code=session_code).first()
        if not session:
            return True

        # Auto submit if too many violations
        if session.focus_violations >= 5 or session.suspicion_score >= 70:
            return True

        # Auto submit if no heartbeat for 2+ minutes
        if session.last_heartbeat:
            time_diff = datetime.utcnow() - session.last_heartbeat
            if time_diff.total_seconds() > 120:
                return True

        return False


    @staticmethod
    def save_screenshot(session_code: str, screenshot_file):
        """Save proctoring screenshot"""
        # Implementation can be expanded with file saving logic
        pass


    @staticmethod
    def get_proctoring_summary(session_code: str):
        session = StudentSession.query.filter_by(session_code=session_code).first()
        if not session:
            return {}

        return {
            "focus_violations": session.focus_violations,
            "tab_switches": getattr(session, 'tab_switch_count', 0),
            "suspicion_score": session.suspicion_score,
            "last_heartbeat": session.last_heartbeat
        }