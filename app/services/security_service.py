from datetime import datetime
import os

from flask import current_app
from werkzeug.utils import secure_filename

from app.models.database import db
from app.models.audit_model import ViolationLog
from app.models.submission_model import StudentSession


class SecurityService:

    @staticmethod
    def record_heartbeat(session_code: str, focused: bool, violation_count: int = 0):
        session = StudentSession.query.filter_by(session_code=session_code).first()
        if not session:
            return False

        session.last_heartbeat = datetime.utcnow()

        if violation_count > session.focus_violations:
            session.focus_violations = violation_count

        db.session.commit()
        return True

    @staticmethod
    def record_violation(session_code: str, violation_type: str, detail: str = "", client_count: int = 0,
                         ip_address: str = None, user_agent: str = None):
        session = StudentSession.query.filter_by(session_code=session_code).first()
        if not session:
            return None

        normalized_type = (violation_type or "UNKNOWN").strip().upper().replace(" ", "_")[:80]
        detail = (detail or "").strip()
        client_count = max(int(client_count or 0), 0)

        session.focus_violations = max(session.focus_violations + 1, client_count)
        if normalized_type in {"TAB_SWITCH", "WINDOW_BLUR"}:
            session.tab_switch_count += 1
        session.suspicion_score = min(100, session.suspicion_score + 15)
        session.last_heartbeat = datetime.utcnow()

        violation = ViolationLog(
            session_id=session.id,
            violation_type=normalized_type,
            detail=detail,
            client_count=client_count,
            ip_address=ip_address,
            user_agent=(user_agent or "")[:255] or None,
        )
        db.session.add(violation)
        db.session.commit()
        return violation


    @staticmethod
    def should_auto_submit(session_code: str) -> bool:
        session = StudentSession.query.filter_by(session_code=session_code).first()
        if not session:
            return True

        # Violation decisions are handled by admin/proctor review. Timer expiry
        # still auto-submits from the exam client.
        if session.last_heartbeat:
            time_diff = datetime.utcnow() - session.last_heartbeat
            if time_diff.total_seconds() > 120:
                return False

        return False


    @staticmethod
    def save_screenshot(session_code: str, screenshot_file):
        """Save proctoring screenshot"""
        session = StudentSession.query.filter_by(session_code=session_code).first()
        if not session or not screenshot_file:
            return None

        screenshot_root = current_app.config.get("SCREENSHOT_FOLDER", os.path.join("app", "static", "screenshots"))
        os.makedirs(screenshot_root, exist_ok=True)

        original_name = secure_filename(getattr(screenshot_file, "filename", "") or "screenshot.png")
        ext = original_name.rsplit(".", 1)[-1].lower() if "." in original_name else "png"
        if ext not in {"png", "jpg", "jpeg", "webp"}:
            ext = "png"

        filename = f"{session_code}_{int(datetime.utcnow().timestamp())}.{ext}"
        output_path = os.path.join(screenshot_root, filename)

        if hasattr(screenshot_file, "save"):
            screenshot_file.save(output_path)
        else:
            data = screenshot_file.read() if hasattr(screenshot_file, "read") else screenshot_file
            with open(output_path, "wb") as handle:
                handle.write(data)

        session.screenshot_count += 1
        db.session.commit()
        return output_path


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
