import math
import os
from datetime import datetime
from io import BytesIO

from flask import current_app
from reportlab.lib import colors
from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    Flowable,
    Image,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from xml.sax.saxutils import escape

from app.services.settings_service import SettingsService


BRAND_PRIMARY = HexColor("#4f46e5")
BRAND_LIGHT = HexColor("#e0e7ff")
SUCCESS = HexColor("#16a34a")
DANGER = HexColor("#dc2626")
WARNING = HexColor("#d97706")
TEXT_PRIMARY = HexColor("#0f172a")
TEXT_SECONDARY = HexColor("#475569")
TEXT_MUTED = HexColor("#94a3b8")
BORDER = HexColor("#e2e8f0")
SURFACE = HexColor("#f8fafc")
WHITE = white

styles = getSampleStyleSheet()
PDF_STYLES = {
    "H1": ParagraphStyle("H1", fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=TEXT_PRIMARY),
    "H2": ParagraphStyle("H2", fontName="Helvetica-Bold", fontSize=14, leading=18, textColor=TEXT_PRIMARY),
    "H3": ParagraphStyle("H3", fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=TEXT_PRIMARY),
    "BODY": ParagraphStyle("BODY", fontName="Helvetica", fontSize=10, leading=14, textColor=TEXT_PRIMARY),
    "BODY_SMALL": ParagraphStyle("BODY_SMALL", fontName="Helvetica", fontSize=8, leading=11, textColor=TEXT_SECONDARY),
    "CAPTION": ParagraphStyle("CAPTION", fontName="Helvetica-Oblique", fontSize=7, leading=9, textColor=TEXT_MUTED),
    "LABEL": ParagraphStyle("LABEL", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=TEXT_SECONDARY),
    "CODE": ParagraphStyle("CODE", fontName="Courier", fontSize=9, leading=11, textColor=TEXT_PRIMARY),
    "TABLE_HEADER": ParagraphStyle("TABLE_HEADER", fontName="Helvetica-Bold", fontSize=9, leading=11, textColor=WHITE),
    "TABLE_CELL": ParagraphStyle("TABLE_CELL", fontName="Helvetica", fontSize=9, leading=12, textColor=TEXT_PRIMARY),
}
PDF_STYLES["TABLE_CELL_ALT"] = PDF_STYLES["TABLE_CELL"]


def clean_text(value):
    return escape(str(value if value is not None else "-")).replace("\n", "<br/>")


def _safe_filename_part(value):
    text = "".join(ch if ch.isalnum() else "_" for ch in str(value or "").strip())
    return text.strip("_") or "export"


def _format_date(value=None, with_time=False):
    value = value or datetime.utcnow()
    fmt = "%b %d, %Y at %#I:%M %p" if with_time else "%b %d, %Y"
    try:
        return value.strftime(fmt)
    except ValueError:
        return value.strftime(fmt.replace("%#I", "%-I"))


def _settings_metadata(metadata):
    settings = SettingsService.get_settings()
    platform_name = getattr(settings, "platform_name", None) or "Exam System"
    tagline = getattr(settings, "welcome_message", None) or "Confidential assessment export"
    return {
        "settings": settings,
        "platform_name": metadata.get("platform_name") or platform_name,
        "tagline": metadata.get("tagline") or tagline,
        "logo_path": metadata.get("logo_path") or getattr(settings, "logo_path", None),
        "generated_at": metadata.get("generated_at") or datetime.utcnow(),
        "watermark": metadata.get("watermark"),
        "confidential": metadata.get("confidential", False),
    }


class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        page_count = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_number(page_count)
            super().showPage()
        super().save()

    def draw_page_number(self, page_count):
        if hasattr(self, "_footer_drawer"):
            self._footer_drawer(self, page_count)


class HorizontalRule(Flowable):
    def __init__(self, width=480, color=BORDER, thickness=0.5):
        super().__init__()
        self.width = width
        self.height = thickness + 2
        self.color = color
        self.thickness = thickness

    def draw(self):
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(self.thickness)
        self.canv.line(0, self.height / 2, self.width, self.height / 2)


