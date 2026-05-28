import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  BookOpenCheck,
  CalendarClock,
  CheckCircle2,
  Clock3,
  DoorOpen,
  Edit3,
  FileText,
  KeyRound,
  Play,
  Plus,
  Radio,
  Search,
  Trophy,
  Users,
  XCircle
} from "lucide-react";
import { PageLayout } from "./components/layout/PageLayout";
import { SessionEndedOverlay } from "./components/SessionEndedOverlay";
import { Badge, Button, Card, EmptyState, Input, PageLoading, StatCard } from "./components/ui";
import { cn } from "./components/ui/utils";
import { useAppStore } from "./store/appStore";
import { api } from "./services/api";
import { notify } from "./components/ui/Toast";
import { useSessionWatcher } from "./hooks/useSessionWatcher";
import { useRealtimeBridge } from "./hooks/useRealtimeBridge";
import { formatDate } from "./utils/dateFormat";

const ExamInterface = lazy(() => import("./ExamInterface.jsx"));
const TeacherReview = lazy(() => import("./TeacherReview.jsx"));
const Proctoring = lazy(() => import("./Proctoring.jsx"));

// Page Components
const StudentResults = lazy(() => import("./pages/StudentResults.jsx"));
const StudentHistory = lazy(() => import("./pages/StudentHistory.jsx"));
const StudentJoinPage = lazy(() => import("./pages/StudentJoinPage.jsx"));
const StudentPrecheckPage = lazy(() => import("./pages/StudentPrecheckPage.jsx"));
const StudentWaitingPage = lazy(() => import("./pages/StudentWaitingPage.jsx"));
const StudentSubmittedPage = lazy(() => import("./pages/StudentSubmittedPage.jsx"));
const LoginPage = lazy(() => import("./pages/LoginPage.jsx"));
const AdminLoginPage = lazy(() => import("./pages/AdminLoginPage.jsx"));
const AdminSetupPage = lazy(() => import("./pages/AdminSetupPage.jsx"));
const RegisterPage = lazy(() => import("./pages/RegisterPage.jsx"));
const ExamEditor = lazy(() => import("./pages/ExamEditor.jsx"));
const AdminDashboardPage = lazy(() => import("./pages/AdminDashboard.jsx"));
const AdminUserManagement = lazy(() => import("./pages/AdminUserManagement.jsx"));
const AdminSettings = lazy(() => import("./pages/AdminSettings.jsx"));
const TeacherQuestionBank = lazy(() => import("./pages/TeacherQuestionBank.jsx"));
const TeacherReports = lazy(() => import("./pages/TeacherReports.jsx"));
const AdminGroups = lazy(() => import("./pages/AdminGroups.jsx"));
const AdminExams = lazy(() => import("./pages/AdminExams.jsx"));
const AdminReports = lazy(() => import("./pages/AdminReports.jsx"));
const AccountSettings = lazy(() => import("./pages/AccountSettings.jsx"));
const MyDrafts = lazy(() => import("./pages/MyDrafts.jsx"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage.jsx"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage.jsx"));

const rolePaths = {
  admin: "/admin",
  teacher: "/teacher",
  student: "/student"
};

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

function formatCountdown(totalSeconds) {
  const seconds = Math.max(Math.floor(totalSeconds || 0), 0);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function countdownParts(totalSeconds) {
  const seconds = Math.max(Math.floor(totalSeconds || 0), 0);
  return {
    days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60
  };
}

function FlipCountdown({ totalSeconds }) {
  const parts = countdownParts(totalSeconds);
  const [flip, setFlip] = useState(false);
  const secondsUnit = parts.seconds % 10;
  const secondsTens = Math.floor(parts.seconds / 10);

  useEffect(() => {
    setFlip(true);
    const timeoutId = window.setTimeout(() => setFlip(false), 240);
    return () => window.clearTimeout(timeoutId);
  }, [secondsUnit]);

  const prefix = parts.days > 0
    ? `${parts.days}d ${parts.hours}h ${parts.minutes}m `
    : parts.hours > 0
      ? `${parts.hours}h ${parts.minutes}m `
      : `${parts.minutes}m `;

  return (
    <span className="inline-flex items-center font-mono tabular-nums text-text-primary">
      {prefix}
      <span>{secondsTens}</span>
      <span className={cn("inline-block origin-center", flip && "animate-flip-second")}>{secondsUnit}</span>
      <span>s</span>
    </span>
  );
}

function formatDateTime(value) {
  const formatted = formatDate(value);
  return formatted === "-" ? null : formatted;
}

function examTone(exam) {
  if (exam.state === "result_published") return "result";
  if (exam.state === "in_progress") return "active";
  if (exam.state === "submitted") return "submitted";
  if (exam.state === "upcoming") return "upcoming";
  if (exam.state === "closed") return "closed";
  if (exam.state === "available") return "active";
  if (exam.result) return "result";
  if (exam.latest_session?.status === "active") return "active";
  if (exam.latest_session?.status && ["submitted", "evaluated", "terminated", "auto_submitted"].includes(exam.latest_session.status)) {
    return "submitted";
  }
  if (exam.window?.time_state === "not_started") return "upcoming";
  if (exam.window?.has_ended || exam.status === "closed") return "closed";
  return exam.status || "draft";
}

function studentStateLabel(state) {
  const labels = {
    available: "Available now",
    in_progress: "In progress",
    upcoming: "Upcoming",
    submitted: "Submitted",
    result_published: "Result ready",
    closed: "Closed",
    draft: "Inactive",
  };
  return labels[state] || String(state || "Inactive").replace(/_/g, " ");
}

function studentStateVariant(state) {
  if (state === "available" || state === "in_progress") return "success";
  if (state === "upcoming" || state === "submitted") return "warning";
  if (state === "result_published") return "primary";
  if (state === "closed") return "danger";
  return "secondary";
}

function actionIcon(label) {
  const normalized = (label || "").toLowerCase();
  if (normalized.includes("view")) return <CheckCircle2 size={18} />;
  if (normalized.includes("waiting")) return <DoorOpen size={18} />;
  if (normalized.includes("next")) return <Play size={18} />;
  if (normalized.includes("start") || normalized.includes("resume")) return <Play size={18} />;
  return <FileText size={18} />;
}

function toRouterPath(target, fallback = "/") {
  if (!target) return fallback;
  return String(target).replace(/^\/react/, "") || fallback;
}

const scheduleDayFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric"
});

const scheduleTimeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit"
});

function parseScheduleDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function scheduleDayLabel(value) {
  const date = parseScheduleDate(value);
  return date ? scheduleDayFormatter.format(date) : "Flexible";
}

function scheduleTimeLabel(value) {
  const date = parseScheduleDate(value);
  return date ? scheduleTimeFormatter.format(date) : "";
}

