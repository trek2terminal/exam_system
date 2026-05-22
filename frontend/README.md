# React Frontend Migration

This is the Vite/React migration workspace. It currently reads live data from the Flask APIs while the existing Jinja templates remain the production UI.

## Run

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Vite proxies `/api`, `/socket.io`, `/student`, `/teacher`, and `/admin` to `http://127.0.0.1:8000`.

Production build:

```powershell
npm.cmd run build
```

When `frontend/dist` exists, Flask serves the built migration shell at `/react`.

## Current Scope

- Bootstrap current role/session state from `/api/bootstrap`.
- Route role dashboards under `/react/student`, `/react/teacher`, and `/react/admin`.
- Persist the light/dark theme preference in the browser.
- Render the student dashboard with assigned-exam cards, countdowns, attempt status, published-result summaries, and secure action forms back to Flask.
- Open active attempts in `/react/exam/:sessionCode` with timer, question navigator, autosave, submit confirmation, integrity events, and Monaco-backed Python coding answers.
- Code questions now include a real stdin textarea plus xterm-rendered output, and the exam route is lazy-loaded so Monaco/xterm do not bloat the dashboard bundle.
- Timed questions show a countdown and lock locally when expired while the server remains the final enforcement point.
- Teacher review is available under `/react/teacher/exam/:examId/review` and `/react/teacher/session/:sessionId/review` with marks, remarks, publish controls, answer PDF links, and classic Flask fallback links.
- Admin and teacher live proctoring are available under `/react/admin/proctoring` and `/react/teacher/proctoring`.
- Admin React proctoring keeps password-confirmed actions for terminate, second chance, time penalty, pause/resume, and private messages; teacher React proctoring is read-only.
- React exam attempts join their private Socket.IO session room, so admin termination, second chance, time changes, pause/resume, and private messages arrive immediately while heartbeat polling remains as fallback.
- React proctoring joins authorized exam rooms and updates student cards from `proctor:*` events while retaining the 5-second polling refresh as fallback.
- Load role dashboards from:
  - `/api/student/dashboard`
  - `/api/teacher/dashboard`
  - `/api/admin/dashboard`
- Keep existing Flask login and exam-taking flows active until the React pages reach parity.

## Next Migration Tasks

- Browser-test the React student exam, teacher review, and proctoring flows with real sessions.
- Browser-verify Socket.IO live push behavior with two real browser sessions.
- Replace individual Jinja pages only after each React page reaches parity and has a fallback path.
