import os
import sys
from app import create_app
from app.utils.db_manager import reset_database, init_database, show_tables

app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug_mode = os.environ.get("FLASK_ENV") != "production"

    print(f"🚀 Starting Exam System on http://0.0.0.0:{port}")

    # Handle command line arguments
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

    # Normal run
    app.run(host="0.0.0.0", port=port, debug=debug_mode, threaded=True)