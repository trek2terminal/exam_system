import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Download, FileBarChart, FileText, Search, ShieldAlert } from "lucide-react";
import { Badge, Button, Card, DateInput, EmptyState, Input, PageLoading, RefreshStatus, Select, Table } from "../components/ui";
import { cachedGet } from "../services/api";
import { notify } from "../components/ui/Toast";
import { formatDate, timeAgo } from "../utils/dateFormat";
import { useLiveRefresh } from "../hooks/useLiveRefresh";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

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
  const [livePaused, setLivePaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState(null);
  const hasLoadedRef = useRef(false);

  const debouncedAuditFilters = useDebouncedValue(auditFilters, 500);
  const auditParams = useMemo(() => buildAuditParams(debouncedAuditFilters), [debouncedAuditFilters]);

  const loadReports = useCallback(async (soft = false, options = {}) => {
    if (!soft) setLoading(true);
    try {
      const [{ data }, examsResponse, auditResponse] = await Promise.all([
        cachedGet("/admin/dashboard", { cacheTtl: options.force ? 0 : 5000 }),
        cachedGet("/admin/exams", { params: { per_page: 100 }, cacheTtl: options.force ? 0 : 8000 }),
        cachedGet("/admin/audit-log", { params: auditParams, cacheTtl: options.force ? 0 : 5000 })
      ]);
      const examSelectOptions = (examsResponse.data.exams || []).map(exam => ({ value: String(exam.id), label: exam.exam_name }));
      setDashboard(data);
      setExamOptions(examSelectOptions);
      setSelectedExamId(current => current || examSelectOptions[0]?.value || "");
      setAuditRows(auditResponse.data.items || []);
      setAuditSummary(auditResponse.data.summary || {});
      setAuditImportant(auditResponse.data.important_events || []);
      setAuditFilterOptions(auditResponse.data.filters || {});
      setLoadedAt(Date.now());
    } catch {
      notify.warning("Some report selectors could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [auditParams]);

  useEffect(() => {
    loadReports(hasLoadedRef.current).finally(() => {
      hasLoadedRef.current = true;
    });
  }, [loadReports]);
  const liveRefresh = useLiveRefresh(loadReports, { enabled: !livePaused, intervalMs: 25000 });

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
    <div className="adminReportsPage">
      <div className="reportsHero">
        <div className="reportsHeroCopy">
          <span className="reportsEyebrow">Admin workspace</span>
          <h1>Reports & Activity</h1>
          <p>Audit trail, important events, violation exports, and exam report PDFs.</p>
        </div>
        <div className="reportsHeroActions">
          <RefreshStatus
            refreshing={liveRefresh.refreshing}
            lastUpdated={loadedAt || liveRefresh.lastUpdated}
            isStale={liveRefresh.isStale}
            livePaused={livePaused}
            onToggleLive={() => setLivePaused(current => !current)}
            onRefresh={() => loadReports(true, { force: true })}
          />
          <Button className="reportsHeroButton" as="a" href={auditExportHref("/api/admin/audit-log/export.csv", auditFilters)} variant="secondary">
            <Download size={18} /> Export Filtered Audit
          </Button>
        </div>
      </div>

      {loading && <PageLoading title="Loading admin reports..." variant="reports" />}

      {!loading && <section className="reportsMetricGrid">
        <ActivityMetric icon={Clock3} label="Today" value={auditSummary.today || 0} tone="info" />
        <ActivityMetric icon={AlertTriangle} label="Important" value={auditSummary.important || 0} tone={auditSummary.important ? "warning" : "success"} />
        <ActivityMetric icon={ShieldAlert} label="Security" value={auditSummary.security || 0} tone={auditSummary.security ? "warning" : "success"} />
        <ActivityMetric icon={Download} label="Exports" value={auditSummary.exports || 0} tone="info" />
      </section>}

      {!loading && <div className="reportsExportGrid">
        <Card className="reportActionCard reportActionCard--danger">
          <div className="reportActionHeader">
            <span className="reportActionIcon">
              <AlertTriangle size={22} />
            </span>
            <div>
              <h2>Violation Log Export</h2>
              <p>Download the current violation CSV for the selected date range.</p>
            </div>
          </div>
          <div className="reportDateGrid">
            <DateInput label="From" value={fromDate} onChange={event => setFromDate(event.target.value)} />
            <DateInput label="To" value={toDate} onChange={event => setToDate(event.target.value)} />
          </div>
          <Button as="a" href={violationExportHref} variant="secondary" className="reportWideButton">
            <Download size={18} /> Export Violation CSV
          </Button>
        </Card>

        <Card className="reportActionCard reportActionCard--brand">
          <div className="reportActionHeader">
            <span className="reportActionIcon">
              <FileText size={22} />
            </span>
            <div>
              <h2>Complete Exam Report PDF</h2>
              <p>Download the admin PDF report for an exam.</p>
            </div>
          </div>
          {examOptions.length > 0 ? (
            <div className="reportActionBody">
              <Select label="Exam" value={selectedExamId} onChange={setSelectedExamId} options={examOptions} required />
              <Button as="a" href={`/api/admin/exams/${selectedExamId}/report.pdf`} variant="primary" className="reportWideButton">
                <Download size={18} /> Download PDF
              </Button>
            </div>
          ) : (
            <EmptyState icon={FileText} heading="No exam selector data" description="No exams are available for report exports yet." compact />
          )}
        </Card>
      </div>}

      {!loading && <div className="reportsMainGrid">
        <Card className="reportsAuditCard">
          <div className="reportsPanelHeader">
            <div>
              <span className="reportsEyebrow">Activity center</span>
              <h2>Audit Activity Center</h2>
              <p>Search, filter, review, and export platform activity.</p>
            </div>
            <Badge className="reportsCountBadge" variant="purple" size="md">{Number(auditSummary.total || 0).toLocaleString()} matching</Badge>
          </div>
          <div className="reportsFilterGrid">
            <Input value={auditFilters.q} onChange={event => updateAuditFilter("q", event.target.value)} placeholder="Search activity, actor, target, IP" aria-label="Search audit activity" />
            <Select value={auditFilters.category} onChange={value => updateAuditFilter("category", value)} options={categoryOptions} placeholder="Category" ariaLabel="Audit category" />
            <Select value={auditFilters.status} onChange={value => updateAuditFilter("status", value)} options={statusOptions} placeholder="Status" ariaLabel="Audit status" />
            <Select value={auditFilters.resource_type} onChange={value => updateAuditFilter("resource_type", value)} options={resourceOptions} placeholder="Target" ariaLabel="Audit target" />
          </div>
          <div className="reportsDateFilterGrid">
            <DateInput label="Activity from" value={auditFilters.from} onChange={event => updateAuditFilter("from", event.target.value)} />
            <DateInput label="Activity to" value={auditFilters.to} onChange={event => updateAuditFilter("to", event.target.value)} />
            <Button className="reportsResetButton" variant="ghost" onClick={() => setAuditFilters({ q: "", category: "all", status: "all", resource_type: "all", from: "", to: "" })}>
              <Search size={17} /> Reset
            </Button>
          </div>
          {auditRows.length > 0 ? (
            <Table columns={auditColumns} data={auditRows} rowsPerPageOptions={[10, 20, 50]} className="reportsTable" />
          ) : (
            <EmptyState icon={FileBarChart} heading="No audit entries" description="Try adjusting the filters." compact />
          )}
        </Card>

        <div className="reportsSideStack">
          <Card className="reportsSideCard reportsEventsCard">
            <div className="reportsSideHeader">
              <div className="reportsSideTitle">
                <span className="reportsSideIcon reportsSideIcon--warning"><ShieldAlert size={20} /></span>
                <div>
                  <span className="reportsEyebrow">Needs review</span>
                  <h2>Important Events</h2>
                </div>
              </div>
              <Badge variant="warning">{auditImportant.length}</Badge>
            </div>
            {auditImportant.length > 0 ? (
              <div className="reportEventList">
                {auditImportant.map(item => (
                  <div key={item.id} className={`reportEventItem reportEventItem--${auditBadge(item.severity)}`}>
                    <div className="reportEventTopline">
                      <Badge variant={auditBadge(item.severity)}>{humanize(item.category)}</Badge>
                      <span>{timeAgo(item.timestamp)}</span>
                    </div>
                    <p className="reportEventMessage">{item.formatted_message}</p>
                    <p className="reportEventMeta">{item.actor_name} {item.ip_address ? `| ${item.ip_address}` : ""}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="reportsClearState">
                <CheckCircle2 size={34} />
                <p>No important events</p>
              </div>
            )}
          </Card>

          <Card className="reportsSideCard">
            <div className="reportsSideHeader">
              <div className="reportsSideTitle">
                <span className="reportsSideIcon reportsSideIcon--warning"><ShieldAlert size={20} /></span>
                <div>
                  <span className="reportsEyebrow">Cross-exam signals</span>
                  <h2>Suspicious Activity</h2>
                </div>
              </div>
            </div>
            {suspicious.length > 0 ? (
              <div className="reportEventList">
                {suspicious.map(student => (
                  <div key={student.id || student.name} className="reportEventItem reportEventItem--warning">
                    <strong>{student.name}</strong>
                    <div className="reportStudentBadges">
                      <Badge variant="warning">{student.exam_count || 0} exams</Badge>
                      <Badge variant="danger">{student.total_violations || student.violation_count || 0} violations</Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="reportsClearState">
                <CheckCircle2 size={34} />
                <p>All clear</p>
                <span>No cross-exam suspicious activity found.</span>
              </div>
            )}
            <Button as="a" href="/react/admin/users" variant="secondary" className="reportWideButton">
              Review Users
            </Button>
          </Card>
        </div>
      </div>}
    </div>
  );
}

function ActivityMetric({ icon: Icon, label, value, tone }) {
  return (
    <Card className={`reportMetricCard reportMetricCard--${tone}`}>
      <span className="reportMetricIcon"><Icon size={18} /></span>
      <div>
        <p>{label}</p>
        <strong>{Number(value || 0).toLocaleString()}</strong>
      </div>
    </Card>
  );
}
