import io
import os
import socket
import sys

from app import create_app
from app.utils.db_manager import init_database, migrate_database, reset_database, show_migrations, show_tables


# Fix Unicode output on Windows.
if sys.stdout.encoding != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")


def get_local_ip_addresses():
    """Return reachable local IPv4 addresses for sharing the app on a LAN."""
    addresses = []

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            addresses.append(sock.getsockname()[0])
    except OSError:
        pass

    try:
        hostname = socket.gethostname()
        _, _, host_ips = socket.gethostbyname_ex(hostname)
        addresses.extend(host_ips)
    except OSError:
        pass

    clean_addresses = []
    for address in addresses:
        if not address or address.startswith("127."):
            continue
        if address not in clean_addresses:
            clean_addresses.append(address)

    return clean_addresses or ["127.0.0.1"]


def is_private_wifi_candidate(address):
    parts = address.split(".")
    if len(parts) != 4:
        return False

    try:
        first, second = int(parts[0]), int(parts[1])
    except ValueError:
        return False

    return (
        first == 10
        or first == 192 and second == 168
        or first == 172 and 16 <= second <= 31
    )


def get_share_ip_address():
    addresses = get_local_ip_addresses()
    private_addresses = [address for address in addresses if is_private_wifi_candidate(address)]

    for prefix in ("192.168.", "10.", "172."):
        for address in private_addresses:
            if address.startswith(prefix):
                return address

    return addresses[0]


def print_startup_urls(port):
    """Print copy-ready Wi-Fi URLs for each app role."""
    share_ip = get_share_ip_address()
    role_paths = {
        "Admin": "/admin/login",
        "Teacher": "/teacher/login",
        "Student": "/student/login",
    }

    print("\nExam System is starting")
    print(f"Wi-Fi IP: {share_ip}")
    print("\nShare these URLs:")
    for role, path in role_paths.items():
        print(f"  {role:<8} http://{share_ip}:{port}{path}")
    print()


def unlock_admin_account():
    app = create_app()
    with app.app_context():
        from app.models.database import db
        from app.models.user_model import User

        admin = User.query.filter_by(role="admin").first()
        if not admin:
            print("No admin account exists yet.")
            return
        admin.failed_login_attempts = 0
        admin.locked_until = None
        db.session.commit()
        print(f"Admin account unlocked: {admin.username}")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app_env = os.environ.get("APP_ENV", os.environ.get("FLASK_ENV", "development")).lower()
    debug_mode = app_env != "production"

    # Handle command line arguments before creating the app.
    if len(sys.argv) > 1:
        cmd = sys.argv[1].lower()
        if cmd == "reset":
            print("Resetting database...")
            reset_database()
            print("Reset complete. You can now run `python run.py` normally.")
            sys.exit(0)
        if cmd == "init":
            init_database()
            sys.exit(0)
        if cmd == "tables":
            show_tables()
            sys.exit(0)
        if cmd == "migrate":
            migrate_database()
            sys.exit(0)
        if cmd in {"migrations", "migration-status"}:
            show_migrations()
            sys.exit(0)
        if cmd in {"unlock-admin", "admin-unlock"}:
            unlock_admin_account()
            sys.exit(0)
        if cmd in {"smoke:realtime", "realtime-smoke", "smoke-realtime"}:
            from app.utils.realtime_smoke import run_realtime_smoke

            app = create_app()
            ok = run_realtime_smoke(app)
            sys.exit(0 if ok else 1)

    app = create_app()
    use_reloader = debug_mode and os.environ.get("FLASK_USE_RELOADER", "1") != "0"

    if os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        print_startup_urls(port)

    socketio = app.extensions.get("socketio")
    if socketio:
        socketio.run(
            app,
            host="0.0.0.0",
            port=port,
            debug=debug_mode,
            use_reloader=use_reloader,
            allow_unsafe_werkzeug=True,
        )
    else:
        app.run(host="0.0.0.0", port=port, debug=debug_mode, threaded=True, use_reloader=use_reloader)
