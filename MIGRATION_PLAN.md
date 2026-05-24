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
- Platform settings table with admin-managed platform name, student welcome message, quote pool, self-registration controls, registration codes, admin security controls, logo upload, and violation warning threshold.
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
- Admin login hidden from the common role selector, configurable admin lockout controls, and `python run.py unlock-admin` recovery.
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

Runtime validation and hardening checklist:
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

Runtime validation and hardening checklist:
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

Runtime validation and hardening checklist:
- Install Node.js/npm and verify the React frontend with `npm install`, `npm run build`, and browser screenshots.
- Move full student exam-taking, teacher review, and admin proctoring screens into React after parity checks.
- Browser verification of Socket.IO push behavior on the final installed environment.
- Stronger external sandbox isolation for Python code execution.
- HTTPS automation for final hosted deployment.

## Latest Implementation Batch 4 - 2026-05-22

Completed in this batch:
- Verified Node.js and npm are installed on the machine.
- Verified the React/Vite production build with `npm.cmd run build`.
- Added `.gitignore` entries for Python caches, local database/log artifacts, frontend dependencies, and frontend production build output.
- Configured Vite with `/react/` as its production base path.
- Added Flask static serving for the built React migration shell at `/react`, while preserving the existing Jinja app routes.
- Added an ESLint 9 flat config for the React workspace so `npm.cmd run lint` works.
- Added React Router role routes under `/react/student`, `/react/teacher`, and `/react/admin` with role redirects.
- Added a persisted light/dark theme toggle and notification badge shell for the React UI.
- Updated the frontend README with Windows-safe `npm.cmd` commands and the Flask `/react` preview path.

Runtime validation and hardening checklist:
- Move full student exam-taking, teacher review, and admin proctoring screens into React after parity checks.
- Browser verification of Socket.IO push behavior and React UI behavior in the running app.
- Stronger external sandbox isolation for Python code execution.
- HTTPS automation for final hosted deployment.

## Latest Implementation Batch 5 - 2026-05-22

Completed in this batch:
- Expanded `/api/student/dashboard` with student greeting, announcement message, server time, dashboard stats, exam timing windows, attempt counts, result summaries, and server-built action links.
- Kept student exam actions routed through the existing Flask routes, so start/resume/waiting/submission behavior still uses the protected backend flow.
- Upgraded the React student dashboard with assigned-exam cards, live countdowns, available/upcoming/result stats, result score strips, access-code/result links, empty state, and responsive card layout.
- Rebuilt the React production bundle and verified `/react`, `/react/student`, generated assets, `/api/bootstrap`, and authenticated/anonymous student dashboard API behavior.

Runtime validation and hardening checklist:
- Move the actual exam-taking interface into React after the dashboard parity layer is stable.
- Move teacher review and admin/teacher proctoring screens into React.
- Browser-test Socket.IO live push behavior in a running interactive session.
- Stronger external sandbox isolation for Python code execution.
- HTTPS automation for final hosted deployment.

## Latest Implementation Batch 6 - 2026-05-22

Completed in this batch:
- Added `/api/student/session/<session_code>/exam-state` for React exam attempts with browser ownership validation, session token delivery, exam metadata, ordered questions, saved answers, code output, navigator status, remaining time, and warning limits.
- Added a React exam route at `/react/exam/:sessionCode`.
- Wired React dashboard start/resume forms to request the React exam UI while keeping backend precheck, waiting room, session token, and window-lock security intact.
- Updated Flask student start/precheck redirects so React-started attempts land in `/react/exam/<session_code>` after the readiness checklist.
- Built the React exam interface with timer, autosave, question navigator, status counts, flag for review, submit confirmation, fullscreen prompt, focus/shortcut/copy/paste/right-click violation reporting, heartbeat sync, offline save buffer, and Monaco editor for Python coding answers.
- Verified lint, production build, Flask React route serving, generated asset serving, migration status, and a temporary authenticated exam-state API smoke test.

