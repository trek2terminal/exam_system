import { useEffect, useMemo, useState } from "react";
import { BookOpenCheck, FilePlus2, Pencil, Search, Trash2, Upload } from "lucide-react";
import { Badge, Button, Card, ConfirmationDialog, EmptyState, Input, Select, Textarea } from "../components/ui";
import { notify } from "../components/ui/Toast";

const typeOptions = [
  { value: "all", label: "All Types" },
  { value: "mcq", label: "MCQ" },
  { value: "short", label: "Short Answer" },
  { value: "long", label: "Long Answer" },
  { value: "coding", label: "Code" }
];

const questionTypeOptions = typeOptions.filter(option => option.value !== "all");

function parseClassicBank(html) {
  const doc = new window.DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll(".question-bank-item")).map((node, index) => {
    const form = node.querySelector("form[action*='/question-bank/']");
    const action = form?.getAttribute("action") || "";
    const id = action.match(/question-bank\/(\d+)\/delete/)?.[1] || `classic-${index}`;
    const meta = Array.from(node.querySelectorAll("p.muted")).map(item => item.textContent.trim()).filter(Boolean);
    return {
      id,
      deleteAction: action,
      type: node.querySelector(".badge")?.textContent.trim().toLowerCase() || "short",
      text: node.querySelector("h3")?.textContent.trim() || "Untitled question",
      meta,
      codeSnippet: node.querySelector("pre")?.textContent.trim() || ""
    };
  });
}

export default function TeacherQuestionBank() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [questionType, setQuestionType] = useState("short");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [examId, setExamId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function loadBank() {
      try {
        const response = await window.fetch("/teacher/question-bank", { credentials: "same-origin" });
        const html = await response.text();
        if (!cancelled) setItems(parseClassicBank(html));
      } catch {
        notify.warning("Question bank list is available in the classic teacher page.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadBank();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter(item => {
      const matchesType = typeFilter === "all" || item.type.includes(typeFilter);
      const matchesSearch = !query || item.text.toLowerCase().includes(query);
      return matchesType && matchesSearch;
    });
  }, [items, search, typeFilter]);

  const confirmDelete = async () => {
    if (!deleteTarget?.deleteAction) return;
    try {
      const response = await window.fetch(deleteTarget.deleteAction, {
        method: "POST",
        credentials: "same-origin"
      });
      if (!response.ok) throw new Error("Delete failed");
      setItems(current => current.filter(item => item.id !== deleteTarget.id));
      notify.success("Question removed from bank");
      setDeleteTarget(null);
    } catch {
      notify.error("Could not delete the bank question");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase text-text-muted">Teacher workspace</p>
          <h1 className="text-3xl font-bold text-text-primary">Question Bank</h1>
          <p className="mt-1 text-text-secondary">Create reusable questions, import them into exams, and keep the classic bank data in sync.</p>
        </div>
        <Button as="a" href="/teacher/question-bank" variant="secondary">
          <BookOpenCheck size={18} /> Classic Bank
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card className="p-5">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-lg bg-brand-primary/10 text-brand-primary">
              <FilePlus2 size={22} />
            </span>
            <div>
              <h2 className="text-xl font-semibold text-text-primary">Add Question</h2>
              <p className="text-sm text-text-secondary">Saves through the existing Flask question-bank route.</p>
            </div>
          </div>

          <form method="post" action="/teacher/question-bank" encType="multipart/form-data" className="space-y-4">
            <Select label="Question Type" value={questionType} onChange={setQuestionType} options={questionTypeOptions} />
            <Textarea label="Question Text" name="question_text" rows={5} required placeholder="Write the reusable question text." />
            <Input label="Marks" name="marks" type="number" min="1" defaultValue="1" required />

            {questionType === "mcq" && (
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
                <input type="hidden" name="options" value={options.filter(Boolean).join("|")} />
              </div>
            )}

            <input type="hidden" name="question_type" value={questionType} />
            <Input label="Correct Answer / Key" name="correct_answer" placeholder="Optional for written questions" />
            <Textarea label="Model Answer" name="model_answer" rows={3} placeholder="Reference answer shown during review/results when revealed." />
            <Input label="Question Images" name="question_images" type="file" accept=".png,.jpg,.jpeg,.gif,.webp" multiple />
            <Textarea label="Read-only Code Snippet" name="code_snippet" rows={4} className="font-mono text-sm" />
            <Input label="Snippet Language" name="code_language" placeholder="python" />
            <Input label="Per-question Time Limit" name="time_limit_seconds" type="number" min="0" defaultValue="0" helperText="Seconds. 0 means no limit." />
            <Button type="submit" variant="primary" className="w-full">
              <Upload size={18} /> Save to Bank
            </Button>
          </form>
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
              description="Add a question on the left, or open the classic bank if the HTML list could not be read."
              action={{ label: "Open Classic Bank", href: "/teacher/question-bank" }}
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {filteredItems.map((item, index) => (
                <Card key={item.id} className="overflow-hidden animate-fade-in-up" style={{ animationDelay: `${index * 50}ms` }}>
                  <div className="h-1.5 bg-brand-primary" />
                  <div className="space-y-4 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <Badge variant={item.type.includes("mcq") ? "info" : item.type.includes("coding") ? "purple" : "secondary"}>
                        {item.type}
                      </Badge>
                      <Button variant="ghost" size="sm" className="h-11 w-11 px-0" onClick={() => setDeleteTarget(item)} aria-label="Delete bank question">
                        <Trash2 size={17} />
                      </Button>
                    </div>
                    <p className="line-clamp-2 font-semibold text-text-primary">{item.text}</p>
                    <div className="flex flex-wrap gap-2">
                      {item.meta.map(meta => <Badge key={meta} variant="secondary">{meta}</Badge>)}
                    </div>
                    {item.codeSnippet && (
                      <pre className="max-h-28 overflow-auto rounded-md bg-slate-950 p-3 font-mono text-xs text-slate-100">{item.codeSnippet}</pre>
                    )}
                    <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                      <Button as="a" href={`/teacher/question-bank`} variant="secondary" size="sm">
                        <Pencil size={16} /> Edit Classic
                      </Button>
                      <form method="post" action={examId ? `/teacher/exam/${examId}/question-bank/import` : "/teacher/question-bank"} className="contents">
                        <input type="hidden" name="bank_item_id" value={item.id} />
                        <Button type="submit" variant="primary" size="sm" disabled={!examId}>
                          <Upload size={16} /> Import
                        </Button>
                      </form>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmationDialog
        open={!!deleteTarget}
        title="Delete Bank Question?"
        description="This removes the saved reusable question from your bank. Existing exams keep their own copied questions."
        confirmLabel="Delete"
        confirmWord="DELETE"
        variant="danger"
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
