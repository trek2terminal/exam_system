import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Clock3, Download, FileSpreadsheet, FileText, Search, ShieldAlert } from "lucide-react";
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

function buildActivityParams(filters) {
  const params = { per_page: 80 };
  Object.entries(filters).forEach(([key, value]) => {
    if (value && value !== "all") params[key] = value;
  });
  return params;
}

function exportHref(filters) {
  const params = new window.URLSearchParams(buildActivityParams(filters));
  params.delete("per_page");
  const query = params.toString();
  return `/api/teacher/activity/export.csv${query ? `?${query}` : ""}`;
}

export default function TeacherReports() {
  const [exams, setExams] = useState([]);
  const [activityRows, setActivityRows] = useState([]);
  const [activitySummary, setActivitySummary] = useState({});
  const [importantEvents, setImportantEvents] = useState([]);
  const [filterOptions, setFilterOptions] = useState({});
  const [selectedExamId, setSelectedExamId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [activityFilters, setActivityFilters] = useState({
    q: "",
    category: "all",
    status: "all",
    resource_type: "all",
    from: "",
    to: ""
  });

  const activityParams = useMemo(() => buildActivityParams(activityFilters), [activityFilters]);

  const loadReports = useCallback(async (soft = false) => {
    if (!soft) setLoading(true);
    try {
      const [dashboardResponse, activityResponse] = await Promise.all([
        api.get("/teacher/dashboard"),
        api.get("/teacher/activity", { params: activityParams })
      ]);
      const loaded = dashboardResponse.data.exams || [];
      setExams(loaded);
      setSelectedExamId(current => current || (loaded[0]?.id ? String(loaded[0].id) : ""));
      setActivityRows(activityResponse.data.items || []);
      setActivitySummary(activityResponse.data.summary || {});
      setImportantEvents(activityResponse.data.important_events || []);
      setFilterOptions(activityResponse.data.filters || {});
    } catch {
      notify.error("Could not load teacher reports");
    } finally {
      setLoading(false);
    }
  }, [activityParams]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);
  useLiveRefresh(loadReports, { intervalMs: 25000 });

  const examOptions = useMemo(() => exams.map(exam => ({
    value: String(exam.id),
    label: `${exam.exam_name} (${exam.subject || "No subject"})`
  })), [exams]);

  const selectedExam = exams.find(exam => String(exam.id) === String(selectedExamId));
  const categoryOptions = [{ value: "all", label: "All categories" }, ...(filterOptions.categories || [])];
  const statusOptions = [{ value: "all", label: "All statuses" }, ...(filterOptions.statuses || [])];
  const resourceOptions = [{ value: "all", label: "All targets" }, ...(filterOptions.resources || [])];
  const activityColumns = [
    { key: "timestamp", header: "Timestamp", sortable: true, render: row => formatDate(row.timestamp) },
    { key: "formatted_message", header: "Activity", sortable: true, render: row => row.formatted_message || humanize(row.action_type) },
    { key: "category", header: "Category", sortable: true, render: row => <Badge variant={auditBadge(row.severity)}>{humanize(row.category)}</Badge> },
    { key: "resource_type", header: "Target", sortable: true, render: row => row.resource_type ? `${humanize(row.resource_type)}${row.resource_label ? ` | ${row.resource_label}` : row.resource_id ? ` #${row.resource_id}` : ""}` : "-" },
    { key: "status", header: "Status", sortable: true, render: row => <Badge variant={row.status === "success" ? "success" : row.status === "warning" ? "warning" : "secondary"}>{row.status || "logged"}</Badge> }
  ];

  const updateActivityFilter = (key, value) => {
    setActivityFilters(current => ({ ...current, [key]: value }));
  };

  if (loading) {
    return <Card className="p-8 text-center text-text-muted">Loading reports...</Card>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase text-text-muted">Teacher workspace</p>
          <h1 className="text-3xl font-bold text-text-primary">Reports & Activity</h1>
          <p className="mt-1 text-text-secondary">Export result files, answer-sheet PDFs, and review your exam activity trail.</p>
        </div>
        <Button as="a" href={exportHref(activityFilters)} variant="secondary">
          <Download size={18} /> Export Activity
        </Button>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ActivityMetric icon={Clock3} label="Today" value={activitySummary.today || 0} tone="info" />
        <ActivityMetric icon={AlertTriangle} label="Important" value={activitySummary.important || 0} tone={activitySummary.important ? "warning" : "success"} />
        <ActivityMetric icon={ShieldAlert} label="Security" value={activitySummary.security || 0} tone={activitySummary.security ? "warning" : "success"} />
        <ActivityMetric icon={Activity} label="Total" value={activitySummary.total || 0} tone="info" />
      </section>

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
              <Select label="Exam" value={selectedExamId} onChange={setSelectedExamId} options={examOptions} required />
              {selectedExam && (
                <div className="flex flex-wrap gap-2">
                  <Badge variant={selectedExam.status === "active" ? "success" : "secondary"}>{selectedExam.status}</Badge>
                  <Badge variant="info">{selectedExam.question_count || 0} questions</Badge>
                  <Badge variant="warning">{selectedExam.pending_review_count || 0} pending</Badge>
                </div>
              )}
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button as="a" href="/api/teacher/reports/results.csv" variant="secondary" className="flex-1">
                  <Download size={18} /> Export All CSV
                </Button>
                <Button as="a" href={selectedExamId ? `/api/teacher/reports/exams/${selectedExamId}/results.csv` : "#"} variant="primary" className="flex-1" disabled={!selectedExamId}>
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
              <Input label="Session ID" value={sessionId} onChange={event => setSessionId(event.target.value)} placeholder="e.g. 42" required />
              <Button as="a" href={sessionId ? `/api/teacher/reports/sessions/${sessionId}/answer.pdf` : "#"} variant="primary" className="w-full" disabled={!sessionId}>
                <Download size={18} /> Download PDF
              </Button>
              <p className="text-sm text-text-muted">Session IDs are visible from the exam review list.</p>
            </div>
          </Card>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.8fr)]">
        <Card className="p-5">
          <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-text-primary">Teacher Activity Center</h2>
              <p className="text-sm text-text-secondary">Review changes, exports, review actions, and security events connected to your exams.</p>
            </div>
            <Badge variant="purple" size="md">{Number(activitySummary.total || 0).toLocaleString()} matching</Badge>
          </div>
          <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(220px,1fr)_repeat(3,minmax(150px,180px))]">
            <Input value={activityFilters.q} onChange={event => updateActivityFilter("q", event.target.value)} placeholder="Search activity, target, IP" aria-label="Search teacher activity" />
            <Select value={activityFilters.category} onChange={value => updateActivityFilter("category", value)} options={categoryOptions} placeholder="Category" />
            <Select value={activityFilters.status} onChange={value => updateActivityFilter("status", value)} options={statusOptions} placeholder="Status" />
            <Select value={activityFilters.resource_type} onChange={value => updateActivityFilter("resource_type", value)} options={resourceOptions} placeholder="Target" />
          </div>
          <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <DateInput label="Activity from" value={activityFilters.from} onChange={event => updateActivityFilter("from", event.target.value)} />
            <DateInput label="Activity to" value={activityFilters.to} onChange={event => updateActivityFilter("to", event.target.value)} />
            <Button variant="ghost" onClick={() => setActivityFilters({ q: "", category: "all", status: "all", resource_type: "all", from: "", to: "" })}>
              <Search size={17} /> Reset
            </Button>
          </div>
          {activityRows.length > 0 ? (
            <Table columns={activityColumns} data={activityRows} rowsPerPageOptions={[10, 20, 50]} className="shadow-none" />
          ) : (
            <EmptyState icon={FileSpreadsheet} heading="No activity entries" description="Try adjusting the filters." compact />
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <ShieldAlert size={22} className="text-warning" />
              <h2 className="text-xl font-semibold text-text-primary">Important Events</h2>
            </div>
            <Badge variant="warning">{importantEvents.length}</Badge>
          </div>
          {importantEvents.length > 0 ? (
            <div className="space-y-3">
              {importantEvents.map(item => (
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
              <FileText size={34} className="mx-auto mb-3 text-success" />
              <p className="font-semibold text-text-primary">No important events</p>
              <p className="mt-1 text-sm text-text-muted">Your exam activity is calm right now.</p>
            </div>
          )}
        </Card>
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