Runtime validation and hardening checklist:
- Add xterm.js terminal rendering and interactive stdin UI inside the React coding answer surface.
- Port per-question countdown expiry UI fully into React; server-side expiry protection remains active.
- Move teacher review and admin/teacher proctoring screens into React.
- Browser-test Socket.IO live push behavior in a running interactive session.
- Stronger external sandbox isolation for Python code execution.
- HTTPS automation for final hosted deployment.

## Latest Implementation Batch 7 - 2026-05-22

Completed in this batch:
- Replaced the React coding prompt-based stdin flow with a dedicated stdin textarea for each coding question.
- Rendered Python execution output through xterm.js in the React exam interface.
- Added React per-question countdown pills for timed questions.
- Added local timed-question expiry handling that disables the current question, syncs expiry to `/question-expired`, and advances to the next question when possible.
- Allowed clipboard/shortcut exceptions inside the React coding workspace to match the existing coding-question behavior.
- Lazy-loaded the React exam route so Monaco/xterm are split into a separate exam bundle instead of increasing the dashboard bundle.
- Verified lint, production build, split React assets, Flask `/react/exam/:sessionCode` serving, `/api/bootstrap`, and migration status.

Runtime validation and hardening checklist:
- Browser-test the React exam interface interactively with a real student attempt, including fullscreen behavior and Monaco/xterm rendering.
- Move teacher review screens into React.
- Move admin/teacher proctoring screens into React.
- Browser-test Socket.IO live push behavior in a running interactive session.
- Stronger external sandbox isolation for Python code execution.
- HTTPS automation for final hosted deployment.

## Latest Implementation Batch 8 - 2026-05-22

Completed in this batch:
- Added teacher review APIs for exam-level review data, per-student answer review, mark saving, result publish/hide, and teacher ownership enforcement.
- Added backend validation for React-submitted marks so every question score must be numeric and within the question's max marks.
- Added React teacher review routes at `/react/teacher/exam/:examId/review` and `/react/teacher/session/:sessionId/review`.
- Updated the React teacher dashboard with Review and Review links per exam.
- Built the React exam review list with attempts, submitted/evaluated/published stats, CSV export, similarity report, publish evaluated, hide published, and per-student review links.
- Built the React per-student marking screen with model answers, submitted answers, coding output, marks, remarks, summary teacher remarks, publish checkbox, answer PDF link, and answer PDF fallback link.
- Verified lint, production build, React route serving, split teacher review asset serving, `/api/bootstrap`, and temporary authenticated teacher review API smoke tests including save/publish.

Runtime validation and hardening checklist:
- Browser-test the React teacher review screens with real submissions.
- Browser-test Socket.IO live push behavior in a running interactive session.
- Stronger external sandbox isolation for Python code execution.
- HTTPS automation for final hosted deployment.

## Latest Implementation Batch 9 - 2026-05-22

Completed in this batch:
- Added role-aware proctoring APIs for admin and teacher React workspaces.
- Added admin JSON action support for terminate, second chance, reduce time, pause, resume, and private messages while preserving admin password confirmation, audit logging, and student/proctor realtime emits.
- Added React proctoring routes at `/react/admin/proctoring` and `/react/teacher/proctoring`.
- Built the React proctoring workspace with polling status cards, sorted violation focus, detailed selected-student panel, recent violation feed, timer/heartbeat/answer metrics, and admin action controls.
- Added proctoring links to the React admin and teacher dashboards and sidebar.

Runtime validation and hardening checklist:
- Browser-test the React student exam, teacher review, and proctoring screens with real users/sessions.
- Browser-test Socket.IO live push behavior in a running interactive session.
- Stronger external sandbox isolation for Python code execution.
- HTTPS automation for final hosted deployment.

## Latest Implementation Batch 10 - 2026-05-22

