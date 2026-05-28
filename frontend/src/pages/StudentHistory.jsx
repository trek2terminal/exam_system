import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, Download, Eye, FileText, History, ShieldAlert, Trophy } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, Skeleton, Table } from "../components/ui";
import { api } from "../services/api";
import { formatDate } from "../utils/dateFormat";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

function resultStatus(result, passingPercentage = 40) {
  if (!result) return { label: "-", variant: "secondary" };
  return Number(result.percentage || 0) >= Number(passingPercentage || 40)
    ? { label: "Pass", variant: "success" }
    : { label: "Fail", variant: "danger" };
}

function statusVariant(status) {
  if (status === "evaluated" || status === "submitted" || status === "auto_submitted") return "success";
  if (status === "active" || status === "paused") return "info";
  if (status === "terminated") return "danger";
  return "secondary";
}

function formatDuration(seconds) {
  const safeSeconds = Math.max(Math.floor(Number(seconds) || 0), 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
  return `${remainder}s`;
}

export default function StudentHistory() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  const loadHistory = useCallback(async (soft = false) => {
    if (!soft) setLoading(true);
    try {
      const { data } = await api.get("/student/dashboard");
      setDashboard(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);
  useLiveRefresh(loadHistory, { intervalMs: 25000 });

  const attempts = useMemo(() => dashboard?.attempt_history || [], [dashboard?.attempt_history]);
  const stats = useMemo(() => ({
    total: attempts.length,
    completed: attempts.filter(item => ["submitted", "auto_submitted", "evaluated"].includes(item.status)).length,
    active: attempts.filter(item => ["active", "paused"].includes(item.status)).length,
    results: attempts.filter(item => item.result).length,
    warnings: attempts.reduce((sum, item) => sum + Number(item.focus_violations || 0), 0),
  }), [attempts]);
  const rows = useMemo(() => (
    attempts
      .filter(item => {
        const search = searchTerm.trim().toLowerCase();
        const matchesSearch = !search
          || `${item.exam_name || ""} ${item.subject || ""} ${item.set_code || ""} ${item.teacher_name || ""}`.toLowerCase().includes(search);
        if (!matchesSearch) return false;
        if (statusFilter === "all") return true;
        if (statusFilter === "results") return Boolean(item.result);
        if (statusFilter === "pending") return ["submitted", "auto_submitted", "terminated"].includes(item.status) && !item.result;
        if (statusFilter === "active") return ["active", "paused"].includes(item.status);
        return item.status === statusFilter;
      })
      .map(item => ({
        id: item.session_code || item.id,
        title: item.exam_name,
        teacher: item.teacher_name || "-",
        dateTaken: item.submitted_at || item.started_at || item.created_at,
        duration: item.progress?.time_spent_seconds || 0,
        progress: item.progress || {},
        score: item.result ? `${item.result.total_marks_obtained}/${item.result.total_marks}` : "-",
        percentage: item.result?.percentage,
        passFail: resultStatus(item.result),
        status: item.status,
        warnings: item.focus_violations || 0,
        submittedHref: item.links?.submitted,
        resultHref: item.links?.result,
        pdfHref: item.links?.pdf,
      }))
  ), [attempts, searchTerm, statusFilter]);

  const columns = [
    {
      key: "title",
      header: "Exam",
      sortable: true,
      render: row => (
        <div>
          <strong className="block text-text-primary">{row.title}</strong>
          <span className="text-xs text-text-muted">{row.teacher}</span>
        </div>
      )
    },
    { key: "dateTaken", header: "Date", sortable: true, render: row => formatDate(row.dateTaken) },
    {
      key: "progress",
      header: "Progress",
      render: row => (
        <div className="min-w-36">
          <div className="mb-1 flex justify-between text-xs text-text-muted">
            <span>{row.progress.answered_count || 0}/{row.progress.total_questions || 0}</span>
            <span>{row.progress.progress_percent || 0}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-background-elevated">
            <div className="h-full rounded-full bg-brand-primary" style={{ width: `${Math.max(0, Math.min(Number(row.progress.progress_percent || 0), 100))}%` }} />
          </div>
        </div>
      )
    },
    { key: "duration", header: "Work Time", sortable: true, accessor: row => Number(row.duration || 0), render: row => formatDuration(row.duration) },
    { key: "score", header: "Score", render: row => row.score },
    { key: "percentage", header: "Percentage", sortable: true, accessor: row => Number(row.percentage || 0), render: row => (row.percentage == null ? "-" : `${row.percentage}%`) },
    { key: "passFail", header: "Pass/Fail", render: row => <Badge variant={row.passFail.variant}>{row.passFail.label}</Badge> },
    { key: "status", header: "Status", render: row => <Badge variant={statusVariant(row.status)}>{row.status}</Badge> },
    { key: "warnings", header: "Warnings", sortable: true, render: row => <Badge variant={row.warnings > 0 ? "warning" : "success"}>{row.warnings}</Badge> },
    {
      key: "actions",
      header: "Results",
      render: row => (
        <div className="flex flex-wrap gap-1.5">
          {row.resultHref ? (
            <Button as="a" href={row.resultHref} variant="ghost" size="sm">
              <Eye size={16} /> View
            </Button>
          ) : row.submittedHref ? (
            <Button as="a" href={row.submittedHref} variant="ghost" size="sm">
              <FileText size={16} /> Submission
            </Button>
          ) : (
            <span className="text-xs text-text-muted">Unavailable</span>
          )}
          {row.pdfHref && (
            <Button as="a" href={row.pdfHref} variant="ghost" size="sm">
              <Download size={16} /> PDF
            </Button>
          )}
        </div>
      )
    }
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold text-text-muted">STUDENT WORKSPACE</p>
          <h1 className="text-3xl font-bold text-text-primary">Exam History</h1>
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-text-muted">STUDENT WORKSPACE</p>
        <h1 className="text-3xl font-bold text-text-primary">Exam History</h1>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <HistoryStat icon={History} label="Attempts" value={stats.total} />
        <HistoryStat icon={Clock3} label="Active" value={stats.active} />
        <HistoryStat icon={FileText} label="Completed" value={stats.completed} />
        <HistoryStat icon={Trophy} label="Results" value={stats.results} />
        <HistoryStat icon={ShieldAlert} label="Warnings" value={stats.warnings} />
      </section>

      <Card className="grid gap-3 p-3 lg:grid-cols-[minmax(220px,1fr)_auto] lg:items-center">
        <Input
          value={searchTerm}
          onChange={event => setSearchTerm(event.target.value)}
          placeholder="Search history"
          aria-label="Search history"
        />
        <div className="flex flex-wrap gap-2">
          {[
            ["all", "All"],
            ["active", "Active"],
            ["pending", "Pending results"],
            ["results", "Published results"],
            ["terminated", "Terminated"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={[
                "min-h-10 rounded-md border px-3 text-sm font-semibold transition",
                statusFilter === value
                  ? "border-brand-primary bg-brand-primary text-white"
                  : "border-border bg-background-card text-text-secondary hover:bg-background-elevated"
              ].join(" ")}
              onClick={() => setStatusFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>

      {rows.length > 0 ? (
        <Table columns={columns} data={rows} rowsPerPageOptions={[10, 20, 50]} emptyMessage="No exams taken yet" />
      ) : (
        <Card className="p-4">
          <EmptyState
            icon={History}
            heading="No exams taken yet"
            description="Completed exams and published scores will appear here after your first submission."
            compact
            className="border-0"
          />
        </Card>
      )}
    </div>
  );
}

function HistoryStat({ icon: Icon, label, value }) {
  return (
    <Card className="p-4">
      <Icon size={18} className="mb-3 text-brand-primary" />
      <p className="text-xs font-semibold uppercase text-text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold text-text-primary">{Number(value || 0).toLocaleString()}</p>
    </Card>
  );
}
