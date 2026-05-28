import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Download, FileBarChart, FileText, Search, ShieldAlert } from "lucide-react";
import { Badge, Button, Card, DateInput, EmptyState, Input, Select, Table } from "../components/ui";
import { api } from "../services/api";
import { notify } from "../components/ui/Toast";
import { formatDate, timeAgo } from "../utils/dateFormat";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

function humanize(value) {
  if (!value) return "-";
  const text = String(value).replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function auditBadge(severity) {
  if (severity === "danger") return "danger";
  if (severity === "warning") return "warning";
  if (severity === "success") return "success";
  return "info";
}

function buildAuditParams(filters) {
  const params = { per_page: 80 };
  Object.entries(filters).forEach(([key, value]) => {
    if (value && value !== "all") params[key] = value;
  });
  return params;
}

function auditExportHref(baseHref, filters) {
  const params = new window.URLSearchParams(buildAuditParams(filters));
  params.delete("per_page");
  const query = params.toString();
  return `${baseHref}${query ? `?${query}` : ""}`;
}

export default function AdminReports() {
  const [dashboard, setDashboard] = useState(null);
  const [examOptions, setExamOptions] = useState([]);
  const [auditRows, setAuditRows] = useState([]);
  const [auditSummary, setAuditSummary] = useState({});
  const [auditImportant, setAuditImportant] = useState([]);
  const [auditFilterOptions, setAuditFilterOptions] = useState({});
  const [selectedExamId, setSelectedExamId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [auditFilters, setAuditFilters] = useState({
    q: "",
    category: "all",
    status: "all",
    resource_type: "all",
    from: "",
    to: ""
  });

  const auditParams = useMemo(() => buildAuditParams(auditFilters), [auditFilters]);

  const loadReports = useCallback(async () => {
    try {
      const [{ data }, examsResponse, auditResponse] = await Promise.all([
        api.get("/admin/dashboard"),
        api.get("/admin/exams", { params: { per_page: 100 } }),
        api.get("/admin/audit-log", { params: auditParams })
      ]);
      const options = (examsResponse.data.exams || []).map(exam => ({ value: String(exam.id), label: exam.exam_name }));
      setDashboard(data);
      setExamOptions(options);
      setSelectedExamId(current => current || options[0]?.value || "");
      setAuditRows(auditResponse.data.items || []);
      setAuditSummary(auditResponse.data.summary || {});
      setAuditImportant(auditResponse.data.important_events || []);
      setAuditFilterOptions(auditResponse.data.filters || {});
    } catch {
      notify.warning("Some report selectors could not be loaded.");
    }
  }, [auditParams]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);
  useLiveRefresh(loadReports, { intervalMs: 25000 });

  const violationExportHref = useMemo(() => {
    const params = new window.URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    const query = params.toString();
    return `/admin/violations/export${query ? `?${query}` : ""}`;
  }, [fromDate, toDate]);

  const categoryOptions = [{ value: "all", label: "All categories" }, ...(auditFilterOptions.categories || [])];
  const statusOptions = [{ value: "all", label: "All statuses" }, ...(auditFilterOptions.statuses || [])];
  const resourceOptions = [{ value: "all", label: "All targets" }, ...(auditFilterOptions.resources || [])];
  const suspicious = dashboard?.suspicious_students || [];
  const auditColumns = [
    { key: "timestamp", header: "Timestamp", sortable: true, render: row => formatDate(row.timestamp) },
    { key: "actor_name", header: "Actor", sortable: true },
    { key: "formatted_message", header: "Activity", sortable: true, render: row => row.formatted_message || humanize(row.action_type) },
    { key: "category", header: "Category", sortable: true, render: row => <Badge variant={auditBadge(row.severity)}>{humanize(row.category)}</Badge> },
    { key: "resource_type", header: "Target", sortable: true, render: row => row.resource_type ? `${humanize(row.resource_type)}${row.resource_label ? ` | ${row.resource_label}` : row.resource_id ? ` #${row.resource_id}` : ""}` : "-" },
    { key: "ip_address", header: "IP Address", sortable: true, render: row => row.ip_address || "-" },
    { key: "status", header: "Status", sortable: true, render: row => <Badge variant={row.status === "success" ? "success" : row.status === "warning" ? "warning" : "secondary"}>{row.status || "logged"}</Badge> }
  ];

  const updateAuditFilter = (key, value) => {
    setAuditFilters(current => ({ ...current, [key]: value }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase text-text-muted">Admin workspace</p>
          <h1 className="text-3xl font-bold text-text-primary">Reports & Activity</h1>
          <p className="mt-1 text-text-secondary">Audit trail, important events, violation exports, and exam report PDFs.</p>
        </div>
        <Button as="a" href={auditExportHref("/api/admin/audit-log/export.csv", auditFilters)} variant="secondary">
          <Download size={18} /> Export Filtered Audit
        </Button>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ActivityMetric icon={Clock3} label="Today" value={auditSummary.today || 0} tone="info" />
        <ActivityMetric icon={AlertTriangle} label="Important" value={auditSummary.important || 0} tone={auditSummary.important ? "warning" : "success"} />
        <ActivityMetric icon={ShieldAlert} label="Security" value={auditSummary.security || 0} tone={auditSummary.security ? "warning" : "success"} />
        <ActivityMetric icon={Download} label="Exports" value={auditSummary.exports || 0} tone="info" />
      </section>

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
          <Button as="a" href={violationExportHref} variant="secondary" className="mt-4 w-full">
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
              <Select label="Exam" value={selectedExamId} onChange={setSelectedExamId} options={examOptions} required />
              <Button as="a" href={`/api/admin/exams/${selectedExamId}/report.pdf`} variant="primary" className="w-full">
                <Download size={18} /> Download PDF
              </Button>
            </div>
          ) : (
            <EmptyState icon={FileText} heading="No exam selector data" description="No exams are available for report exports yet." compact />
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.8fr)]">
        <Card className="p-5">
          <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-text-primary">Audit Activity Center</h2>
              <p className="text-sm text-text-secondary">Search, filter, review, and export platform activity.</p>
            </div>
            <Badge variant="purple" size="md">{Number(auditSummary.total || 0).toLocaleString()} matching</Badge>
          </div>
          <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(220px,1fr)_repeat(3,minmax(150px,180px))]">
            <Input value={auditFilters.q} onChange={event => updateAuditFilter("q", event.target.value)} placeholder="Search activity, actor, target, IP" aria-label="Search audit activity" />
            <Select value={auditFilters.category} onChange={value => updateAuditFilter("category", value)} options={categoryOptions} placeholder="Category" />
            <Select value={auditFilters.status} onChange={value => updateAuditFilter("status", value)} options={statusOptions} placeholder="Status" />
            <Select value={auditFilters.resource_type} onChange={value => updateAuditFilter("resource_type", value)} options={resourceOptions} placeholder="Target" />
          </div>
          <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <DateInput label="Activity from" value={auditFilters.from} onChange={event => updateAuditFilter("from", event.target.value)} />
            <DateInput label="Activity to" value={auditFilters.to} onChange={event => updateAuditFilter("to", event.target.value)} />
            <Button variant="ghost" onClick={() => setAuditFilters({ q: "", category: "all", status: "all", resource_type: "all", from: "", to: "" })}>
              <Search size={17} /> Reset
            </Button>
          </div>
          {auditRows.length > 0 ? (
            <Table columns={auditColumns} data={auditRows} rowsPerPageOptions={[10, 20, 50]} className="shadow-none" />
          ) : (
            <EmptyState icon={FileBarChart} heading="No audit entries" description="Try adjusting the filters." compact />
          )}
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <ShieldAlert size={22} className="text-warning" />
                <h2 className="text-xl font-semibold text-text-primary">Important Events</h2>
              </div>
              <Badge variant="warning">{auditImportant.length}</Badge>
            </div>
            {auditImportant.length > 0 ? (
              <div className="space-y-3">
                {auditImportant.map(item => (
                  <div key={item.id} className="rounded-lg border border-border bg-background-base p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <Badge variant={auditBadge(item.severity)}>{humanize(item.category)}</Badge>
                      <span className="text-xs text-text-muted">{timeAgo(item.timestamp)}</span>
                    </div>
                    <p className="text-sm font-semibold text-text-primary">{item.formatted_message}</p>
                    <p className="mt-1 text-xs text-text-muted">{item.actor_name} {item.ip_address ? `| ${item.ip_address}` : ""}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-success/20 bg-success/5 p-5 text-center">
                <CheckCircle2 size={34} className="mx-auto mb-3 text-success" />
                <p className="font-semibold text-text-primary">No important events</p>
              </div>
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
            <Button as="a" href="/react/admin/users" variant="secondary" className="mt-4 w-full">
              Review Users
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ActivityMetric({ icon: Icon, label, value, tone }) {
  const color = tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-brand-primary";
  return (
    <Card className="p-4">
      <Icon size={18} className={`mb-3 ${color}`} />
      <p className="text-xs font-semibold uppercase text-text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold text-text-primary">{Number(value || 0).toLocaleString()}</p>
    </Card>
  );
}
