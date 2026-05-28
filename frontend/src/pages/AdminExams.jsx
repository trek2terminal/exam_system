import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpenCheck, CheckCircle2, Eye, FileText, PencilLine, Search, Trash2, XCircle } from "lucide-react";
import { Badge, Button, Card, ConfirmationDialog, DateInput, EmptyState, Input, RefreshStatus, Select, SkeletonCard, StatCard, Table } from "../components/ui";
import { api, cachedGet } from "../services/api";
import { notify } from "../components/ui/Toast";
import { formatDateShort } from "../utils/dateFormat";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

function statusVariant(status) {
  if (status === "active" || status === "published") return "success";
  if (status === "closed" || status === "archived") return "danger";
  if (status === "draft") return "warning";
  return "secondary";
}

function statsFromExams(exams) {
  return {
    total: exams.length,
    published: exams.filter(exam => exam.status === "active" || exam.status === "published").length,
    closed: exams.filter(exam => exam.status === "closed").length,
    draft: exams.filter(exam => exam.status === "draft").length,
    archived: exams.filter(exam => exam.status === "archived").length
  };
}

export default function AdminExams() {
  const [stats, setStats] = useState({});
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [livePaused, setLivePaused] = useState(false);
  const [loadedAt, setLoadedAt] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [teacherFilter, setTeacherFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");
  const [teachers, setTeachers] = useState([]);
  const [pendingAction, setPendingAction] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [deleteAdminPassword, setDeleteAdminPassword] = useState("");

  const loadExams = useCallback(async (soft = false, options = {}) => {
    if (!soft) setLoading(true);
    try {
      const { data } = await cachedGet("/admin/exams", { params: { per_page: 100 }, cacheTtl: options.force ? 0 : soft ? 8000 : 1000 });
      setStats(data.stats || {});
      setExams(data.exams || []);
      setTeachers(data.teachers || []);
      setLoadedAt(Date.now());
    } catch (error) {
      notify.error(error.message || "Could not load exams.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadExams();
  }, [loadExams]);
  const liveRefresh = useLiveRefresh(loadExams, { enabled: !livePaused, intervalMs: 25000 });

  const filteredExams = useMemo(() => {
    const query = search.trim().toLowerCase();
    return exams.filter(exam => {
      const matchesStatus = statusFilter === "all" || exam.status === statusFilter;
      const matchesTeacher = teacherFilter === "all" || String(exam.teacher_id) === teacherFilter;
      const createdAt = exam.created_at ? new Date(exam.created_at) : null;
      const matchesFrom = !fromDate || (createdAt && createdAt >= new Date(`${fromDate}T00:00:00`));
      const matchesTo = !toDate || (createdAt && createdAt <= new Date(`${toDate}T23:59:59`));
      const haystack = [exam.exam_name, exam.subject, exam.teacher_name].join(" ").toLowerCase();
      const matchesSearch = !query || haystack.includes(query);
      return matchesStatus && matchesTeacher && matchesFrom && matchesTo && matchesSearch;
    });
  }, [exams, fromDate, search, statusFilter, teacherFilter, toDate]);

  const derivedStats = {
    total: stats.total ?? exams.length,
    published: stats.published ?? exams.filter(exam => exam.status === "active" || exam.status === "published").length,
    closed: stats.closed ?? exams.filter(exam => exam.status === "closed").length,
    draft: stats.draft ?? exams.filter(exam => exam.status === "draft").length
  };

  const runAction = async () => {
    if (!pendingAction) return;
    if (pendingAction.type === "delete" && !deleteAdminPassword.trim()) return;
    setActionLoading(true);
    try {
      if (pendingAction.type === "delete") {
        const { data } = await api.delete(`/admin/exams/${pendingAction.exam.id}`, {
          data: { confirm_word: "DELETE", admin_password: deleteAdminPassword }
        });
        notify.success(data.message || "Exam deleted");
        setExams(current => {
          const next = current.filter(exam => exam.id !== pendingAction.exam.id);
          setStats(statsFromExams(next));
          return next;
        });
      } else {
        const { data } = await api.post(`/admin/exams/${pendingAction.exam.id}/status`, {
          action: pendingAction.type
        });
        notify.success(data.message || "Exam updated");
        setExams(current => {
          const next = current.map(exam => (
            exam.id === pendingAction.exam.id
              ? (data.exam || { ...exam, status: pendingAction.type === "activate" ? "active" : pendingAction.type === "deactivate" ? "draft" : "closed" })
              : exam
          ));
          setStats(statsFromExams(next));
          return next;
        });
      }
      setPendingAction(null);
      setDeleteAdminPassword("");
    } catch (error) {
      notify.error(error.message || "Could not update exam");
    } finally {
      setActionLoading(false);
    }
  };

  const columns = [
    {
      key: "exam_name",
      header: "Exam",
      sortable: true,
      render: row => (
        <div>
          <strong className="block text-text-primary">{row.exam_name}</strong>
          <span className="text-xs text-text-muted">{row.subject || row.set_code || "-"}</span>
        </div>
      )
    },
    { key: "teacher_name", header: "Teacher", sortable: true, render: row => row.teacher_name || "-" },
    { key: "status", header: "Status", sortable: true, render: row => <Badge variant={statusVariant(row.status)}>{row.status}</Badge> },
    { key: "question_count", header: "Questions", sortable: true },
    { key: "enrolled_count", header: "Enrolled", sortable: true },
    { key: "submitted_count", header: "Submitted", sortable: true },
    { key: "created_at", header: "Created", sortable: true, render: row => formatDateShort(row.created_at) }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase text-text-muted">Admin workspace</p>
          <h1 className="text-3xl font-bold text-text-primary">Exams Overview</h1>
          <p className="mt-1 text-text-secondary">View and manage all exams created across the platform.</p>
        </div>
        <RefreshStatus
          refreshing={liveRefresh.refreshing}
          lastUpdated={loadedAt || liveRefresh.lastUpdated}
          isStale={liveRefresh.isStale}
          livePaused={livePaused}
          onToggleLive={() => setLivePaused(current => !current)}
          onRefresh={() => loadExams(true, { force: true })}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard icon={BookOpenCheck} label="Total Exams" value={derivedStats.total} />
        <StatCard icon={CheckCircle2} label="Published" value={derivedStats.published} />
        <StatCard icon={XCircle} label="Closed" value={derivedStats.closed} variant="danger" />
        <StatCard icon={FileText} label="Draft" value={derivedStats.draft} />
      </div>

      <Card className="p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px_150px_150px]">
          <Input label="Search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search exams or teachers" />
          <Select
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "All Statuses" },
              { value: "draft", label: "Draft" },
              { value: "active", label: "Active" },
              { value: "closed", label: "Closed" }
            ]}
          />
          <Select
            label="Teacher"
            value={teacherFilter}
            onChange={setTeacherFilter}
            options={[
              { value: "all", label: "All Teachers" },
              ...teachers.map(teacher => ({ value: String(teacher.id), label: teacher.name || teacher.username }))
            ]}
          />
          <DateInput label="From" value={fromDate} onChange={event => setFromDate(event.target.value)} />
          <DateInput label="To" value={toDate} onChange={event => setToDate(event.target.value)} />
        </div>
      </Card>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map(item => <SkeletonCard key={item} />)}
        </div>
      ) : filteredExams.length > 0 ? (
        <>
          <div className="grid gap-4 md:hidden">
            {filteredExams.map((exam, index) => (
              <ExamMobileCard
                key={exam.id}
                exam={exam}
                index={index}
                onAction={setPendingAction}
              />
            ))}
          </div>
          <div className="hidden md:block">
            <Table
              columns={columns}
              data={filteredExams}
              rowsPerPageOptions={[10, 20, 50]}
              renderRowActions={row => (
                <>
                  <Button as="a" href={`/react/admin/reports?exam=${row.id}`} variant="ghost" size="sm">
                    <Eye size={16} /> View
                  </Button>
                  {row.status === "draft" && (
                    <Button variant="success" size="sm" onClick={() => setPendingAction({ type: "activate", exam: row })}>
                      <CheckCircle2 size={16} /> Publish
                    </Button>
                  )}
                  {row.status === "active" && (
                    <Button variant="warning" size="sm" onClick={() => setPendingAction({ type: "deactivate", exam: row })}>
                      <PencilLine size={16} /> Deactivate
                    </Button>
                  )}
                  {row.status === "active" && (
                    <Button variant="danger" size="sm" onClick={() => setPendingAction({ type: "close", exam: row })}>
                      <XCircle size={16} /> End
                    </Button>
                  )}
                  <Button as="a" href={`/api/admin/exams/${row.id}/report.pdf`} variant="secondary" size="sm">
                    <FileText size={16} /> PDF
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => setPendingAction({ type: "delete", exam: row })}>
                    <Trash2 size={16} /> Delete
                  </Button>
                </>
              )}
            />
          </div>
        </>
      ) : (
        <EmptyState icon={Search} heading="No exams found" description="Try another search or status filter." />
      )}

      <ConfirmationDialog
        open={!!pendingAction}
        title={pendingAction?.type === "activate" ? "Publish Exam?" : pendingAction?.type === "delete" ? "Delete Exam?" : pendingAction?.type === "deactivate" ? "Deactivate Exam?" : "End Exam?"}
        description={confirmationDescription(pendingAction, deleteAdminPassword, setDeleteAdminPassword)}
        confirmLabel={pendingAction?.type === "activate" ? "Publish" : pendingAction?.type === "delete" ? "Delete Exam" : pendingAction?.type === "deactivate" ? "Deactivate" : "End Exam"}
        confirmWord={pendingAction?.type === "delete" ? "DELETE" : undefined}
        variant={pendingAction?.type === "activate" ? "success" : pendingAction?.type === "deactivate" ? "warning" : "danger"}
        onConfirm={runAction}
        loading={actionLoading}
        onClose={() => {
          setPendingAction(null);
          setDeleteAdminPassword("");
        }}
      />
    </div>
  );
}

