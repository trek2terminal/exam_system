import json
import csv
from io import StringIO
from app.models.database import db
from app.models.exam_model import Question


class QuestionParserService:

    @staticmethod
    def parse_csv(file):
        """Parse questions from CSV file"""
        questions = []
        stream = StringIO(file.stream.read().decode("UTF8"), newline=None)
        reader = csv.DictReader(stream)

        for row in reader:
            question = {
                'question_number': int(row.get('question_number', 0)),
                'question_text': row.get('question_text', '').strip(),
                'question_type': row.get('question_type', 'short').lower(),
                'marks': int(row.get('marks', 1)),
                'options': row.get('options', ''),  # comma separated for MCQ
                'correct_answer': row.get('correct_answer', '')
            }
            questions.append(question)

        return questions

    @staticmethod
    def parse_json(file):
        """Parse questions from JSON file"""
        data = json.load(file.stream)
        return data.get('questions', []) if isinstance(data, dict) else data

    @staticmethod
    def save_questions_to_exam(exam_set_id: int, questions_list: list):
        """Save parsed questions to database"""
        for q in questions_list:
            question = Question(
                exam_set_id=exam_set_id,
                question_number=q.get('question_number'),
                question_text=q.get('question_text'),
                question_type=q.get('question_type'),
                marks=q.get('marks', 1),
                correct_answer=q.get('correct_answer')
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