import { lazy, Suspense, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import {
  Bell,
  BookOpenCheck,
  CalendarClock,
  CheckCircle2,
  Clock3,
  DoorOpen,
  FileText,
  Gauge,
  KeyRound,
  LogIn,
  Moon,
  Play,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users
} from "lucide-react";
import { useAppStore } from "./store/appStore";

const ExamInterface = lazy(() => import("./ExamInterface.jsx"));
const TeacherReview = lazy(() => import("./TeacherReview.jsx"));

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

function Shell({ children, platformName, auth, notifications, theme, onToggleTheme }) {
  const rolePath = rolePaths[auth?.role] || "/";
  const workspaceHref = auth?.role ? `/${auth.role}/dashboard` : "/student/login";
  const peopleHref = auth?.role === "admin" ? "/admin/users" : workspaceHref;
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark"><ShieldCheck size={22} /></div>
          <div>
            <strong>{platformName || "Exam Platform"}</strong>
            <span>Focused assessment space</span>
          </div>
        </div>
        <nav>
          <Link className="active" to={rolePath}><Gauge size={18} /> Overview</Link>
          <a href={workspaceHref}><BookOpenCheck size={18} /> Exams</a>
          <a href={peopleHref}><Users size={18} /> People</a>
          <a href={workspaceHref}><Bell size={18} /> Alerts</a>
        </nav>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <span className="eyebrow">{auth?.role ? `${auth.role} workspace` : "Welcome"}</span>
            <h1>{auth?.student_name || auth?.teacher_name || auth?.admin_name || "Exam Platform"}</h1>
          </div>
          <div className="topbarActions">
            <button className="iconButton badgeButton" type="button" aria-label="Notifications">
              <Bell size={18} />
              {notifications?.unread_count > 0 && <span>{notifications.unread_count}</span>}
            </button>
            <button className="iconButton" type="button" aria-label="Toggle theme" onClick={onToggleTheme}>
              {theme === "dark" ? <Sparkles size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>
        {children}
      </main>
    </div>
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

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setElapsedSeconds(current => current + 1);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <div className="studentWorkspace">
      {dashboard?.announcement_message && (
        <section className="announcement">
          <Bell size={18} />
          <span>{dashboard.announcement_message}</span>
        </section>
      )}

      <section className="studentHero">
        <div>
          <span className="eyebrow">Your exam space</span>
          <h2>{dashboard?.student?.greeting || "Welcome"}, {dashboard?.student?.name || "student"}.</h2>
          <p>{dashboard?.quote?.text || dashboard?.quote || "One calm question at a time."}</p>
        </div>
        <div className="studentIdentity">
          <span>Roll No</span>
          <strong>{dashboard?.student?.roll_no || "-"}</strong>
          <small>{stats.assigned || 0} assigned exams</small>
        </div>
      </section>

      <section className="studentStats">
        <article><BookOpenCheck size={18} /><span>Assigned</span><strong>{stats.assigned || 0}</strong></article>
        <article><Play size={18} /><span>Available</span><strong>{stats.available || 0}</strong></article>
        <article><Clock3 size={18} /><span>Upcoming</span><strong>{stats.upcoming || 0}</strong></article>
        <article><Trophy size={18} /><span>Results</span><strong>{stats.published_results || 0}</strong></article>
      </section>

      <div className="rowBetween">
        <div>
          <span className="eyebrow">My exams</span>
          <h2>Assigned exams</h2>
        </div>
        <div className="actionRow">
          <a className="button secondary" href={dashboard?.links?.results || "/student/results"}>
            <Trophy size={18} /> Results
          </a>
          <a className="button primary" href={dashboard?.links?.join_exam || "/student/join"}>
            <KeyRound size={18} /> Use access code
          </a>
        </div>
      </div>

      {exams.length === 0 ? (
        <section className="emptyState">
          <CalendarClock size={34} />
          <h3>No assigned exams yet</h3>
          <p>Your assigned exams will appear here. You can still join an exam with an access code if your teacher shared one.</p>
          <a className="button primary" href={dashboard?.links?.join_exam || "/student/join"}>
            <KeyRound size={18} /> Open exam lobby
          </a>
        </section>
      ) : (
        <section className="studentExamGrid">
          {exams.map(exam => (
            <StudentExamCard key={exam.exam_id} exam={exam} elapsedSeconds={elapsedSeconds} />
          ))}
        </section>
      )}
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

  return (
    <article className={`studentExamCard ${tone}`}>
      <div className="examCardHeader">
        <div>
          <span className={`status ${tone}`}>{tone.replace("_", " ")}</span>
          <h3>{exam.exam_name}</h3>
          <p>{exam.subject} | Set {exam.set_code}</p>
        </div>
        <div className="examIcon"><FileText size={22} /></div>
      </div>

      <div className="examMetaGrid">
        <div><span>Duration</span><strong>{exam.effective_duration_minutes} min</strong></div>
        <div><span>Marks</span><strong>{exam.total_marks}</strong></div>
        <div><span>Questions</span><strong>{exam.question_count}</strong></div>
        <div>
          <span>Attempts</span>
          <strong>{exam.attempt_count}{exam.attempt_limit > 0 ? `/${exam.attempt_limit}` : "/Unlimited"}</strong>
        </div>
      </div>

      {exam.extra_time_minutes > 0 && (
        <div className="softNote">Includes +{exam.extra_time_minutes} minutes approved extra time.</div>
      )}

      <div className="examTimeline">
        {startTime && <span><CalendarClock size={15} /> Starts {startTime}</span>}
        {endTime && <span><Clock3 size={15} /> Closes {endTime}</span>}
        {secondsUntilStart > 0 && <strong>Starts in {formatCountdown(secondsUntilStart)}</strong>}
      </div>

      {exam.result ? (
        <div className="resultStrip">
          <Trophy size={18} />
          <strong>{exam.result.total_marks_obtained} / {exam.result.total_marks}</strong>
          <span>{exam.result.percentage}%</span>
        </div>
      ) : (
        <div className="sessionStrip">
          <span>{exam.latest_session?.status || "not started"}</span>
          {exam.latest_session?.remaining_seconds != null && (
            <strong>{formatCountdown(exam.latest_session.remaining_seconds)} remaining</strong>
          )}
        </div>
      )}

      <div className="examActions">
        {action.disabled ? (
          <button className="button secondary" type="button" disabled>{action.label || "Unavailable"}</button>
        ) : action.method === "post" ? (
          <form method="post" action={action.href}>
            <input type="hidden" name="ui" value="react" />
            <button className="button primary" type="submit">
              {actionIcon(actionLabel)}
              {actionLabel}
            </button>
          </form>
        ) : (
          <a className={`button ${action.variant || "secondary"}`} href={action.href}>
            {actionIcon(actionLabel)}
            {actionLabel}
          </a>
        )}
        {exam.result?.pdf_href && (
          <a className="button quiet" href={exam.result.pdf_href}>PDF</a>
        )}
      </div>
    </article>
  );
}

function TeacherDashboard({ dashboard }) {
  return (
    <section className="cardList">
      {(dashboard?.exams || []).map(exam => (
        <article className="examCard" key={exam.id}>
          <div>
            <span className={`status ${exam.status}`}>{exam.status}</span>
            <h3>{exam.exam_name}</h3>
            <p>{exam.question_count} questions | {exam.session_count} sessions</p>
          </div>
          <div className="actionRow">
            <strong>{exam.total_marks} marks</strong>
            <Link className="button primary" to={`/teacher/exam/${exam.id}/review`}>Review</Link>
            <a className="button quiet" href={exam.flask_results_url}>Classic</a>
          </div>
        </article>
      ))}
    </section>
  );
}

function AdminDashboard({ dashboard }) {
  const stats = dashboard?.stats || {};
  return (
    <section className="statsGrid">
      {Object.entries(stats).map(([key, value]) => (
        <article className="statCard" key={key}>
          <span>{key.replaceAll("_", " ")}</span>
          <strong>{value}</strong>
        </article>
      ))}
    </section>
  );
}

function RoleDashboard({ role, dashboard }) {
  if (role === "student") return <StudentDashboard dashboard={dashboard} />;
  if (role === "teacher") return <TeacherDashboard dashboard={dashboard} />;
  if (role === "admin") return <AdminDashboard dashboard={dashboard} />;
  return null;
}

function HomeRoute({ role, settings }) {
  if (role && rolePaths[role]) {
    return <Navigate to={rolePaths[role]} replace />;
  }
  return <LoginPanel settings={settings} />;
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

export default function App() {
  const { bootstrap, dashboard, error, loading, loadBootstrap, loadDashboard } = useAppStore();
  const role = bootstrap?.auth?.role;
  const [theme, setTheme] = useState(() => window.localStorage.getItem("examTheme") || "light");

  useEffect(() => {
    loadBootstrap().then(data => {
      if (data?.auth?.role) loadDashboard(data.auth.role);
    });
  }, [loadBootstrap, loadDashboard]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("examTheme", theme);
  }, [theme]);

  if (loading) {
    return <div className="loadingScreen">Preparing your workspace...</div>;
  }

  return (
    <Shell
      platformName={bootstrap?.settings?.platform_name}
      auth={bootstrap?.auth}
      notifications={bootstrap?.notifications}
      theme={theme}
      onToggleTheme={() => setTheme(current => (current === "dark" ? "light" : "dark"))}
    >
      {error && <div className="alert">{error}</div>}
      <Routes>
        <Route path="/" element={<HomeRoute role={role} settings={bootstrap?.settings} />} />
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
          path="/admin"
          element={
            <ProtectedRoleRoute
              expectedRole="admin"
              currentRole={role}
              dashboard={dashboard}
              settings={bootstrap?.settings}
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