class MarksBar(Flowable):
    def __init__(self, awarded, total, width=260, height=8):
        super().__init__()
        self.awarded = float(awarded or 0)
        self.total = float(total or 0)
        self.width = width
        self.height = height

    def draw(self):
        ratio = 0 if self.total <= 0 else max(0, min(self.awarded / self.total, 1))
        color = SUCCESS if ratio >= 0.5 else WARNING if ratio >= 0.35 else DANGER
        self.canv.setFillColor(BORDER)
        self.canv.roundRect(0, 0, self.width, self.height, 4, fill=1, stroke=0)
        self.canv.setFillColor(color)
        self.canv.roundRect(0, 0, self.width * ratio, self.height, 4, fill=1, stroke=0)


def paragraph(text, style="BODY"):
    return Paragraph(clean_text(text), PDF_STYLES[style])


def horizontal_rule(width=480, color=BORDER, thickness=0.5):
    return HorizontalRule(width=width, color=color, thickness=thickness)


def page_break():
    return PageBreak()


def section_heading(title):
    table = Table(
        [["", Paragraph(clean_text(title), PDF_STYLES["H2"])]],
        colWidths=[4, 460],
        rowHeights=[18],
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, 0), BRAND_PRIMARY),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (1, 0), (1, 0), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return table


def info_row(label, value):
    return [
        Paragraph(clean_text(str(label).upper()), PDF_STYLES["LABEL"]),
        Paragraph(clean_text(value), PDF_STYLES["BODY"]),
    ]


def info_table(rows, col_widths=(110, 160, 110, 160)):
    data = []
    for left, right in rows:
        data.append(info_row(*left) + info_row(*right))
    table = Table(data, colWidths=list(col_widths), hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, BORDER),
                ("BACKGROUND", (0, 0), (-1, -1), SURFACE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def status_badge(text, color):
    style = ParagraphStyle(
        f"Badge{text}",
        parent=PDF_STYLES["LABEL"],
        textColor=WHITE,
        alignment=TA_CENTER,
    )
    table = Table([[Paragraph(clean_text(str(text).upper()), style)]], colWidths=[90], rowHeights=[18])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), color),
                ("BOX", (0, 0), (-1, -1), 0, color),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    return table


def marks_bar(awarded, total):
    return MarksBar(awarded, total)


def code_box(text):
    table = Table([[Paragraph(clean_text(text), PDF_STYLES["CODE"])]], colWidths=[480])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), SURFACE),
                ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return table


def image_flowable(path, max_width=400, max_height=180):
    if not path:
        return None
    absolute_path = path if os.path.isabs(path) else os.path.join(current_app.root_path, "static", path)
    if not os.path.exists(absolute_path):
        return paragraph(f"[Question image missing: {path}]", "BODY_SMALL")
    try:
        reader = ImageReader(absolute_path)
        width, height = reader.getSize()
        ratio = min(max_width / width, max_height / height, 1)
        return Image(absolute_path, width=width * ratio, height=height * ratio)
    except Exception:
        return paragraph(f"[Question image could not be rendered: {path}]", "BODY_SMALL")


def _draw_logo_or_initial(pdf, meta, x, y, size):
    logo_path = meta.get("logo_path")
    if logo_path:
        absolute_path = logo_path if os.path.isabs(logo_path) else os.path.join(current_app.root_path, "static", logo_path)
        if os.path.exists(absolute_path):
            try:
                pdf.drawImage(absolute_path, x, y, width=size, height=size, preserveAspectRatio=True, mask="auto")
                return
            except Exception:
                pass
    pdf.setFillColor(BRAND_PRIMARY)
    pdf.roundRect(x, y, size, size, 6, fill=1, stroke=0)
    pdf.setFillColor(WHITE)
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawCentredString(x + size / 2, y + 13, (meta["platform_name"] or "E")[:1].upper())


def _draw_watermark(pdf, width, height, text):
    if not text:
        return
    pdf.saveState()
    try:
        pdf.setFillAlpha(0.06)
    except Exception:
        pass
    pdf.translate(width / 2, height / 2)
    pdf.rotate(45)
    pdf.setFillColor(colors.lightgrey)
    pdf.setFont("Helvetica-Bold", 60)
    pdf.drawCentredString(0, 0, text)
    pdf.restoreState()


