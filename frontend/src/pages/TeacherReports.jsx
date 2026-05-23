import { useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, Select } from "../components/ui";
import { api } from "../services/api";
import { notify } from "../components/ui/Toast";

export default function TeacherReports() {
  const [exams, setExams] = useState([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadExams() {
      try {
        const { data } = await api.get("/teacher/dashboard");
        const loaded = data.exams || [];
        setExams(loaded);
        setSelectedExamId(loaded[0]?.id ? String(loaded[0].id) : "");
      } catch {
        notify.error("Could not load teacher exams");
      } finally {
        setLoading(false);
      }
    }
    loadExams();
  }, []);

  const examOptions = useMemo(() => exams.map(exam => ({
    value: String(exam.id),
    label: `${exam.exam_name} (${exam.subject || "No subject"})`
  })), [exams]);

  const selectedExam = exams.find(exam => String(exam.id) === String(selectedExamId));

  if (loading) {
    return <Card className="p-8 text-center text-text-muted">Loading reports...</Card>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase text-text-muted">Teacher workspace</p>
          <h1 className="text-3xl font-bold text-text-primary">Reports</h1>
          <p className="mt-1 text-text-secondary">Export result CSVs and answer-sheet PDFs through the existing Flask report routes.</p>
        </div>
        <Button as="a" href="/teacher/results" variant="secondary">
          <FileText size={18} /> Classic Results
        </Button>
      </div>

      {exams.length === 0 ? (
        <EmptyState
          icon={FileSpreadsheet}
          heading="No exams available"
          description="Create an exam first, then exports will be available here."
          action={{ label: "Create Exam", href: "/react/teacher/exam/new" }}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-5">
            <div className="mb-5 flex items-start gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-lg bg-success/10 text-success">
                <FileSpreadsheet size={22} />
              </span>
              <div>
                <h2 className="text-xl font-semibold text-text-primary">Exam Results Export</h2>
                <p className="text-sm text-text-secondary">Download CSV exports for all results or a single exam.</p>
              </div>
            </div>
            <div className="space-y-4">
              <Select label="Exam" value={selectedExamId} onChange={setSelectedExamId} options={examOptions} />
              {selectedExam && (
                <div className="flex flex-wrap gap-2">
                  <Badge variant={selectedExam.status === "active" ? "success" : "secondary"}>{selectedExam.status}</Badge>
                  <Badge variant="info">{selectedExam.question_count || 0} questions</Badge>
                  <Badge variant="warning">{selectedExam.pending_review_count || 0} pending</Badge>
                </div>
              )}
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button as="a" href="/teacher/results/export" variant="secondary" className="flex-1">
                  <Download size={18} /> Export All CSV
                </Button>
                <Button as="a" href={selectedExamId ? `/teacher/exam/${selectedExamId}/results/export` : "#"} variant="primary" className="flex-1" aria-disabled={!selectedExamId}>
                  <Download size={18} /> Export Exam CSV
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-5 flex items-start gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-lg bg-brand-primary/10 text-brand-primary">
                <FileText size={22} />
              </span>
              <div>
                <h2 className="text-xl font-semibold text-text-primary">Answer Sheet PDF</h2>
                <p className="text-sm text-text-secondary">Use a reviewed session ID to download the protected answer-sheet PDF.</p>
              </div>
            </div>
            <div className="space-y-4">
              <Input label="Session ID" value={sessionId} onChange={event => setSessionId(event.target.value)} placeholder="e.g. 42" />
              <Button as="a" href={sessionId ? `/teacher/session/${sessionId}/answer-pdf` : "#"} variant="primary" className="w-full" aria-disabled={!sessionId}>
                <Download size={18} /> Download PDF
              </Button>
              <p className="text-sm text-text-muted">Session IDs are visible from the exam review list and classic teacher result screens.</p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
