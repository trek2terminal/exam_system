import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BookOpenCheck, Save, Trash2, Plus, Upload } from "lucide-react";
import { Avatar, Badge, Button, Input, Select, Textarea, StepWizard, ConfirmationDialog, Modal, Toggle } from "../components/ui";
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
  group_id: "",
  group_ids: []
});

export default function ExamEditor() {
  const { examId } = useParams();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(!!examId);
  const [saving, setSaving] = useState(false);
  const [exam, setExam] = useState(() => createEmptyExam());
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [showBankImport, setShowBankImport] = useState(false);
  const [savingBankQuestionId, setSavingBankQuestionId] = useState(null);
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
    setSaving(true);
    try {
      const formData = new window.FormData();
      formData.append("exam_name", exam.name);
      formData.append("subject", exam.subject);
      formData.append("set_code", exam.set_code || "A");
      formData.append("duration_minutes", String(exam.duration_minutes || 60));
      formData.append("passing_percentage", String(exam.passing_percentage ?? 40));
      formData.append("attempt_limit", String(exam.attempt_limit ?? 1));
      formData.append("random_question_count", String(exam.random_question_count || 0));
      if (exam.shuffle_questions) formData.append("shuffle_questions", "on");
      if (exam.shuffle_options) formData.append("shuffle_options", "on");
      if (exam.start_time) formData.append("start_time", exam.start_time);
      if (exam.end_time) formData.append("end_time", exam.end_time);
      if (exam.access_code) formData.append("access_code", exam.access_code);
      if (exam.enrollment_lines) formData.append("enrollment_lines", exam.enrollment_lines);
      if (exam.group_id) formData.append("group_id", exam.group_id);
      if ((exam.group_ids || []).length) formData.append("group_ids", JSON.stringify(exam.group_ids));

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
        formData.append("execution_time_limit_seconds", String(question.execution_time_limit_seconds || 10));
        (question.image_files || []).forEach(file => {
          formData.append(`question_images_${index}`, file);
        });
      });

      const response = await api.request({
        url: examId ? `/teacher/exams/${examId}` : "/teacher/exams",
        method: examId ? "patch" : "post",
        data: formData,
        headers: { "Content-Type": "multipart/form-data" }
      });
      notify.success(response.data?.message || "Exam saved successfully");
      navigate("/teacher/exams", { replace: true });
    } catch (error) {
      notify.error(error.message || "Failed to save exam");
    } finally {
      setSaving(false);
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
      questions: [
        ...(prev.questions || []),
        { id: Date.now(), text: "", type: "mcq", options: [], max_marks: 1, time_limit_seconds: 0, execution_time_limit_seconds: 10 }
      ]
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

  const saveQuestionToBank = async question => {
    if (!question?.text?.trim()) {
      notify.error("Enter the question text before saving it to the question bank.");
      return;
    }
    setSavingBankQuestionId(question.id);
    try {
      const payload = questionToBankPayload(question);
      const { data } = await api.post("/teacher/question-bank", payload, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      notify.success(data.message || "Question added to question bank");
    } catch (error) {
      notify.error(error.message || "Could not save question to bank");
    } finally {
      setSavingBankQuestionId(null);
    }
  };

  const importBankQuestion = item => {
    setExam(prev => ({
      ...prev,
      questions: [...(prev.questions || []), bankItemToExamQuestion(item)]
    }));
    setShowBankImport(false);
    notify.success("Question imported from bank. Save the exam to keep it in this paper.");
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
        nextDisabled={saving || !isStepValid(currentStep, exam)}
      >
        {currentStep === 0 && <ExamDetailsStep exam={exam} onUpdate={updateExamField} />}
        {currentStep === 1 && (
          <QuestionsStep
            exam={exam}
            onAddQuestion={addQuestion}
            onUpdateQuestion={updateQuestion}
            onDeleteQuestion={deleteQuestion}
            onImport={() => setShowImportWizard(true)}
            onOpenBank={() => setShowBankImport(true)}
            onSaveToBank={saveQuestionToBank}
            savingBankQuestionId={savingBankQuestionId}
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

      <QuestionBankImportModal
        open={showBankImport}
        onClose={() => setShowBankImport(false)}
        onImport={importBankQuestion}
      />
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

function bankTypeToEditorType(type) {
  const typeMap = {
    short: "short_answer",
    long: "long_answer",
    coding: "code",
    code: "code",
    true_false: "true_false",
    mcq: "mcq"
  };
  return typeMap[type] || "short_answer";
}

function questionToBankPayload(question) {
  const payload = new window.FormData();
  payload.append("question_text", question.text || "");
  payload.append("question_type", mapQuestionType(question.type));
  payload.append("marks", String(question.max_marks || 1));
  payload.append("options", (question.options || []).filter(Boolean).join("|"));
  payload.append("correct_answer", question.correct_answer || "");
  payload.append("model_answer", question.model_answer || "");
  payload.append("code_snippet", question.code_snippet || "");
  payload.append("code_language", question.code_language || "python");
  payload.append("time_limit_seconds", String(question.time_limit_seconds || 0));
  payload.append("execution_time_limit_seconds", String(question.execution_time_limit_seconds || 10));
  payload.append("image_paths", JSON.stringify(question.image_paths || []));
  (question.image_files || []).forEach(file => payload.append("question_images", file));
  return payload;
}

function bankItemToExamQuestion(item) {
  return {
    id: `bank_${item.id}_${Date.now()}`,
    text: item.question_text || item.text || "",
    type: bankTypeToEditorType(item.question_type || item.type),
    options: item.options || [],
    max_marks: item.marks || 1,
    correct_answer: item.correct_answer || "",
    model_answer: item.model_answer || "",
    image_paths: item.image_paths || [],
    image_urls: item.image_urls || [],
    code_snippet: item.code_snippet || "",
    has_code_snippet: Boolean(item.code_snippet),
    code_language: item.code_language || "python",
    time_limit_seconds: item.time_limit_seconds || 0,
    execution_time_limit_seconds: item.execution_time_limit_seconds || 10
  };
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

function QuestionsStep({ exam, onAddQuestion, onUpdateQuestion, onDeleteQuestion, onImport, onOpenBank, onSaveToBank, savingBankQuestionId }) {
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
            <Upload size={16} /> File
          </Button>
          <Button variant="secondary" size="sm" onClick={onOpenBank} className="flex-1">
            <BookOpenCheck size={16} /> Bank
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
            onSaveToBank={() => onSaveToBank(questions.find(q => q.id === selectedQuestion))}
            savingToBank={savingBankQuestionId === selectedQuestion}
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

function QuestionEditor({ question, onUpdate, onDelete, onSaveToBank, savingToBank }) {
  const imagePreviews = question?.image_files ? Array.from(question.image_files).map(file => ({
    name: file.name,
    url: window.URL.createObjectURL(file)
  })) : [];

  return (
    <div className="space-y-5 rounded-lg border border-border bg-background-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-text-primary">Edit Question</h3>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onSaveToBank} loading={savingToBank} loadingLabel="Saving">
            <Save size={16} /> Add to Question Bank
          </Button>
          <Button variant="danger" size="sm" onClick={onDelete} aria-label="Delete question">
            <Trash2 size={16} />
          </Button>
        </div>
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
            helperText="Seconds. Used when students run code for this question."
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

function QuestionBankImportModal({ open, onClose, onImport }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function loadBank() {
      setLoading(true);
      try {
        const { data } = await api.get("/teacher/question-bank");
        if (!cancelled) setItems(data.items || []);
      } catch (error) {
        if (!cancelled) {
          setItems([]);
          notify.error(error.message || "Could not load question bank");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadBank();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const filteredItems = items.filter(item => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [
      item.question_text,
      item.question_type,
      item.correct_answer,
      item.model_answer
    ].filter(Boolean).join(" ").toLowerCase().includes(query);
  });

  return (
    <Modal open={open} onClose={onClose} title="Import from Question Bank" className="max-w-4xl">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Input
            label="Search Bank"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search saved questions"
          />
          <Button as="a" href="/react/teacher/question-bank" variant="secondary">
            Manage Bank
          </Button>
        </div>

        {loading ? (
          <div className="rounded-lg border border-border bg-background-base p-8 text-center text-text-muted">Loading question bank...</div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-lg border border-border bg-background-base p-8 text-center text-text-muted">
            No saved questions found.
          </div>
        ) : (
          <div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1 md:grid-cols-2">
            {filteredItems.map(item => (
              <div key={item.id} className="rounded-lg border border-border bg-background-base p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={item.question_type === "mcq" ? "info" : item.question_type === "coding" ? "purple" : "secondary"}>
                      {item.question_type}
                    </Badge>
                    <Badge variant="secondary">{item.marks || 1} marks</Badge>
                  </div>
                  <Button variant="primary" size="sm" onClick={() => onImport(item)}>
                    <Plus size={16} /> Import
                  </Button>
                </div>
                <p className="line-clamp-3 text-sm font-semibold text-text-primary">{item.question_text}</p>
                {item.options?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.options.slice(0, 4).map(option => (
                      <Badge key={option} variant={option === item.correct_answer ? "success" : "secondary"} size="sm">
                        {option}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function EnrollmentStep({ exam, examId, onUpdate }) {
  const [loading, setLoading] = useState(Boolean(examId));
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [students, setStudents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [bulkText, setBulkText] = useState(exam?.enrollment_lines || "");
  const [selectedGroup, setSelectedGroup] = useState(exam?.group_id || "");
  const [selectedGroupIds, setSelectedGroupIds] = useState(exam?.group_ids || []);
  const [manual, setManual] = useState({ roll_no: "", student_name: "", extra_time_minutes: 0 });
  const [pendingRemove, setPendingRemove] = useState(null);

  const loadEnrollments = useCallback(async () => {
    if (!examId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/teacher/exams/${examId}/enrollments`);
      setEnrollments(data.enrollments || []);
      setGroups(data.groups || []);
    } catch (error) {
      notify.error(error.message || "Failed to load exam enrollments");
    } finally {
      setLoading(false);
    }
  }, [examId]);

  const loadGroups = useCallback(async () => {
    try {
      const { data } = await api.get("/teacher/groups");
      setGroups(data.groups || []);
    } catch {
      setGroups([]);
    }
  }, []);

  useEffect(() => {
    loadGroups();
    if (examId) {
      loadEnrollments();
    } else {
      setLoading(false);
    }
  }, [examId, loadEnrollments, loadGroups]);

  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setStudents([]);
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await api.get("/teacher/students/search", { params: { q: query.trim() } });
        setStudents(data.students || []);
      } catch {
        setStudents([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const addDraftLine = (line) => {
    const next = [bulkText, line].filter(Boolean).join("\n");
    setBulkText(next);
    onUpdate("enrollment_lines", next);
    notify.success("Student added to the roster that will be applied when this exam is saved.");
  };

  const postEnrollment = async (payload, successMessage) => {
    if (!examId) {
      if (payload.group_id) {
        const nextIds = Array.from(new Set([...selectedGroupIds, String(payload.group_id)]));
        setSelectedGroupIds(nextIds);
        setSelectedGroup("");
        onUpdate("group_ids", nextIds);
        onUpdate("group_id", nextIds[0] || "");
        notify.success("Group assignment will be applied when this exam is saved.");
        return;
      }
      if (payload.enrollments) {
        onUpdate("enrollment_lines", payload.enrollments);
        notify.success("Roster will be applied when this exam is saved.");
        return;
      }
      if (payload.roll_no) {
        addDraftLine(
          [
            payload.roll_no,
            payload.student_name,
            payload.extra_time_minutes || 0
          ].filter(value => value !== undefined && value !== "").join(", ")
        );
        return;
      }
      if (payload.student_id && payload.student) {
        addDraftLine(`${payload.student.roll_number || payload.student.username}, ${payload.student.name}, 0`);
      }
      return;
    }

    setSaving(true);
    try {
      const { data } = await api.post(`/teacher/exams/${examId}/enrollments`, payload);
      setEnrollments(data.enrollments || []);
      setGroups(data.groups || groups);
      notify.success(successMessage || data.message || "Enrollment updated");
    } catch (error) {
      notify.error(error.message || "Failed to update enrollment");
    } finally {
      setSaving(false);
    }
  };

  const addStudent = (student) => {
    setQuery("");
    setStudents([]);
    postEnrollment({ student_id: student.id, student }, `${student.name} added to the exam`);
  };

  const addManualStudent = () => {
    if (!manual.roll_no.trim()) {
      notify.error("Enter a roll number before adding the student.");
      return;
    }
    postEnrollment(manual, "Student added to the exam");
    setManual({ roll_no: "", student_name: "", extra_time_minutes: 0 });
  };

  const applyBulkRoster = () => {
    const cleanText = bulkText.trim();
    if (!cleanText) {
      notify.error("Paste at least one roster line first.");
      return;
    }
    onUpdate("enrollment_lines", cleanText);
    postEnrollment({ enrollments: cleanText }, "Roster applied to the exam");
  };

  const applyGroup = () => {
    if (!selectedGroup) {
      notify.error("Choose a group first.");
      return;
    }
    onUpdate("group_id", selectedGroup);
    postEnrollment({ group_id: selectedGroup }, "Group students added to the exam");
  };

  const removeDraftGroup = groupId => {
    const nextIds = selectedGroupIds.filter(item => String(item) !== String(groupId));
    setSelectedGroupIds(nextIds);
    onUpdate("group_ids", nextIds);
    onUpdate("group_id", nextIds[0] || "");
  };

  const saveEnrollment = async (enrollment) => {
    if (!examId) return;
    try {
      const { data } = await api.patch(`/teacher/exams/${examId}/enrollments/${enrollment.id}`, {
        student_name: enrollment.student_name,
        extra_time_minutes: enrollment.extra_time_minutes
      });
      setEnrollments(prev => prev.map(item => item.id === enrollment.id ? data.enrollment : item));
      notify.success("Enrollment saved");
    } catch (error) {
      notify.error(error.message || "Failed to save enrollment");
    }
  };

  const removeEnrollment = async () => {
    if (!pendingRemove || !examId) {
      setPendingRemove(null);
      return;
    }
    try {
      await api.delete(`/teacher/exams/${examId}/enrollments/${pendingRemove.id}`);
      setEnrollments(prev => prev.filter(item => item.id !== pendingRemove.id));
      notify.success("Student removed from this exam");
    } catch (error) {
      notify.error(error.message || "Failed to remove student");
    } finally {
      setPendingRemove(null);
    }
  };

  const draftGroupStudentCount = selectedGroupIds.reduce((total, groupId) => {
    const group = groups.find(item => String(item.id) === String(groupId));
    return total + Number(group?.student_count || 0);
  }, 0);

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-info/30 bg-info/5 p-4 text-sm text-info">
        Search students, assign a group, or paste a roster in the format <span className="font-semibold">ROLL, Student Name, Extra Minutes</span>.
        {examId ? " Changes are saved immediately." : " These entries are applied when you save the exam."}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <div className="rounded-xl border border-border bg-background-card p-5 shadow-card">
            <div className="relative">
              <Input
                label="Search Students"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search by name, email, username, or roll number"
                helperText="Choose a result to add the student to this exam."
              />
              {(students.length > 0 || searching) && (
                <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-background-card p-2 shadow-elevated">
                  {searching && <p className="px-3 py-2 text-sm text-text-muted">Searching...</p>}
                  {students.map(student => (
                    <button
                      key={student.id}
                      type="button"
                      onClick={() => addStudent(student)}
                      className="flex w-full items-center justify-between rounded-md px-3 py-3 text-left text-sm transition hover:bg-background-elevated"
                    >
                      <span>
                        <span className="block font-semibold text-text-primary">{student.name}</span>
                        <span className="text-xs text-text-muted">{student.roll_number || student.username} · {student.email || "No email"}</span>
                      </span>
                      <Badge variant="info" size="sm">Add</Badge>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-background-card p-5 shadow-card">
            <h3 className="mb-4 text-sm font-semibold text-text-primary">Manual Add</h3>
            <div className="grid gap-4 md:grid-cols-[1fr_1fr_140px_auto]">
              <Input
                label="Roll Number"
                value={manual.roll_no}
                onChange={event => setManual(prev => ({ ...prev, roll_no: event.target.value }))}
              />
              <Input
                label="Student Name"
                value={manual.student_name}
                onChange={event => setManual(prev => ({ ...prev, student_name: event.target.value }))}
              />
              <Input
                label="Extra Minutes"
                type="number"
                min="0"
                value={manual.extra_time_minutes}
                onChange={event => setManual(prev => ({ ...prev, extra_time_minutes: Number(event.target.value || 0) }))}
              />
              <Button className="self-end" loading={saving} onClick={addManualStudent}>
                <Plus size={16} /> Add
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-background-card p-5 shadow-card">
            <h3 className="mb-4 text-sm font-semibold text-text-primary">Bulk Roster</h3>
            <Textarea
              label="Roster Lines"
              value={bulkText}
              onChange={event => {
                setBulkText(event.target.value);
                onUpdate("enrollment_lines", event.target.value);
              }}
              rows={7}
              placeholder={"ROLL001, Asha Sen, 10\nROLL002, Ravi Roy, 0"}
              helperText="One student per line. Extra minutes are optional and default to 0."
            />
            <div className="mt-4 flex justify-end">
              <Button variant="secondary" loading={saving} onClick={applyBulkRoster}>Apply Roster</Button>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-xl border border-border bg-background-card p-5 shadow-card">
            <h3 className="mb-4 text-sm font-semibold text-text-primary">Group Assignment</h3>
            <Select
              label="Student Group"
              value={selectedGroup}
              onChange={value => {
                setSelectedGroup(value);
                onUpdate("group_id", value);
              }}
              options={[
                { value: "", label: "Select a group" },
                ...groups.map(group => ({
                  value: String(group.id),
                  label: `${group.name} (${group.student_count})`
                }))
              ]}
            />
            <Button className="mt-4 w-full" variant="secondary" loading={saving} onClick={applyGroup}>
              Add Group Students
            </Button>
            {!examId && selectedGroupIds.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold uppercase text-text-muted">Batches selected for this exam</p>
                {selectedGroupIds.map(groupId => {
                  const group = groups.find(item => String(item.id) === String(groupId));
                  return (
                    <div key={groupId} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background-base p-2 text-sm">
                      <span className="font-semibold text-text-primary">{group?.name || `Batch ${groupId}`}</span>
                      <Button variant="ghost" size="sm" onClick={() => removeDraftGroup(groupId)}>
                        <Trash2 size={14} /> Remove
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
            {selectedGroup && groups.find(group => String(group.id) === String(selectedGroup))?.members?.length > 0 && (
              <div className="mt-4 rounded-lg border border-border bg-background-base p-3">
                <p className="mb-2 text-xs font-semibold uppercase text-text-muted">Students in selected batch</p>
                <div className="max-h-52 space-y-2 overflow-y-auto">
                  {groups.find(group => String(group.id) === String(selectedGroup)).members.map(member => (
                    <div key={member.id} className="flex items-center justify-between gap-3 rounded-md bg-background-surface px-3 py-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <Avatar name={member.name} src={member.profile_picture} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-text-primary">{member.name}</span>
                          <span className="block truncate text-xs text-text-muted">{member.roll_number || member.username}</span>
                        </span>
                      </span>
                      <Badge variant="info" size="sm">Included</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-background-card p-5 shadow-card">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-text-primary">Current Enrollment</h3>
              <Badge variant="purple">{examId ? enrollments.length : countDraftRoster(bulkText) + draftGroupStudentCount} students</Badge>
            </div>
            {!examId ? (
              <div className="rounded-lg border border-border bg-background-base p-4 text-sm text-text-muted">
                Save the exam to convert this roster into live enrollment records with editable extra time.
              </div>
            ) : loading ? (
              <div className="space-y-2">
                {[0, 1, 2].map(item => (
                  <div key={item} className="h-16 animate-pulse rounded-lg bg-background-elevated" />
                ))}
              </div>
            ) : enrollments.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-background-base p-6 text-center text-sm text-text-muted">
                No students enrolled yet.
              </div>
            ) : (
              <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
                {enrollments.map(enrollment => (
                  <div key={enrollment.id} className="rounded-lg border border-border bg-background-base p-3">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-text-primary">{enrollment.student_name || "Unnamed student"}</p>
                        <p className="text-xs text-text-muted">{enrollment.roll_no}</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setPendingRemove(enrollment)}>
                        <Trash2 size={16} />
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
                      <Input
                        label="Name"
                        value={enrollment.student_name || ""}
                        onChange={event => setEnrollments(prev => prev.map(item => (
                          item.id === enrollment.id ? { ...item, student_name: event.target.value } : item
                        )))}
                        onBlur={() => saveEnrollment(enrollment)}
                      />
                      <Input
                        label="Extra"
                        type="number"
                        min="0"
                        value={enrollment.extra_time_minutes || 0}
                        onChange={event => setEnrollments(prev => prev.map(item => (
                          item.id === enrollment.id ? { ...item, extra_time_minutes: Number(event.target.value || 0) } : item
                        )))}
                        onBlur={() => saveEnrollment(enrollment)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmationDialog
        open={Boolean(pendingRemove)}
        title="Remove Student?"
        description={`Remove ${pendingRemove?.student_name || pendingRemove?.roll_no || "this student"} from this exam enrollment.`}
        confirmLabel="Remove"
        confirmWord="DELETE"
        variant="danger"
        onConfirm={removeEnrollment}
        onClose={() => setPendingRemove(null)}
      />
    </div>
  );
}

function countDraftRoster(text) {
  return String(text || "").split("\n").filter(line => line.trim()).length;
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
          <p className="mt-2 text-xs text-text-muted">Answer choices are shuffled per attempt and remain stable throughout the session.</p>
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
