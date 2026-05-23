import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Trash2, Plus, Upload } from "lucide-react";
import { Button, Input, Select, Textarea, StepWizard, ConfirmationDialog, Modal } from "../components/ui";
import { api } from "../services/api";
import { notify } from "../components/ui/Toast";
import QuestionImportWizard from "./QuestionImportWizard";

const createEmptyExam = () => ({
  name: "",
  subject: "",
  total_marks: "",
  duration_minutes: "",
  passing_percentage: 40,
  set_code: "",
  instructions: "",
  questions: [],
  shuffle_questions: false,
  shuffle_options: false,
  attempt_limit: 1
});

export default function ExamEditor() {
  const { examId } = useParams();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(!!examId);
  const [exam, setExam] = useState(() => createEmptyExam());
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingQuestionId, setDeletingQuestionId] = useState(null);

  const loadExam = useCallback(async () => {
    try {
      const { data } = await api.get(`/teacher/exams/${examId}`);
      setExam(data || createEmptyExam());
    } catch {
      notify.error("Failed to load exam");
    } finally {
      setLoading(false);
    }
  }, [examId]);

  useEffect(() => {
    if (examId) loadExam();
  }, [examId, loadExam]);

  const steps = [
    { label: "Exam Details" },
    { label: "Questions" },
    { label: "Enrollment" },
    { label: "Settings" },
    { label: "Review & Publish" }
  ];

  const handleNext = () => {
    if (currentStep < steps.length - 1) setCurrentStep(currentStep + 1);
    else publishExam();
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  const publishExam = async () => {
    try {
      const formData = new window.FormData();
      formData.append("exam_name", exam.name);
      formData.append("subject", exam.subject);
      formData.append("set_code", exam.set_code || "A");
      formData.append("duration_minutes", String(exam.duration_minutes || 60));
      formData.append("attempt_limit", String(exam.attempt_limit ?? 1));
      formData.append("random_question_count", String(exam.random_question_count || 0));
      if (exam.shuffle_questions) formData.append("shuffle_questions", "on");
      if (exam.start_time) formData.append("start_time", exam.start_time);
      if (exam.end_time) formData.append("end_time", exam.end_time);
      if (exam.access_code) formData.append("access_code", exam.access_code);

      (exam.questions || []).forEach((question, index) => {
        formData.append("question_number", String(index + 1));
        formData.append("question_type", mapQuestionType(question.type));
        formData.append("marks", String(question.max_marks || 1));
        formData.append("correct_answer", question.correct_answer || "");
        formData.append("question_text", question.text || "");
        formData.append("options", (question.options || []).join("|"));
        formData.append("model_answer", question.model_answer || "");
        formData.append("existing_image_paths", "[]");
        formData.append("code_snippet", question.code_snippet || "");
        formData.append("code_language", question.code_language || "python");
        formData.append("time_limit_seconds", String(question.time_limit_seconds || 0));
      });

      const response = await window.fetch(examId ? `/teacher/setup/${examId}` : "/teacher/setup", {
        method: "POST",
        body: formData,
        credentials: "same-origin"
      });
      if (!response.ok) throw new Error("Exam save failed");
      notify.success("Exam saved successfully");
      window.location.href = "/react/teacher/exams";
    } catch {
      notify.error("Failed to save exam");
    }
  };

  const updateExamField = (field, value) => {
    setExam(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const addQuestion = () => {
    setExam(prev => ({
      ...prev,
      questions: [...(prev.questions || []), { id: Date.now(), text: "", type: "mcq", options: [], max_marks: 1 }]
    }));
  };

  const updateQuestion = (id, field, value) => {
    setExam(prev => ({
      ...prev,
      questions: prev.questions.map(q => q.id === id ? { ...q, [field]: value } : q)
    }));
  };

  const deleteQuestion = (id) => {
    setDeletingQuestionId(id);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = () => {
    setExam(prev => ({
      ...prev,
      questions: prev.questions.filter(q => q.id !== deletingQuestionId)
    }));
    setShowDeleteConfirm(false);
  };

  if (loading) return <div className="p-8 text-center">Loading exam...</div>;

  const isNewExam = !examId;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-text-muted">CREATE EXAM</p>
        <h1 className="text-3xl font-bold text-text-primary">{isNewExam ? "New Exam" : exam?.name}</h1>
      </div>

      <StepWizard
        steps={steps}
        currentStep={currentStep}
        onNext={handleNext}
        onBack={handleBack}
        nextLabel={currentStep === steps.length - 1 ? "Save Exam" : "Next"}
        nextDisabled={!isStepValid(currentStep, exam)}
      >
        {currentStep === 0 && <ExamDetailsStep exam={exam} onUpdate={updateExamField} />}
        {currentStep === 1 && (
          <QuestionsStep
            exam={exam}
            onAddQuestion={addQuestion}
            onUpdateQuestion={updateQuestion}
            onDeleteQuestion={deleteQuestion}
            onImport={() => setShowImportWizard(true)}
          />
        )}
        {currentStep === 2 && <EnrollmentStep exam={exam} onUpdate={updateExamField} />}
        {currentStep === 3 && <SettingsStep exam={exam} onUpdate={updateExamField} />}
        {currentStep === 4 && <ReviewStep exam={exam} />}
      </StepWizard>

      <ConfirmationDialog
        open={showDeleteConfirm}
        title="Delete Question?"
        description="This question will be permanently removed from the exam."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
        onClose={() => setShowDeleteConfirm(false)}
      />

      <Modal
        open={showImportWizard}
        title="Import Questions"
        onClose={() => setShowImportWizard(false)}
      >
        <QuestionImportWizard
          onImport={(questions) => {
            setExam(prev => ({
              ...prev,
              questions: [...(prev.questions || []), ...questions]
            }));
            setShowImportWizard(false);
            notify.success(`${questions.length} questions imported`);
          }}
        />
      </Modal>
    </div>
  );
}

function isStepValid(step, exam) {
  if (!exam) return false;
  switch (step) {
    case 0:
      return exam.name && exam.subject && exam.total_marks && exam.duration_minutes;
    case 1:
      return exam.questions && exam.questions.length > 0;
    case 2:
      return true;
    case 3:
      return true;
    case 4:
      return true;
    default:
      return false;
  }
}

function mapQuestionType(type) {
  const typeMap = {
    mcq: "mcq",
    short_answer: "short",
    long_answer: "long",
    code: "coding",
    coding: "coding",
    true_false: "mcq"
  };
  return typeMap[type] || "short";
}

function ExamDetailsStep({ exam, onUpdate }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Input
          label="Exam Name"
          placeholder="e.g., Midterm Physics"
          value={exam?.name || ""}
          onChange={e => onUpdate("name", e.target.value)}
          required
        />
        <Input
          label="Subject"
          placeholder="e.g., Physics"
          value={exam?.subject || ""}
          onChange={e => onUpdate("subject", e.target.value)}
          required
        />
        <Input
          label="Total Marks"
          type="number"
          min="1"
          value={exam?.total_marks || ""}
          onChange={e => onUpdate("total_marks", parseInt(e.target.value))}
          required
        />
        <Input
          label="Duration (minutes)"
          type="number"
          min="1"
          value={exam?.duration_minutes || ""}
          onChange={e => onUpdate("duration_minutes", parseInt(e.target.value))}
          required
        />
        <Input
          label="Passing Percentage (%)"
          type="number"
          min="0"
          max="100"
          value={exam?.passing_percentage || 40}
          onChange={e => onUpdate("passing_percentage", parseInt(e.target.value))}
        />
        <Input
          label="Set Code"
          placeholder="e.g., SET-A"
          value={exam?.set_code || ""}
          onChange={e => onUpdate("set_code", e.target.value)}
        />
      </div>
      <Textarea
        label="Instructions"
        placeholder="Enter exam instructions for students"
        value={exam?.instructions || ""}
        onChange={e => onUpdate("instructions", e.target.value)}
        rows={4}
      />
    </div>
  );
}

function QuestionsStep({ exam, onAddQuestion, onUpdateQuestion, onDeleteQuestion, onImport }) {
  const [selectedQuestion, setSelectedQuestion] = useState(null);
  const questions = exam?.questions || [];

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      {/* Question List */}
      <div className="lg:col-span-1 space-y-3">
        <div className="flex gap-2">
          <Button variant="primary" size="sm" onClick={onAddQuestion} className="flex-1">
            <Plus size={16} /> Add
          </Button>
          <Button variant="secondary" size="sm" onClick={onImport} className="flex-1">
            <Upload size={16} /> Import
          </Button>
        </div>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {questions.map((q, index) => (
            <button
              key={q.id}
              type="button"
              onClick={() => setSelectedQuestion(q.id)}
              className={`w-full rounded-lg border p-3 text-left transition ${
                selectedQuestion === q.id
                  ? "border-brand-primary bg-brand-primary/10"
                  : "border-border hover:bg-background-elevated/50"
              }`}
            >
              <p className="font-semibold text-sm text-text-primary">Q{index + 1}</p>
              <p className="text-xs text-text-muted truncate">{q.text || "(Empty)"}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Question Editor */}
      <div className="lg:col-span-2">
        {selectedQuestion ? (
          <QuestionEditor
            question={questions.find(q => q.id === selectedQuestion)}
            onUpdate={(field, value) => onUpdateQuestion(selectedQuestion, field, value)}
            onDelete={() => onDeleteQuestion(selectedQuestion)}
          />
        ) : (
          <div className="rounded-lg border border-border/50 bg-background-elevated/30 p-8 text-center">
            <p className="text-text-muted">Select or add a question to edit</p>
          </div>
        )}
      </div>
    </div>
  );
}

function QuestionEditor({ question, onUpdate, onDelete }) {
  return (
    <div className="space-y-5 rounded-lg border border-border bg-background-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-text-primary">Edit Question</h3>
        <Button variant="danger" size="sm" onClick={onDelete}>
          <Trash2 size={16} />
        </Button>
      </div>

      <Select
        label="Question Type"
        value={question?.type || "mcq"}
        onChange={e => onUpdate("type", e)}
        options={[
          { value: "mcq", label: "Multiple Choice" },
          { value: "short_answer", label: "Short Answer" },
          { value: "long_answer", label: "Long Answer" },
          { value: "code", label: "Code" },
          { value: "true_false", label: "True/False" }
        ]}
      />

      <Textarea
        label="Question Text"
        value={question?.text || ""}
        onChange={e => onUpdate("text", e.target.value)}
        placeholder="Enter the question"
        rows={3}
      />

      <Input
        label="Marks"
        type="number"
        min="1"
        value={question?.max_marks || 1}
        onChange={e => onUpdate("max_marks", parseInt(e.target.value))}
      />

      {(question?.type === "mcq" || question?.type === "true_false") && (
        <div className="space-y-3">
          <label className="block font-semibold text-text-primary">Options</label>
          {(question?.options || []).map((option, index) => (
            <Input
              key={index}
              value={option}
              onChange={e => {
                const newOptions = [...(question.options || [])];
                newOptions[index] = e.target.value;
                onUpdate("options", newOptions);
              }}
              placeholder={`Option ${index + 1}`}
            />
          ))}
          <Button variant="ghost" size="sm" onClick={() => onUpdate("options", [...(question?.options || []), ""])}>
            <Plus size={16} /> Add Option
          </Button>
        </div>
      )}

      {question?.type === "code" && (
        <Textarea
          label="Model Solution"
          value={question?.model_answer || ""}
          onChange={e => onUpdate("model_answer", e.target.value)}
          placeholder="Enter the model solution code"
          rows={5}
        />
      )}
    </div>
  );
}

function EnrollmentStep() {
  return (
    <div className="space-y-5">
      <div>
        <label className="block font-semibold text-text-primary mb-3">Add Students</label>
        <Input placeholder="Search students by name or roll number..." />
      </div>
      <div>
        <label className="block font-semibold text-text-primary mb-3">Or Add Groups</label>
        <Select
          label="Select Groups"
          options={[
            { value: "group1", label: "Group A" },
            { value: "group2", label: "Group B" }
          ]}
        />
      </div>
      <div>
        <label className="block font-semibold text-text-primary mb-3">Extra Time (per student)</label>
        <Input type="number" placeholder="Minutes" />
      </div>
    </div>
  );
}

function SettingsStep({ exam, onUpdate }) {
  return (
    <div className="space-y-5">
      <div>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={exam?.shuffle_questions || false}
            onChange={e => onUpdate("shuffle_questions", e.target.checked)}
            className="h-4 w-4"
          />
          <span className="font-semibold text-text-primary">Shuffle Questions</span>
        </label>
      </div>
      <div>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={exam?.shuffle_options || false}
            onChange={e => onUpdate("shuffle_options", e.target.checked)}
            className="h-4 w-4"
          />
          <span className="font-semibold text-text-primary">Shuffle Options</span>
        </label>
      </div>
      <div>
        <Input
          label="Attempt Limit"
          type="number"
          min="1"
          value={exam?.attempt_limit || 1}
          onChange={e => onUpdate("attempt_limit", parseInt(e.target.value))}
          helperText="0 for unlimited attempts"
        />
      </div>
      <div>
        <Input label="Access Window Start" type="datetime-local" />
      </div>
      <div>
        <Input label="Access Window End" type="datetime-local" />
      </div>
    </div>
  );
}

function ReviewStep({ exam }) {
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-background-surface p-5">
        <h3 className="mb-4 font-semibold text-text-primary">Exam Summary</h3>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-xs text-text-muted">NAME</p>
            <p className="font-semibold text-text-primary">{exam?.name}</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">TOTAL MARKS</p>
            <p className="font-semibold text-text-primary">{exam?.total_marks}</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">DURATION</p>
            <p className="font-semibold text-text-primary">{exam?.duration_minutes} min</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">QUESTIONS</p>
            <p className="font-semibold text-text-primary">{exam?.questions?.length || 0}</p>
          </div>
        </div>
      </div>
      <div className="rounded-lg border border-success/30 bg-success/5 p-4 text-sm text-success">
        Exam is ready to publish. Students will be able to access and take this exam once it is published.
      </div>
    </div>
  );
}