Completed in this batch:
- Added a shared React Socket.IO client with WebSocket plus polling fallback.
- Added Vite `/socket.io` proxying for local React development.
- Wired React exam attempts into their private student session room so admin termination, time reduction, pause/resume, second chance, private messages, and submitted events update immediately.
- Wired React admin/teacher proctoring into authorized proctor rooms so student status, violation alerts, and submissions update cards immediately while polling remains as fallback.
- Hardened backend Socket.IO student joins to require the private attempt token, active browser session ownership, student role, and non-locked attempt status.
- Hardened backend proctor room joins to require active admin/teacher accounts and teacher exam ownership.
- Added `deployment/start-realtime.ps1` and clarified that Waitress is HTTP-only fallback, while realtime exams should use the Socket.IO-capable runner.

Runtime validation and hardening checklist:
- Browser-test realtime push with two real browser sessions on the running LAN app.
- Stronger external sandbox isolation for Python code execution.
- HTTPS automation for final hosted deployment.

## Latest Implementation Batch 11 - 2026-05-22

Completed in this batch:
- Added configurable Python execution modes: `subprocess`, `docker`, `firejail`, and `auto`.
- Added Docker sandbox execution with no network, read-only filesystem, dropped capabilities, no-new-privileges, pids limit, memory cap, CPU cap, and temporary read-only code mount.
- Added Firejail sandbox execution for Linux hosts with network disabled, dropped capabilities, no-new-privileges, CPU limit, and memory limit.
- Kept LAN default as the existing subprocess runner so local exams continue working without Docker or Firejail.
- Added `.env` settings for code execution mode, Docker image, and memory cap.
- Updated deployment notes with exam-day setup guidance for Docker/Firejail isolation.

Runtime validation and hardening checklist:
- Browser-test realtime push with two real browser sessions on the running LAN app.
- HTTPS automation for final hosted deployment.

## Latest Implementation Batch 12 - 2026-05-22

Completed in this batch:
- Added production proxy awareness for HTTPS deployments with configurable `TRUST_PROXY_HEADERS` and `PREFERRED_URL_SCHEME`.
- Added `ProxyFix` support so Flask respects Nginx `X-Forwarded-*` headers when explicitly enabled.
- Added `deployment/nginx-exam-system-https.conf` with HTTP to HTTPS redirect, TLS settings, HSTS, static asset serving, Socket.IO websocket proxying, and secure forwarded headers.
- Added `deployment/setup-letsencrypt-linux.sh` to install the Nginx site, request Let's Encrypt certificates through Certbot, enable HTTPS redirect, reload Nginx, and enable renewal timer.
- Added `deployment/create-local-self-signed-cert.ps1` for Windows LAN HTTPS testing with local cert/key export.
- Updated `.env.example` and deployment docs with production HTTPS settings and LAN self-signed guidance.

Runtime validation and hardening checklist:
- Browser-test realtime push with two real browser sessions on the running LAN app.

## Latest Implementation Batch 13 - 2026-05-22

Completed in this batch:
- Added a repeatable realtime smoke command: `python run.py smoke:realtime`.
- The smoke command creates temporary admin, teacher, non-owner teacher, student, exam, question, and active session rows.
- It verifies admin proctor room join, owning teacher proctor room join, non-owner teacher rejection, student private room join, bad student token rejection, student violation delivery to proctors, and admin message delivery to the student socket.
- It disconnects all Socket.IO test clients and cleans up temporary database rows after the check.
- Updated deployment notes so admins can run the realtime smoke check before exam day.

Runtime validation and hardening checklist:
- Browser-test the full React UI with two real browser sessions on the running LAN app.

## Latest Implementation Batch 14 - 2026-05-22

Completed in this batch:
- Added an admin-only account security dashboard at `/admin/account`.
- Admin can update their own display name and login ID after confirming the current admin password.
- Admin can change their own password from the same dashboard with strength validation.
- The active admin session updates immediately after a successful name or login ID change.
- Account changes are written to the audit log as `update_admin_account`.
- Added Account links to the admin top navigation and admin dashboard quick actions.
- Verified the route rejects an incorrect current password, accepts a valid login ID/password change, updates the session, and records an audit row.

Runtime validation and hardening checklist:
- Browser-test the full React UI with two real browser sessions on the running LAN app.

