# React Frontend Migration

This is the Vite/React migration workspace. It currently reads live data from the Flask APIs while the existing Jinja templates remain the production UI.

## Run

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Vite proxies `/api`, `/student`, `/teacher`, and `/admin` to `http://127.0.0.1:8000`.

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
- Load role dashboards from:
  - `/api/student/dashboard`
  - `/api/teacher/dashboard`
  - `/api/admin/dashboard`
- Keep existing Flask login and exam-taking flows active until the React pages reach parity.

## Next Migration Tasks

- Move student exam list and results screens into React.
- Wrap the current Monaco/xterm coding experience as React components.
- Add protected React routes per role.
- Replace the Jinja dashboards only after feature parity is verified.
