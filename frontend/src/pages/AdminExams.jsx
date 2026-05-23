import { useEffect, useMemo, useState } from "react";
import { Archive, BookOpenCheck, CheckCircle2, Eye, FileText, Search, XCircle } from "lucide-react";
import { Badge, Button, Card, ConfirmationDialog, EmptyState, Input, Select, StatCard, Table } from "../components/ui";
import { api } from "../services/api";
import { notify } from "../components/ui/Toast";

function parseClassicExams(html) {
  const doc = new window.DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll(".exam-card")).map((node, index) => {
    const viewHref = node.querySelector("a[href*='/admin/exams/']")?.getAttribute("href") || "";
    const id = viewHref.match(/admin\/exams\/(\d+)/)?.[1] || `exam-${index}`;
    const metaText = Array.from(node.querySelectorAll(".exam-meta p")).map(item => item.textContent.trim());
    const durationMatch = metaText.join(" ").match(/Duration:\s*(\d+)/i);
    const questionMatch = metaText.join(" ").match(/Questions:\s*(\d+)/i);
    const teacherMatch = metaText.join(" ").match(/Created by:\s*(.+)$/i);
    return {
      id,
      title: node.querySelector("h3")?.textContent.trim() || "Untitled exam",
      status: node.querySelector(".status-badge")?.textContent.trim().toLowerCase() || "draft",
      subject: metaText[0] || "-",
      duration: Number(durationMatch?.[1] || 0),
      questionCount: Number(questionMatch?.[1] || 0),
      teacher: teacherMatch?.[1] || "-",
      viewHref
    };
  });
}

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
  const [search, setSearch] = useState("");
  const [pendingAction, setPendingAction] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [{ data }, classicResponse] = await Promise.all([
          api.get("/admin/dashboard"),
          window.fetch("/admin/exams", { credentials: "same-origin" })
        ]);
        const html = await classicResponse.text();
        if (!cancelled) {
          setStats(data.stats || {});
          setExams(parseClassicExams(html));
        }
      } catch {
        notify.warning("Could not load the classic exams list.");
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
      const matchesSearch = !query || exam.title.toLowerCase().includes(query) || exam.teacher.toLowerCase().includes(query);
      return matchesStatus && matchesSearch;
    });
  }, [exams, search, statusFilter]);

  const derivedStats = {
    total: exams.length || stats.total_exams || 0,
    published: exams.filter(exam => exam.status === "active" || exam.status === "published").length || stats.active_exams || 0,
    closed: exams.filter(exam => exam.status === "closed").length,
    draft: exams.filter(exam => exam.status === "draft").length
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
      key: "title",
      header: "Exam",
      sortable: true,
      render: row => (
        <div>
          <strong className="block text-text-primary">{row.title}</strong>
          <span className="text-xs text-text-muted">{row.subject}</span>
        </div>
      )
    },
    { key: "teacher", header: "Teacher", sortable: true },
    { key: "status", header: "Status", sortable: true, render: row => <Badge variant={statusVariant(row.status)}>{row.status}</Badge> },
    { key: "questionCount", header: "Questions", sortable: true },
    { key: "duration", header: "Duration", sortable: true, render: row => `${row.duration} min` }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase text-text-muted">Admin workspace</p>
          <h1 className="text-3xl font-bold text-text-primary">Exams Overview</h1>
          <p className="mt-1 text-text-secondary">Cross-teacher exam visibility with safe admin actions routed through Flask.</p>
        </div>
        <Button as="a" href="/admin/exams" variant="secondary">
          <BookOpenCheck size={18} /> Classic Exams
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard icon={BookOpenCheck} label="Total Exams" value={derivedStats.total} />
        <StatCard icon={CheckCircle2} label="Published" value={derivedStats.published} />
        <StatCard icon={XCircle} label="Closed" value={derivedStats.closed} variant="danger" />
        <StatCard icon={FileText} label="Draft" value={derivedStats.draft} />
      </div>

      <Card className="p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px]">
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
              <Button as="a" href={row.viewHref || `/admin/exams/${row.id}`} variant="ghost" size="sm">
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