## Latest Implementation Batch 15 - 2026-05-22

Completed in this batch:
- Added server-side live login tokens for account-based Admin, Teacher, and Student sessions.
- Added `users.active_session_token` and `users.active_session_started_at` with migration `20260522_015_active_login_sessions`.
- Each successful account login now rotates the user's live token, so a newer browser login invalidates older browser sessions.
- Admin, teacher, and student protected page decorators now reject stale or mismatched browser sessions.
- React/API role checks now reject stale admin, teacher, and account-based student sessions.
- Socket.IO proctor and student room joins now require the current live account token as well as existing role and exam-token checks.
- Password changes rotate the current session token; admin-driven password resets clear the affected user's live token.
- Authenticated responses now send no-store cache headers so protected pages are not reused from browser cache after logout or invalidation.
- Verified unauthenticated `/admin/account` redirects to login, second admin login invalidates the first browser, stale server-rendered page URLs redirect, stale React admin APIs return 401, and authenticated pages carry no-store headers.

Runtime validation and hardening checklist:
- Browser-test the full React UI with two real browser sessions on the running LAN app.

## Latest Implementation Batch 16 - 2026-05-23

Completed in this batch:
- Audited the React/Vite frontend against the UI/UX overhaul prompt and the Python-first migration plan.
- Kept Tailwind on class-based dark mode and verified the React theme path uses `localStorage`, system preference fallback, and the `html.dark` class.
- Confirmed the notification bell is separated from the theme toggle: the sun/moon button changes theme, while the bell opens the unread notification dropdown with mark-all-read and view-all actions.
- Fixed React build blockers from duplicate component symbols, missing imports, unused generated code, and unresolved/unused page imports.
- Routed the advanced React login, registration, student results, teacher exam editor, admin dashboard, admin users, admin settings, and dedicated 404 screens under the `/react/` app.
- Updated React login and registration to submit through the existing Flask auth routes instead of nonexistent JSON auth endpoints.
- Updated React student results to use the existing `/api/student/dashboard` result summaries.
- Updated React admin settings save/backup and teacher creation flows to use existing Flask form endpoints while keeping the Python backend unchanged.
- Updated the React exam editor save flow to submit to the existing Flask teacher setup route, preserving the Python-first migration boundary.
- Removed duplicate, unrouted generated pages for admin proctoring and teacher review because the live routed React implementations are `Proctoring.jsx` and `TeacherReview.jsx`.
- Removed temporary Vite dev-server log files after targeted shutdown of the identified Vite processes.
- Verified `npm.cmd run lint` and `npm.cmd run build` complete successfully.

Runtime validation and hardening checklist:
- Browser-test the full React UI with real admin, teacher, and student sessions at 375px, 768px, and 1280px.
- Browser-test realtime push behavior with two real browser sessions on the running LAN app.
- Resolved in later batches: admin user management, teacher exam CRUD, and the remaining high-traffic React flows now use JSON APIs.

## Latest Implementation Batch 17 - 2026-05-23

Completed in this batch:
- Added production-grade JSON endpoints for React admin users, admin exams, admin audit log, admin groups, teacher question bank, student published results, and notifications.
- Extended `/api/admin/dashboard` with participation trend, status distribution, recent activity, suspicious students, violations today, and pending review counts for the Recharts dashboard.
- Replaced React HTML-scraping bridge logic in admin exams, admin reports, admin groups, admin users, teacher question bank, student results, and notifications with JSON API calls.
- Added admin user edit, reset password, and session-history modals backed by JSON APIs with admin password confirmation where required.
- Added question-bank image upload support through the JSON API using the existing Flask question image storage flow.
- Upgraded student results to load per-question published result data, show animated score rings, MCQ correctness, teacher remarks, image lightbox previews, and read-only Monaco views for code answers.
- Removed visible "server-rendered" bridge links from the React pages now covered by JSON endpoints.
- Removed the tracked generated `app/routes/__pycache__/api_routes.cpython-311.pyc` artifact; Python caches are already ignored by `.gitignore`.
- Verified Flask route syntax via a Python compile check and verified `npm.cmd run lint` plus `npm.cmd run build` complete successfully.