function scheduleTimeRange(item) {
  const start = scheduleTimeLabel(item.starts_at);
  const end = scheduleTimeLabel(item.ends_at);
  if (start && end) return `${start} - ${end}`;
  if (start) return start;
  if (end) return `Until ${end}`;
  return "Open window";
}

function scheduleVariant(state) {
  if (state === "live" || state === "available" || state === "in_progress") return "success";
  if (state === "review_due" || state === "upcoming" || state === "submitted") return "warning";
  if (state === "closed") return "danger";
  if (state === "draft") return "secondary";
  return "info";
}

function scheduleLabel(state) {
  const labels = {
    available: "Available",
    in_progress: "Active",
    live: "Live",
    review_due: "Review",
    upcoming: "Upcoming",
    draft: "Draft",
    submitted: "Submitted",
    closed: "Closed"
  };
  return labels[state] || String(state || "Scheduled").replace(/_/g, " ");
}

function Shell({ children, platformName, platformLogoUrl, auth, notifications, theme, highContrast, onToggleTheme, onToggleContrast, onMarkAllRead }) {
  // layout handled by PageLayout
  return (
    <PageLayout auth={auth} platformName={platformName} platformLogoUrl={platformLogoUrl} notifications={notifications} theme={theme} highContrast={highContrast} onToggleTheme={onToggleTheme} onToggleContrast={onToggleContrast} onMarkAllRead={onMarkAllRead}>
      {children}
    </PageLayout>
  );
}

function PageSuspense({ children, label = "Loading workspace..." }) {
  return (
    <Suspense fallback={<PageLoading title={label} />}>
      {children}
    </Suspense>
  );
}

function LoginPanel() {
  const location = useLocation();
  const target = location.pathname.startsWith("/admin") ? "/admin/login" : "/login";
  return <Navigate to={target} replace state={{ from: location.pathname }} />;
}

