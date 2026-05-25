import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, History } from "lucide-react";
import { Badge, Button, Card, EmptyState, Skeleton, Table } from "../components/ui";
import { api } from "../services/api";
import { formatDate } from "../utils/dateFormat";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

function resultStatus(result, passingPercentage = 40) {
  if (!result) return { label: "-", variant: "secondary" };
  return Number(result.percentage || 0) >= Number(passingPercentage || 40)
    ? { label: "Pass", variant: "success" }
    : { label: "Fail", variant: "danger" };
}

export default function StudentHistory() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);

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

  const rows = useMemo(() => (
    (dashboard?.exams || [])
      .filter(exam => exam.latest_session?.submitted_at || exam.result)
      .map(exam => ({
        id: exam.latest_session?.session_code || exam.exam_id,
        title: exam.exam_name,
        teacher: exam.teacher_name || exam.teacher || "-",
        dateTaken: exam.latest_session?.submitted_at || exam.result?.published_at || exam.end_time,
        duration: exam.effective_duration_minutes || exam.duration_minutes || 0,
        score: exam.result ? `${exam.result.total_marks_obtained}/${exam.result.total_marks}` : "-",
        percentage: exam.result?.percentage,
        passFail: resultStatus(exam.result, exam.passing_percentage),
        status: exam.latest_session?.status || exam.status,
        resultHref: exam.result?.href || exam.result?.pdf_href || null
      }))
  ), [dashboard]);

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
    { key: "dateTaken", header: "Date Taken", sortable: true, render: row => formatDate(row.dateTaken) },
    { key: "duration", header: "Duration", sortable: true, render: row => `${row.duration} min` },
    { key: "score", header: "Score", render: row => row.score },
    { key: "percentage", header: "Percentage", sortable: true, accessor: row => Number(row.percentage || 0), render: row => (row.percentage == null ? "-" : `${row.percentage}%`) },
    { key: "passFail", header: "Pass/Fail", render: row => <Badge variant={row.passFail.variant}>{row.passFail.label}</Badge> },
    { key: "status", header: "Status", render: row => <Badge variant={row.status === "evaluated" || row.status === "submitted" ? "success" : "secondary"}>{row.status}</Badge> },
    {
      key: "actions",
      header: "Results",
      render: row => row.resultHref ? (
        <Button as="a" href={row.resultHref} variant="ghost" size="sm">
          <Eye size={16} /> View
        </Button>
      ) : (
        <span className="text-xs text-text-muted">Not published</span>
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