Runtime validation and hardening checklist:
- Browser-test the full React UI with real admin, teacher, and student sessions at 375px, 768px, and 1280px.
- Browser-test realtime push behavior with two real browser sessions on the running LAN app.
- Complete final hosted deployment hardening and HTTPS validation in the target environment.

## Latest Implementation Batch 18 - 2026-05-23

Completed in this batch:
- Rechecked the React frontend with `npm.cmd run lint` and `npm.cmd run build` before continuing; both passed before edits.
- Added JSON account APIs for the shared React account settings page: `/api/account/profile` and `/api/account/password`.
- Extended `/api/bootstrap` to include username, email, and profile picture data so the React account/settings shell has real profile context.
- Wired React Account Settings to save profile changes and change passwords through the new JSON APIs with button loading states and clean success/error toasts.
- Replaced remaining React admin user-management bridges with JSON calls for activate/deactivate, bulk activate/deactivate, create teacher, import students, edit user, reset password, and session history.
- Replaced React admin exam publish/archive actions with `/api/admin/exams/<id>/status` instead of server-rendered form endpoints.
- Replaced teacher question-bank "import into exam" form posts with `/api/teacher/exam/<id>/question-bank/import` JSON calls and per-card loading feedback.
- Hardened the shared Axios client so API failures become human-readable messages and network failures show `Unexpected error. Check your connection.`
- Aligned toast timing with the UI overhaul prompt: success/info toasts auto-dismiss after 4 seconds, warning/error toasts after 7 seconds, with the existing maximum-visible toast cap preserved.
- Updated the rate limiter to return JSON 429 responses for React/XHR requests, including the React admin login flow.
- Removed the explicit legacy `server-rendered view` link from React teacher per-student review and the `server-rendered results` link from React teacher exam cards.
- Cleaned stale "server-rendered" wording from React copy and removed tracked Python `__pycache__` artifacts because they are generated files already covered by `.gitignore`.
- Verified Python route/util syntax with an AST parse check that does not recreate `.pyc` files, then verified `npm.cmd run lint` and `npm.cmd run build` again.

Runtime validation and hardening checklist:
- Browser-test the full React UI with real authenticated admin, teacher, and student sessions at 375px, 768px, and 1280px.
- Browser-test realtime push behavior with two real browser sessions on the running LAN app.
- Runtime-smoke the new JSON actions against a live authenticated Flask session, especially admin user import/create/status, account password change, and teacher question-bank import.
- Resolved in batches 19-22: student start/precheck/login/register, admin settings save/backup, teacher exam setup, and teacher enrollment/report flows now use React/JSON paths.
- Leave `instance/database.db` untouched as local runtime data even if it appears modified in the working tree.

## Latest Implementation Batch 19 - 2026-05-23

Completed in this batch:
- Moved the remaining high-traffic Flask-template exits into React/JSON flows.
- Added JSON auth endpoints for React student/teacher login and student self-registration: `/api/auth/login` and `/api/auth/register`.
- Converted the React Login and Register pages to use JSON APIs, refresh bootstrap/dashboard state after success, and stay inside the `/react/` app.
- Added React-owned student access-code join, waiting room, precheck checklist, and submitted-confirmation pages.
- Added JSON student exam flow endpoints for start, access-code join, and precheck confirmation, returning React redirects instead of Flask template redirects.
- Updated student dashboard exam cards so Start/Resume opens sessions through JSON APIs instead of posting a server-rendered form.
- Updated exam submit/locked redirects and exam-state payloads to point at React submitted/results surfaces.
- Added JSON admin settings save and database backup endpoints, then moved React Admin Settings off `/admin/settings/save` and the old backup form.
- Added JSON teacher exam create/edit/load endpoints, then moved the React Exam Editor off `/teacher/setup`.
- Added a JSON teacher similarity report endpoint and replaced the React Teacher Review similarity link with an in-app modal.
- Removed React quick-action links to old admin violations/suspicious pages and redirected them to React proctoring/reports.
- Removed old server-rendered exam view links from React Admin Exams.
- Cleaned generated Python cache files after verification.
- Verified `npm.cmd run lint`, `npm.cmd run build`, `frontend/dist/index.html`, and Python route syntax.

