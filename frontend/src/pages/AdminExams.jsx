import { useEffect, useMemo, useState } from "react";
import { Archive, BookOpenCheck, CheckCircle2, Eye, FileText, Search, XCircle } from "lucide-react";
import { Badge, Button, Card, ConfirmationDialog, EmptyState, Input, Select, StatCard, Table } from "../components/ui";
import { api } from "../services/api";
import { notify } from "../components/ui/Toast";

function statusVariant(status) {
  if (status === "active" || status === "published") return "success";
  if (status === "closed" || status === "archived") return "danger";
  if (status === "draft") return "warning";
  return "secondary";
}

export default function AdminExams() {
  const [stats, setStats] = useState({});
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [teacherFilter, setTeacherFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");
  const [teachers, setTeachers] = useState([]);
  const [pendingAction, setPendingAction] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data } = await api.get("/admin/exams", { params: { per_page: 100 } });
        if (!cancelled) {
          setStats(data.stats || {});
          setExams(data.exams || []);
          setTeachers(data.teachers || []);
        }
      } catch (error) {
        notify.error(error.message || "Could not load exams.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

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
    const endpoint = pendingAction.type === "activate"
      ? `/admin/exams/${pendingAction.exam.id}/activate`
      : `/admin/exams/${pendingAction.exam.id}/close`;
    try {
      const response = await window.fetch(endpoint, { method: "POST", credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.message || "Action failed");
      notify.success(data.message || "Exam updated");
      setExams(current => current.map(exam => (
        exam.id === pendingAction.exam.id
          ? { ...exam, status: pendingAction.type === "activate" ? "active" : "closed" }
          : exam
      )));
      setPendingAction(null);
    } catch (error) {
      notify.error(error.message || "Could not update exam");
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
    { key: "created_at", header: "Created", sortable: true, render: row => row.created_at ? new Date(row.created_at).toLocaleDateString() : "-" }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase text-text-muted">Admin workspace</p>
          <h1 className="text-3xl font-bold text-text-primary">Exams Overview</h1>
          <p className="mt-1 text-text-secondary">Cross-teacher exam visibility with safe admin actions routed through Flask.</p>
        </div>
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
          <Input label="From" type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} />
          <Input label="To" type="date" value={toDate} onChange={event => setToDate(event.target.value)} />
        </div>
      </Card>

      {loading ? (
        <Card className="p-8 text-center text-text-muted">Loading exams...</Card>
      ) : filteredExams.length > 0 ? (
        <Table
          columns={columns}
          data={filteredExams}
          rowsPerPageOptions={[10, 20, 50]}
          renderRowActions={row => (
            <>
              <Button as="a" href={row.links?.classic || `/admin/exams/${row.id}`} variant="ghost" size="sm">
                <Eye size={16} /> View
              </Button>
              {row.status === "draft" && (
                <Button variant="success" size="sm" onClick={() => setPendingAction({ type: "activate", exam: row })}>
                  <CheckCircle2 size={16} /> Publish
                </Button>
              )}
              {row.status === "active" && (
                <Button variant="danger" size="sm" onClick={() => setPendingAction({ type: "close", exam: row })}>
                  <Archive size={16} /> Archive
                </Button>
              )}
              <Button as="a" href={`/admin/exams/${row.id}/report.pdf`} variant="secondary" size="sm">
                <FileText size={16} /> PDF
              </Button>
            </>
          )}
        />
      ) : (
        <EmptyState icon={Search} heading="No exams found" description="Try another search or status filter." />
      )}

      <ConfirmationDialog
        open={!!pendingAction}
        title={pendingAction?.type === "activate" ? "Publish Exam?" : "Archive Exam?"}
        description={pendingAction?.type === "activate"
          ? "Students will be able to join this draft exam if the normal access rules allow it."
          : "Students will no longer be able to join this exam."}
        confirmLabel={pendingAction?.type === "activate" ? "Publish" : "Archive"}
        confirmWord={pendingAction?.type === "activate" ? undefined : "DELETE"}
        variant={pendingAction?.type === "activate" ? "success" : "danger"}
        onConfirm={runAction}
        onClose={() => setPendingAction(null)}
      />
    </div>
  );
}
