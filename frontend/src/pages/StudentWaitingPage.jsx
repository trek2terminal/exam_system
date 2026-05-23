import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Clock3, RefreshCw } from "lucide-react";
import { Badge, Button, Card, ProgressBar, Skeleton } from "../components/ui";
import { api } from "../services/api";
import { notify } from "../components/ui/Toast";

function toRouterPath(target) {
  return String(target || "/react/student").replace(/^\/react/, "") || "/student";
}

function formatWait(seconds) {
  const safe = Math.max(Number(seconds || 0), 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default function StudentWaitingPage() {
  const { sessionCode } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    try {
      const { data } = await api.get(`/student/session/${sessionCode}/status`);
      if (data.redirect) {
        navigate(toRouterPath(data.redirect), { replace: true });
        return;
      }
      if (data.ready_redirect) {
        navigate(toRouterPath(data.ready_redirect), { replace: true });
        return;
      }
      if (data.exam_redirect) {
        navigate(toRouterPath(data.exam_redirect), { replace: true });
        return;
      }
      setStatus(data);
    } catch (error) {
      notify.error(error.message || "Could not load exam status");
      navigate("/student", { replace: true });
    } finally {
      setLoading(false);
    }
  }, [navigate, sessionCode]);

  useEffect(() => {
    loadStatus();
    const interval = window.setInterval(loadStatus, 10000);
    return () => window.clearInterval(interval);
  }, [loadStatus]);

  if (loading) {
    return (
      <Card className="mx-auto max-w-2xl p-6">
        <Skeleton className="mb-4 h-7 w-2/3" />
        <Skeleton className="mb-3 h-4 w-full" />
        <Skeleton className="h-20 w-full" />
      </Card>
    );
  }

  const exam = status?.exam || {};
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase text-text-muted">Waiting room</p>
        <h1 className="text-3xl font-bold text-text-primary">{exam.exam_name || "Exam waiting room"}</h1>
        <p className="mt-1 text-text-secondary">This page refreshes automatically when the exam opens.</p>
      </div>
      <Card className="p-6">
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 place-items-center rounded-lg bg-warning/10 text-warning">
            <Clock3 size={26} />
          </span>
          <div>
            <Badge variant="warning">{status?.time_state === "not_started" ? "Not started" : status?.exam_status || "Waiting"}</Badge>
            <p className="mt-2 text-lg font-semibold text-text-primary">{exam.subject || "Please stay ready"}</p>
            <p className="text-sm text-text-secondary">Remaining shown after the exam starts: {formatWait(status?.remaining_seconds)}</p>
          </div>
        </div>
        <div className="mt-6">
          <ProgressBar value={status?.time_state === "not_started" ? 35 : 65} max={100} variant="warning" />
        </div>
      </Card>
      <Button variant="secondary" onClick={loadStatus}>
        <RefreshCw size={17} /> Check Now
      </Button>
    </div>
  );
}