Runtime validation and hardening checklist:
- Teacher CSV/PDF downloads now have `/api/teacher/reports/...` aliases; admin/student export endpoints are file responses, not styled pages.
- Resolved in Batch 20: React admin login posts to `/api/auth/admin-login`.
- Resolved in Batch 22: React Exam Editor now has live student search, group assignment, bulk roster, extra-time editing, and removal.
- Browser-test the complete React-only user journey with real admin, teacher, and student accounts: login, register, start exam, precheck, submit, review, proctoring, reports, settings, and backup.

## Latest Implementation Batch 20 - 2026-05-23

Completed in this batch:
- Added a dedicated React first-admin setup page at `/react/admin/setup`.
- Added JSON admin setup and admin login endpoints: `/api/auth/admin-setup` and `/api/auth/admin-login`.
- Moved the React Admin Login page off the old `/admin/login` bridge and onto the JSON admin login endpoint.
- Updated legacy auth GET entry points so `/`, `/login`, `/admin/login`, `/teacher/login`, `/student/login`, and `/student/register` redirect into the React app.
- Added route-level redirects for old admin, teacher, and student HTML page URLs so direct browser visits land on matching React pages instead of Jinja templates.
- Kept CSV/PDF/file endpoints available because they return downloads, not styled pages.
- Improved light mode professionalism with app/card background tokens, white card surfaces, cleaner borders, softer shadows, a subtle app backdrop, polished topbar/sidebar surfaces, and carded login/register forms.
- Confirmed Python cache files are generated artifacts and are ignored; no tracked cache artifacts were present in the final working tree scan.
- Verified `npm.cmd run lint`, `npm.cmd run build`, Python route syntax, and test-client redirects for the legacy page URLs into `/react/...`.

Runtime validation and hardening checklist:
- Runtime browser-test the full React-only user journey with real accounts at 375px, 768px, and 1280px.
- Runtime-smoke file downloads after authentication: teacher CSV/PDF exports, student PDF exports, admin violation CSV, and admin complete exam report PDF.
- Complete a dedicated React enrollment-management experience if live roster editing outside the Exam Editor is still desired.
- Remove tracked Python `__pycache__` artifacts once the environment allows the cleanup command or via a normal Git cleanup commit.

## Latest Implementation Batch 21 - 2026-05-24

Completed in this batch:
- Softened the React light-mode design tokens so the UI is less harsh: cooler off-white app/card surfaces, softer borders, gentler text colors, reduced glare in the app backdrop, and lower-intensity shadows.
- Kept dark mode token values unchanged.
- Normalized notification links in both the top bar dropdown and the Notifications page so stored legacy `/admin`, `/teacher`, or `/student` URLs route into the `/react/...` workspace.
- Removed remaining old server-rendered link fields from JSON API review/dashboard payloads, while preserving CSV/PDF download URLs because they are file responses rather than styled pages.
- Rechecked the React source for visible `Flask`, `server-rendered`, old form-post, `window.fetch`, and direct server-rendered href references; none remain.
- Rechecked Flask API payloads for `flask_` and `server-rendered` fields; none remain.
- Verified Python route syntax, `npm.cmd run lint`, `npm.cmd run build`, and test-client redirects for old page URLs into React.

Runtime validation and hardening checklist:
- Browser-test the complete React-only journey with real accounts at 375px, 768px, and 1280px.
- Runtime-smoke authenticated file downloads: teacher CSV/PDF exports, student result PDFs, admin violation CSV, and admin complete exam report PDF.
- Use the React Exam Editor enrollment step as the live roster-management surface.

## Latest Implementation Batch 22 - 2026-05-24

