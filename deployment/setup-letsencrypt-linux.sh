#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'HELP'
Usage:
  sudo bash deployment/setup-letsencrypt-linux.sh <domain> <email> <project-root> [upstream]

Example:
  sudo bash deployment/setup-letsencrypt-linux.sh exam.example.com admin@example.com /opt/exam_system 127.0.0.1:8000

This script installs an Nginx reverse proxy site, requests a Let's Encrypt
certificate with Certbot, enables HTTPS redirect, and enables renewal timer.
Run it only on a Linux host where the domain already points to this server.
HELP
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || $# -lt 3 ]]; then
  usage
  exit 1
fi

DOMAIN="$1"
EMAIL="$2"
PROJECT_ROOT="$3"
UPSTREAM="${4:-127.0.0.1:8000}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HTTP_TEMPLATE="$SCRIPT_DIR/nginx-exam-system.conf"
SITE_NAME="exam-system"
SITE_AVAILABLE="/etc/nginx/sites-available/$SITE_NAME"
SITE_ENABLED="/etc/nginx/sites-enabled/$SITE_NAME"

if [[ ! -f "$HTTP_TEMPLATE" ]]; then
  echo "Missing template: $HTTP_TEMPLATE" >&2
  exit 1
fi

for command_name in nginx certbot; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    echo "Install nginx and certbot first, then rerun this script." >&2
    exit 1
  fi
done

TMP_SITE="$(mktemp)"
cleanup() {
  rm -f "$TMP_SITE"
}
trap cleanup EXIT

sed \
  -e "s|SERVER_IP_OR_DOMAIN|$DOMAIN|g" \
  -e "s|PROJECT_ROOT|$PROJECT_ROOT|g" \
  -e "s|127.0.0.1:8000|$UPSTREAM|g" \
  "$HTTP_TEMPLATE" > "$TMP_SITE"

install -m 0644 "$TMP_SITE" "$SITE_AVAILABLE"
ln -sfn "$SITE_AVAILABLE" "$SITE_ENABLED"

nginx -t
systemctl reload nginx

certbot --nginx \
  --domain "$DOMAIN" \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  --redirect \
  --non-interactive

nginx -t
systemctl reload nginx

systemctl enable --now certbot.timer >/dev/null 2>&1 || true

cat <<DONE
HTTPS is configured for https://$DOMAIN

Set these in your production .env:
  APP_ENV=production
  SESSION_COOKIE_SECURE=True
  PREFERRED_URL_SCHEME=https
  TRUST_PROXY_HEADERS=true

Make sure your Python app is running behind Nginx at http://$UPSTREAM
DONE
