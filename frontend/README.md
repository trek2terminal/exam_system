# React Frontend Migration

This is the Vite/React migration workspace. It currently reads live data from the Flask APIs while the existing Jinja templates remain the production UI.

## Run

```powershell
cd frontend
npm install
npm run dev
```

Vite proxies `/api`, `/student`, `/teacher`, and `/admin` to `http://127.0.0.1:8000`.

## Current Scope

- Bootstrap current role/session state from `/api/bootstrap`.
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
