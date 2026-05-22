import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import {
  Bell,
  BookOpenCheck,
  CalendarClock,
  Gauge,
  LogIn,
  Moon,
  ShieldCheck,
  Sparkles,
  Users
} from "lucide-react";
import { useAppStore } from "./store/appStore";

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
  return (
    <section className="contentGrid">
      <article className="heroCard">
        <Sparkles size={24} />
        <h2>Good luck, {dashboard?.student?.name || "student"}.</h2>
        <p>{dashboard?.quote?.text || dashboard?.quote || "One calm question at a time."}</p>
      </article>
      <div className="cardList">
        {(dashboard?.exams || []).map(exam => (
          <article className="examCard" key={exam.exam_id}>
            <div>
              <span className={`status ${exam.status}`}>{exam.status}</span>
              <h3>{exam.exam_name}</h3>
              <p>{exam.subject} | Set {exam.set_code}</p>
            </div>
            <div className="metric">
              <CalendarClock size={18} />
              {exam.latest_session?.status || "not started"}
            </div>
          </article>
        ))}
      </div>
    </section>
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
          <strong>{exam.total_marks} marks</strong>
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
