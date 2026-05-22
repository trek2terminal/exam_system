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

For HTTPS, use `deployment/nginx-exam-system-https.conf` after certificates exist.

## HTTPS Setup

### Hosted Domain With Let's Encrypt

On a Linux host where your domain already points to the server:

```bash
sudo bash deployment/setup-letsencrypt-linux.sh exam.example.com admin@example.com /opt/exam_system 127.0.0.1:8000
```

The script installs the Nginx site, requests the certificate with Certbot, enables HTTPS redirect, reloads Nginx, and enables Certbot renewal timer.

### Local LAN Self-Signed Certificate

For LAN testing on Windows, generate a local certificate:

```powershell
.\deployment\create-local-self-signed-cert.ps1 -DnsName 192.168.1.105 -OutputDir C:\nginx\certs
```

Add `-TrustCurrentUserRoot` only on a machine you control and trust. Student devices may still show a browser warning unless the certificate is trusted on those devices.

Then copy `deployment/nginx-exam-system-https.conf`, replace `SERVER_DOMAIN`, `PROJECT_ROOT`, `SSL_CERT_PATH`, and `SSL_KEY_PATH`, and reload Nginx.

## Environment

Start from `.env.example`. In production set:

```env
APP_ENV=production
SECRET_KEY=<long-random-secret>
DATABASE_URL=<postgres-url-or-empty-for-local-sqlite>
SESSION_COOKIE_SECURE=True
PREFERRED_URL_SCHEME=https
TRUST_PROXY_HEADERS=true
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

## Python Code Execution Isolation

The default LAN mode uses the built-in subprocess runner with AST validation, timeout, stdin/output limits, isolated temp files, and POSIX CPU/memory limits where available:

```env
CODE_EXECUTION_MODE=subprocess
```

For stronger lab/hosted isolation, preinstall one of these runners and change `.env`:

```env
CODE_EXECUTION_MODE=docker
CODE_EXECUTION_DOCKER_IMAGE=python:3.11-alpine
CODE_EXECUTION_MEMORY_MB=128
```

Docker runs student code with no network, read-only filesystem, dropped capabilities, pids limit, memory cap, and no-new-privileges. Pull the image before the exam, for example:

```powershell
docker pull python:3.11-alpine
```

On Linux machines with Firejail:

```env
CODE_EXECUTION_MODE=firejail
CODE_EXECUTION_MEMORY_MB=128
```

`CODE_EXECUTION_MODE=auto` uses a locally available Docker image first, then Firejail on Linux, then the subprocess runner. For predictable exam-day behavior, set the exact mode after testing on the admin machine.
