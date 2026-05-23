import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Clock3, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, Skeleton, Toggle } from "../components/ui";
import { api } from "../services/api";
import { notify } from "../components/ui/Toast";

function toRouterPath(target) {
  return String(target || "/react/student").replace(/^\/react/, "") || "/student";
}

export default function StudentPrecheckPage() {
  const { sessionCode } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [ack, setAck] = useState(false);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  const loadPrecheck = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get(`/student/session/${sessionCode}/precheck`);
      if (response.data.redirect) {
        navigate(toRouterPath(response.data.redirect), { replace: true });
        return;
      }
      setData(response.data);
    } catch (error) {
      notify.error(error.message || "Could not load precheck");
      navigate("/student", { replace: true });
    } finally {
      setLoading(false);
    }
  }, [navigate, sessionCode]);

  useEffect(() => {
    loadPrecheck();
  }, [loadPrecheck]);

  const startExam = async () => {
    setStarting(true);
    try {
      const response = await api.post(`/student/session/${sessionCode}/precheck`, { rules_ack: ack });
      navigate(toRouterPath(response.data.redirect), { replace: true });
    } catch (error) {
      notify.error(error.message || "Could not start exam");
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <Card className="mx-auto max-w-3xl p-6">
        <Skeleton className="mb-4 h-7 w-2/3" />
        <Skeleton className="mb-3 h-4 w-full" />
        <Skeleton className="mb-3 h-4 w-5/6" />
        <Skeleton className="h-24 w-full" />
      </Card>
    );
  }

  const exam = data?.exam || {};
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase text-text-muted">Pre-exam checklist</p>
        <h1 className="text-3xl font-bold text-text-primary">{exam.exam_name}</h1>
        <p className="mt-1 text-text-secondary">{exam.subject} {exam.set_code ? `| Set ${exam.set_code}` : ""}</p>
      </div>

      <Card className="p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Badge variant="info">{data?.question_count || 0} questions</Badge>
          <Badge variant="purple">{exam.total_marks || 0} marks</Badge>
          <Badge variant="warning">{exam.duration_minutes || 0} minutes</Badge>
        </div>
        <div className="mt-6 grid gap-4">
          {[
            "Stay on this exam tab until you submit.",
            "Fullscreen, focus, copy/paste, and shortcut activity may be logged.",
            `After ${data?.max_violations_allowed || 3} warnings, an admin may review or terminate the attempt.`,
            "Answers autosave, but submit only when you are finished."
          ].map(item => (
            <div key={item} className="flex items-start gap-3 rounded-lg border border-border bg-background-base p-4 text-text-secondary">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Toggle checked={ack} onChange={setAck} label="I understand the rules and am ready to begin." />
          <Button variant="primary" disabled={!ack} loading={starting} loadingLabel="Starting..." onClick={startExam}>
            <ShieldCheck size={17} /> Start Exam
          </Button>
        </div>
        <p className="mt-3 flex items-center gap-2 text-sm text-text-muted">
          <Clock3 size={15} /> The timer starts after this confirmation.
        </p>
      </Card>
    </div>
  );
}
