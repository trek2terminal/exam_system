import { useCallback, useEffect, useMemo, useState } from "react";
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
  TimerReset,
  UserCheck,
  XCircle
} from "lucide-react";
import { api } from "./services/api";

function formatSeconds(value) {
  const total = Math.max(Number(value || 0), 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map(part => String(part).padStart(2, "0")).join(":");
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString([], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function violationTone(count) {
  if (count >= 3) return "danger";
  if (count > 0) return "warning";
  return "calm";
}

export default function Proctoring({ mode }) {
  const isAdmin = mode === "admin";
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const endpoint = isAdmin ? "/admin/proctoring/status" : "/teacher/proctoring/status";

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

  const sortedSessions = useMemo(() => {
    const sessions = data?.sessions || [];
    return [...sessions].sort((left, right) => {
      if (right.focus_violations !== left.focus_violations) return right.focus_violations - left.focus_violations;
      return (right.remaining_seconds || 0) - (left.remaining_seconds || 0);
    });
  }, [data]);

  const selectedSession = sortedSessions.find(item => item.id === selectedId) || sortedSessions[0] || null;

  if (loading) return <div className="loadingScreen">Loading proctoring workspace...</div>;

  return (
    <section className="proctorWorkspace">
      <div className="reviewHeader">
        <div>
          <span className="eyebrow">{isAdmin ? "Admin control room" : "Teacher proctoring"}</span>
          <h2>Live Proctoring</h2>
          <p>{isAdmin ? "Monitor active attempts and take audited security actions." : "Read-only view of your active exam attempts."}</p>
        </div>
        <div className="actionRow">
          <span className="proctorUpdated">
            <Radio size={16} />
            Updated {formatDateTime(data?.updated_at)}
          </span>
          <button className="button secondary" type="button" disabled={refreshing} onClick={() => loadStatus(true)}>
            <RefreshCw size={18} /> {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {error && <div className="alert">{error}</div>}
      {message && <div className="successBanner">{message}</div>}

      <section className="studentStats">
        <article><PlayCircle size={18} /><span>Active</span><strong>{data?.counts?.active_sessions || 0}</strong></article>
        <article><Clock3 size={18} /><span>Waiting</span><strong>{data?.counts?.waiting_sessions || 0}</strong></article>
        <article><PauseCircle size={18} /><span>Paused</span><strong>{data?.counts?.paused_sessions || 0}</strong></article>
        <article><ShieldAlert size={18} /><span>Flagged</span><strong>{data?.counts?.flagged_sessions || 0}</strong></article>
      </section>

      <div className="proctorLayout">
        <section className="proctorCardGrid">
          {sortedSessions.map(item => (
            <button
              type="button"
              className={`proctorStudentCard ${selectedSession?.id === item.id ? "selected" : ""}`}
              key={item.id}
              onClick={() => setSelectedId(item.id)}
            >
              <div className="proctorCardTop">
                <div>
                  <strong>{item.student_name}</strong>
                  <span>Roll {item.roll_no} | {item.exam_name}</span>
                </div>
                <span className={`violationBadge ${violationTone(item.focus_violations)}`}>
                  {item.focus_violations}
                </span>
              </div>
              <div className="proctorMetrics">
                <span><Clock3 size={15} /> {formatSeconds(item.remaining_seconds)}</span>
                <span><CheckCircle2 size={15} /> {item.answered_count}/{item.total_questions}</span>
                <span className={`status ${item.status}`}>{item.status}</span>
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

        <aside className="proctorDetailPanel">
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

      {isAdmin && data?.recent_violations?.length > 0 && (
        <section className="recentViolationFeed">
          <div className="rowBetween">
            <div>
              <span className="eyebrow">Recent alerts</span>
              <h3>Violation Feed</h3>
            </div>
            <a className="button quiet" href="/admin/violations">Full log</a>
          </div>
          {data.recent_violations.map(item => (
            <article key={item.id}>
              <AlertTriangle size={17} />
              <div>
                <strong>{item.student_name} | {item.type}</strong>
                <p>{item.exam_name} | {formatDateTime(item.occurred_at)}{item.detail ? ` | ${item.detail}` : ""}</p>
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

  const runAction = async action => {
    onActionError("");
    onActionMessage("");

    if (!adminPassword.trim()) {
      onActionError("Enter your admin password before taking a proctoring action.");
      return;
    }
    if (action === "terminate" && !window.confirm(`Terminate ${sessionItem.student_name}'s exam?`)) {
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
        <div className="adminActionPanel">
          <label>
            Admin password
            <input
              type="password"
              value={adminPassword}
              onChange={event => setAdminPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <label>
            Reason / note
            <input value={reason} onChange={event => setReason(event.target.value)} placeholder="Required for serious actions" />
          </label>
          <label>
            Private message
            <textarea rows={3} value={studentMessage} onChange={event => setStudentMessage(event.target.value)} />
          </label>
          <div className="timePenaltyLine">
            <label>
              Time penalty
              <input type="number" min="1" value={minutes} onChange={event => setMinutes(event.target.value)} />
            </label>
            <button className="button secondary" type="button" disabled={Boolean(busyAction)} onClick={() => runAction("reduce_time")}>
              <TimerReset size={18} /> Reduce
            </button>
          </div>
          <div className="actionRow">
            <button className="button danger" type="button" disabled={Boolean(busyAction)} onClick={() => runAction("terminate")}>
              <XCircle size={18} /> Terminate
            </button>
            <button className="button secondary" type="button" disabled={Boolean(busyAction)} onClick={() => runAction("second_chance")}>
              <UserCheck size={18} /> Second chance
            </button>
            {sessionItem.status === "paused" ? (
              <button className="button primary" type="button" disabled={Boolean(busyAction)} onClick={() => runAction("resume")}>
                <PlayCircle size={18} /> Resume
              </button>
            ) : (
              <button className="button secondary" type="button" disabled={Boolean(busyAction)} onClick={() => runAction("pause")}>
                <PauseCircle size={18} /> Pause
              </button>
            )}
            <button className="button primary" type="button" disabled={Boolean(busyAction)} onClick={() => runAction("message")}>
              <MessageSquare size={18} /> Send message
            </button>
          </div>
          {busyAction && <span className="savingHint">Applying {busyAction.replace("_", " ")}...</span>}
        </div>
      )}
    </div>
  );
}
