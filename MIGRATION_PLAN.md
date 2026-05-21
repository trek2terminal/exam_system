# Exam Platform Python Build Plan

## Direction

Build the full local-first, host-ready exam platform with Python as the backend stack.

Recommended final architecture:

- Backend: Python, preferably FastAPI for the final API service.
- Current runtime: Flask app under `app/`, kept working during migration.
- Realtime: Flask-SocketIO now or FastAPI WebSockets/python-socketio later.
- ORM: SQLAlchemy with SQLite locally and PostgreSQL in production.
- Migrations: Alembic for the final service.
- Frontend: React + Vite for Monaco editor, terminal UI, and richer dashboards.
- Code execution: sandboxed Python subprocess with timeouts and restricted imports.
- LAN deployment: local machine shares Wi-Fi IP links first, production hosting later.

## Important Security Reality

No web exam platform can fully block operating-system actions such as Alt+Tab, screenshots, camera photos, second devices, or hardware-level shortcuts. Serious exam portals handle this by combining:

- fullscreen enforcement,
- tab/window blur detection,
- blocked browser shortcuts,
- copy/paste/right-click restrictions,
- violation logging,
- proctor/admin alerts,
- server-side autosave and timer state,
- audit trails,
- role-based access control,
- strong operational rules.

This project should follow that same practical model.

## Current App State

- The working Python app is Flask-based.
- It already supports admin, teacher, and student roles.
- It already has student login, assigned-exam dashboard, access-code fallback, exam taking, autosave, submission, teacher marking, PDF export, and a calmer student UI.
- It now prints only Wi-Fi share URLs from `run.py`.
- A Node/Prisma draft exists under `backend/`, but the project direction is now Python-first.

## Completed Hardening Slices

- Lightweight local/LAN rate limiting for login, autosave, heartbeat, violation reporting, submit, and admin security actions.
- Append-only violation log model.
- Student exam violation endpoint.
- Admin violation log page.
- Admin live proctoring page with polling status cards.
- Admin controls for terminate, second chance, and reduce-time.
- Student heartbeat now syncs server-side remaining time and warning count after admin action.
- Audit logging for submit and admin security actions.
- Exam enrollment table for assigning students by roll number.
- Teacher assignment page for adding/removing exam rosters.
- Student dashboard with greeting, assigned exams, waiting room/start/resume/submission actions.
- Student access-code join now respects assignment restrictions when an exam has a roster.
- Teacher smart question import from pasted text, .txt, .docx, .csv, and .json with preview before import.
- Bulk publish/hide evaluated results per exam.
- Student results page for published marks and feedback.
- Python coding-question execution endpoint with timeout, restricted imports/functions, stdin support, captured stdout/stderr, and per-session authorization.
- Student coding-question UI with code textarea, stdin box, run button, and saved output panel.
- Code execution output stored with answers and shown to teacher/student/PDF review surfaces.

## Python Feature Roadmap

### Phase 1 - Harden Current Flask App

- Append-only violation log table.
- 3-warning exam integrity model.
- Admin-visible violation records.
- Admin actions: terminate exam, grant second chance, reduce time.
- Stronger audit logging for sensitive actions.
- Rate limiting for login, autosave, submit, and code execution.
- Security headers and form/JSON validation cleanup.

### Phase 2 - Full Python Domain Model

- Users: Admin, Teacher, Student.
- Settings: registration toggle, platform name, violation threshold, quotes.
- Exams: draft, published, closed, archived.
- Questions: MCQ, short, long, Python code.
- Enrollments: students and groups.
- Exam sessions: start/resume/submit/terminate/second chance.
- Answers: text, selected options, code, output, marks, remarks.
- Violations: immutable append-only rows.
- Notifications: student, teacher, admin alerts.

### Phase 3 - Student Experience

- Student dashboard with greeting, quotes, assigned exams, results.
- Pre-exam checklist and fullscreen capability test.
- Exam interface with timer, navigator, autosave, flagged questions.
- Resume after refresh/reconnect.
- Results page after teacher publishes marks.

### Phase 4 - Teacher Experience

- Teacher dashboard.
- Exam CRUD.
- Question editor.
- Word/text/direct-paste import parser.
- Student assignment.
- Review answers and publish results.
- Read-only proctoring view.

### Phase 5 - Admin Experience

- User and teacher management.
- Settings panel.
- Live proctoring dashboard.
- End exam, second chance, reduce time, private message.
- Violation logs and audit logs.
- Export CSV/PDF reports.
- Backup database.

### Phase 6 - Python Code Execution

- Code question type.
- Python static safety checks.
- Subprocess execution with timeout.
- Captured stdout/stderr.
- Input support for `input()`.
- Output saved with answer.
- Rate limiting per student.

### Phase 7 - Realtime Layer

- Student heartbeat.
- Admin/teacher proctor rooms.
- Violation alert events.
- Time reduction/termination/second chance events.
- Student private messages.

### Phase 8 - React Frontend

- React + Vite app.
- Monaco editor for Python.
- xterm.js for terminal output.
- Zustand or simple query state.
- Axios with auth refresh if/when API auth moves to JWT.
- shadcn/Tailwind or equivalent modern UI.

### Phase 9 - Deployment

- Local LAN mode remains first-class.
- SQLite for local use.
- PostgreSQL option for hosting.
- Nginx or Caddy reverse proxy.
- Windows firewall instructions.
- Optional HTTPS in production.

## Non-Negotiable Rules

- Admin should be seeded/setup securely, not freely self-created.
- Teachers only manage their own exams.
- Students only access their own sessions/results.
- Results are hidden until published.
- Violation logs are append-only.
- Answers survive refreshes/reconnects.
- Security actions are logged with user/IP/time/reason.
- The current Python app must stay runnable during every migration step.
