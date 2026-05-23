import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, FileBarChart, FileText, ShieldAlert } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, Select, Table } from "../components/ui";
import { api } from "../services/api";
import { notify } from "../components/ui/Toast";

function exportAuditRows(rows) {
  const header = ["timestamp", "admin_user", "action_type", "resource_type", "resource_id", "ip_address", "status"];
  const body = rows.map(row => header.map(key => `"${String(row[key] ?? "").replaceAll('"', '""')}"`).join(","));
  const blob = new window.Blob([[header.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "audit-log.csv";
  link.click();
  window.URL.revokeObjectURL(url);
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
  const stats = dashboard?.stats || {};
  const auditColumns = [
    { key: "timestamp", header: "Timestamp", sortable: true, render: row => row.timestamp ? new Date(row.timestamp).toLocaleString() : "-" },
    { key: "admin_user", header: "Admin", sortable: true },
    { key: "action_type", header: "Action", sortable: true },
    { key: "resource_type", header: "Target", sortable: true, render: row => [row.resource_type, row.resource_id].filter(Boolean).join(" #") || "-" },
    { key: "ip_address", header: "IP Address", sortable: true, render: row => row.ip_address || "-" },
    { key: "status", header: "Status", sortable: true, render: row => <Badge variant={row.status === "success" ? "success" : row.status === "warning" ? "warning" : "secondary"}>{row.status || "logged"}</Badge> }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase text-text-muted">Admin workspace</p>
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
              <p className="text-sm text-text-secondary">Recent admin and system audit events from the JSON audit endpoint.</p>
            </div>
            <Button variant="secondary" onClick={() => exportAuditRows(auditRows)} disabled={auditRows.length === 0}>
              <Download size={18} /> Export CSV
            </Button>
          </div>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
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
            <p className="text-sm text-text-muted">No cross-exam suspicious activity returned by the current dashboard API.</p>
          )}
          <Button as="a" href="/react/admin/users" variant="secondary" className="mt-4 w-full">
            Review Users
          </Button>
        </Card>
      </div>
    </div>
  );
}
