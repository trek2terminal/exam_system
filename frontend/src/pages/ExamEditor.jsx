import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Trash2, Plus, Upload } from "lucide-react";
import { Badge, Button, Input, Select, Textarea, StepWizard, ConfirmationDialog, Modal, Toggle } from "../components/ui";
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
  randomize_delivery: false,
  random_question_count: 0,
  attempt_limit: 1,
  access_mode: "open",
  access_code: "",
  start_time: "",
  end_time: "",
  enrollment_lines: "",
  group_id: ""
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
        formData.append("existing_image_paths", JSON.stringify(question.image_paths || []));
        formData.append("code_snippet", question.code_snippet || "");
        formData.append("code_language", question.code_language || "python");
        formData.append("time_limit_seconds", String(question.time_limit_seconds || 0));
        (question.image_files || []).forEach(file => {
          formData.append(`question_images_${index}`, file);
        });
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
        {currentStep === 2 && <EnrollmentStep exam={exam} examId={examId} onUpdate={updateExamField} />}
        {currentStep === 3 && <SettingsStep exam={exam} onUpdate={updateExamField} />}
        {currentStep === 4 && <ReviewStep exam={exam} />}
      </StepWizard>

      <ConfirmationDialog
        open={showDeleteConfirm}
        title="Delete Question?"
        description="This question will be permanently removed from the exam."
        confirmLabel="Delete"
        confirmWord="DELETE"
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
  const imagePreviews = question?.image_files ? Array.from(question.image_files).map(file => ({
    name: file.name,
    url: window.URL.createObjectURL(file)
  })) : [];

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
          <Input
            label="Correct Answer / Key"
            value={question?.correct_answer || ""}
            onChange={event => onUpdate("correct_answer", event.target.value)}
            placeholder="Type the exact correct option text or key"
          />
        </div>
      )}

      <Textarea
        label="Model Answer / Review Reference"
        value={question?.model_answer || ""}
        onChange={e => onUpdate("model_answer", e.target.value)}
        placeholder="Enter the model answer or marking guide"
        rows={4}
      />

      <div className="space-y-3 rounded-lg border border-border bg-background-base p-4">
        <Toggle
          checked={Boolean(question?.has_code_snippet)}
          onChange={checked => onUpdate("has_code_snippet", checked)}
          label="Add read-only code snippet"
        />
        {question?.has_code_snippet && (
          <div className="space-y-3">
            <Textarea
              label="Code Snippet"
              value={question?.code_snippet || ""}
              onChange={event => onUpdate("code_snippet", event.target.value)}
              rows={6}
              className="font-mono text-sm"
              placeholder="Paste code shown read-only to students"
            />
            <Input
              label="Snippet Language"
              value={question?.code_language || "python"}
              onChange={event => onUpdate("code_language", event.target.value)}
            />
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Input
          label="Per-question Time Limit"
          type="number"
          min="0"
          value={Math.round((question?.time_limit_seconds || 0) / 60)}
          onChange={event => onUpdate("time_limit_seconds", Number(event.target.value || 0) * 60)}
          helperText="Minutes. 0 means no limit."
        />
        {question?.type === "code" && (
          <Input
            label="Execution Time Limit"
            type="number"
            min="1"
            value={question?.execution_time_limit_seconds || 10}
            onChange={event => onUpdate("execution_time_limit_seconds", Number(event.target.value || 10))}
            helperText="Seconds. Stored in editor state; backend currently uses server config."
          />
        )}
      </div>

      <div className="space-y-3 rounded-lg border border-dashed border-border bg-background-base p-4">
        <Input
          label="Question Images"
          type="file"
          accept=".png,.jpg,.jpeg,.gif,.webp"
          multiple
          onChange={event => onUpdate("image_files", Array.from(event.target.files || []))}
        />
        {imagePreviews.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {imagePreviews.map(image => (
              <div key={image.url} className="overflow-hidden rounded-lg border border-border">
                <img src={image.url} alt={image.name} className="h-32 w-full object-cover" />
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="truncate text-xs text-text-muted">{image.name}</span>
                  <Button variant="ghost" size="sm" onClick={() => onUpdate("image_files", [])}>Remove</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {question?.type === "code" && (
        <Badge variant="purple">Coding answers render with Monaco and terminal output in the student UI.</Badge>
      )}
    </div>
  );
}

function EnrollmentStep({ exam, examId, onUpdate }) {
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-info/30 bg-info/5 p-4 text-sm text-info">
        Enrollment changes are saved on the dedicated Flask enrollment endpoint after the exam exists.
      </div>
      {examId && (
        <Button as="a" href={`/teacher/exam/${examId}/enrollments`} variant="secondary">
          <Upload size={16} /> Open Live Enrollment Manager
        </Button>
      )}
      <Textarea
        label="Student Roster Draft"
        value={exam?.enrollment_lines || ""}
        onChange={event => onUpdate("enrollment_lines", event.target.value)}
        rows={8}
        placeholder="One student per line: ROLL, Student Name, Extra Minutes"
        helperText="Use this as a staging area while composing the exam."
      />
      <Input
        label="Group ID Draft"
        value={exam?.group_id || ""}
        onChange={event => onUpdate("group_id", event.target.value)}
        placeholder="Paste a group ID from Admin > Groups"
      />
    </div>
  );
}

function SettingsStep({ exam, onUpdate }) {
  const randomEnabled = Boolean(exam?.randomize_delivery);
  const accessMode = exam?.access_mode || "open";

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-background-base p-4">
          <Toggle
            checked={exam?.shuffle_questions || false}
            onChange={checked => onUpdate("shuffle_questions", checked)}
            label="Shuffle Questions"
          />
        </div>
        <div className="rounded-lg border border-border bg-background-base p-4">
          <Toggle
            checked={exam?.shuffle_options || false}
            onChange={checked => onUpdate("shuffle_options", checked)}
            label="Shuffle MCQ Options"
          />
          <p className="mt-2 text-xs text-text-muted">Kept in editor state; backend randomizes question order now and can accept option shuffle later.</p>
        </div>
        <div className="rounded-lg border border-border bg-background-base p-4">
          <Toggle
            checked={randomEnabled}
            onChange={checked => {
              onUpdate("randomize_delivery", checked);
              if (!checked) onUpdate("random_question_count", 0);
            }}
            label="Randomize Delivery"
          />
        </div>
        {randomEnabled && (
          <Input
            label="Number of Questions"
            type="number"
            min="1"
            max={exam?.questions?.length || undefined}
            value={exam?.random_question_count || ""}
            onChange={event => onUpdate("random_question_count", Number(event.target.value || 0))}
          />
        )}
        <Input
          label="Attempt Limit"
          type="number"
          min="0"
          value={exam?.attempt_limit ?? 1}
          onChange={e => onUpdate("attempt_limit", parseInt(e.target.value || "0"))}
          helperText="0 for unlimited attempts"
        />
        <Select
          label="Access Mode"
          value={accessMode}
          onChange={value => onUpdate("access_mode", value)}
          options={[
            { value: "open", label: "Open" },
            { value: "scheduled", label: "Scheduled" },
            { value: "access_code", label: "Access Code" },
            { value: "invite_only", label: "Invite Only" }
          ]}
        />
      </div>
      {accessMode === "access_code" && (
        <Input
          label="Access Code"
          value={exam?.access_code || ""}
          onChange={event => onUpdate("access_code", event.target.value.toUpperCase())}
          placeholder="Leave blank to keep or generate code"
        />
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Input
          label="Access Window Start"
          type="datetime-local"
          value={exam?.start_time || ""}
          onChange={event => onUpdate("start_time", event.target.value)}
        />
        <Input
          label="Access Window End"
          type="datetime-local"
          value={exam?.end_time || ""}
          onChange={event => onUpdate("end_time", event.target.value)}
        />
      </div>
      {Number(exam?.attempt_limit || 0) === 0 && (
        <Badge variant="info">Attempt limit will be saved as Unlimited.</Badge>
      )}
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
