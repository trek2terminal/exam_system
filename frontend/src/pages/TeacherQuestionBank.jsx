import { useEffect, useMemo, useState } from "react";
import { FilePlus2, Pencil, Search, Trash2, Upload } from "lucide-react";
import { Badge, Button, Card, ConfirmationDialog, EmptyState, Input, Modal, Select, Textarea } from "../components/ui";
import { notify } from "../components/ui/Toast";
import { api } from "../services/api";

const typeOptions = [
  { value: "all", label: "All Types" },
  { value: "mcq", label: "MCQ" },
  { value: "short", label: "Short Answer" },
  { value: "long", label: "Long Answer" },
  { value: "coding", label: "Code" }
];

const questionTypeOptions = typeOptions.filter(option => option.value !== "all");

const emptyForm = {
  question_text: "",
  question_type: "short",
  marks: "1",
  correct_answer: "",
  model_answer: "",
  explanation: "",
  code_snippet: "",
  code_language: "python",
  time_limit_seconds: "0"
};

function normalizeItem(item) {
  return {
    id: item.id,
    type: item.question_type || item.type || "short",
    text: item.question_text || item.text || "Untitled question",
    marks: Number(item.marks || 0),
    options: item.options || [],
    correct_answer: item.correct_answer || "",
    model_answer: item.model_answer || "",
    explanation: item.explanation || "",
    codeSnippet: item.code_snippet || "",
    code_language: item.code_language || "python",
    time_limit_seconds: item.time_limit_seconds || 0,
    image_urls: item.image_urls || []
  };
}

function formFromItem(item) {
  return {
    question_text: item.text || "",
    question_type: item.type || "short",
    marks: String(item.marks || 1),
    correct_answer: item.correct_answer || "",
    model_answer: item.model_answer || "",
    explanation: item.explanation || "",
    code_snippet: item.codeSnippet || "",
    code_language: item.code_language || "python",
    time_limit_seconds: String(item.time_limit_seconds || 0)
  };
}

