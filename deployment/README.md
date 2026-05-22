# Exam System Deployment Notes

## Local LAN

Use this while developing or running a small LAN exam from the admin PC:

```powershell
python run.py
```

The terminal prints copy-ready Wi-Fi URLs for Admin, Teacher, and Student.

## Production-Style Python Server

Install dependencies and run migrations:

```powershell
pip install -r requirements.txt
python run.py migrate
```

Start with the Socket.IO-capable runner on Windows when you want live proctoring push events:

```powershell
.\deployment\start-realtime.ps1 -Port 8000
```

Waitress can still serve HTTP pages and APIs, but it does not provide WebSocket transport. Use it only when polling fallback is acceptable:

```powershell
.\deployment\start-waitress.ps1 -Port 8000
```

For Linux, use a Socket.IO-capable process for realtime exams, then put Nginx in front.

## Nginx Reverse Proxy

Copy `deployment/nginx-exam-system.conf`, replace:

- `SERVER_IP_OR_DOMAIN` with your LAN IP or domain.
- `PROJECT_ROOT` with the absolute path to this project.

Then proxy HTTP and Socket.IO traffic to `127.0.0.1:8000`.

## Environment

Start from `.env.example`. In production set:

```env
APP_ENV=production
SECRET_KEY=<long-random-secret>
DATABASE_URL=<postgres-url-or-empty-for-local-sqlite>
SESSION_COOKIE_SECURE=True
```

Use HTTPS in production before enabling secure cookies for browsers.

## Optional Redis

For hosted or multi-process deployments, set Redis-backed rate limiting and server-side sessions:

```env
REDIS_URL=redis://127.0.0.1:6379/0
RATE_LIMIT_STORAGE=redis
SESSION_TYPE=redis
SESSION_REDIS_URL=redis://127.0.0.1:6379/1
```

LAN mode can keep the defaults: signed cookie sessions and in-memory rate limits.
