import os
from app import create_app
from app.utils.db_manager import reset_database, init_database, show_tables

app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug_mode = os.environ.get("FLASK_ENV") != "production"

    print(f"🚀 Starting Exam System on http://0.0.0.0:{port}")

    # Simple command line arguments
    import sys

    if len(sys.argv) > 1:
        cmd = sys.argv[1].lower()
        if cmd == "reset":
            print("⚠️ Resetting database...")
            reset_database()
            exit()
        elif cmd == "init":
            init_database()
            exit()
        elif cmd == "tables":
            show_tables()
            exit()

    app.run(host="0.0.0.0", port=port, debug=debug_mode, threaded=True)