export default function TeacherQuestionBank() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [formData, setFormData] = useState(emptyForm);
  const [options, setOptions] = useState(["", "", "", ""]);
  const [examId, setExamId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [editOptions, setEditOptions] = useState(["", "", "", ""]);
  const [importingId, setImportingId] = useState(null);

  const loadBank = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/teacher/question-bank");
      setItems((data.items || []).map(normalizeItem));
    } catch (error) {
      notify.error(error.message || "Could not load the question bank.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBank();
  }, []);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter(item => {
      const matchesType = typeFilter === "all" || item.type === typeFilter;
      const matchesSearch = !query || item.text.toLowerCase().includes(query);
      return matchesType && matchesSearch;
    });
  }, [items, search, typeFilter]);

  const saveQuestion = async (event, imageFiles = []) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = new window.FormData();
      Object.entries(formData).forEach(([key, value]) => payload.append(key, value ?? ""));
      payload.set("options", formData.question_type === "mcq" ? options.filter(Boolean).join("|") : "");
      imageFiles.forEach(file => payload.append("question_images", file));
      const { data } = await api.post("/teacher/question-bank", payload, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      setItems(current => [normalizeItem(data.item), ...current]);
      setFormData(emptyForm);
      setOptions(["", "", "", ""]);
      notify.success("Question saved to bank");
    } catch (error) {
      notify.error(error.response?.data?.message || error.message || "Could not save question");
    } finally {
      setSaving(false);
    }
  };

  const openEdit = item => {
    setEditTarget(item);
    setEditForm(formFromItem(item));
    setEditOptions([...item.options, "", "", "", ""].slice(0, Math.max(4, item.options.length)));
  };

  const saveEdit = async event => {
    event.preventDefault();
    if (!editTarget) return;
    setSaving(true);
    try {
      const payload = {
        ...editForm,
        marks: Number(editForm.marks || 1),
        time_limit_seconds: Number(editForm.time_limit_seconds || 0),
        options: editForm.question_type === "mcq" ? editOptions.filter(Boolean) : []
      };
      const { data } = await api.patch(`/teacher/question-bank/${editTarget.id}`, payload);
      setItems(current => current.map(item => item.id === editTarget.id ? normalizeItem(data.item) : item));
      setEditTarget(null);
      notify.success("Question updated");
    } catch (error) {
      notify.error(error.response?.data?.message || error.message || "Could not update question");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget?.id) return;
    try {
      await api.delete(`/teacher/question-bank/${deleteTarget.id}`);
      setItems(current => current.filter(item => item.id !== deleteTarget.id));
      notify.success("Question removed from bank");
      setDeleteTarget(null);
    } catch (error) {
      notify.error(error.response?.data?.message || error.message || "Could not delete the bank question");
    }
  };

  const importIntoExam = async item => {
    if (!examId.trim()) {
      notify.warning("Enter an exam ID before importing.");
      return;
    }
    setImportingId(item.id);
    try {
      const { data } = await api.post(`/teacher/exam/${examId.trim()}/question-bank/import`, {
        bank_item_id: item.id
      });
      notify.success(data.message || "Question imported into exam");
    } catch (error) {
      notify.error(error.message || "Could not import question into exam");
    } finally {
      setImportingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase text-text-muted">Teacher workspace</p>
          <h1 className="text-3xl font-bold text-text-primary">Question Bank</h1>
          <p className="mt-1 text-text-secondary">Create reusable questions, import them into exams, and keep everything synced through the JSON API.</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card className="p-5">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-lg bg-brand-primary/10 text-brand-primary">
              <FilePlus2 size={22} />
            </span>
            <div>
              <h2 className="text-xl font-semibold text-text-primary">Add Question</h2>
              <p className="text-sm text-text-secondary">Reusable items can be edited and imported later.</p>
            </div>
          </div>

          <QuestionForm
            formData={formData}
            setFormData={setFormData}
            options={options}
            setOptions={setOptions}
            onSubmit={saveQuestion}
            saving={saving}
            submitLabel="Save to Bank"
            allowImages
          />
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_170px]">
              <Input
                label="Search Questions"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search by question text"
              />
              <Select label="Type" value={typeFilter} onChange={setTypeFilter} options={typeOptions} />
              <Input label="Exam ID for Import" value={examId} onChange={event => setExamId(event.target.value)} placeholder="e.g. 12" />
            </div>
          </Card>

          {loading ? (
            <Card className="p-8 text-center text-text-muted">Loading question bank...</Card>
          ) : filteredItems.length === 0 ? (
            <EmptyState
              icon={Search}
              heading="No saved questions found"
              description="Add a reusable question, then import it into any exam."
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {filteredItems.map((item, index) => (
                <Card key={item.id} className="overflow-hidden animate-fade-in-up" style={{ animationDelay: `${index * 50}ms` }}>
                  <div className="h-1.5 bg-brand-primary" />
                  <div className="space-y-4 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={item.type === "mcq" ? "info" : item.type === "coding" ? "purple" : "secondary"}>
                          {item.type}
                        </Badge>
                        <Badge variant="secondary">{item.marks} marks</Badge>
                      </div>
                      <Button variant="ghost" size="sm" className="h-11 w-11 px-0" onClick={() => setDeleteTarget(item)} aria-label="Delete bank question">
                        <Trash2 size={17} />
                      </Button>
                    </div>
                    <p className="line-clamp-2 font-semibold text-text-primary">{item.text}</p>
                    {item.options.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {item.options.map(option => <Badge key={option} variant={option === item.correct_answer ? "success" : "secondary"}>{option}</Badge>)}
                      </div>
                    )}
                    {item.image_urls.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {item.image_urls.map(url => <img key={url} src={url} alt="" className="h-16 w-20 rounded-md border border-border object-cover" />)}
                      </div>
                    )}
                    {item.codeSnippet && (
                      <pre className="max-h-28 overflow-auto rounded-md bg-slate-950 p-3 font-mono text-xs text-slate-100">{item.codeSnippet}</pre>
                    )}
                    <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                      <Button variant="secondary" size="sm" onClick={() => openEdit(item)}>
                        <Pencil size={16} /> Edit
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        disabled={!examId.trim()}
                        loading={importingId === item.id}
                        loadingLabel="Importing"
                        onClick={() => importIntoExam(item)}
                      >
                        <Upload size={16} /> Import
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Bank Question" className="max-w-2xl">
        <QuestionForm
          formData={editForm}
          setFormData={setEditForm}
          options={editOptions}
          setOptions={setEditOptions}
          onSubmit={saveEdit}
          saving={saving}
        submitLabel="Save Changes"
      />
      </Modal>

      <ConfirmationDialog
        open={!!deleteTarget}
        title="Delete Bank Question?"
        description="This removes the saved reusable question from your bank. Existing exams keep their copied questions."
        confirmLabel="Delete"
        confirmWord="DELETE"
        variant="danger"
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function QuestionForm({ formData, setFormData, options, setOptions, onSubmit, saving, submitLabel, allowImages = false }) {
  const [imageFiles, setImageFiles] = useState([]);
  const update = patch => setFormData(current => ({ ...current, ...patch }));

  return (
    <form className="space-y-4" onSubmit={event => onSubmit(event, imageFiles)}>
      <Select label="Question Type" value={formData.question_type} onChange={value => update({ question_type: value })} options={questionTypeOptions} />
      <Textarea label="Question Text" rows={5} required value={formData.question_text} onChange={event => update({ question_text: event.target.value })} placeholder="Write the reusable question text." />
      <Input label="Marks" type="number" min="1" required value={formData.marks} onChange={event => update({ marks: event.target.value })} />

      {formData.question_type === "mcq" && (
        <div className="space-y-3">
          <span className="block text-sm font-semibold text-text-secondary">MCQ Options</span>
          {options.map((option, index) => (
            <Input
              key={index}
              value={option}
              onChange={event => {
                const next = [...options];
                next[index] = event.target.value;
                setOptions(next);
              }}
              placeholder={`Option ${index + 1}`}
            />
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={() => setOptions(current => [...current, ""])}>
            Add Option
          </Button>
        </div>
      )}

      <Input label="Correct Answer / Key" value={formData.correct_answer} onChange={event => update({ correct_answer: event.target.value })} placeholder="Optional for written questions" />
      <Textarea label="Model Answer" rows={3} value={formData.model_answer} onChange={event => update({ model_answer: event.target.value })} placeholder="Reference answer shown during review/results when revealed." />
      <Textarea label="Explanation" rows={3} value={formData.explanation} onChange={event => update({ explanation: event.target.value })} placeholder="Optional explanation for results." />
      {allowImages && (
        <Input
          label="Question Images"
          type="file"
          accept=".png,.jpg,.jpeg,.gif,.webp"
          multiple
          onChange={event => setImageFiles(Array.from(event.target.files || []))}
          helperText={imageFiles.length ? `${imageFiles.length} image(s) selected` : "Optional image attachments."}
        />
      )}
      <Textarea label="Read-only Code Snippet" rows={4} value={formData.code_snippet} onChange={event => update({ code_snippet: event.target.value })} className="font-mono text-sm" />
      <Input label="Snippet Language" value={formData.code_language} onChange={event => update({ code_language: event.target.value })} placeholder="python" />
      <Input label="Per-question Time Limit" type="number" min="0" value={formData.time_limit_seconds} onChange={event => update({ time_limit_seconds: event.target.value })} helperText="Seconds. 0 means no limit." />
      <Button type="submit" variant="primary" className="w-full" loading={saving} loadingLabel="Saving...">
        <Upload size={18} /> {submitLabel}
      </Button>
    </form>
  );
}
