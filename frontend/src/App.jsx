import { useEffect } from "react";
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

function Shell({ children, platformName, auth }) {
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
          <a className="active"><Gauge size={18} /> Overview</a>
          <a><BookOpenCheck size={18} /> Exams</a>
          <a><Users size={18} /> People</a>
          <a><Bell size={18} /> Alerts</a>
        </nav>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <span className="eyebrow">{auth?.role ? `${auth.role} workspace` : "Welcome"}</span>
            <h1>{auth?.student_name || auth?.teacher_name || auth?.admin_name || "Exam Platform"}</h1>
          </div>
          <button className="iconButton" type="button" aria-label="Theme">
            <Moon size={18} />
          </button>
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

export default function App() {
  const { bootstrap, dashboard, error, loading, loadBootstrap, loadDashboard } = useAppStore();
  const role = bootstrap?.auth?.role;

  useEffect(() => {
    loadBootstrap().then(data => {
      if (data?.auth?.role) loadDashboard(data.auth.role);
    });
  }, [loadBootstrap, loadDashboard]);

  if (loading) {
    return <div className="loadingScreen">Preparing your workspace...</div>;
  }

  return (
    <Shell platformName={bootstrap?.settings?.platform_name} auth={bootstrap?.auth}>
      {error && <div className="alert">{error}</div>}
      {!role ? (
        <LoginPanel settings={bootstrap?.settings} />
      ) : (
        <RoleDashboard role={role} dashboard={dashboard} />
      )}
    </Shell>
  );
}