def _draw_header_footer(pdf, doc, doc_type_label, meta):
    width, height = doc.pagesize
    _draw_watermark(pdf, width, height, meta.get("watermark") or ("CONFIDENTIAL" if meta.get("confidential") else None))
    header_top = height - 26
    logo_y = header_top - 40
    _draw_logo_or_initial(pdf, meta, doc.leftMargin, logo_y, 40)
    pdf.setFillColor(TEXT_PRIMARY)
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(doc.leftMargin + 50, logo_y + 22, meta["platform_name"][:70])
    pdf.setFillColor(TEXT_MUTED)
    pdf.setFont("Helvetica", 8)
    pdf.drawString(doc.leftMargin + 50, logo_y + 9, meta["tagline"][:95])
    pdf.setFillColor(TEXT_PRIMARY)
    pdf.setFont("Helvetica-Bold", 10)
    pdf.drawRightString(width - doc.rightMargin, logo_y + 22, doc_type_label)
    pdf.setFillColor(TEXT_MUTED)
    pdf.setFont("Helvetica", 8)
    pdf.drawRightString(width - doc.rightMargin, logo_y + 9, f"Generated: {_format_date(meta['generated_at'])}")
    pdf.setStrokeColor(BRAND_PRIMARY)
    pdf.setLineWidth(1)
    pdf.line(doc.leftMargin, height - 80, width - doc.rightMargin, height - 80)
    pdf._footer_drawer = lambda canv, total: _draw_footer(canv, doc, meta, total)


def _draw_footer(pdf, doc, meta, page_count):
    width, _height = doc.pagesize
    pdf.setStrokeColor(BORDER)
    pdf.setLineWidth(0.5)
    pdf.line(doc.leftMargin, 35, width - doc.rightMargin, 35)
    pdf.setFillColor(TEXT_MUTED)
    pdf.setFont("Helvetica-Oblique", 7)
    pdf.drawString(doc.leftMargin, 20, f"{meta['platform_name']} Confidential")
    pdf.setFont("Helvetica", 7)
    pdf.drawCentredString(width / 2, 20, f"Page {pdf.getPageNumber()} of {page_count}")
    pdf.drawRightString(width - doc.rightMargin, 20, _format_date(meta["generated_at"], with_time=True))


def build_pdf(filename, pages_fn, doc_type_label, metadata=None, pagesize=A4, top_margin=80, bottom_margin=50):
    metadata = metadata or {}
    meta = _settings_metadata(metadata)
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=pagesize,
        leftMargin=50,
        rightMargin=50,
        topMargin=top_margin,
        bottomMargin=bottom_margin,
        title=filename,
    )
    story = []
    pages_fn(story)
    doc.build(
        story,
        onFirstPage=lambda pdf, document: _draw_header_footer(pdf, document, doc_type_label, meta),
        onLaterPages=lambda pdf, document: _draw_header_footer(pdf, document, doc_type_label, meta),
        canvasmaker=NumberedCanvas,
    )
    buffer.seek(0)
    return buffer


def pdf_response(buffer, filename):
    from flask import send_file

    response = send_file(buffer, mimetype="application/pdf", as_attachment=True, download_name=filename, max_age=0)
    response.headers["Cache-Control"] = "no-store, no-cache"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def draw_star(pdf, cx, cy, radius, color=WARNING):
    points = []
    for index in range(10):
        angle = math.pi / 2 + index * math.pi / 5
        current_radius = radius if index % 2 == 0 else radius * 0.45
        points.append((cx + current_radius * math.cos(angle), cy + current_radius * math.sin(angle)))
    path = pdf.beginPath()
    path.moveTo(*points[0])
    for point in points[1:]:
        path.lineTo(*point)
    path.close()
    pdf.setFillColor(color)
    pdf.drawPath(path, fill=1, stroke=0)


def landscape_a4():
    return landscape(A4)
