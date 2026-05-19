import os
import sys
import io
from app import create_app
from app.utils.db_manager import reset_database, init_database, show_tables

# Fix Unicode output on Windows
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app_env = os.environ.get("APP_ENV", os.environ.get("FLASK_ENV", "development")).lower()
    debug_mode = app_env != "production"

    print(f"🚀 Starting Exam System on http://0.0.0.0:{port}")

    # Handle command line arguments before creating the app
    if len(sys.argv) > 1:
        cmd = sys.argv[1].lower()
        if cmd == "reset":
            print("⚠️ Resetting database...")
            reset_database()
            print("✅ Reset complete. You can now run `python run.py` normally.")
            sys.exit(0)
        elif cmd == "init":
            init_database()
            sys.exit(0)
        elif cmd == "tables":
            show_tables()
            sys.exit(0)

    app = create_app()

    # Normal run
    app.run(host="0.0.0.0", port=port, debug=debug_mode, threaded=True)
