from flask import flash


def validate_exam_form(form_data):
    """Validate exam creation form"""
    errors = []

    if not form_data.get("exam_name", "").strip():
        errors.append("Exam name is required.")
    if not form_data.get("subject", "").strip():
        errors.append("Subject is required.")
    if not form_data.get("set_code", "").strip():
        errors.append("Set code is required.")

    try:
        duration = int(form_data.get("duration_minutes", 0))
        if duration < 5 or duration > 480:
            errors.append("Duration must be between 5 and 480 minutes.")
    except ValueError:
        errors.append("Invalid duration.")

    if errors:
        for error in errors:
            flash(error, "danger")
        return False
    return True


def validate_student_join(form_data):
    """Validate student join form"""
    if not form_data.get("student_name", "").strip():
        flash("Student name is required.", "danger")
        return False
    if not form_data.get("roll_no", "").strip():
        flash("Roll number is required.", "danger")
        return False
    if not form_data.get("access_code", "").strip():
        flash("Access code is required.", "danger")
        return False
    return True