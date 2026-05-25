import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock3,
  MessageSquare,
  PauseCircle,
  PlayCircle,
  Radio,
  RefreshCw,
  ShieldAlert,
  Volume2,
  VolumeX,
  TimerReset,
  UserCheck,
  XCircle
} from "lucide-react";
import { api } from "./services/api";
import { createRealtimeSocket } from "./services/realtime";
import { Button } from "./components/ui/Button";
import { Card } from "./components/ui/Card";
import { ConfirmationDialog } from "./components/ui/ConfirmationDialog";
import { Badge } from "./components/ui/Badge";
import { Input } from "./components/ui/Input";
import { Textarea } from "./components/ui/Textarea";
import { Select } from "./components/ui/Select";
import { Avatar } from "./components/ui/Avatar";
import { cn } from "./components/ui/utils";
import { formatDate } from "./utils/dateFormat";

function formatSeconds(value) {
  const total = Math.max(Number(value || 0), 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map(part => String(part).padStart(2, "0")).join(":");
}

function violationTone(count) {
  if (count >= 3) return "danger";
  if (count > 0) return "warning";
  return "calm";
}

function countSessions(sessions) {
  return {
    active_sessions: sessions.filter(item => item.status === "active").length,
    waiting_sessions: sessions.filter(item => item.status === "waiting").length,
    paused_sessions: sessions.filter(item => item.status === "paused").length,
    flagged_sessions: sessions.filter(item => item.focus_violations > 0).length
  };
}

function normalizeRealtimePatch(payload) {
  const patch = { ...(payload || {}) };
  if (patch.session_id && !patch.id) patch.id = patch.session_id;
  if (patch.remainingSeconds != null && patch.remaining_seconds == null) {
    patch.remaining_seconds = patch.remainingSeconds;
  }
  return patch;
}

export default function Proctoring({ mode }) {
  const isAdmin = mode === "admin";
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedExamId, setSelectedExamId] = useState("all");
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => window.localStorage.getItem("proctorSoundEnabled") === "true");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [realtimeStatus, setRealtimeStatus] = useState("connecting");
  const socketRef = useRef(null);
  const joinedExamIdsRef = useRef(new Set());
  const sessionsRef = useRef([]);

  const endpoint = isAdmin ? "/admin/proctoring/status" : "/teacher/proctoring/status";

  useEffect(() => {
    window.localStorage.setItem("proctorSoundEnabled", String(soundEnabled));
  }, [soundEnabled]);

  const playViolationBeep = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.value = 0.07;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.12);
      window.setTimeout(() => context.close?.(), 180);
    } catch {
      // Browser may block audio until user interaction.
    }
  }, [soundEnabled]);

  const loadStatus = useCallback(async soft => {
    setError("");
    if (soft) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await api.get(endpoint);
      setData(response.data);
      const sessions = response.data.sessions || [];
      setSelectedId(current => (sessions.some(item => item.id === current) ? current : sessions[0]?.id || null));
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Could not load proctoring data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [endpoint]);

  useEffect(() => {
    loadStatus(false);
    const intervalId = window.setInterval(() => loadStatus(true), 5000);
    return () => window.clearInterval(intervalId);
  }, [loadStatus]);

  useEffect(() => {
    sessionsRef.current = data?.sessions || [];
  }, [data?.sessions]);

  const joinExamRooms = useCallback(sessions => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    (sessions || []).forEach(item => {
      const examId = Number(item.exam_id || 0);
      if (!examId || joinedExamIdsRef.current.has(examId)) return;
      joinedExamIdsRef.current.add(examId);
      socket.emit("proctor:join", { exam_id: examId });
    });
  }, []);

  const applySessionPatch = useCallback(payload => {
    const patch = normalizeRealtimePatch(payload);
    const sessionId = Number(patch.id || 0);
    if (!sessionId) return;

    setData(current => {
      if (!current) return current;
      let sessions = current.sessions || [];
      const shouldRemove = patch.status && !["active", "waiting", "paused"].includes(patch.status);
      let found = false;

      sessions = sessions
        .map(item => {
          if (item.id !== sessionId) return item;
          found = true;
          return { ...item, ...patch };
        })
        .filter(item => !(shouldRemove && item.id === sessionId));

      if (!found) return current;
      return {
        ...current,
        sessions,
        counts: countSessions(sessions),
        updated_at: new Date().toISOString()
      };
    });
  }, []);

  useEffect(() => {
    joinExamRooms(data?.sessions || []);
  }, [data?.sessions, joinExamRooms]);

  useEffect(() => {
    const socket = createRealtimeSocket();
    const joinedExamIds = joinedExamIdsRef.current;
    socketRef.current = socket;

    const handleConnect = () => {
      setRealtimeStatus("connected");
      joinedExamIdsRef.current.clear();
      joinExamRooms(sessionsRef.current);
    };
    const handleDisconnect = () => {
      setRealtimeStatus("reconnecting");
    };
    const handleRealtimeError = payload => {
      setRealtimeStatus("limited");
      if (payload?.message) setError(payload.message);
    };
    const handleJoined = () => {
      setRealtimeStatus("connected");
    };
    const handleStatus = payload => {
      applySessionPatch(payload);
    };
    const handleViolation = payload => {
      applySessionPatch({
        id: payload?.session_id,
        focus_violations: payload?.count,
        latest_violation: payload?.type,
        latest_violation_at: new Date().toISOString()
      });
      if (payload?.student_name) {
        toast.error(`${payload.student_name}: ${payload.type || "violation"}`, { duration: 5000 });
      }
      playViolationBeep();
      window.setTimeout(() => loadStatus(true), 400);
    };
    const handleSubmitted = payload => {
      applySessionPatch({ id: payload?.session_id, status: payload?.status || "submitted" });
      if (payload?.student_name) toast.success(`${payload.student_name} submitted.`);
      window.setTimeout(() => loadStatus(true), 400);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("realtime:error", handleRealtimeError);
    socket.on("proctor:joined", handleJoined);
    socket.on("proctor:student_status", handleStatus);
    socket.on("proctor:violation_alert", handleViolation);
    socket.on("proctor:exam_submitted", handleSubmitted);
    socket.connect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("realtime:error", handleRealtimeError);
      socket.off("proctor:joined", handleJoined);
      socket.off("proctor:student_status", handleStatus);
      socket.off("proctor:violation_alert", handleViolation);
      socket.off("proctor:exam_submitted", handleSubmitted);
      socket.disconnect();
      socketRef.current = null;
      joinedExamIds.clear();
    };
  }, [applySessionPatch, joinExamRooms, loadStatus, playViolationBeep]);

  const examOptions = useMemo(() => {
    const exams = new Map();
    (data?.sessions || []).forEach(item => {
      const examId = String(item.exam_id || "");
      if (!examId) return;
      exams.set(examId, item.exam_name || `Exam ${examId}`);
    });
    return [
      { value: "all", label: "All Active Exams" },
      ...Array.from(exams.entries()).map(([value, label]) => ({ value, label }))
    ];
  }, [data?.sessions]);

  const sortedSessions = useMemo(() => {
    const sessions = data?.sessions || [];
    const filtered = selectedExamId === "all"
      ? sessions
      : sessions.filter(item => String(item.exam_id) === String(selectedExamId));
    return [...filtered].sort((left, right) => {
      if (right.focus_violations !== left.focus_violations) return right.focus_violations - left.focus_violations;
      return (right.remaining_seconds || 0) - (left.remaining_seconds || 0);
    });
  }, [data, selectedExamId]);

  const selectedSession = sortedSessions.find(item => item.id === selectedId) || sortedSessions[0] || null;
  const waitingSessions = sortedSessions.filter(item => item.status === "waiting");
  const counts = data?.counts || {};

  if (loading) return <div className="loadingScreen">Loading proctoring workspace...</div>;

  return (
    <section className="proctorWorkspace">
      <Card className="reviewHeader">
        <div>
          <h2>Live Proctoring</h2>
          <p>{isAdmin ? "Monitor active attempts and take audited security actions." : "Read-only view of your active exam attempts."}</p>
        </div>
        <div className="actionRow">
          <span className="proctorUpdated">
            <Radio size={16} />
            Updated {formatDate(data?.updated_at)}
          </span>
          <Badge className={`realtimePill ${realtimeStatus}`} variant={realtimeStatus === "connected" ? "success" : realtimeStatus === "reconnecting" ? "warning" : "secondary"}>
            {realtimeStatus}
          </Badge>
          {isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-11 w-11 border px-0 transition duration-150",
                soundEnabled
                  ? "border-brand-primary bg-brand-primary text-white hover:bg-brand-hover"
                  : "border-border bg-transparent text-text-muted hover:border-brand-primary/60 hover:text-brand-primary"
              )}
              onClick={() => setSoundEnabled(current => !current)}
              aria-label={soundEnabled ? "Disable violation sound" : "Enable violation sound"}
            >
              {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </Button>
          )}
          <Button variant="secondary" size="sm" disabled={refreshing} onClick={() => loadStatus(true)}>
            <RefreshCw size={18} /> {refreshing ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </Card>

      {error && <div className="alert">{error}</div>}
      {message && <div className="successBanner">{message}</div>}

      <section className="studentStats">
        <Card className="statsCard border-success/30 bg-success/5"><PlayCircle size={18} className="text-success" /><span>Active</span><strong>{counts.active_sessions || 0}</strong></Card>
        <Card className="statsCard border-warning/30 bg-warning/5"><Clock3 size={18} className="text-warning" /><span>Waiting</span><strong>{counts.waiting_sessions || 0}</strong></Card>
        <Card className={cn("statsCard border-orange-300/30 bg-orange-500/5", Number(counts.paused_sessions || 0) > 0 && "border-orange-400/70 bg-orange-500/10")}><PauseCircle size={18} className="text-orange-500" /><span>Paused</span><strong>{counts.paused_sessions || 0}</strong></Card>
        <Card className={cn("statsCard border-danger/30 bg-danger/5", Number(counts.flagged_sessions || 0) > 0 && "border-danger/70 bg-danger/10")}><ShieldAlert size={18} className="text-danger" /><span>Flagged</span><strong>{counts.flagged_sessions || 0}</strong></Card>
      </section>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,320px)_1fr] md:items-end">
          <Select label="Active Exam" value={selectedExamId} onChange={setSelectedExamId} options={examOptions} required />
          <p className="mb-0 text-sm text-text-muted">
            Showing {sortedSessions.length} of {(data?.sessions || []).length} active, waiting, or paused attempts.
          </p>
        </div>
      </Card>

      {waitingSessions.length > 0 && (
        <Card className="overflow-hidden border-warning/30 bg-warning/5">
          <div className="flex flex-col gap-2 border-b border-warning/20 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-text-primary">Exam Lobby</h3>
              <p className="text-sm text-text-secondary">Students waiting for this exam to open or complete the pre-check appear here live.</p>
            </div>
            <Badge variant="warning">{waitingSessions.length} waiting</Badge>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
            {waitingSessions.map(item => (
              <button
                type="button"
                key={item.id}
                className={cn(
                  "flex items-center gap-3 rounded-lg border border-warning/25 bg-background-surface p-3 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-warning/60 hover:shadow-card",
                  selectedSession?.id === item.id && "border-warning/70 ring-2 ring-warning/20"
                )}
                onClick={() => {
                  setSelectedId(item.id);
                  setMobileDetailOpen(true);
                }}
              >
                <Avatar name={item.student_name} src={item.profile_picture} size="lg" />
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-text-primary">{item.student_name}</span>
                  <span className="block truncate text-xs text-text-muted">Roll {item.roll_no}</span>
                  <span className="mt-1 block truncate text-xs font-medium text-warning">{item.exam_name}</span>
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="proctorLayout">
        <section className="proctorCardGrid">
          {sortedSessions.map(item => (
            <button
              type="button"
              className={`proctorStudentCard ${violationTone(item.focus_violations)} ${selectedSession?.id === item.id ? "selected" : ""}`}
              key={item.id}
              onClick={() => {
                setSelectedId(item.id);
                setMobileDetailOpen(true);
              }}
            >
              <div className="proctorCardTop">
                <Avatar name={item.student_name} src={item.profile_picture} size="md" />
                <div className="min-w-0 flex-1">
                  <strong>{item.student_name}</strong>
                  <span>Roll {item.roll_no} | {item.exam_name}</span>
                </div>
                <Badge variant={violationTone(item.focus_violations)}>{item.focus_violations}</Badge>
              </div>
              <div className="proctorMetrics">
                <span><Clock3 size={15} /> {formatSeconds(item.remaining_seconds)}</span>
                <span><CheckCircle2 size={15} /> {item.answered_count}/{item.total_questions}</span>
                <Badge variant={item.status === "active" ? "success" : item.status === "paused" ? "warning" : "secondary"}>{item.status}</Badge>
              </div>
              <div className="proctorCardFoot">
                <span>{item.latest_violation || "No violation"}</span>
                <span>{item.last_heartbeat_age == null ? "No heartbeat" : `${item.last_heartbeat_age}s ago`}</span>
              </div>
            </button>
          ))}

          {!sortedSessions.length && (
            <div className="emptyState">
              <UserCheck size={34} />
              <h3>No active attempts</h3>
              <p>Students who are waiting, active, or paused will appear here automatically.</p>
            </div>
          )}
        </section>

        <aside className="proctorDetailPanel hidden md:block">
          {selectedSession ? (
            <SessionDetail
              sessionItem={selectedSession}
              isAdmin={isAdmin}
              onActionMessage={setMessage}
              onActionError={setError}
              onReload={() => loadStatus(true)}
            />
          ) : (
            <div className="emptyState compact">
              <BellRing size={30} />
              <h3>Select a student</h3>
              <p>Detailed status and controls will open here.</p>
            </div>
          )}
        </aside>
      </div>

      {mobileDetailOpen && selectedSession && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button className="absolute inset-0 bg-black/55 animate-page-fade" type="button" aria-label="Close student detail" onClick={() => setMobileDetailOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-auto rounded-t-card border border-border bg-background-surface p-4 shadow-elevated animate-drawer-bottom">
            <div className="mb-3 flex items-center justify-between gap-3">
              <strong className="text-text-primary">Student Detail</strong>
              <Button variant="ghost" size="sm" onClick={() => setMobileDetailOpen(false)}>Close</Button>
            </div>
            <SessionDetail
              sessionItem={selectedSession}
              isAdmin={isAdmin}
              onActionMessage={setMessage}
              onActionError={setError}
              onReload={() => loadStatus(true)}
            />
          </div>
        </div>
      )}

      {isAdmin && data?.recent_violations?.length > 0 && (
        <section className="recentViolationFeed">
          <div className="rowBetween">
            <div>
              <span className="eyebrow">Recent alerts</span>
              <h3>Violation Feed</h3>
            </div>
            <Button as="a" variant="ghost" size="sm" href="/react/admin/reports">Full log</Button>
          </div>
          {data.recent_violations.map(item => (
            <article key={item.id}>
              <AlertTriangle size={17} />
              <div>
                <strong>{item.student_name} | {item.type}</strong>
                <p>{item.exam_name} | {formatDate(item.occurred_at)}{item.detail ? ` | ${item.detail}` : ""}</p>
              </div>
            </article>
          ))}
        </section>
      )}
    </section>
  );
}

function SessionDetail({ sessionItem, isAdmin, onActionMessage, onActionError, onReload }) {
  const [adminPassword, setAdminPassword] = useState("");
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState(5);
  const [studentMessage, setStudentMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [pendingAction, setPendingAction] = useState("");

  const runAction = async action => {
    onActionError("");
    onActionMessage("");

    if (!adminPassword.trim()) {
      onActionError("Enter your admin password before taking a proctoring action.");
      return;
    }

    setBusyAction(action);
    try {
      const response = await api.post(`/admin/proctoring/session/${sessionItem.id}/action`, {
        action,
        admin_password: adminPassword,
        reason,
        minutes,
        message: studentMessage
      });
      onActionMessage(response.data.message || "Action completed.");
      if (action === "message") setStudentMessage("");
      await onReload();
    } catch (err) {
      onActionError(err.response?.data?.message || err.message || "Action failed.");
    } finally {
      setBusyAction("");
    }
  };

  const requestAction = action => {
    if (action === "terminate") {
      onActionError("");
      onActionMessage("");
      if (!adminPassword.trim()) {
        onActionError("Enter your admin password before taking a proctoring action.");
        return;
      }
      setPendingAction("terminate");
      return;
    }
    runAction(action);
  };

  return (
    <div className="proctorDetail">
      <div>
        <span className="eyebrow">Selected attempt</span>
        <h3>{sessionItem.student_name}</h3>
        <p>{sessionItem.exam_name} | Roll {sessionItem.roll_no} | Set {sessionItem.set_code}</p>
      </div>

      <div className="proctorDetailStats">
        <div><span>Timer</span><strong>{formatSeconds(sessionItem.remaining_seconds)}</strong></div>
        <div><span>Answered</span><strong>{sessionItem.answered_count}/{sessionItem.total_questions}</strong></div>
        <div><span>Violations</span><strong>{sessionItem.focus_violations}</strong></div>
        <div><span>Suspicion</span><strong>{sessionItem.suspicion_score || 0}</strong></div>
      </div>

      <div className="proctorInfoList">
        <div><span>Status</span><strong>{sessionItem.status}</strong></div>
        <div><span>Latest violation</span><strong>{sessionItem.latest_violation || "None"}</strong></div>
        <div><span>Heartbeat</span><strong>{sessionItem.last_heartbeat_age == null ? "No heartbeat" : `${sessionItem.last_heartbeat_age}s ago`}</strong></div>
        <div><span>Pause request</span><strong>{sessionItem.pause_requested ? sessionItem.pause_reason || "Requested" : "No"}</strong></div>
      </div>

      {!isAdmin ? (
        <div className="softNote">Teacher proctoring is read-only. Admin-only actions are intentionally unavailable here.</div>
      ) : (
        <Card className="adminActionPanel">
          <Input
            label="Admin password"
            type="password"
            value={adminPassword}
            onChange={event => setAdminPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
          <Input
            label="Reason / note"
            value={reason}
            onChange={event => setReason(event.target.value)}
            placeholder="Required for serious actions"
          />
          <Textarea
            label="Private message"
            rows={3}
            value={studentMessage}
            onChange={event => setStudentMessage(event.target.value)}
          />
          <div className="timePenaltyLine">
            <Input
              label="Time penalty"
              type="number"
              min="1"
              value={minutes}
              onChange={event => setMinutes(event.target.value)}
              required
            />
            <Button variant="secondary" size="sm" disabled={Boolean(busyAction)} onClick={() => requestAction("reduce_time")}>
              <TimerReset size={18} /> Reduce
            </Button>
          </div>
          <div className="actionRow">
            <Button variant="danger" size="sm" disabled={Boolean(busyAction)} onClick={() => requestAction("terminate")}>
              <XCircle size={18} /> Terminate
            </Button>
            <Button variant="secondary" size="sm" disabled={Boolean(busyAction)} onClick={() => requestAction("second_chance")}>
              <UserCheck size={18} /> Second chance
            </Button>
            {sessionItem.status === "paused" ? (
              <Button variant="primary" size="sm" disabled={Boolean(busyAction)} onClick={() => requestAction("resume")}>
                <PlayCircle size={18} /> Resume
              </Button>
            ) : (
              <Button variant="secondary" size="sm" disabled={Boolean(busyAction)} onClick={() => requestAction("pause")}>
                <PauseCircle size={18} /> Pause
              </Button>
            )}
            <Button variant="primary" size="sm" disabled={Boolean(busyAction)} onClick={() => requestAction("message")}>
              <MessageSquare size={18} /> Send message
            </Button>
          </div>
          {busyAction && <span className="savingHint">Applying {busyAction.replace("_", " ")}...</span>}
        </Card>
      )}
      <ConfirmationDialog
        open={pendingAction === "terminate"}
        title="Terminate Exam Attempt?"
        description={`This will immediately end ${sessionItem.student_name}'s exam attempt and notify the student.`}
        confirmLabel="Terminate"
        confirmWord="TERMINATE"
        variant="danger"
        loading={busyAction === "terminate"}
        onConfirm={() => {
          setPendingAction("");
          runAction("terminate");
        }}
        onClose={() => setPendingAction("")}
      />
    </div>
  );
}
