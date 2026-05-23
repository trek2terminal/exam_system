import { lazy, Suspense, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  Bell,
  BookOpenCheck,
  CalendarClock,
  CheckCircle2,
  Clock3,
  DoorOpen,
  FileText,
  KeyRound,
  LogIn,
  Play,
  Radio,
  Trophy
} from "lucide-react";
import { PageLayout } from "./components/layout/PageLayout";
import { Badge, Button, Card, StatCard } from "./components/ui";
import { cn } from "./components/ui/utils";
import { useAppStore } from "./store/appStore";
import { api } from "./services/api";

const ExamInterface = lazy(() => import("./ExamInterface.jsx"));
const TeacherReview = lazy(() => import("./TeacherReview.jsx"));
const Proctoring = lazy(() => import("./Proctoring.jsx"));

// Page Components
const StudentResults = lazy(() => import("./pages/StudentResults.jsx"));
const LoginPage = lazy(() => import("./pages/LoginPage.jsx"));
const RegisterPage = lazy(() => import("./pages/RegisterPage.jsx"));
const ExamEditor = lazy(() => import("./pages/ExamEditor.jsx"));
const AdminDashboardPage = lazy(() => import("./pages/AdminDashboard.jsx"));
const AdminUserManagement = lazy(() => import("./pages/AdminUserManagement.jsx"));
const AdminSettings = lazy(() => import("./pages/AdminSettings.jsx"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage.jsx"));

const loginLinks = [
  { label: "Admin", href: "/admin/login" },
  { label: "Teacher", href: "/teacher/login" },
  { label: "Student", href: "/student/login" }
];

const rolePaths = {
  admin: "/admin",
  teacher: "/teacher",
  student: "/student"
};

function formatCountdown(totalSeconds) {
  const seconds = Math.max(Math.floor(totalSeconds || 0), 0);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString([], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function examTone(exam) {
  if (exam.result) return "result";
  if (exam.latest_session?.status === "active") return "active";
  if (exam.latest_session?.status && ["submitted", "evaluated", "terminated", "auto_submitted"].includes(exam.latest_session.status)) {
    return "submitted";
  }
  if (exam.window?.time_state === "not_started") return "upcoming";
  if (exam.window?.has_ended || exam.status === "closed") return "closed";
  return exam.status || "draft";
}

function actionIcon(label) {
  const normalized = (label || "").toLowerCase();
  if (normalized.includes("view")) return <CheckCircle2 size={18} />;
  if (normalized.includes("waiting")) return <DoorOpen size={18} />;
  if (normalized.includes("next")) return <Play size={18} />;
  if (normalized.includes("start") || normalized.includes("resume")) return <Play size={18} />;
  return <FileText size={18} />;
}

function Shell({ children, platformName, auth, notifications, theme, onToggleTheme, onMarkAllRead }) {
  // layout handled by PageLayout
  return (
    <PageLayout auth={auth} platformName={platformName} notifications={notifications} theme={theme} onToggleTheme={onToggleTheme} onMarkAllRead={onMarkAllRead}>
      {children}
    </PageLayout>
  );
}

function PageSuspense({ children, label = "Loading workspace..." }) {
  return (
    <Suspense fallback={<div className="loadingScreen">{label}</div>}>
      {children}
    </Suspense>
  );
}

function LoginPanel({ settings }) {
  return (
    <section className="loginPanel">
      <div>
        <span className="eyebrow">Local LAN and hosted ready</span>
        <h2>{settings?.welcome_message || "Choose your workspace"}</h2>
        <p>Use the current Flask login while the React migration grows around the live APIs.</p>
      </div>
      <div className="loginLinks">
        {loginLinks.map(item => (
          <a key={item.label} href={item.href}>
            <LogIn size={18} />
            {item.label} Login
          </a>
        ))}
      </div>
    </section>
  );
}

function StudentDashboard({ dashboard }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const stats = dashboard?.stats || {};
  const exams = dashboard?.exams || [];
  const student = dashboard?.student || {};

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setElapsedSeconds(current => current + 1);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const getTimeBasedGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  return (
    <div className="space-y-6">
      {/* Greeting Banner */}
      <div className="relative overflow-hidden rounded-card border border-border bg-gradient-to-br from-brand-primary/10 via-background-surface to-background-base p-6 shadow-card md:p-8">
        <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-brand-primary/5 blur-3xl" />
        <div className="absolute -bottom-8 -left-8 h-24 w-24 rounded-full bg-info/5 blur-3xl" />
        <div className="relative z-10">
          <p className="text-sm font-semibold uppercase text-text-muted">Your exam space</p>
          <h1 className="mt-2 text-3xl font-bold text-text-primary md:text-4xl">
            {getTimeBasedGreeting()}, {student.name || "Student"}
          </h1>
          <p className="mt-2 text-lg text-text-secondary italic">{dashboard?.quote?.text || dashboard?.quote || "One calm question at a time."}</p>
          <div className="mt-4 flex items-center gap-6">
            <div>
              <p className="text-xs font-semibold text-text-muted">ROLL NUMBER</p>
              <p className="text-xl font-bold text-text-primary">{student.roll_no || "-"}</p>
            </div>
            <div className="h-12 border-l border-border" />
            <div>
              <p className="text-xs font-semibold text-text-muted">ASSIGNED EXAMS</p>
              <p className="text-xl font-bold text-text-primary">{stats.assigned || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Announcement Banner */}
      {dashboard?.announcement_message && (
        <div className="flex items-start gap-4 rounded-card border border-warning/30 bg-warning/5 p-4 md:p-5">
          <Bell size={20} className="mt-1 shrink-0 text-warning" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-text-primary">{dashboard.announcement_message}</p>
          </div>
          <button
            type="button"
            className="shrink-0 text-text-muted transition hover:text-text-primary"
            onClick={e => e.currentTarget.parentElement.remove()}
            aria-label="Dismiss announcement"
          >
            x
          </button>
        </div>
      )}

      {/* Stats Row */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={BookOpenCheck} label="Assigned" value={stats.assigned || 0} variant="default" />
        <StatCard icon={Play} label="Available" value={stats.available || 0} variant="default" />
        <StatCard icon={Clock3} label="Upcoming" value={stats.upcoming || 0} variant="default" />
        <StatCard icon={Trophy} label="Results" value={stats.published_results || 0} variant="default" />
      </section>

      {/* Exams Section */}
      <div>
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-text-muted">EXAMS</p>
            <h2 className="text-2xl font-bold text-text-primary">Assigned exams</h2>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" as={Link} to={dashboard?.links?.results || "/student/results"}>
              <Trophy size={16} />
              <span className="hidden sm:inline">Results</span>
            </Button>
            <Button variant="primary" size="sm" as="a" href={dashboard?.links?.join_exam || "/student/join"}>
              <KeyRound size={16} />
              <span className="hidden sm:inline">Access code</span>
            </Button>
          </div>
        </div>

        {exams.length === 0 ? (
          <div className="rounded-card border border-border bg-background-surface p-12 text-center shadow-card">
            <CalendarClock size={40} className="mx-auto mb-4 text-text-muted" />
            <h3 className="text-lg font-semibold text-text-primary">No assigned exams yet</h3>
            <p className="mt-2 text-text-secondary">Your assigned exams will appear here. You can still join an exam with an access code if your teacher shared one.</p>
            <Button variant="primary" size="md" as="a" href={dashboard?.links?.join_exam || "/student/join"} className="mt-4">
              <KeyRound size={16} /> Open exam lobby
            </Button>
          </div>
        ) : (
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {exams.map((exam, index) => (
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

function StudentExamCard({ exam, elapsedSeconds }) {
  const tone = examTone(exam);
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

  return (
    <Card className={cn("overflow-hidden transition duration-200 hover:shadow-elevated", config.color)}>
      {/* Header with badge and icon */}
      <div className="flex items-start justify-between gap-3 border-b border-border/50 p-4">
        <div className="flex-1 min-w-0">
          <Badge variant={config.variant} size="sm" className="capitalize">
            {tone.replace(/_/g, " ")}
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
          <p className="mt-1 font-semibold text-text-primary">{exam.question_count}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-text-muted">Total Marks</p>
          <p className="mt-1 font-semibold text-text-primary">{exam.total_marks}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-text-muted">Attempts</p>
          <p className="mt-1 font-semibold text-text-primary">
            {exam.attempt_count}
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
            Starts in {formatCountdown(secondsUntilStart)}
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

      {/* Action buttons */}
      <div className="flex flex-col gap-2 p-4">
        {action.disabled ? (
          <Button variant="secondary" size="sm" disabled className="w-full">
            {action.label || "Unavailable"}
          </Button>
        ) : action.method === "post" ? (
          <form method="post" action={action.href} className="contents">
            <input type="hidden" name="ui" value="react" />
            <Button type="submit" variant={tone === "active" ? "success" : "primary"} size="sm" className="w-full">
              {actionIcon(actionLabel)}
              {actionLabel}
            </Button>
          </form>
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
  return (
    <div className="cardList">
      <div className="rowBetween">
        <div>
          <span className="eyebrow">Teacher workspace</span>
          <h2>My exams</h2>
        </div>
        <Button variant="primary" size="sm" as={Link} to="/teacher/proctoring"><Radio size={18} /> Live proctoring</Button>
      </div>
      {(dashboard?.exams || []).map(exam => (
        <Card key={exam.id} className="examCard">
          <div>
            <Badge variant={exam.status === "active" ? "success" : "secondary"} size="sm">{exam.status}</Badge>
            <h3>{exam.exam_name}</h3>
            <p>{exam.question_count} questions | {exam.session_count} sessions</p>
          </div>
          <div className="actionRow">
            <strong>{exam.total_marks} marks</strong>
            <Button variant="primary" size="sm" as={Link} to={`/teacher/exam/${exam.id}/review`}>Review</Button>
            <Button as="a" variant="ghost" size="sm" href={exam.flask_results_url}>Classic</Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function AdminOverview({ dashboard }) {
  const stats = dashboard?.stats || {};
  return (
    <div className="cardList">
      <div className="rowBetween">
        <div>
          <span className="eyebrow">Admin overview</span>
          <h2>Platform health</h2>
        </div>
        <Button variant="primary" size="sm" as={Link} to="/admin/proctoring"><Radio size={18} /> Live proctoring</Button>
      </div>
      <section className="statsGrid">
        {Object.entries(stats).map(([key, value]) => (
          <Card key={key} className="statCard">
            <span>{key.replaceAll("_", " ")}</span>
            <strong>{value}</strong>
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

function NotificationCenter({ notifications, onMarkAllRead }) {
  const items = notifications?.recent || notifications?.items || [];
  return (
    <div className="cardList">
      <div className="rowBetween">
        <div>
          <span className="eyebrow">Notifications</span>
          <h2>Unread notifications</h2>
        </div>
        <Button variant="secondary" size="sm" disabled={(notifications?.unread_count || 0) === 0} onClick={onMarkAllRead}>
          Mark all as read
        </Button>
      </div>
      <Card className="p-5">
        {items.length > 0 ? (
          <div className="grid gap-3">
            {items.map(item => (
              <div className="rounded-lg border border-border bg-background-base p-4" key={item.id || item.message}>
                <Badge variant={item.type === "result_published" ? "success" : "info"} size="sm" dot>
                  {item.type || "notice"}
                </Badge>
                <p className="mt-2 font-semibold text-text-primary">{item.message}</p>
                {item.created_at && <p className="mb-0 text-sm text-text-muted">{formatDateTime(item.created_at)}</p>}
              </div>
            ))}
          </div>
        ) : (
          <div className="emptyState compact">
            <Bell size={34} />
            <h3>No unread notifications</h3>
            <p>You are all caught up.</p>
          </div>
        )}
      </Card>
    </div>
  );
}

function PlaceholderPage({ title, eyebrow, description }) {
  return (
    <div className="cardList">
      <div>
        <span className="eyebrow">{eyebrow || "Workspace"}</span>
        <h2>{title}</h2>
      </div>
      <Card className="emptyState">
        <BookOpenCheck size={34} />
        <h3>{title}</h3>
        <p>{description || "This React workspace is ready for the next migration pass. Existing Flask pages and API endpoints remain unchanged."}</p>
      </Card>
    </div>
  );
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
    <Suspense fallback={<div className="loadingScreen">Loading exam workspace...</div>}>
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
    <Suspense fallback={<div className="loadingScreen">Loading review workspace...</div>}>
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
    <Suspense fallback={<div className="loadingScreen">Loading proctoring workspace...</div>}>
      <Proctoring mode={mode} />
    </Suspense>
  );
}

export default function App() {
  const { bootstrap, dashboard, error, loading, loadBootstrap, loadDashboard } = useAppStore();
  const location = useLocation();
  const role = bootstrap?.auth?.role;
  const [theme, setTheme] = useState(() => {
    try {
      const stored = window.localStorage.getItem("examTheme");
      if (stored) return stored;
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      return prefersDark ? 'dark' : 'light';
    } catch {
      return 'light';
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
      window.setTimeout(() => document.documentElement.classList.remove('theme-transition'), 300);
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
    return <div className="loadingScreen">Preparing your workspace...</div>;
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
          path="/student/history"
          element={role === "student" ? (
            <PlaceholderPage title="Exam History" eyebrow="Student workspace" description="Completed attempts and submission history will appear here as the React migration expands." />
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
            <PlaceholderPage title="Question Bank" eyebrow="Teacher workspace" description="Question bank management is ready to be moved from the classic teacher tools into React." />
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/teacher/reports"
          element={role === "teacher" ? (
            <PlaceholderPage title="Reports" eyebrow="Teacher workspace" description="Exam analytics and exports can be connected here without changing existing API routes." />
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
            <PlaceholderPage title="Groups" eyebrow="Admin workspace" description="Group assignment and bulk student workflows will live here." />
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/admin/exams"
          element={role === "admin" ? (
            <PlaceholderPage title="Exams" eyebrow="Admin workspace" description="Cross-platform exam administration can be connected here while teacher exam creation remains unchanged." />
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/admin/reports"
          element={role === "admin" ? (
            <PlaceholderPage title="Reports" eyebrow="Admin workspace" description="Participation, violations, and review reports can be added here using the existing reporting data." />
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
            <NotificationCenter notifications={bootstrap?.notifications} onMarkAllRead={markAllRead} />
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/profile"
          element={role ? (
            <PlaceholderPage title="Profile" eyebrow="Account" description="Profile management can be connected here while existing login/logout behavior remains in Flask." />
          ) : (
            <LoginPanel settings={bootstrap?.settings} />
          )}
        />
        <Route
          path="/settings"
          element={role ? (
            <PlaceholderPage title="Settings" eyebrow="Account" description="User preferences and account settings can be migrated here next." />
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

  if (!role || location.pathname.startsWith("/exam/")) {
    return routes;
  }

  return (
    <Shell
      platformName={bootstrap?.settings?.platform_name}
      auth={bootstrap?.auth}
      notifications={bootstrap?.notifications}
      theme={theme}
      onToggleTheme={() => setTheme(current => (current === "dark" ? "light" : "dark"))}
      onMarkAllRead={markAllRead}
    >
      {routes}
    </Shell>
  );
}
