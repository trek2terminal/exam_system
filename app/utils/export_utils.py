import csv
from io import StringIO

from flask import Response


def _safe_csv_cell(value):
    """Prevent spreadsheet formula injection while keeping values readable."""
    if value is None:
        return ""

    text = str(value)
    if text and text[0] in ("=", "+", "-", "@", "\t", "\r"):
        return f"'{text}"
    return text


def csv_response(filename, headers, rows):
    output = StringIO()
    output.write("\ufeff")
    writer = csv.writer(output)
    writer.writerow([_safe_csv_cell(header) for header in headers])

    for row in rows:
        writer.writerow([_safe_csv_cell(value) for value in row])

    return Response(
        output.getvalue(),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def format_datetime(value):
    return value.strftime("%Y-%m-%d %H:%M:%S") if value else ""
