# Exam Platform Migration Plan

## Goal
Migrate the current Flask-based exam system toward the shared next-level specification in stages, without breaking the existing app during the transition.

## Strategy
- Keep the current Flask app operational as the legacy runtime during migration.
- Introduce the new architecture incrementally.
- Move backend capabilities first, then UI, then security/proctoring, then deployment.
- Preserve data and workflows during each stage.

## Stage 1 — Foundation
- Create a new backend structure aligned with the target architecture.
- Define environment/config loading, logging, and error-handling standards.
- Introduce the database layer that supports local SQLite and production PostgreSQL.
- Establish migration tooling and seed strategy.
- Keep the current Flask app intact while the new foundation is introduced.

## Stage 2 — Authentication and Users
- Implement role-based auth.
- Add JWT access/refresh handling.
- Build user and settings management APIs.
- Add admin seed flow.

## Stage 3 — Exams and Questions
- Implement exam CRUD.
- Add question models and import parsing.
- Add enrollment and assignment flows.
- Add result and review foundations.

## Stage 4 — Student Exam Flow
- Add exam start/resume/session handling.
- Implement autosave and timed submission.
- Add integrity controls and session state APIs.

## Stage 5 — Code Execution and Proctoring
- Add sandboxed Python execution.
- Add violation logging and real-time events.
- Add admin/teacher monitoring flows.

## Stage 6 — Frontend Migration
- Introduce React frontend.
- Build role-based dashboards.
- Implement exam UI, editor, terminal, and review screens.

## Stage 7 — Deployment and Hardening
- Add production config, reverse proxy support, and process management.
- Add rate limiting, CSRF, audit logging, backups, and observability.
- Finalize migration and retire legacy paths.

## Current State
- Legacy Flask app is still the running system.
- Production hardening has been applied to the current Flask code.
- Migration now moves forward in stages instead of a full rewrite in one step.
