import os
from flask import Flask
from config import Config, DevelopmentConfig, ProductionConfig

# Import extensions
from app.models.database import db, init_db
from app.utils.logger import setup_logging


def create_app(config_class=None):
    """Application factory"""
    app_dir = os.path.abspath(os.path.dirname(__file__))
    project_root = os.path.abspath(os.path.join(app_dir, ".."))

    template_dir = os.path.join(app_dir, "templates")
    static_dir = os.path.join(app_dir, "static")

    app = Flask(__name__,
                template_folder=template_dir,
                static_folder=static_dir,
                static_url_path='/static')

    # ====================== CONFIG ======================
    if config_class is None:
        if os.environ.get("FLASK_ENV") == "production":
            config_class = ProductionConfig
        else:
            config_class = DevelopmentConfig

    app.config.from_object(config_class)

    # Database Path
    instance_path = os.path.join(project_root, "instance")
    os.makedirs(instance_path, exist_ok=True)
    db_path = os.path.join(instance_path, "database.db")
    app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path}"

    # Create directories
    for folder in ["UPLOAD_FOLDER", "BACKUP_FOLDER", "LOG_FOLDER", "SCREENSHOT_FOLDER"]:
        path = app.config.get(folder)
        if path:
            os.makedirs(path, exist_ok=True)

    # ====================== INITIALIZE EXTENSIONS ======================
    setup_logging(app)
    # db.init_app(app)   ← Removed (moved to init_db)

    # ====================== DATABASE ======================
    init_db(app)   # This now handles init_app + model registration

    # ====================== BLUEPRINTS ======================
    from app.routes.auth_routes import auth_bp
    from app.routes.teacher_routes import teacher_bp
    from app.routes.student_routes import student_bp
    from app.routes.api_routes import api_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(teacher_bp)
    app.register_blueprint(student_bp)
    app.register_blueprint(api_bp)

    # Security Headers
    @app.after_request
    def add_security_headers(response):
        if app.config.get("SECURITY_HEADERS", True):
            response.headers['X-Content-Type-Options'] = 'nosniff'
            response.headers['X-Frame-Options'] = 'DENY'
            response.headers['X-XSS-Protection'] = '1; mode=block'
        return response

    app.logger.info("✅ Exam System started successfully!")
    return app