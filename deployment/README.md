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

Start with Waitress on Windows:

```powershell
.\deployment\start-waitress.ps1 -Port 8000
```

For Linux, run an equivalent WSGI server against `wsgi:app`, then put Nginx in front.

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