function StudentDashboard({ dashboard }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [examFilter, setExamFilter] = useState("all");
  const [examSearch, setExamSearch] = useState("");
  const loadDashboard = useAppStore(state => state.loadDashboard);
  const stats = dashboard?.stats || {};
  const exams = useMemo(() => dashboard?.exams || [], [dashboard?.exams]);
  const student = dashboard?.student || {};
  const focusExam = dashboard?.focus_exam;
  const activity = dashboard?.activity || [];
  const schedule = dashboard?.schedule || {};
  const greeting = getGreeting();
  const announcementMessage = dashboard?.announcement_message?.trim();
  const announcementText = announcementMessage
    ? announcementMessage.replace(/^good\s+(morning|afternoon|evening)/i, greeting)
    : "";
  const visibleExams = useMemo(() => {
    const search = examSearch.trim().toLowerCase();
    return exams.filter(exam => {
      const state = exam.state || examTone(exam);
      const matchesFilter = examFilter === "all"
        || (examFilter === "results" ? state === "result_published" : state === examFilter);
      const matchesSearch = !search
        || `${exam.exam_name || ""} ${exam.subject || ""} ${exam.set_code || ""}`.toLowerCase().includes(search);
      return matchesFilter && matchesSearch;
    });
  }, [examFilter, examSearch, exams]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setElapsedSeconds(current => current + 1);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <div className="space-y-6">
      {/* Greeting Banner */}
      <div className="relative overflow-hidden rounded-card border border-border bg-gradient-to-br from-brand-primary/10 via-background-surface to-background-base p-6 shadow-card md:p-8">
        <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-brand-primary/5 blur-3xl" />
        <div className="absolute -bottom-8 -left-8 h-24 w-24 rounded-full bg-info/5 blur-3xl" />
        <div className="relative z-10">
          <p className="text-lg text-text-secondary">
            {greeting}, {student.name || "Student"}. {dashboard?.quote?.text || dashboard?.quote || "One calm question at a time."}
          </p>
          <div className="mt-4 flex items-center gap-6">
            <div>
              <p className="text-xs font-semibold text-text-muted">Roll number</p>
              <p className="text-xl font-bold text-text-primary">{student.roll_no || "-"}</p>
            </div>
            <div className="h-12 border-l border-border" />
            <div>
              <p className="text-xs font-semibold text-text-muted">Assigned exams</p>
              <p className="text-xl font-bold text-text-primary">{Number(stats.assigned || 0).toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Announcement Banner */}
      {announcementText && (
        <div className="flex items-center gap-4 rounded-card border border-warning/30 bg-warning/5 p-4 md:p-5">
          <Bell size={20} className="shrink-0 text-warning" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-text-primary">{announcementText}</p>
          </div>
          <button
            type="button"
            className="grid h-8 w-8 shrink-0 place-items-center self-center text-text-muted transition hover:text-text-primary"
            onClick={e => e.currentTarget.parentElement.remove()}
            aria-label="Dismiss announcement"
          >
            x
          </button>
        </div>
      )}

      <StudentBatchJoinPanel
        joinedBatches={student.batches || []}
        needsBatchJoin={Boolean(student.needs_batch_join)}
        onJoined={() => loadDashboard("student")}
      />

      {/* Stats Row */}
      <section className="grid grid-cols-2 gap-4 min-[900px]:grid-cols-4">
        <StatCard icon={BookOpenCheck} label="Assigned" value={stats.assigned || 0} variant="default" />
        <StatCard icon={Play} label="Available" value={stats.available || 0} variant="default" />
        <StatCard icon={Clock3} label="Active" value={stats.in_progress || 0} variant="default" />
        <StatCard icon={Trophy} label="Results" value={stats.published_results || 0} variant="default" />
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <StudentFocusCard exam={focusExam} elapsedSeconds={elapsedSeconds} />
        <StudentActivityPanel activity={activity} />
      </section>

      <DashboardSchedulePanel
        title="Upcoming schedule"
        description="Your next open, active, and scheduled exams in one timeline."
        schedule={schedule}
        role="student"
        emptyLabel="No upcoming exam windows yet."
      />

      {/* Exams Section */}
      <div>
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-text-primary">Assigned exams</h2>
            <p className="mt-1 text-text-secondary">Start available exams, resume active sessions, and review published results.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" as={Link} to={dashboard?.links?.results || "/student/results"}>
              <Trophy size={16} />
              <span className="hidden sm:inline">Results</span>
            </Button>
            <Button variant="primary" size="sm" as={Link} to="/student/join">
              <KeyRound size={16} />
              <span className="hidden sm:inline">Access code</span>
            </Button>
          </div>
        </div>

        <Card className="mb-4 grid gap-3 p-3 lg:grid-cols-[minmax(220px,1fr)_auto] lg:items-center">
          <Input
            value={examSearch}
            onChange={event => setExamSearch(event.target.value)}
            placeholder="Search assigned exams"
            aria-label="Search assigned exams"
          />
          <div className="flex flex-wrap gap-2">
            {[
              ["all", "All"],
              ["available", "Available"],
              ["in_progress", "Active"],
              ["upcoming", "Upcoming"],
              ["submitted", "Submitted"],
              ["results", "Results"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={cn(
                  "min-h-10 rounded-md border px-3 text-sm font-semibold transition",
                  examFilter === value
                    ? "border-brand-primary bg-brand-primary text-white"
                    : "border-border bg-background-card text-text-secondary hover:bg-background-elevated"
                )}
                onClick={() => setExamFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </Card>

        {exams.length === 0 ? (
          <div className="rounded-card border border-border bg-background-surface p-12 text-center shadow-card">
            <CalendarClock size={40} className="mx-auto mb-4 text-text-muted" />
            <h3 className="text-lg font-semibold text-text-primary">No assigned exams yet</h3>
            <p className="mt-2 text-text-secondary">Your assigned exams will appear here. You can still join an exam with an access code if your teacher shared one.</p>
            <Button variant="primary" size="md" as={Link} to="/student/join" className="mt-4">
              <KeyRound size={16} /> Open exam lobby
            </Button>
          </div>
        ) : visibleExams.length === 0 ? (
          <Card className="p-10 text-center">
            <Search size={32} className="mx-auto mb-3 text-text-muted" />
            <h3 className="font-semibold text-text-primary">No exams match this view</h3>
            <p className="mt-1 text-sm text-text-secondary">Try a different filter or search term.</p>
          </Card>
        ) : (
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {visibleExams.map((exam, index) => (
              <div key={exam.exam_id} style={{ "--stagger-delay": `${index * 50}ms` }}>
                <StudentExamCard exam={exam} elapsedSeconds={elapsedSeconds} />
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

function StudentFocusCard({ exam, elapsedSeconds }) {
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  if (!exam) {
    return (
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-lg bg-brand-primary/10 text-brand-primary">
            <CalendarClock size={22} />
          </span>
          <div>
            <p className="text-sm font-semibold text-text-primary">No immediate exam action</p>
            <p className="mt-1 text-sm text-text-secondary">Assigned exams and activity will appear here when available.</p>
          </div>
        </div>
      </Card>
    );
  }

  const state = exam.state || examTone(exam);
  const secondsUntilStart = Math.max((exam.window?.seconds_until_start || 0) - elapsedSeconds, 0);
  const progress = exam.latest_session?.progress;
  const action = exam.action || {};
  const actionLabel = action.ready_label || action.label || "Open";
  const openExam = async () => {
    if (!action.api_path) return;
    setStarting(true);
    try {
      const { data } = await api.post(action.api_path);
      if (data.message) notify.success(data.message);
      navigate(toRouterPath(data.redirect, "/student"), { replace: false });
    } catch (error) {
      notify.error(error.message || "Could not open exam");
    } finally {
      setStarting(false);
    }
  };
  return (
    <Card className="overflow-hidden border-brand-primary/25 bg-brand-primary/5">
      <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <Badge variant={studentStateVariant(state)}>{studentStateLabel(state)}</Badge>
          <h2 className="mt-3 truncate text-2xl font-bold text-text-primary">{exam.exam_name}</h2>
          <p className="mt-1 text-sm text-text-secondary">
            {exam.subject || "Subject"} {exam.set_code ? `| Set ${exam.set_code}` : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="secondary">{exam.effective_duration_minutes || exam.duration_minutes} min</Badge>
            <Badge variant="secondary">{Number(exam.question_count || 0).toLocaleString()} questions</Badge>
            {secondsUntilStart > 0 && <Badge variant="warning">Starts in {formatCountdown(secondsUntilStart)}</Badge>}
          </div>
        </div>
        {action.method === "post" ? (
          <Button
            type="button"
            variant={state === "in_progress" || state === "available" ? "primary" : "secondary"}
            size="sm"
            loading={starting}
            loadingLabel="Opening..."
            disabled={action.disabled}
            onClick={openExam}
          >
            {actionIcon(actionLabel)}
            {actionLabel}
          </Button>
        ) : (
          <Button
            as="a"
            href={action.href}
            variant={state === "in_progress" || state === "available" ? "primary" : "secondary"}
            size="sm"
            disabled={action.disabled}
          >
            {actionIcon(actionLabel)}
            {actionLabel}
          </Button>
        )}
      </div>
      {progress && (
        <div className="border-t border-border/60 bg-background-card/70 px-5 py-3">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold text-text-muted">
            <span>{progress.answered_count || 0}/{progress.total_questions || 0} answered</span>
            <span>{progress.progress_percent || 0}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-background-elevated">
            <div
              className="h-full rounded-full bg-brand-primary transition-all duration-300"
              style={{ width: `${Math.max(0, Math.min(Number(progress.progress_percent || 0), 100))}%` }}
            />
          </div>
        </div>
      )}
    </Card>
  );
}

function StudentActivityPanel({ activity = [] }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-text-muted">Recent activity</p>
          <h3 className="text-lg font-semibold text-text-primary">Attempt timeline</h3>
        </div>
        <Button as={Link} to="/student/history" variant="ghost" size="sm">History</Button>
      </div>
      {activity.length === 0 ? (
        <p className="rounded-lg border border-border bg-background-base p-4 text-sm text-text-secondary">No attempts yet.</p>
      ) : (
        <div className="space-y-3">
          {activity.slice(0, 4).map(item => (
            <div key={item.id} className="flex gap-3 rounded-lg border border-border/70 bg-background-base p-3">
              <span className={cn(
                "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                item.result ? "bg-success" : item.status === "active" ? "bg-info" : item.status === "terminated" ? "bg-danger" : "bg-warning"
              )} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-text-primary">{item.exam_name}</p>
                <p className="text-xs text-text-muted">
                  {studentStateLabel(item.result ? "result_published" : item.status === "active" ? "in_progress" : "submitted")} · {formatDate(item.submitted_at || item.started_at || item.created_at)}
                </p>
              </div>
              {item.result && <Badge variant={item.result.passed ? "success" : "danger"}>{item.result.percentage}%</Badge>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function DashboardSchedulePanel({ title, description, schedule, role, emptyLabel }) {
  const items = schedule?.items;
  const visibleItems = items || [];
  const groups = useMemo(() => {
    const grouped = new Map();
    (items || []).forEach(item => {
      const key = item.date_key || "unscheduled";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item);
    });
    return Array.from(grouped.entries()).map(([key, rows]) => ({ key, rows }));
  }, [items]);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-text-muted">Calendar</p>
          <h3 className="text-xl font-bold text-text-primary">{title}</h3>
          <p className="mt-1 text-sm text-text-secondary">{description}</p>
        </div>
        <Badge variant="purple" size="md">{Number(schedule?.total || visibleItems.length || 0).toLocaleString()} items</Badge>
      </div>

      {visibleItems.length === 0 ? (
        <div className="p-8 text-center">
          <CalendarClock size={34} className="mx-auto mb-3 text-text-muted" />
          <p className="font-semibold text-text-primary">{emptyLabel}</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {groups.map(group => (
            <div key={group.key} className="grid gap-3 p-5 md:grid-cols-[130px_minmax(0,1fr)]">
              <div>
                <p className="text-sm font-bold text-text-primary">{scheduleDayLabel(group.rows[0]?.primary_at)}</p>
                <p className="mt-1 text-xs text-text-muted">{group.rows.length} scheduled</p>
              </div>
              <div className="space-y-3">
                {group.rows.map(item => (
                  <ScheduleRow key={item.id} item={item} role={role} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ScheduleRow({ item, role }) {
  const isTeacher = role === "teacher";
  const target = isTeacher
    ? toRouterPath(item.href, item.exam_id ? `/teacher/exam/${item.exam_id}/review` : "/teacher")
    : "/student/exams";
  const actionLabel = isTeacher && item.state === "review_due" ? "Review" : isTeacher ? "Open" : "My Exams";
  const details = [
    item.subject,
    item.set_code ? `Set ${item.set_code}` : null,
    item.duration_minutes ? `${item.duration_minutes} min` : null,
    item.question_count ? `${item.question_count} questions` : null
  ].filter(Boolean).join(" | ");

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-background-base p-4 transition hover:bg-background-elevated sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={scheduleVariant(item.state)}>{scheduleLabel(item.state)}</Badge>
          {item.pending_review_count ? <Badge variant="warning">{item.pending_review_count} pending</Badge> : null}
          {item.progress?.progress_percent ? <Badge variant="success">{item.progress.progress_percent}% done</Badge> : null}
        </div>
        <h4 className="mt-2 truncate text-base font-semibold text-text-primary">{item.title}</h4>
        <p className="mt-1 text-sm text-text-secondary">{details || item.label || "Exam window"}</p>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
        <span className="text-right text-sm font-semibold text-text-primary">{scheduleTimeRange(item)}</span>
        <Button variant="secondary" size="sm" as={Link} to={target}>
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}

function StudentBatchJoinPanel({ joinedBatches = [], needsBatchJoin = false, onJoined }) {
  const [batches, setBatches] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState(needsBatchJoin);
  const [joining, setJoining] = useState(false);
  const [expanded, setExpanded] = useState(needsBatchJoin);

  useEffect(() => {
    if (!expanded) return undefined;
    let mounted = true;
    setLoading(true);
    api.get("/student/batches")
      .then(({ data }) => {
        if (!mounted) return;
        setBatches(data.batches || []);
        const firstAvailable = (data.batches || []).find(batch => !batch.is_member);
        if (firstAvailable && !selectedBatchId) setSelectedBatchId(String(firstAvailable.id));
      })
      .catch(error => notify.error(error.message || "Could not load batches"))
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [expanded, selectedBatchId]);

  const visibleBatches = batches.filter(batch => {
    const searchText = `${batch.name} ${batch.description || ""}`.toLowerCase();
    return searchText.includes(query.toLowerCase());
  });
  const selectedBatch = batches.find(batch => String(batch.id) === String(selectedBatchId));

  const joinBatch = async event => {
    event.preventDefault();
    if (!selectedBatchId) {
      notify.error("Choose your batch first.");
      return;
    }
    setJoining(true);
    try {
      const { data } = await api.post("/student/batches/join", {
        group_id: selectedBatchId,
        join_code: joinCode
      });
      notify.success(data.message || "Batch joined");
      setJoinCode("");
      setExpanded(false);
      await onJoined?.();
    } catch (error) {
      notify.error(error.message || "Could not join batch");
    } finally {
      setJoining(false);
    }
  };

  if (!needsBatchJoin && !expanded && joinedBatches.length > 0) {
    return (
      <Card className="border-info/20 bg-info/5 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-info/10 text-info">
              <Users size={20} />
            </span>
            <div>
              <p className="text-sm font-semibold text-text-primary">Your batch</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {joinedBatches.map(batch => (
                  <Badge key={batch.id} variant="info">{batch.name}</Badge>
                ))}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            Join another batch
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className={cn("overflow-hidden p-5", needsBatchJoin && "border-brand-primary/30 bg-brand-primary/5")}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand-primary/10 text-brand-primary">
            <Users size={22} />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              {needsBatchJoin ? "Join your batch" : "Join another batch"}
            </h2>
            <p className="text-sm text-text-secondary">
              Select your batch and enter the code shared by the admin. Assigned exams will appear automatically.
            </p>
          </div>
        </div>
        {!needsBatchJoin && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>Close</Button>
        )}
      </div>

      <form onSubmit={joinBatch} className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-3">
          <Input
            label="Search batches"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search or scroll to find your batch"
          />
          <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-background-base p-2">
            {loading ? (
              <p className="px-3 py-4 text-sm text-text-muted">Loading batches...</p>
            ) : visibleBatches.length === 0 ? (
              <div className="flex min-h-40 flex-col items-center justify-center px-3 py-6 text-center text-sm text-text-muted">
                <Search size={24} className="mx-auto mb-2" />
                No matching batches found.
              </div>
            ) : (
              visibleBatches.map(batch => (
                <button
                  key={batch.id}
                  type="button"
                  disabled={batch.is_member}
                  onClick={() => setSelectedBatchId(String(batch.id))}
                  className={cn(
                    "mb-2 flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left transition last:mb-0",
                    String(selectedBatchId) === String(batch.id)
                      ? "border-brand-primary bg-brand-primary/10"
                      : "border-border hover:bg-background-elevated",
                    batch.is_member && "cursor-not-allowed opacity-60"
                  )}
                >
                  <span>
                    <span className="block font-semibold text-text-primary">{batch.name}</span>
                    <span className="block text-xs text-text-muted">{batch.description || "No description"} | {batch.student_count} students</span>
                  </span>
                  <Badge variant={batch.is_member ? "success" : "secondary"}>{batch.is_member ? "Joined" : "Select"}</Badge>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="self-start rounded-lg border border-border bg-background-surface p-4">
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase text-text-muted">Selected batch</p>
            <p className="mt-1 text-lg font-semibold text-text-primary">{selectedBatch?.name || "Choose a batch"}</p>
          </div>
          <Input
            label="Batch code"
            value={joinCode}
            onChange={event => setJoinCode(event.target.value.toUpperCase())}
            placeholder="Enter code"
            autoComplete="off"
            required
          />
          <Button type="submit" variant="primary" className="mt-4 w-full" loading={joining} loadingLabel="Joining...">
            <KeyRound size={17} /> Join Batch
          </Button>
        </div>
      </form>
    </Card>
  );
}

function StudentExamCard({ exam, elapsedSeconds }) {
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const tone = examTone(exam);
  const state = exam.state || tone;
  const secondsUntilStart = Math.max((exam.window?.seconds_until_start || 0) - elapsedSeconds, 0);
  const isReadyNow = exam.status === "active" && secondsUntilStart === 0 && !exam.window?.has_ended;
  const action = exam.action || {};
  const actionLabel = action.ready_label && isReadyNow ? action.ready_label : action.label;
  const startTime = formatDateTime(exam.start_time);
  const endTime = formatDateTime(exam.end_time);

  const toneConfig = {
    active: { variant: "success", color: "border-l-success bg-success/5" },
    result: { variant: "primary", color: "border-l-brand-primary bg-brand-primary/5" },
    upcoming: { variant: "warning", color: "border-l-warning bg-warning/5" },
    closed: { variant: "danger", color: "border-l-danger bg-danger/5" },
    submitted: { variant: "secondary", color: "border-l-border bg-background-elevated/50" }
  };

  const config = toneConfig[tone] || toneConfig.submitted;

  const startExam = async () => {
    if (!action.api_path) return;
    setStarting(true);
    try {
      const { data } = await api.post(action.api_path);
      if (data.message) notify.success(data.message);
      navigate(toRouterPath(data.redirect, "/student"), { replace: false });
    } catch (error) {
      notify.error(error.message || "Could not open exam");
    } finally {
      setStarting(false);
    }
  };

  return (
    <Card className={cn("overflow-hidden transition duration-200 hover:shadow-elevated", config.color)}>
      {/* Header with badge and icon */}
      <div className="flex items-start justify-between gap-3 border-b border-border/50 p-4">
        <div className="flex-1 min-w-0">
          <Badge variant={config.variant} size="sm" className="capitalize">
            {studentStateLabel(state)}
          </Badge>
          <h3 className="mt-2 truncate text-lg font-semibold text-text-primary">{exam.exam_name}</h3>
          <p className="truncate text-sm text-text-secondary">{exam.subject} {exam.set_code && `| Set ${exam.set_code}`}</p>
        </div>
        <FileText size={24} className="shrink-0 text-text-muted" />
      </div>

      {/* Meta grid */}
      <div className="grid grid-cols-2 gap-4 border-b border-border/50 p-4 text-sm">
        <div>
          <p className="text-xs font-semibold text-text-muted">Duration</p>
          <p className="mt-1 font-semibold text-text-primary">{exam.effective_duration_minutes} min</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-text-muted">Questions</p>
          <p className="mt-1 font-semibold text-text-primary">{Number(exam.question_count || 0).toLocaleString()}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-text-muted">Total Marks</p>
          <p className="mt-1 font-semibold text-text-primary">{Number(exam.total_marks || 0).toLocaleString()}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-text-muted">Attempts</p>
          <p className="mt-1 font-semibold text-text-primary">
            {Number(exam.attempt_count || 0).toLocaleString()}
            {exam.attempt_limit > 0 ? `/${exam.attempt_limit}` : "/unlimited"}
          </p>
        </div>
      </div>

      {/* Extra time notice */}
      {exam.extra_time_minutes > 0 && (
        <div className="border-b border-border/50 bg-info/5 px-4 py-2 text-xs font-semibold text-info">
          Extra time: +{exam.extra_time_minutes} minutes approved
        </div>
      )}

      {/* Timeline */}
      <div className="border-b border-border/50 px-4 py-3 text-xs text-text-muted space-y-1">
        {startTime && (
          <div className="flex items-center gap-2">
            <CalendarClock size={14} />
            Starts {startTime}
          </div>
        )}
        {endTime && (
          <div className="flex items-center gap-2">
            <Clock3 size={14} />
            Closes {endTime}
          </div>
        )}
        {secondsUntilStart > 0 && (
          <div className="font-semibold text-text-secondary">
            Starts in <FlipCountdown totalSeconds={secondsUntilStart} />
          </div>
        )}
      </div>

      {/* Result or Session strip */}
      {exam.result ? (
        <div className="flex items-center justify-between gap-3 border-b border-border/50 bg-brand-primary/5 px-4 py-3">
          <Trophy size={18} className="text-brand-primary" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-text-muted">SCORE</p>
            <p className="font-bold text-text-primary">
              {exam.result.total_marks_obtained}/{exam.result.total_marks}
              <span className="ml-2 text-sm text-text-secondary">({exam.result.percentage}%)</span>
            </p>
          </div>
        </div>
      ) : exam.latest_session?.remaining_seconds != null ? (
        <div className="flex items-center justify-between border-b border-border/50 bg-info/5 px-4 py-3 text-sm">
          <span className="font-semibold text-text-secondary">In Progress</span>
          <span className="font-bold text-info">{formatCountdown(exam.latest_session.remaining_seconds)} remaining</span>
        </div>
      ) : null}

      {exam.latest_session?.progress && !exam.result && (
        <div className="border-b border-border/50 px-4 py-3">
          <div className="mb-2 flex justify-between text-xs font-semibold text-text-muted">
            <span>{exam.latest_session.progress.answered_count || 0}/{exam.latest_session.progress.total_questions || 0} answered</span>
            <span>{exam.latest_session.progress.progress_percent || 0}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-background-elevated">
            <div
              className="h-full rounded-full bg-success transition-all duration-300"
              style={{ width: `${Math.max(0, Math.min(Number(exam.latest_session.progress.progress_percent || 0), 100))}%` }}
            />
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col gap-2 p-4">
        {action.disabled ? (
          <>
            {action.message && (
              <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
                {action.message}
              </div>
            )}
            <Button variant="secondary" size="sm" disabled className="w-full">
              {action.label || "Unavailable"}
            </Button>
          </>
        ) : action.method === "post" ? (
          <Button
            type="button"
            variant={tone === "active" ? "success" : "primary"}
            size="sm"
            className="w-full"
            loading={starting}
            loadingLabel="Opening..."
            onClick={startExam}
          >
            {actionIcon(actionLabel)}
            {actionLabel}
          </Button>
        ) : (
          <Button
            as="a"
            variant={action.variant || (tone === "active" ? "success" : "secondary")}
            size="sm"
            href={action.href}
            className="w-full"
          >
            {actionIcon(actionLabel)}
            {actionLabel}
          </Button>
        )}
        {exam.result?.pdf_href && (
          <Button as="a" variant="ghost" size="sm" href={exam.result.pdf_href} className="w-full">
            PDF Report
          </Button>
        )}
      </div>
    </Card>
  );
}

function TeacherDashboard({ dashboard }) {
  const loadDashboard = useAppStore(state => state.loadDashboard);
  const [localExams, setLocalExams] = useState(dashboard?.exams || []);

  useEffect(() => {
    setLocalExams(dashboard?.exams || []);
  }, [dashboard?.exams]);

  const updateExamStatus = async (exam, action) => {
    if (action === "close" && !window.confirm("End this exam? Students will no longer be able to join or submit.")) {
      return;
    }
    try {
      const { data } = await api.post(`/teacher/exams/${exam.id}/status`, { action });
      notify.success(data.message || "Exam updated.");
      setLocalExams(current => current.map(item => (
        item.id === exam.id
          ? { ...item, status: data.exam?.status || (action === "deactivate" ? "draft" : action === "close" ? "closed" : "active") }
          : item
      )));
      loadDashboard();
    } catch (error) {
      notify.error(error.message || "Could not update exam.");
    }
  };

  const exams = localExams;
  const schedule = dashboard?.schedule || {};
  const stats = {
    total: exams.length,
    published: exams.filter(exam => ["active", "published"].includes(exam.status)).length,
    pending: exams.reduce((sum, exam) => sum + Number(exam.pending_review_count || 0), 0),
    enrolled: exams.reduce((sum, exam) => sum + Number(exam.enrolled_count || exam.session_count || 0), 0)
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-text-primary">Teacher Workspace</h1>
          <p className="text-text-secondary">Create, review, and monitor your assessments.</p>
        </div>
        <Button variant="primary" as={Link} to="/teacher/exam/new">
          <Plus size={18} /> New Exam
        </Button>
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={BookOpenCheck} label="Total Exams" value={stats.total} />
        <StatCard icon={CheckCircle2} label="Published Exams" value={stats.published} />
        <StatCard icon={FileText} label="Pending Reviews" value={stats.pending} />
        <StatCard icon={Users} label="Students Enrolled" value={stats.enrolled} />
      </section>

      <DashboardSchedulePanel
        title="Teaching schedule"
        description="Live exams, upcoming windows, and review deadlines from your workspace."
        schedule={schedule}
        role="teacher"
        emptyLabel="No scheduled exams or pending reviews."
      />

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-text-primary">My Exams</h2>
            <Badge variant="purple" size="md">{exams.length}</Badge>
          </div>
          <Button variant="secondary" size="sm" as={Link} to="/teacher/proctoring">
            <Radio size={17} /> Live proctoring
          </Button>
        </div>

        {exams.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {exams.map((exam, index) => (
              <TeacherExamCard exam={exam} key={exam.id} index={index} onStatusChange={updateExamStatus} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={BookOpenCheck}
            heading="No exams yet"
            description="Create your first exam and it will appear here with review and proctoring actions."
            action={{ label: "Create your first exam", href: "/react/teacher/exam/new" }}
          />
        )}
      </section>
    </div>
  );
}

function teacherExamTone(status) {
  if (["active", "published"].includes(status)) return { badge: "success", strip: "bg-success" };
  if (status === "draft") return { badge: "secondary", strip: "bg-text-muted" };
  if (status === "closed") return { badge: "danger", strip: "bg-danger" };
  return { badge: "warning", strip: "bg-warning" };
}

function TeacherExamCard({ exam, index, onStatusChange }) {
  const tone = teacherExamTone(exam.status);
  const submitted = exam.submitted_count ?? exam.session_count ?? 0;
  const pending = exam.pending_review_count ?? 0;
  const enrolled = exam.enrolled_count ?? exam.session_count ?? 0;

  return (
    <Card className="overflow-hidden animate-fade-in-up" style={{ "--stagger-delay": `${index * 50}ms`, animationDelay: `${index * 50}ms` }}>
      <div className={cn("h-1.5", tone.strip)} />
      <div className="grid gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Badge variant={tone.badge}>{exam.status}</Badge>
            <h4 className="mt-3 truncate text-lg font-semibold text-text-primary">{exam.exam_name}</h4>
            <p className="truncate text-sm text-text-secondary">{exam.subject} {exam.set_code ? `| Set ${exam.set_code}` : ""}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <Badge variant="info">{Number(exam.question_count || 0).toLocaleString()} questions</Badge>
          <Badge variant="purple">{Number(enrolled || 0).toLocaleString()} enrolled</Badge>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border border-border bg-background-base p-3">
            <span className="text-xs font-semibold text-text-muted">Submitted</span>
            <strong className="block text-xl text-text-primary">{Number(submitted || 0).toLocaleString()}</strong>
          </div>
          <div className="rounded-md border border-border bg-background-base p-3">
            <span className="text-xs font-semibold text-text-muted">Pending Review</span>
            <strong className="block text-xl text-text-primary">{Number(pending || 0).toLocaleString()}</strong>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" as={Link} to={`/teacher/exam/${exam.id}/edit`}>
            <Edit3 size={16} /> Edit
          </Button>
          {exam.status === "draft" && (
            <Button variant="success" size="sm" onClick={() => onStatusChange(exam, "activate")}>
              <CheckCircle2 size={16} /> Publish
            </Button>
          )}
          {exam.status === "active" && (
            <Button variant="warning" size="sm" onClick={() => onStatusChange(exam, "deactivate")}>
              <DoorOpen size={16} /> Deactivate
            </Button>
          )}
          {exam.status === "active" && (
            <Button variant="danger" size="sm" onClick={() => onStatusChange(exam, "close")}>
              <XCircle size={16} /> End
            </Button>
          )}
          <Button variant="primary" size="sm" as={Link} to={`/teacher/exam/${exam.id}/review`}>
            <FileText size={16} /> Review
          </Button>
          <Button variant="ghost" size="sm" as={Link} to="/teacher/proctoring">
            <Radio size={16} /> Proctor
          </Button>
        </div>
      </div>
    </Card>
  );
}

function AdminOverview({ dashboard }) {
  const stats = dashboard?.stats || {};
  const labels = {
    total_users: "Total Users",
    total_students: "Students",
    total_teachers: "Teachers",
    total_exams: "Total Exams",
    active_exams: "Active Exams",
    submitted_sessions: "Submitted Sessions",
    published_results: "Published Results",
    violations_today: "Violations Today",
    pending_reviews: "Pending Reviews"
  };
  return (
    <div className="cardList">
      <div className="rowBetween">
        <div>
          <h2>Admin Workspace</h2>
          <p>Monitor users, exams, reviews, and live proctoring activity.</p>
        </div>
        <Button variant="primary" size="sm" as={Link} to="/admin/proctoring"><Radio size={18} /> Live proctoring</Button>
      </div>
      <section className="statsGrid">
        {Object.entries(stats).map(([key, value]) => (
          <Card key={key} className="statCard">
            <span>{labels[key] || key.replaceAll("_", " ")}</span>
            <strong>{Number(value || 0).toLocaleString()}</strong>
          </Card>
        ))}
      </section>
    </div>
  );
}

function RoleDashboard({ role, dashboard }) {
  if (role === "student") return <StudentDashboard dashboard={dashboard} />;
  if (role === "teacher") return <TeacherDashboard dashboard={dashboard} />;
  if (role === "admin") return <AdminOverview dashboard={dashboard} />;
  return null;
}

function HomeRoute({ role, settings }) {
  if (role && rolePaths[role]) {
    return <Navigate to={rolePaths[role]} replace />;
  }
  return (
    <PageSuspense label="Loading sign in...">
      <LoginPage settings={settings} />
    </PageSuspense>
  );
}

function ProtectedRoleRoute({ expectedRole, currentRole, dashboard, settings }) {
  if (!currentRole) {
    return <LoginPanel settings={settings} />;
  }
  if (currentRole !== expectedRole) {
    return <Navigate to={rolePaths[currentRole] || "/"} replace />;
  }
  return <RoleDashboard role={expectedRole} dashboard={dashboard} />;
}

function ProtectedExamRoute({ currentRole, settings }) {
  if (!currentRole) {
    return <LoginPanel settings={settings} />;
  }
  if (currentRole !== "student") {
    return <Navigate to={rolePaths[currentRole] || "/"} replace />;
  }
  return (
    <Suspense fallback={<PageLoading title="Loading exam workspace..." />}>
      <ExamInterface />
    </Suspense>
  );
}

function ProtectedTeacherReviewRoute({ currentRole, settings, mode }) {
  if (!currentRole) {
    return <LoginPanel settings={settings} />;
  }
  if (currentRole !== "teacher") {
    return <Navigate to={rolePaths[currentRole] || "/"} replace />;
  }
  return (
    <Suspense fallback={<PageLoading title="Loading review workspace..." variant="reports" />}>
      <TeacherReview mode={mode} />
    </Suspense>
  );
}

function ProtectedProctoringRoute({ currentRole, settings, mode }) {
  if (!currentRole) {
    return <LoginPanel settings={settings} />;
  }
  if (currentRole !== mode) {
    return <Navigate to={rolePaths[currentRole] || "/"} replace />;
  }
  return (
    <Suspense fallback={<PageLoading title="Loading proctoring workspace..." />}>
      <Proctoring mode={mode} />
    </Suspense>
  );
}

export default function App() {
  const { bootstrap, dashboard, error, loading, loadBootstrap, loadDashboard } = useAppStore();
  const location = useLocation();
  const role = bootstrap?.auth?.role;
  const { endedSession, goToLogin } = useSessionWatcher(role);
  useRealtimeBridge(role);
  const [theme, setTheme] = useState(() => {
    try {
      const stored = window.localStorage.getItem("examTheme");
      if (stored === "light" || stored === "dark") return stored;
      return "dark";
    } catch {
      return "dark";
    }
  });
  const [highContrast, setHighContrast] = useState(() => {
    try {
      return window.localStorage.getItem("examHighContrast") === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    loadBootstrap().then(data => {
      if (data?.auth?.role) loadDashboard(data.auth.role);
    });
  }, [loadBootstrap, loadDashboard]);

  useEffect(() => {
    try {
      // transient transition class for smooth theme change
      document.documentElement.classList.add('theme-transition');
      window.setTimeout(() => document.documentElement.classList.remove('theme-transition'), 220);
      window.localStorage.setItem("examTheme", theme);
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.style.colorScheme = 'dark';
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.style.colorScheme = 'light';
      }
    } catch {
      // ignore
    }
  }, [theme]);

  useEffect(() => {
    try {
      document.documentElement.classList.toggle("high-contrast", highContrast);
      window.localStorage.setItem("examHighContrast", String(highContrast));
    } catch {
      // ignore
    }
  }, [highContrast]);

  useEffect(() => {
    const roleClasses = ["role-admin", "role-teacher", "role-student"];
    document.documentElement.classList.remove(...roleClasses);
    if (role) document.documentElement.classList.add(`role-${role}`);
    return () => document.documentElement.classList.remove(...roleClasses);
  }, [role]);

  async function markAllRead() {
    try {
      await api.post("/notifications/mark-read");
    } catch {
      // ignore errors, but attempt to reload bootstrap regardless
    }
    try {
      await loadBootstrap();
    } catch {
      // ignore
    }
  }

  if (loading) {
    return <PageLoading title="Preparing your workspace..." />;
  }

  const routes = (
    <>
      {error && <div className="alert">{error}</div>}
      <Routes>
        <Route path="/" element={<HomeRoute role={role} settings={bootstrap?.settings} />} />
        <Route
          path="/login"
          element={role ? <Navigate to={rolePaths[role] || "/"} replace /> : (
            <PageSuspense label="Loading sign in...">
              <LoginPage />
            </PageSuspense>
          )}
        />
        <Route
          path="/admin/login"
          element={role === "admin" ? <Navigate to="/admin" replace /> : (
            <PageSuspense label="Loading admin portal...">
              <AdminLoginPage />
            </PageSuspense>
          )}
        />
        <Route
          path="/admin/setup"
          element={role === "admin" ? <Navigate to="/admin" replace /> : (
            <PageSuspense label="Loading admin setup...">
              <AdminSetupPage />
            </PageSuspense>
          )}
        />
        <Route
          path="/register"
          element={role ? <Navigate to={rolePaths[role] || "/"} replace /> : (
            <PageSuspense label="Loading registration...">
              <RegisterPage />
            </PageSuspense>
          )}
        />
        <Route
          path="/student"
          element={
            <ProtectedRoleRoute
              expectedRole="student"
              currentRole={role}
              dashboard={dashboard}
              settings={bootstrap?.settings}
            />
          }
        />
        <Route
          path="/student/exams"
          element={
            <ProtectedRoleRoute
              expectedRole="student"
              currentRole={role}
              dashboard={dashboard}
              settings={bootstrap?.settings}
            />
          }
        />
        <Route
          path="/student/results"
          element={role === "student" ? (
            <PageSuspense label="Loading results...">
              <StudentResults />
            </PageSuspense>
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/student/results/:examId"
          element={role === "student" ? (
            <PageSuspense label="Loading results...">
              <StudentResults />
            </PageSuspense>
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/student/history"
          element={role === "student" ? (
            <PageSuspense label="Loading exam history...">
              <StudentHistory />
            </PageSuspense>
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/student/join"
          element={role === "student" ? (
            <PageSuspense label="Loading join form...">
              <StudentJoinPage />
            </PageSuspense>
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/student/precheck/:sessionCode"
          element={role === "student" ? (
            <PageSuspense label="Loading checklist...">
              <StudentPrecheckPage />
            </PageSuspense>
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/student/waiting/:sessionCode"
          element={role === "student" ? (
            <PageSuspense label="Loading waiting room...">
              <StudentWaitingPage />
            </PageSuspense>
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/student/submitted/:sessionCode"
          element={role === "student" ? (
            <PageSuspense label="Loading submission...">
              <StudentSubmittedPage />
            </PageSuspense>
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/exam/:sessionCode"
          element={
            <ProtectedExamRoute
              currentRole={role}
              settings={bootstrap?.settings}
            />
          }
        />
        <Route
          path="/teacher"
          element={
            <ProtectedRoleRoute
              expectedRole="teacher"
              currentRole={role}
              dashboard={dashboard}
              settings={bootstrap?.settings}
            />
          }
        />
        <Route
          path="/teacher/exams"
          element={role === "teacher" ? (
            <TeacherDashboard dashboard={dashboard} />
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/teacher/exam/new"
          element={role === "teacher" ? (
            <PageSuspense label="Loading exam editor...">
              <ExamEditor />
            </PageSuspense>
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/teacher/exams/new"
          element={role === "teacher" ? (
            <PageSuspense label="Loading exam editor...">
              <ExamEditor />
            </PageSuspense>
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/teacher/exam/:examId/edit"
          element={role === "teacher" ? (
            <PageSuspense label="Loading exam editor...">
              <ExamEditor />
            </PageSuspense>
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/teacher/question-bank"
          element={role === "teacher" ? (
            <PageSuspense label="Loading question bank...">
              <TeacherQuestionBank />
            </PageSuspense>
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/teacher/drafts"
          element={role === "teacher" ? (
            <PageSuspense label="Loading drafts...">
              <MyDrafts role="teacher" />
            </PageSuspense>
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/teacher/reports"
          element={role === "teacher" ? (
            <PageSuspense label="Loading reports...">
              <TeacherReports />
            </PageSuspense>
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/teacher/exam/:examId/review"
          element={
            <ProtectedTeacherReviewRoute
              currentRole={role}
              settings={bootstrap?.settings}
              mode="exam"
            />
          }
        />
        <Route
          path="/teacher/session/:sessionId/review"
          element={
            <ProtectedTeacherReviewRoute
              currentRole={role}
              settings={bootstrap?.settings}
              mode="session"
            />
          }
        />
        <Route
          path="/teacher/proctoring"
          element={
            <ProtectedProctoringRoute
              currentRole={role}
              settings={bootstrap?.settings}
              mode="teacher"
            />
          }
        />
        <Route
          path="/admin"
          element={
            role === "admin" ? (
              <PageSuspense label="Loading admin dashboard...">
                <AdminDashboardPage />
              </PageSuspense>
            ) : (
              <LoginPanel settings={bootstrap?.settings} />
            )
          }
        />
        <Route
          path="/admin/users"
          element={role === "admin" ? (
            <PageSuspense label="Loading users...">
              <AdminUserManagement />
            </PageSuspense>
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/admin/groups"
          element={role === "admin" ? (
            <PageSuspense label="Loading groups...">
              <AdminGroups />
            </PageSuspense>
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/admin/drafts"
          element={role === "admin" ? (
            <PageSuspense label="Loading drafts...">
              <MyDrafts role="admin" />
            </PageSuspense>
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/admin/exams"
          element={role === "admin" ? (
            <PageSuspense label="Loading exams...">
              <AdminExams />
            </PageSuspense>
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/admin/reports"
          element={role === "admin" ? (
            <PageSuspense label="Loading reports...">
              <AdminReports />
            </PageSuspense>
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/admin/settings"
          element={role === "admin" ? (
            <PageSuspense label="Loading settings...">
              <AdminSettings />
            </PageSuspense>
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/admin/proctoring"
          element={
            <ProtectedProctoringRoute
              currentRole={role}
              settings={bootstrap?.settings}
              mode="admin"
            />
          }
        />
        <Route
          path="/notifications"
          element={role ? (
            <PageSuspense label="Loading notifications...">
              <NotificationsPage notifications={bootstrap?.notifications} auth={bootstrap?.auth} onMarkAllRead={markAllRead} />
            </PageSuspense>
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/profile"
          element={role ? (
            <PageSuspense label="Loading profile...">
              <AccountSettings auth={bootstrap?.auth} mode="profile" />
            </PageSuspense>
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/settings"
          element={role ? (
            <PageSuspense label="Loading settings...">
              <AccountSettings auth={bootstrap?.auth} mode="settings" />
            </PageSuspense>
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        {["admin", "teacher", "student"].map(accountRole => (
          <Route
            key={`${accountRole}-profile`}
            path={`/${accountRole}/profile`}
            element={role === accountRole ? (
              <PageSuspense label="Loading profile...">
                <AccountSettings auth={bootstrap?.auth} mode="profile" />
              </PageSuspense>
            ) : (
              <LoginPanel settings={bootstrap?.settings} />
            )}
          />
        ))}
        <Route
          path="/student/settings"
          element={role === "student" ? (
            <PageSuspense label="Loading settings...">
              <AccountSettings auth={bootstrap?.auth} mode="settings" />
            </PageSuspense>
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/teacher/settings"
          element={role === "teacher" ? (
            <PageSuspense label="Loading settings...">
              <AccountSettings auth={bootstrap?.auth} mode="settings" />
            </PageSuspense>
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="*"
          element={(
            <PageSuspense label="Loading page...">
              <NotFoundPage />
            </PageSuspense>
          )}
        />
      </Routes>
    </>
  );

  const sessionEndedOverlay = endedSession ? (
    <SessionEndedOverlay role={endedSession.role} onLogin={goToLogin} />
  ) : null;

  if (!role || location.pathname.startsWith("/exam/")) {
    return (
      <>
        {routes}
        {sessionEndedOverlay}
      </>
    );
  }

  return (
    <>
      <Shell
        platformName={bootstrap?.settings?.platform_name}
        platformLogoUrl={bootstrap?.settings?.logo_url}
        auth={bootstrap?.auth}
        notifications={bootstrap?.notifications}
        theme={theme}
        highContrast={highContrast}
        onToggleTheme={() => setTheme(current => (current === "dark" ? "light" : "dark"))}
        onToggleContrast={() => setHighContrast(current => !current)}
        onMarkAllRead={markAllRead}
      >
        {routes}
      </Shell>
      {sessionEndedOverlay}
    </>
  );
}
