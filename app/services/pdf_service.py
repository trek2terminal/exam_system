from datetime import datetime
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
import os
from app.config import Config


class PDFService:

    @staticmethod
    def generate_question_paper(exam_set, questions, output_path=None):
        """Generate Question Paper PDF"""
        if not output_path:
            filename = f"question_paper_{exam_set.access_code}_{datetime.now().strftime('%Y%m%d')}.pdf"
            output_path = os.path.join(Config.UPLOAD_FOLDER, "exports", filename)

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
        # Implementation similar to above (can be expanded later)
        pass