Completed in this batch:
- Replaced the placeholder Exam Editor enrollment step with a real React/API enrollment manager: live student search, manual add, group assignment, bulk roster paste, current enrollment list, extra-time editing, and destructive remove confirmation.
- Added teacher JSON endpoints for student search, groups, exam enrollments list/create/update/delete, and React save-time roster/group application for new exams.
- Added `/api/teacher/reports/...` CSV/PDF aliases and moved Teacher Reports download buttons away from `/teacher/...` page routes.
- Updated teacher review/report API payload links to use the new `/api/teacher/reports/...` file endpoints.
- Renamed route redirect helpers and cleaned migration-plan wording so old page URLs are described as React redirects, not active UI surfaces.
- Rechecked React/source route references for direct old page links, `flask_`, `classic`, `window.confirm`, and direct server-rendered href patterns; none were found.
- Verified Python route syntax, new route registration, old page URL redirects into `/react/...`, `npm.cmd run lint`, and `npm.cmd run build`.

Current status:
- No known lint/build/source-level bugs after this pass.
- No new package install was required.
- Runtime-only checks still need a real browser session with authenticated admin/teacher/student accounts for visual QA, realtime multi-browser behavior, and authenticated file-download permission checks.

## Latest Implementation Batch 23 - 2026-05-24

Completed in this batch:
- Made Admin Settings logo upload functional instead of showing placeholder copy.
- Added `platform_settings.logo_path` with a recorded schema migration.
- Added `/api/admin/settings/logo` for authenticated image upload, validation, static storage, audit logging, old-logo cleanup, and updated settings payloads with `logo_url`.
- Wired the React Admin Settings page to upload, preview, and refresh the saved logo immediately.
- Displayed the uploaded logo in the React sidebar, mobile drawer, login page, and registration page.

## Latest Implementation Batch 24 - 2026-05-24

Completed in this batch:
- Removed remaining live UI "disabled promise" copy from React pages; the scan no longer finds `not exposed`, `backend currently`, `can be enabled`, `window.confirm`, or similar markers in `frontend/src`/`app`.
- Made account avatar upload functional with `/api/account/avatar`, image validation, static storage, old-avatar cleanup, audit logging, and immediate React profile/sidebar/topbar refresh.
- Made Admin Settings security and registration controls functional: registration code requirement, admin failed-attempt lockout count, and admin idle timeout now persist through `platform_settings` and are enforced by auth/session APIs.
- Added `platform_settings.registration_code_required`, `platform_settings.registration_code`, `platform_settings.admin_lockout_count`, `platform_settings.admin_idle_timeout_minutes`, `exam_sets.shuffle_options`, and per-question `execution_time_limit_seconds` with recorded migrations.
- Wired student registration to require the admin registration code when enabled.
- Wired teacher Exam Editor MCQ option shuffle end to end; options now shuffle per student attempt and remain stable during the session.
- Wired coding-question execution time limits end to end; teacher-entered limits are saved and used by the student code-run endpoint.
- Added authenticated admin exam deletion from the React Admin Exams page with a destructive `DELETE` confirmation word, loading state, success/error toast, and server-side cascading cleanup of sessions, answers, results, marks, enrollments, questions, violations, and notifications.
- Added `/api/admin/exams/<exam_id>/report.pdf` so React admin exam PDF links stay inside API/file routes rather than old styled page routes.
- Improved Admin Exams mobile responsiveness with card-based mobile rows, skeleton loaders, staggered entry animation, full-width touch actions, and desktop table preservation.
- Improved toast motion and polish with desktop/mobile-specific enter/exit animations, accent bars, blur, spacing, and capped visible stack behavior.
- Fixed non-button disabled `Button` rendering so disabled links are visually muted and non-interactive.
- Verified `python -B -m py_compile` on changed backend files, `npm.cmd run lint`, and `npm.cmd run build`.

Current status:
- No known lint/build/source-level bugs after this pass.
- No new package install was required.
- Runtime-only checks still need a real authenticated browser pass for destructive admin deletion, avatar/logo upload file storage, and multi-role visual QA at 375px, 768px, and 1280px.
