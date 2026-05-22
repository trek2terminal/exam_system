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
- Pre-exam checklist/start gate for active exams. Timed sessions now start only after the student confirms readiness and rules.
- CSV exports for teacher all-results, per-exam results with per-question marks/remarks, and admin violation logs.
- Platform settings table with admin-managed platform name, student welcome message, quote pool, self-registration toggle placeholder, and violation warning threshold.
- Student self-registration controlled by admin settings, plus account-based student login alongside local quick entry.
- Admin user management now includes student accounts and roll number editing.
- Recorded schema migration runner with `schema_migrations` table plus `python run.py migrate` and `python run.py migrations` commands.
- Post-submit exam lock for submitted/evaluated/terminated attempts across student pages and mutation APIs.
- Private per-attempt `session_token` stored on `StudentSession`, remembered in the browser session, and required for autosave, heartbeat, violation, code-run, and submit APIs.
- Role session checks now re-validate active admin/teacher/student database accounts on protected requests and force logout if an account is deactivated mid-session.
- One-active-exam-window protection with per-tab window locks, stale-lock recovery, and a student-facing "already open" screen.
- Optional exam start/end windows with teacher form fields, student entry enforcement, API enforcement, and periodic expired-session auto-submit.
- IBPS-style persisted question navigator states: not visited, visited unanswered, answered, marked for review, and answered marked for review.
- Model answers per question for teacher review and published student feedback/PDF copies.
- Per-student extra time at enrollment level, carried into the exam session timer and proctoring timer.
- Admin announcement banner on student dashboards with per-session dismiss.
- Admin bulk student CSV import for onboarding batches.
- Teacher question bank with manual saves, copy-from-exam, delete, and import selected bank questions into exams.
- Teacher per-question side-by-side answer comparison.
- Teacher similarity flag report for long and coding answers.
- Question images and read-only code snippets in question bodies, visible during exams, review, comparison, and PDF exports.
- Per-student randomized question delivery with stored question order for refresh-safe exam attempts.
- Student pause requests, admin pause/resume controls, and server-side timer freeze while paused.
- Offline answer buffer in the exam UI using localStorage with automatic sync on reconnect.
- Admin student groups/batches and teacher one-click group assignment to exams.
- Admin database backup download from settings for SQLite, with PostgreSQL `pg_dump` support when hosted.
- Admin suspicious activity report across repeated violation-heavy exam sessions.
- Admin login hidden from the common role selector, harder admin lockout after 3 failed attempts, and `python run.py unlock-admin` recovery.
- Forced teacher password change after admin-created temporary credentials.
- Notification bell with unread count for logged-in users, plus admin/teacher/student notification records.
- Private admin-to-student messages from live proctoring, delivered to the student's exam screen through heartbeat.
- Exam attempt limits, including `0` for unlimited attempts and dashboard attempt status.
- Per-question time limits with client countdown, auto-lock after expiry, and server-side save/code-run rejection after expiry.
- Teacher read-only live proctoring view for exams created by that teacher.
- Admin password re-entry for destructive or sensitive actions such as terminate, pause/resume, reduce time, group deletion, private message, and database backup.
- Admin complete exam report PDF export with questions, sessions, scores, and violation counts.

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
- Optional Flask-SocketIO server wiring with polling fallback when the package is not installed.
- Student-side realtime handlers for termination, time adjustment, pause/resume, second chance, submit, and private messages.
- Admin/teacher proctoring pages join realtime exam rooms after their normal status refresh.

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

## Latest Implementation Batch - 2026-05-22

Completed in this batch:
- Fixed the exam API integer parser so heartbeat, violation count, answer save, code run, and question timer endpoints parse numeric fields correctly.
- Added optional Flask-SocketIO initialization, Socket.IO requirements, realtime room helpers, and browser handlers while keeping polling as the fallback.
- Emitted realtime events for heartbeat status, violation alerts, exam submission, admin termination, second chance, time reduction, pause/resume, and admin messages.
- Added student result-sheet PDF download and teacher answer-sheet PDF download.
- Fixed PDF result privacy: unpublished marks, teacher remarks, and model answers no longer appear in student answer-copy PDFs.
- Changed admin user delete into soft delete/deactivation; teacher removal now archives the teacher's exams instead of deleting data.
- Added admin password confirmation for account status toggle, account edit, and account soft delete.
- Added admin idle timeout tracking with a 2-hour inactivity limit while keeping longer normal student/teacher sessions.

Still intentionally left for later phases:
- Full React + Vite migration with Monaco Editor, xterm.js, Zustand, Axios interceptors, shadcn/Tailwind.
- Installing and verifying Flask-SocketIO client/server dependencies in the real environment, then browser-testing live push updates.
- Production-grade Python execution isolation using OS-level limits beyond the current static blocklist, timeout, and subprocess capture.
- External deployment hardening: HTTPS certificates, reverse proxy config validation, Redis-backed rate limiting/session store if hosted multi-process.

## Latest Implementation Batch 2 - 2026-05-22

Completed in this batch:
- Hardened Python code execution with an explicit safe-import allowlist, stronger blocked builtins/helpers, blocked private/dunder attribute access, relative import rejection, stdin length limits, no bytecode writes, no proxy environment, isolated temp working directory, POSIX CPU/memory limits, and Windows no-window process flags.
- Moved per-question timer validation before Python execution so expired coding questions cannot run code.
- Added audit-log records for Python execution attempts with status and execution time.
- Added `CODE_EXECUTION_STDIN_MAX_CHARS` and made admin idle timeout configurable from `.env`.
- Added `wsgi.py` for production-style WSGI serving.
- Added deployment assets: `deployment/nginx-exam-system.conf`, `deployment/start-waitress.ps1`, and `deployment/README.md`.
- Updated `.env.example` and requirements for host-ready runtime configuration.
- Upgraded the existing Flask exam coding UI with optional Monaco Editor and xterm.js CDN loading, while preserving textarea/output fallbacks if those assets are unavailable.

Still intentionally left for later phases:
- Full React + Vite migration with Zustand, Axios interceptors, shadcn/Tailwind, and deeper component-level state management. Monaco/xterm are now available in the current Flask interface as an interim working upgrade.
- Browser verification of Socket.IO push behavior on the final installed environment.
- Stronger production sandbox isolation outside the Python process, such as container/firejail/Windows Job Object policy and network namespace blocking.
- HTTPS certificate automation and Redis-backed rate limiting/session storage for multi-process hosting.

## Latest Implementation Batch 3 - 2026-05-22

Completed in this batch:
- Added optional Redis-backed rate limiting while preserving in-memory LAN defaults.
- Added optional Redis-backed Flask server-side sessions via `SESSION_TYPE=redis`.
- Added shared Redis utility and production env keys for `REDIS_URL`, `RATE_LIMIT_STORAGE`, `SESSION_REDIS_URL`, and related settings.
- Added role-aware JSON APIs for the React migration: `/api/bootstrap`, `/api/student/dashboard`, `/api/teacher/dashboard`, and `/api/admin/dashboard`.
- Created a Vite/React frontend workspace under `frontend/` with live Flask API proxying, Zustand state, Axios client, role dashboard shell, and migration README.
- Updated deployment notes with Redis production configuration.

Still intentionally left for later phases:
- Install Node.js/npm and verify the React frontend with `npm install`, `npm run build`, and browser screenshots.
- Move full student exam-taking, teacher review, and admin proctoring screens into React after parity checks.
- Browser verification of Socket.IO push behavior on the final installed environment.
- Stronger external sandbox isolation for Python code execution.
- HTTPS automation for final hosted deployment.
