import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, FileBarChart, FileText, ShieldAlert } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, Select } from "../components/ui";
import { api } from "../services/api";
import { notify } from "../components/ui/Toast";

function parseClassicExamOptions(html) {
  const doc = new window.DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll(".exam-card")).map(node => {
    const href = node.querySelector("a[href*='/admin/exams/']")?.getAttribute("href") || "";
    const id = href.match(/admin\/exams\/(\d+)/)?.[1];
    return id ? { value: id, label: node.querySelector("h3")?.textContent.trim() || `Exam ${id}` } : null;
  }).filter(Boolean);
}

export default function AdminReports() {
  const [dashboard, setDashboard] = useState(null);
  const [examOptions, setExamOptions] = useState([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [{ data }, examsResponse] = await Promise.all([
          api.get("/admin/dashboard"),
          window.fetch("/admin/exams", { credentials: "same-origin" })
        ]);
        const html = await examsResponse.text();
        const options = parseClassicExamOptions(html);
        if (!cancelled) {
          setDashboard(data);
          setExamOptions(options);
          setSelectedExamId(options[0]?.value || "");
        }
      } catch {
        notify.warning("Some report selectors could not be loaded.");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const violationExportHref = useMemo(() => {
    const params = new window.URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    const query = params.toString();
    return `/admin/violations/export${query ? `?${query}` : ""}`;
  }, [fromDate, toDate]);

  const suspicious = dashboard?.suspicious_students || [];
  const stats = dashboard?.stats || {};

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase text-text-muted">Admin workspace</p>
          <h1 className="text-3xl font-bold text-text-primary">Reports</h1>
          <p className="mt-1 text-text-secondary">Violation exports, exam PDFs, audit logs, and suspicious activity review.</p>
        </div>
        <Button as="a" href="/admin/analytics" variant="secondary">
          <FileBarChart size={18} /> Classic Analytics
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-5">
          <div className="mb-5 flex items-start gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-lg bg-danger/10 text-danger">
              <AlertTriangle size={22} />
            </span>
            <div>
              <h2 className="text-xl font-semibold text-text-primary">Violation Log Export</h2>
              <p className="text-sm text-text-secondary">Download the current violation CSV from Flask.</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="From" type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} />
            <Input label="To" type="date" value={toDate} onChange={event => setToDate(event.target.value)} />
          </div>
          <Button as="a" href={violationExportHref} variant="danger" className="mt-4 w-full">
            <Download size={18} /> Export Violation CSV
          </Button>
        </Card>

        <Card className="p-5">
          <div className="mb-5 flex items-start gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-lg bg-brand-primary/10 text-brand-primary">
              <FileText size={22} />
            </span>
            <div>
              <h2 className="text-xl font-semibold text-text-primary">Complete Exam Report PDF</h2>
              <p className="text-sm text-text-secondary">Download the admin PDF report for an exam.</p>
            </div>
          </div>
          {examOptions.length > 0 ? (
            <div className="space-y-4">
              <Select label="Exam" value={selectedExamId} onChange={setSelectedExamId} options={examOptions} />
              <Button as="a" href={`/admin/exams/${selectedExamId}/report.pdf`} variant="primary" className="w-full">
                <Download size={18} /> Download PDF
              </Button>
            </div>
          ) : (
            <EmptyState icon={FileText} heading="No exam selector data" description="Use the classic exams page if the React parser could not read the current exam list." compact />
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-text-primary">Audit Log Viewer</h2>
              <p className="text-sm text-text-secondary">The current audit log is server-rendered; the link keeps the protected Flask workflow intact.</p>
            </div>
            <Button as="a" href="/admin/audit-logs" variant="secondary">
              Open Audit Logs
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-background-base p-4">
              <span className="text-xs font-semibold uppercase text-text-muted">Users</span>
              <strong className="mt-1 block text-2xl text-text-primary">{stats.total_users || 0}</strong>
            </div>
            <div className="rounded-lg border border-border bg-background-base p-4">
              <span className="text-xs font-semibold uppercase text-text-muted">Active Exams</span>
              <strong className="mt-1 block text-2xl text-text-primary">{stats.active_exams || 0}</strong>
            </div>
            <div className="rounded-lg border border-border bg-background-base p-4">
              <span className="text-xs font-semibold uppercase text-text-muted">Violations Today</span>
              <strong className="mt-1 block text-2xl text-danger">{stats.violations_today || 0}</strong>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <ShieldAlert size={22} className="text-warning" />
            <h2 className="text-xl font-semibold text-text-primary">Suspicious Activity</h2>
          </div>
          {suspicious.length > 0 ? (
            <div className="space-y-3">
              {suspicious.map(student => (
                <div key={student.id || student.name} className="rounded-lg border border-warning/30 bg-warning/5 p-3">
                  <strong className="block text-text-primary">{student.name}</strong>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="warning">{student.exam_count || 0} exams</Badge>
                    <Badge variant="danger">{student.total_violations || student.violation_count || 0} violations</Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-muted">No cross-exam suspicious activity returned by the current dashboard API.</p>
          )}
          <Button as="a" href="/admin/suspicious-activity" variant="secondary" className="mt-4 w-full">
            Open Classic Report
          </Button>
        </Card>
      </div>
    </div>
  );
}
