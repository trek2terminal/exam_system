import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileBarChart, FileText, ShieldAlert } from "lucide-react";
import { Badge, Button, Card, DateInput, EmptyState, Select, Table } from "../components/ui";
import { api } from "../services/api";
import { notify } from "../components/ui/Toast";
import { formatDate } from "../utils/dateFormat";

function exportAuditRows(rows) {
  const header = ["timestamp", "admin_user", "formatted_message", "resource_type", "resource_id", "ip_address", "status"];
  const body = rows.map(row => header.map(key => `"${String(row[key] ?? "").replaceAll('"', '""')}"`).join(","));
  const blob = new window.Blob([[header.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "audit-log.csv";
  link.click();
  window.URL.revokeObjectURL(url);
}

function humanize(value) {
  if (!value) return "-";
  const text = String(value).replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default function AdminReports() {
  const [dashboard, setDashboard] = useState(null);
  const [examOptions, setExamOptions] = useState([]);
  const [auditRows, setAuditRows] = useState([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [{ data }, examsResponse, auditResponse] = await Promise.all([
          api.get("/admin/dashboard"),
          api.get("/admin/exams", { params: { per_page: 100 } }),
          api.get("/admin/audit-log", { params: { per_page: 50 } })
        ]);
        const options = (examsResponse.data.exams || []).map(exam => ({ value: String(exam.id), label: exam.exam_name }));
        if (!cancelled) {
          setDashboard(data);
          setExamOptions(options);
          setSelectedExamId(options[0]?.value || "");
          setAuditRows(auditResponse.data.items || []);
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
  const auditColumns = [
    { key: "timestamp", header: "Timestamp", sortable: true, render: row => formatDate(row.timestamp) },
    { key: "admin_user", header: "Actor", sortable: true },
    { key: "formatted_message", header: "Activity", sortable: true, render: row => row.formatted_message || humanize(row.action_type) },
    { key: "resource_type", header: "Target", sortable: true, render: row => row.resource_type ? `${humanize(row.resource_type)}${row.resource_id ? ` #${row.resource_id}` : ""}` : "-" },
    { key: "ip_address", header: "IP Address", sortable: true, render: row => row.ip_address || "-" },
    { key: "status", header: "Status", sortable: true, render: row => <Badge variant={row.status === "success" ? "success" : row.status === "warning" ? "warning" : "secondary"}>{row.status || "logged"}</Badge> }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-text-primary">Reports</h1>
          <p className="mt-1 text-text-secondary">Violation exports, exam PDFs, audit logs, and suspicious activity review.</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-5">
          <div className="mb-5 flex items-start gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-lg bg-danger/10 text-danger">
              <AlertTriangle size={22} />
            </span>
            <div>
              <h2 className="text-xl font-semibold text-text-primary">Violation Log Export</h2>
              <p className="text-sm text-text-secondary">Download the current violation CSV for the selected date range.</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <DateInput label="From" value={fromDate} onChange={event => setFromDate(event.target.value)} />
            <DateInput label="To" value={toDate} onChange={event => setToDate(event.target.value)} />
          </div>
          <Button as="a" href={violationExportHref} variant="secondary" className="mt-4 w-full border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
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
              <Button as="a" href={`/api/admin/exams/${selectedExamId}/report.pdf`} variant="primary" className="w-full">
                <Download size={18} /> Download PDF
              </Button>
            </div>
          ) : (
            <EmptyState icon={FileText} heading="No exam selector data" description="No exams are available for report exports yet." compact />
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-text-primary">Audit Log Viewer</h2>
              <p className="text-sm text-text-secondary">Recent admin and system activity.</p>
            </div>
            <Button variant="secondary" onClick={() => exportAuditRows(auditRows)} disabled={auditRows.length === 0}>
              <Download size={18} /> Export CSV
            </Button>
          </div>
          {auditRows.length > 0 ? (
            <Table columns={auditColumns} data={auditRows} rowsPerPageOptions={[10, 20, 50]} className="shadow-none" />
          ) : (
            <EmptyState icon={FileBarChart} heading="No audit entries" description="Recent audit activity will appear here." compact />
          )}
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
            <div className="rounded-lg border border-success/20 bg-success/5 p-5 text-center">
              <CheckCircle2 size={34} className="mx-auto mb-3 text-success" />
              <p className="font-semibold text-text-primary">All clear</p>
              <p className="mt-1 text-sm text-text-muted">No cross-exam suspicious activity found.</p>
            </div>
          )}
          <Button as="a" href="/react/admin/users" variant="secondary" className="mt-4 w-full border border-brand-primary/40 bg-transparent text-brand-primary hover:bg-brand-primary/10">
            Review Users
          </Button>
        </Card>
      </div>
    </div>
  );
}
