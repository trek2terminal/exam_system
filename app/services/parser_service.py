import csv
import json
import re
import zipfile
from io import StringIO
from xml.etree import ElementTree

from app.models.database import db
from app.models.exam_model import Question


class QuestionParserService:
    QUESTION_RE = re.compile(
        r"^(?:Q(?:uestion)?\s*)?(\d+)\s*[\.\):\-]\s*(.+)$",
        re.IGNORECASE,
    )
    OPTION_RE = re.compile(r"^(?:\(?([A-H])\)?[\.\)]|([A-H])\s*[-:])\s*(.+)$", re.IGNORECASE)
    ANSWER_RE = re.compile(r"^(?:ans|answer|correct answer|correct)\s*[:\-]\s*(.+)$", re.IGNORECASE)
    MARKS_RE = re.compile(r"(?:\[marks?\s*:\s*(\d+)\]|\((\d+)\s*marks?\))", re.IGNORECASE)

    @staticmethod
    def _clean_text(text):
        return (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()

    @staticmethod
    def _extract_marks(text):
        match = QuestionParserService.MARKS_RE.search(text or "")
        if not match:
            return text.strip(), 1

        marks = int(match.group(1) or match.group(2) or 1)
        cleaned_text = QuestionParserService.MARKS_RE.sub("", text).strip()
        return cleaned_text, marks

    @staticmethod
    def _infer_question_type(question_text, options, explicit_answer):
        lowered = (question_text or "").lower()
        if options:
            return "mcq"
        if "write a program" in lowered or "python" in lowered or "code" in lowered:
            return "coding"
        if len(question_text or "") > 180:
            return "long"
        if explicit_answer and len(explicit_answer) > 120:
            return "long"
        return "short"

    @staticmethod
    def _finalize_question(current, questions, unmatched):
        if not current:
            return

        text = " ".join(part.strip() for part in current["text_parts"] if part.strip()).strip()
        text, marks = QuestionParserService._extract_marks(text)
        options = [option["text"] for option in current["options"]]
        correct_answer = current["answer"].strip()

        if not correct_answer:
            correct_options = [option["text"] for option in current["options"] if option["correct"]]
            correct_answer = correct_options[0] if correct_options else ""

        if not text:
            unmatched.extend(current["raw_lines"])
            return

        questions.append(
            {
                "question_number": current["number"] or len(questions) + 1,
                "question_text": text,
                "question_type": QuestionParserService._infer_question_type(text, options, correct_answer),
                "marks": marks,
                "options": options,
                "correct_answer": correct_answer,
            }
        )

    @staticmethod
    def parse_text(raw_text):
        """Parse common pasted question-paper formats into question dictionaries."""
        text = QuestionParserService._clean_text(raw_text)
        questions = []
        unmatched = []
        current = None

        for raw_line in text.split("\n"):
            line = raw_line.strip()
            if not line:
                continue

            question_match = QuestionParserService.QUESTION_RE.match(line)
            option_match = QuestionParserService.OPTION_RE.match(line)
            answer_match = QuestionParserService.ANSWER_RE.match(line)

            if question_match:
                QuestionParserService._finalize_question(current, questions, unmatched)
                current = {
                    "number": int(question_match.group(1)),
                    "text_parts": [question_match.group(2).strip()],
                    "options": [],
                    "answer": "",
                    "raw_lines": [line],
                }
                continue

            if current and option_match:
                option_text = (option_match.group(3) or "").strip()
                is_correct = False
                if option_text.startswith("*"):
                    is_correct = True
                    option_text = option_text[1:].strip()
                if "[correct]" in option_text.lower():
                    is_correct = True
                    option_text = re.sub(r"\[correct\]", "", option_text, flags=re.IGNORECASE).strip()
                current["options"].append({"text": option_text, "correct": is_correct})
                current["raw_lines"].append(line)
                continue

            if current and answer_match:
                current["answer"] = answer_match.group(1).strip().lstrip("*").strip()
                current["raw_lines"].append(line)
                continue

            if current:
                current["text_parts"].append(line)
                current["raw_lines"].append(line)
            else:
                unmatched.append(line)

        QuestionParserService._finalize_question(current, questions, unmatched)
        return {"questions": questions, "unmatched": unmatched}

    @staticmethod
    def extract_docx_text(file_storage):
        """Extract plain text from a .docx without extra dependencies."""
        with zipfile.ZipFile(file_storage.stream) as docx:
            xml_bytes = docx.read("word/document.xml")

        root = ElementTree.fromstring(xml_bytes)
        namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        paragraphs = []

        for paragraph in root.findall(".//w:p", namespace):
            parts = [node.text for node in paragraph.findall(".//w:t", namespace) if node.text]
            if parts:
                paragraphs.append("".join(parts))

        return "\n".join(paragraphs)

    @staticmethod
    def parse_uploaded_file(file_storage):
        filename = (file_storage.filename or "").lower()
        if filename.endswith(".txt"):
            raw = file_storage.stream.read().decode("utf-8", errors="replace")
            return QuestionParserService.parse_text(raw)
        if filename.endswith(".docx"):
            raw = QuestionParserService.extract_docx_text(file_storage)
            return QuestionParserService.parse_text(raw)
        if filename.endswith(".csv"):
            return {"questions": QuestionParserService.parse_csv(file_storage), "unmatched": []}
        if filename.endswith(".json"):
            return {"questions": QuestionParserService.parse_json(file_storage), "unmatched": []}
        raise ValueError("Upload a .txt, .docx, .csv, or .json file.")

    @staticmethod
    def parse_csv(file):
        """Parse questions from CSV file"""
        questions = []
        stream = StringIO(file.stream.read().decode("UTF8"), newline=None)
        reader = csv.DictReader(stream)

        for index, row in enumerate(reader, start=1):
            try:
                question_number = int(row.get('question_number') or index)
            except ValueError:
                question_number = index

            try:
                marks = int(row.get('marks') or 1)
            except ValueError:
                marks = 1

            question = {
                'question_number': question_number,
                'question_text': row.get('question_text', '').strip(),
                'question_type': row.get('question_type', 'short').lower(),
                'marks': marks,
                'options': row.get('options', ''),  # comma separated for MCQ
                'correct_answer': row.get('correct_answer', '')
            }
            if question['question_text']:
                questions.append(question)

        return questions

    @staticmethod
    def parse_json(file):
        """Parse questions from JSON file"""
        data = json.load(file.stream)
        return data.get('questions', []) if isinstance(data, dict) else data

    @staticmethod
    def save_questions_to_exam(exam_set_id: int, questions_list: list, replace=False):
        """Save parsed questions to database"""
        if replace:
            Question.query.filter_by(exam_set_id=exam_set_id).delete()
            next_number = 1
        else:
            last_question = (
                Question.query.filter_by(exam_set_id=exam_set_id)
                .order_by(Question.question_number.desc())
                .first()
            )
            next_number = (last_question.question_number + 1) if last_question else 1

        for q in questions_list:
            question_number = q.get('question_number') or next_number
            if not replace:
                question_number = next_number
            next_number += 1

            question = Question(
                exam_set_id=exam_set_id,
                question_number=question_number,
                question_text=q.get('question_text'),
                question_type=q.get('question_type'),
                marks=int(q.get('marks', 1) or 1),
                correct_answer=q.get('correct_answer') or ""
            )

            if q.get('options'):
                if isinstance(q['options'], str):
                    options_list = [opt.strip() for opt in q['options'].split(',')]
                else:
                    options_list = q['options']
                question.set_options(options_list)

            db.session.add(question)

        db.session.commit()
        return len(questions_list)