function confirmationDescription(pendingAction, deleteAdminPassword, setDeleteAdminPassword) {
  if (!pendingAction) return "";
  if (pendingAction.type === "activate") {
    return "Students will be able to join this draft exam if the normal access rules allow it.";
  }
  if (pendingAction.type === "delete") {
    return (
      <div className="space-y-2">
        <p>This permanently deletes the exam, its questions, enrollments, sessions, answers, results, and violation logs.</p>
        <p className="font-semibold text-danger">This cannot be undone.</p>
        <Input
          label="Admin Password"
          type="password"
          value={deleteAdminPassword}
          onChange={event => setDeleteAdminPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
    );
  }
  if (pendingAction.type === "deactivate") {
    return "Students will see that this exam is temporarily inactive. The exam returns to Draft so it can be edited, then published again.";
  }
  if (pendingAction.type === "close") {
    return "Students will no longer be able to join or submit. Use Deactivate instead if you need to edit and publish again.";
  }
  return "Students will no longer be able to join this exam.";
}

function ExamMobileCard({ exam, index, onAction }) {
  return (
    <Card
      className="animate-fade-in-up p-4"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-text-primary">{exam.exam_name}</h2>
          <p className="text-sm text-text-secondary">{exam.subject || exam.set_code || "No subject"}</p>
          <p className="mt-1 text-xs text-text-muted">{exam.teacher_name || "Unknown teacher"}</p>
        </div>
        <Badge variant={statusVariant(exam.status)}>{exam.status}</Badge>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-background-base p-3">
          <p className="text-xs text-text-muted">Questions</p>
          <p className="font-semibold text-text-primary">{exam.question_count || 0}</p>
        </div>
        <div className="rounded-lg bg-background-base p-3">
          <p className="text-xs text-text-muted">Enrolled</p>
          <p className="font-semibold text-text-primary">{exam.enrolled_count || 0}</p>
        </div>
        <div className="rounded-lg bg-background-base p-3">
          <p className="text-xs text-text-muted">Submitted</p>
          <p className="font-semibold text-text-primary">{exam.submitted_count || 0}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        <Button as="a" href={`/react/admin/reports?exam=${exam.id}`} variant="secondary" className="w-full">
          <Eye size={16} /> View Results
        </Button>
        {exam.status === "draft" && (
          <Button variant="success" className="w-full" onClick={() => onAction({ type: "activate", exam })}>
            <CheckCircle2 size={16} /> Publish
          </Button>
        )}
        {exam.status === "active" && (
          <Button variant="warning" className="w-full" onClick={() => onAction({ type: "deactivate", exam })}>
            <PencilLine size={16} /> Deactivate
          </Button>
        )}
        {exam.status === "active" && (
          <Button variant="danger" className="w-full" onClick={() => onAction({ type: "close", exam })}>
            <XCircle size={16} /> End Exam
          </Button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button as="a" href={`/api/admin/exams/${exam.id}/report.pdf`} variant="ghost" className="w-full">
            <FileText size={16} /> PDF
          </Button>
          <Button variant="danger" className="w-full" onClick={() => onAction({ type: "delete", exam })}>
            <Trash2 size={16} /> Delete
          </Button>
        </div>
      </div>
    </Card>
  );
}
