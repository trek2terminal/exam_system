import bcrypt

# ─── Teacher login credentials ───────────────────────────
# To change password: run this file directly once with your
# new password, copy the printed hash, paste it below.

TEACHER_USERNAME = "admin"

# Default password is:  teach@2024
TEACHER_PASSWORD_HASH = bcrypt.hashpw(
    b"teach@2024", bcrypt.gensalt()
).decode("utf-8")

# ─── Flask secret key (signs session cookies) ────────────
SECRET_KEY = "exam_system_secret_key_change_this_in_production"

# ─── Server settings ─────────────────────────────────────
HOST = "0.0.0.0"      # listen on all interfaces (LAN + localhost)
PORT = 5000

# ─── Exam settings ───────────────────────────────────────
# How many questions to show based on exam duration
PATTERN_RULES = [
    {"max_minutes": 20,  "questions": 5,  "free_navigation": False},
    {"max_minutes": 40,  "questions": 10, "free_navigation": True},
    {"max_minutes": 60,  "questions": 20, "free_navigation": True},
    {"max_minutes": 9999,"questions": 20, "free_navigation": True},
]

# Code execution sandbox settings
CODE_TIMEOUT_SECONDS = 10
BLOCKED_IMPORTS = [
    "os", "sys", "subprocess", "socket", "shutil",
    "importlib", "builtins", "ctypes", "multiprocessing"
]

# Auto-save interval reminder (actual save triggered by JS)
AUTOSAVE_INTERVAL_SECONDS = 15