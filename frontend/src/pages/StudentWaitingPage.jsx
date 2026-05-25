import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CalendarClock, CheckCircle2, Clock3, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { Avatar, Badge, Button, Card, ProgressBar, Skeleton } from "../components/ui";
import { api } from "../services/api";
import { notify } from "../components/ui/Toast";
import { formatDate } from "../utils/dateFormat";

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
  const studentSession = status?.student_session || {};
  const lobby = status?.lobby || {};
  const inactive = status?.exam_status === "draft";
  const timeStateLabel = inactive ? "Temporarily inactive" : status?.time_state === "not_started" ? "Exam not started" : status?.exam_status || "Waiting";
  const progressValue = inactive ? 20 : status?.time_state === "not_started" ? 35 : 65;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="relative overflow-hidden rounded-card border border-warning/25 bg-gradient-to-br from-warning/10 via-background-surface to-background-base p-6 shadow-card md:p-8">
        <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-warning/10 blur-3xl" />
        <div className="absolute -bottom-20 left-10 h-52 w-52 rounded-full bg-brand-primary/10 blur-3xl" />
        <div className="relative z-10 grid gap-6 lg:grid-cols-[1fr_300px] lg:items-center">
          <div>
            <Badge variant={inactive ? "secondary" : "warning"}>{timeStateLabel}</Badge>
            <h1 className="mt-3 text-3xl font-bold text-text-primary md:text-4xl">{exam.exam_name || "Exam lobby"}</h1>
            <p className="mt-2 max-w-2xl text-text-secondary">
              {status?.message || "Stay on this lobby screen. You will be moved to the pre-check automatically as soon as the exam opens."}
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-background-base/80 p-3">
                <span className="text-xs font-semibold text-text-muted">Subject</span>
                <strong className="mt-1 block text-text-primary">{exam.subject || "-"}</strong>
              </div>
              <div className="rounded-lg border border-border bg-background-base/80 p-3">
                <span className="text-xs font-semibold text-text-muted">Duration</span>
                <strong className="mt-1 block text-text-primary">{exam.duration_minutes || "-"} min</strong>
              </div>
              <div className="rounded-lg border border-border bg-background-base/80 p-3">
                <span className="text-xs font-semibold text-text-muted">Total marks</span>
                <strong className="mt-1 block text-text-primary">{exam.total_marks || "-"}</strong>
              </div>
            </div>
          </div>

          <Card className="bg-background-surface/90 p-5">
            <div className="flex items-center gap-3">
              <Avatar name={studentSession.student_name} src={studentSession.profile_picture} size="xl" />
              <div className="min-w-0">
                <p className="truncate font-semibold text-text-primary">{studentSession.student_name || "Student"}</p>
                <p className="text-sm text-text-muted">Roll {studentSession.roll_no || "-"}</p>
              </div>
            </div>
            <div className="mt-5 rounded-lg border border-warning/30 bg-warning/5 p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold text-warning">
                  <Users size={16} /> Lobby position
                </span>
                <strong className="text-xl text-text-primary">{lobby.position || "-"}</strong>
              </div>
              <p className="mt-1 text-xs text-text-muted">{lobby.waiting_count || 1} student(s) currently waiting for this exam.</p>
            </div>
          </Card>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="p-6">
          <div className="mb-5 flex items-center gap-4">
            <span className="relative grid h-14 w-14 place-items-center rounded-lg bg-warning/10 text-warning">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-lg bg-warning/15" />
              <Clock3 size={26} className="relative" />
            </span>
            <div>
              <h2 className="text-xl font-semibold text-text-primary">{inactive ? "Exam paused for updates" : "Waiting for the gate to open"}</h2>
              <p className="text-sm text-text-secondary">
                {inactive ? "Your teacher or admin will publish it again after changes are complete." : `Remaining time will be shown once the timer starts: ${formatWait(status?.remaining_seconds)}`}
              </p>
            </div>
          </div>
          <ProgressBar value={progressValue} max={100} variant="warning" />
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="flex items-start gap-3 rounded-lg border border-border bg-background-base p-3">
              <CalendarClock size={18} className="mt-0.5 text-info" />
              <div>
                <p className="text-sm font-semibold text-text-primary">Starts</p>
                <p className="text-sm text-text-muted">{formatDate(exam.start_time)}</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-border bg-background-base p-3">
              <CalendarClock size={18} className="mt-0.5 text-info" />
              <div>
                <p className="text-sm font-semibold text-text-primary">Closes</p>
                <p className="text-sm text-text-muted">{formatDate(exam.end_time)}</p>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold text-text-primary">Before you start</h2>
          <div className="mt-4 space-y-3">
            {["Keep this browser tab open", "Stay connected to the internet", "Do not leave fullscreen during the exam"].map(item => (
              <div key={item} className="flex items-center gap-3 rounded-lg border border-border bg-background-base p-3">
                <CheckCircle2 size={18} className="text-success" />
                <span className="text-sm text-text-secondary">{item}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-lg border border-brand-primary/25 bg-brand-primary/5 p-3 text-sm text-brand-primary">
            <ShieldCheck size={18} className="mb-2" />
            Your attendance in the lobby is visible to the proctor.
          </div>
        </Card>
      </div>

      <Button variant="secondary" onClick={loadStatus}>
        <RefreshCw size={17} /> Check Now
      </Button>
    </div>
  );
}
