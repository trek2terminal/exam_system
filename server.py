import os
import json
import uuid
import bcrypt
import tempfile
import subprocess
import sys
from datetime import datetime, timedelta
from functools import wraps

from flask import (
    Flask, render_template, request, redirect,
    url_for, session, jsonify, abort
)
import config

app = Flask(__name__)
app.secret_key = config.SECRET_KEY
app.permanent_session_lifetime = timedelta(hours=8)

# ─────────────────────────────────────────────────────────
# PATHS
# ─────────────────────────────────────────────────────────
BASE_DIR        = os.path.dirname(os.path.abspath(__file__))
DATA_DIR        = os.path.join(BASE_DIR, "data")
SETS_DIR        = os.path.join(DATA_DIR, "question_sets")
EXAMS_DIR       = os.path.join(DATA_DIR, "exams")
SUBMISSIONS_DIR = os.path.join(DATA_DIR, "submissions")

for d in [DATA_DIR, SETS_DIR, EXAMS_DIR, SUBMISSIONS_DIR]:
    os.makedirs(d, exist_ok=True)

# ─────────────────────────────────────────────────────────
# HELPERS  –  read / write JSON safely
# ─────────────────────────────────────────────────────────

def read_json(path: str, default=None):
    if default is None:
        default = {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def write_json(path: str, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


# ─────────────────────────────────────────────────────────
# HELPERS  –  active exam
# ─────────────────────────────────────────────────────────

def get_active_exam():
    """Return the config of the currently active exam, or None."""
    meta_path = os.path.join(EXAMS_DIR, "active.json")
    return read_json(meta_path, default=None) or None


def get_exam_sessions(exam_id: str):
    path = os.path.join(EXAMS_DIR, exam_id, "sessions.json")
    return read_json(path, default={})


def save_exam_sessions(exam_id: str, sessions_data: dict):
    path = os.path.join(EXAMS_DIR, exam_id, "sessions.json")
    write_json(path, sessions_data)


# ─────────────────────────────────────────────────────────
# AUTH  –  teacher login required decorator
# ─────────────────────────────────────────────────────────

def teacher_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("teacher_logged_in"):
            return redirect(url_for("teacher_login"))
        return f(*args, **kwargs)
    return decorated


# ─────────────────────────────────────────────────────────
# TEACHER ROUTES
# ─────────────────────────────────────────────────────────

@app.route("/")
def index():
    return redirect(url_for("teacher_login"))


@app.route("/teacher/login", methods=["GET", "POST"])
def teacher_login():
    error = None
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "").encode("utf-8")
        stored   = config.TEACHER_PASSWORD_HASH.encode("utf-8")

        if (username == config.TEACHER_USERNAME and
                bcrypt.checkpw(password, stored)):
            session.permanent = True
            session["teacher_logged_in"] = True
            return redirect(url_for("teacher_dashboard"))
        else:
            error = "Invalid username or password."

    return render_template("teacher/login.html", error=error)


@app.route("/teacher/logout")
def teacher_logout():
    session.clear()
    return redirect(url_for("teacher_login"))


@app.route("/teacher/dashboard")
@teacher_required
def teacher_dashboard():
    exam = get_active_exam()
    sessions_data = {}
    if exam:
        sessions_data = get_exam_sessions(exam["exam_id"])
    return render_template(
        "teacher/dashboard.html",
        exam=exam,
        sessions=sessions_data
    )


@app.route("/teacher/setup", methods=["GET", "POST"])
@teacher_required
def teacher_setup():
    # Load existing question sets
    sets = []
    for fname in os.listdir(SETS_DIR):
        if fname.endswith(".json"):
            sets.append(fname.replace(".json", ""))

    if request.method == "POST":
        action = request.form.get("action")

        # ── Upload / save a question set ──────────────────
        if action == "save_set":
            set_name  = request.form.get("set_name", "").strip().upper()
            questions = request.form.get("questions", "").strip()

            if not set_name or not questions:
                return render_template(
                    "teacher/setup.html", sets=sets,
                    error="Set name and questions are required."
                )

            q_list = [q.strip() for q in questions.splitlines() if q.strip()]
            path   = os.path.join(SETS_DIR, f"{set_name}.json")
            write_json(path, {"set_name": set_name, "questions": q_list})
            return redirect(url_for("teacher_setup"))

        # ── Create / start an exam ─────────────────────────
        if action == "start_exam":
            duration  = int(request.form.get("duration_minutes", 30))
            seat_map  = {}  # seat_number → set_name

            for key, val in request.form.items():
                if key.startswith("seat_"):
                    seat_num = key.replace("seat_", "")
                    seat_map[seat_num] = val.upper()

            # Determine pattern from duration
            pattern = config.PATTERN_RULES[-1]
            for rule in config.PATTERN_RULES:
                if duration <= rule["max_minutes"]:
                    pattern = rule
                    break

            exam_id   = datetime.now().strftime("exam_%Y%m%d_%H%M%S")
            exam_data = {
                "exam_id":         exam_id,
                "started_at":      datetime.now().isoformat(),
                "duration_minutes": duration,
                "questions_to_show": pattern["questions"],
                "free_navigation":   pattern["free_navigation"],
                "seat_map":          seat_map,
                "active":            True,
            }

            exam_dir = os.path.join(EXAMS_DIR, exam_id)
            os.makedirs(exam_dir, exist_ok=True)
            write_json(os.path.join(exam_dir, "config.json"), exam_data)
            write_json(os.path.join(EXAMS_DIR, "active.json"), exam_data)

            return redirect(url_for("teacher_dashboard"))

    return render_template("teacher/setup.html", sets=sets, error=None)


@app.route("/teacher/end_exam", methods=["POST"])
@teacher_required
def end_exam():
    active_path = os.path.join(EXAMS_DIR, "active.json")
    if os.path.exists(active_path):
        exam = read_json(active_path)
        exam["active"] = False
        exam_dir = os.path.join(EXAMS_DIR, exam.get("exam_id", ""))
        if os.path.exists(exam_dir):
            write_json(os.path.join(exam_dir, "config.json"), exam)
        os.remove(active_path)
    return redirect(url_for("teacher_dashboard"))


@app.route("/teacher/student/<session_id>")
@teacher_required
def view_student(session_id):
    exam = get_active_exam()
    if not exam:
        abort(404)
    sessions_data = get_exam_sessions(exam["exam_id"])
    student = sessions_data.get(session_id)
    if not student:
        abort(404)
    return render_template(
        "teacher/student_view.html",
        student=student,
        session_id=session_id,
        exam=exam
    )


@app.route("/teacher/results")
@teacher_required
def teacher_results():
    # List all past exams
    exams = []
    for name in os.listdir(EXAMS_DIR):
        cfg_path = os.path.join(EXAMS_DIR, name, "config.json")
        if os.path.exists(cfg_path):
            exams.append(read_json(cfg_path))
    exams.sort(key=lambda x: x.get("started_at", ""), reverse=True)
    return render_template("teacher/results.html", exams=exams)


@app.route("/teacher/results/<exam_id>")
@teacher_required
def exam_results(exam_id):
    exam_dir = os.path.join(EXAMS_DIR, exam_id)
    cfg      = read_json(os.path.join(exam_dir, "config.json"))
    sessions = read_json(os.path.join(exam_dir, "sessions.json"), default={})
    return render_template(
        "teacher/exam_results.html",
        exam=cfg,
        sessions=sessions
    )


# ─────────────────────────────────────────────────────────
# TEACHER  –  LIVE POLL (dashboard auto-refresh)
# ─────────────────────────────────────────────────────────

@app.route("/teacher/api/live")
@teacher_required
def api_live():
    """Returns live student session data as JSON for dashboard polling."""
    exam = get_active_exam()
    if not exam:
        return jsonify({"active": False})
    sessions_data = get_exam_sessions(exam["exam_id"])

    # Strip code content for security — dashboard only gets metadata
    safe = {}
    for sid, s in sessions_data.items():
        safe[sid] = {
            "name":             s.get("name"),
            "seat":             s.get("seat"),
            "set_name":         s.get("set_name"),
            "current_question": s.get("current_question", 1),
            "status":           s.get("status", "active"),
            "joined_at":        s.get("joined_at"),
            "last_seen":        s.get("last_seen"),
            "questions_done":   s.get("questions_done", []),
        }
    return jsonify({"active": True, "exam": exam, "sessions": safe})


# ─────────────────────────────────────────────────────────
# STUDENT ROUTES
# ─────────────────────────────────────────────────────────

@app.route("/student", methods=["GET", "POST"])
def student_join():
    exam = get_active_exam()
    if not exam:
        return render_template("student/waiting.html")

    error = None
    if request.method == "POST":
        name     = request.form.get("name", "").strip()
        seat_str = request.form.get("seat", "").strip()

        if not name or not seat_str:
            error = "Please enter your name and seat number."
        else:
            seat_map = exam.get("seat_map", {})
            set_name = seat_map.get(seat_str)

            if not set_name:
                error = f"Seat number {seat_str} is not assigned. Ask your teacher."
            else:
                # Check set exists
                set_path = os.path.join(SETS_DIR, f"{set_name}.json")
                if not os.path.exists(set_path):
                    error = f"Question set '{set_name}' not found. Ask your teacher."
                else:
                    # Create or resume session
                    sessions_data = get_exam_sessions(exam["exam_id"])

                    # Check if this seat is already taken by someone else
                    for sid, s in sessions_data.items():
                        if s.get("seat") == seat_str and s.get("name") != name:
                            error = "This seat is already taken."
                            break

                    if not error:
                        # Find existing session for this seat
                        existing_sid = None
                        for sid, s in sessions_data.items():
                            if s.get("seat") == seat_str:
                                existing_sid = sid
                                break

                        if existing_sid:
                            session["student_session_id"] = existing_sid
                            session["exam_id"]            = exam["exam_id"]
                        else:
                            new_sid = str(uuid.uuid4())
                            started_at = datetime.now().isoformat()
                            deadline   = (
                                datetime.now() +
                                timedelta(minutes=exam["duration_minutes"])
                            ).isoformat()

                            sessions_data[new_sid] = {
                                "session_id":       new_sid,
                                "name":             name,
                                "seat":             seat_str,
                                "set_name":         set_name,
                                "current_question": 1,
                                "status":           "active",
                                "joined_at":        started_at,
                                "deadline":         deadline,
                                "last_seen":        started_at,
                                "questions_done":   [],
                                "answers":          {},
                            }
                            save_exam_sessions(exam["exam_id"], sessions_data)
                            session["student_session_id"] = new_sid
                            session["exam_id"]            = exam["exam_id"]

                        return redirect(url_for("student_exam"))

    return render_template("student/join.html", error=error)


@app.route("/student/exam")
def student_exam():
    sid    = session.get("student_session_id")
    eid    = session.get("exam_id")
    exam   = get_active_exam()

    if not sid or not eid or not exam:
        return redirect(url_for("student_join"))

    sessions_data  = get_exam_sessions(eid)
    student        = sessions_data.get(sid)

    if not student:
        return redirect(url_for("student_join"))

    if student.get("status") == "submitted":
        return render_template("student/submitted.html", name=student["name"])

    # Load question set — send ONLY the current question to browser
    set_data  = read_json(
        os.path.join(SETS_DIR, f"{student['set_name']}.json"), default={}
    )
    all_qs    = set_data.get("questions", [])
    total_qs  = min(len(all_qs), exam.get("questions_to_show", 20))
    current_q = student.get("current_question", 1)
    current_q = max(1, min(current_q, total_qs))

    question_text = all_qs[current_q - 1] if all_qs else "No question available."

    # Saved code for this question (resume on refresh)
    saved_code = student.get("answers", {}).get(str(current_q), {}).get("code", "")

    # Time remaining
    deadline_str = student.get("deadline", "")
    try:
        deadline      = datetime.fromisoformat(deadline_str)
        remaining_sec = max(0, int((deadline - datetime.now()).total_seconds()))
    except Exception:
        remaining_sec = 0

    return render_template(
        "student/exam.html",
        student=student,
        question_text=question_text,
        question_number=current_q,
        total_questions=total_qs,
        free_navigation=exam.get("free_navigation", True),
        remaining_seconds=remaining_sec,
        saved_code=saved_code,
        set_name=student["set_name"],
    )


# ─────────────────────────────────────────────────────────
# STUDENT  –  API ENDPOINTS
# ─────────────────────────────────────────────────────────

def get_student_session():
    """Validate and return (exam, sessions_data, student, sid) or None."""
    sid  = session.get("student_session_id")
    eid  = session.get("exam_id")
    exam = get_active_exam()
    if not sid or not eid or not exam:
        return None
    sessions_data = get_exam_sessions(eid)
    student = sessions_data.get(sid)
    if not student or student.get("status") == "submitted":
        return None
    return exam, sessions_data, student, sid


@app.route("/student/api/save", methods=["POST"])
def student_save():
    """Auto-save current question code."""
    ctx = get_student_session()
    if not ctx:
        return jsonify({"ok": False}), 403

    exam, sessions_data, student, sid = ctx
    eid  = session.get("exam_id")
    data = request.get_json(silent=True) or {}

    q_num = str(data.get("question", student.get("current_question", 1)))
    code  = data.get("code", "")

    if "answers" not in student:
        student["answers"] = {}
    student["answers"][q_num] = {
        "code":       code,
        "saved_at":   datetime.now().isoformat(),
    }
    student["last_seen"] = datetime.now().isoformat()
    sessions_data[sid]   = student
    save_exam_sessions(eid, sessions_data)
    return jsonify({"ok": True})


@app.route("/student/api/navigate", methods=["POST"])
def student_navigate():
    """Move to a different question."""
    ctx = get_student_session()
    if not ctx:
        return jsonify({"ok": False}), 403

    exam, sessions_data, student, sid = ctx
    eid  = session.get("exam_id")
    data = request.get_json(silent=True) or {}

    # First save current code
    current_q = str(student.get("current_question", 1))
    code      = data.get("current_code", "")
    if "answers" not in student:
        student["answers"] = {}
    student["answers"][current_q] = {
        "code":     code,
        "saved_at": datetime.now().isoformat(),
    }

    # Move to new question
    set_data  = read_json(
        os.path.join(SETS_DIR, f"{student['set_name']}.json"), default={}
    )
    total_qs  = min(len(set_data.get("questions", [])),
                    exam.get("questions_to_show", 20))
    new_q     = int(data.get("new_question", 1))
    new_q     = max(1, min(new_q, total_qs))

    student["current_question"] = new_q
    student["last_seen"]        = datetime.now().isoformat()
    sessions_data[sid]          = student
    save_exam_sessions(eid, sessions_data)

    # Return the new question text (server-side, never expose all questions)
    all_qs       = set_data.get("questions", [])
    question_text = all_qs[new_q - 1] if all_qs else ""
    saved_code   = student["answers"].get(str(new_q), {}).get("code", "")

    return jsonify({
        "ok":            True,
        "question_text": question_text,
        "question_number": new_q,
        "saved_code":    saved_code,
        "total_questions": total_qs,
    })


@app.route("/student/api/run", methods=["POST"])
def student_run():
    """Execute student code in a sandbox, return output."""
    ctx = get_student_session()
    if not ctx:
        return jsonify({"ok": False, "error": "Session expired."}), 403

    _, _, _, _ = ctx
    data  = request.get_json(silent=True) or {}
    code  = data.get("code", "")
    stdin = data.get("stdin", "")

    if not code.strip():
        return jsonify({"ok": True, "output": "", "error": "No code to run."})

    # Security: block dangerous imports
    for blocked in config.BLOCKED_IMPORTS:
        if f"import {blocked}" in code or f"from {blocked}" in code:
            return jsonify({
                "ok": False,
                "error": f"'{blocked}' is not allowed in exam code."
            })

    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".py", delete=False, encoding="utf-8"
        ) as tf:
            tf.write(code)
            temp_path = tf.name

        result = subprocess.run(
            [sys.executable, "-u", temp_path],
            input=stdin,
            capture_output=True,
            text=True,
            timeout=config.CODE_TIMEOUT_SECONDS,
        )
        return jsonify({
            "ok":     True,
            "output": result.stdout,
            "error":  result.stderr,
            "code":   result.returncode,
        })
    except subprocess.TimeoutExpired:
        return jsonify({
            "ok":    False,
            "error": f"Code timed out after {config.CODE_TIMEOUT_SECONDS} seconds."
        })
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)})
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass


@app.route("/student/api/submit", methods=["POST"])
def student_submit():
    """Final submission."""
    ctx = get_student_session()
    if not ctx:
        return jsonify({"ok": False}), 403

    exam, sessions_data, student, sid = ctx
    eid  = session.get("exam_id")
    data = request.get_json(silent=True) or {}

    # Save final code for current question
    current_q = str(student.get("current_question", 1))
    code      = data.get("current_code", "")
    if "answers" not in student:
        student["answers"] = {}
    student["answers"][current_q] = {
        "code":     code,
        "saved_at": datetime.now().isoformat(),
    }

    student["status"]       = "submitted"
    student["submitted_at"] = datetime.now().isoformat()
    sessions_data[sid]      = student
    save_exam_sessions(eid, sessions_data)

    return jsonify({"ok": True})


# ─────────────────────────────────────────────────────────
# RUN
# ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    print(f"\n  ✅  Exam server running.")
    print(f"  Teacher dashboard → http://localhost:{config.PORT}/teacher/login")
    print(f"  Students connect  → http://<your-ip>:{config.PORT}/student\n")
    app.run(host=config.HOST, port=config.PORT, debug=False)