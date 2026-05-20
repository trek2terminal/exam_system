from datetime import datetime
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
import os
from flask import current_app, has_app_context


class PDFService:
    @staticmethod
    def _export_path(filename):
        upload_folder = (
            current_app.config.get("UPLOAD_FOLDER")
            if has_app_context()
            else os.path.join(os.getcwd(), "app", "static", "uploads")
        )
        return os.path.join(upload_folder, "exports", filename)

    @staticmethod
    def generate_question_paper(exam_set, questions, output_path=None):
        """Generate Question Paper PDF"""
        if not output_path:
            filename = f"question_paper_{exam_set.access_code}_{datetime.now().strftime('%Y%m%d')}.pdf"
            output_path = PDFService._export_path(filename)

        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        c = canvas.Canvas(output_path, pagesize=letter)
        width, height = letter

        # Header
        c.setFont("Helvetica-Bold", 18)
        c.drawString(50, height - 50, exam_set.exam_name)
        c.setFont("Helvetica", 12)
        c.drawString(50, height - 80, f"Subject: {exam_set.subject} | Duration: {exam_set.duration_minutes} mins")
        c.drawString(50, height - 100, f"Access Code: {exam_set.access_code} | Total Marks: {exam_set.total_marks}")

        y = height - 150

        for q in questions:
            if y < 100:  # New page
                c.showPage()
                y = height - 50

            c.setFont("Helvetica-Bold", 12)
            c.drawString(50, y, f"Q{q.question_number}. ({q.marks} marks)")
            y -= 20

            c.setFont("Helvetica", 11)
            text_object = c.beginText(50, y)
            text_object.setLeading(14)
            for line in q.question_text.split('\n'):
                text_object.textLine(line)
            c.drawText(text_object)
            y -= len(q.question_text.split('\n')) * 18

            if q.question_type == "mcq" and q.options_as_list():
                options = q.options_as_list()
                for i, opt in enumerate(options):
                    y -= 18
                    c.drawString(70, y, f"{chr(65+i)}. {opt}")

            y -= 30

        c.save()
        return output_path


    @staticmethod
    def generate_result_pdf(result, session, exam_set, output_path=None):
        """Generate Student Result PDF"""
        if not output_path:
            filename = f"result_{session.roll_no}_{datetime.now().strftime('%Y%m%d')}.pdf"
            output_path = PDFService._export_path(filename)

        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        c = canvas.Canvas(output_path, pagesize=letter)
        width, height = letter
        y = height - 50

        c.setFont("Helvetica-Bold", 18)
        c.drawString(50, y, "Exam Result")
        y -= 36

        c.setFont("Helvetica", 12)
        rows = [
            ("Student", session.student_name),
            ("Roll No", session.roll_no),
            ("Exam", exam_set.exam_name),
            ("Subject", exam_set.subject),
            ("Marks", f"{result.total_marks_obtained} / {result.total_marks}"),
            ("Percentage", f"{result.percentage}%"),
        ]

        for label, value in rows:
            c.setFont("Helvetica-Bold", 11)
            c.drawString(50, y, f"{label}:")
            c.setFont("Helvetica", 11)
            c.drawString(145, y, str(value or "-"))
            y -= 22

        if result.teacher_remarks:
            y -= 10
            c.setFont("Helvetica-Bold", 11)
            c.drawString(50, y, "Teacher Remarks:")
            y -= 20
            c.setFont("Helvetica", 11)
            text_object = c.beginText(50, y)
            text_object.setLeading(15)
            for line in str(result.teacher_remarks).splitlines() or ["-"]:
                text_object.textLine(line)
            c.drawText(text_object)

        c.save()
        return output_path
