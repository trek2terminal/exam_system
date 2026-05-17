exam_system/
│
├── app/
│   │
│   ├── routes/
│   │   ├── teacher_routes.py
│   │   ├── student_routes.py
│   │   ├── auth_routes.py
│   │   └── api_routes.py
│   │
│   ├── services/
│   │   ├── exam_service.py
│   │   ├── autosave_service.py
│   │   ├── result_service.py
│   │   ├── pdf_service.py
│   │   ├── parser_service.py
│   │   └── security_service.py
│   │
│   ├── models/
│   │   ├── database.py
│   │   ├── user_model.py
│   │   ├── exam_model.py
│   │   ├── submission_model.py
│   │   └── result_model.py
│   │
│   ├── templates/
│   │   ├── student/
│   │   └── teacher/
│   │
│   ├── static/
│   │   ├── css/
│   │   ├── js/
│   │   ├── uploads/
│   │   └── screenshots/
│   │
│   ├── utils/
│   │   ├── helpers.py
│   │   ├── logger.py
│   │   ├── validators.py
│   │   └── network.py
│   │
│   └── socketio/
│       └── realtime_events.py
│
├── data/
│   ├── backups/
│   ├── exams/
│   ├── question_sets/
│   ├── submissions/
│   ├── exports/
│   └── logs/
│
├── instance/
│   └── database.db
│
├── requirements.txt
├── config.py
├── run.py
└── README.md