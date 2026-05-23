import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, BookOpenCheck, DatabaseBackup, Eye, Plus, Upload, Users } from "lucide-react";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis
} from "recharts";
import { Badge, Button, Card, StatCard } from "../components/ui";
import { api } from "../services/api";
import { notify } from "../components/ui/Toast";

const donutColors = {
  draft: "rgb(var(--color-warning))",
  published: "rgb(var(--color-success))",
  active: "rgb(var(--color-success))",
  closed: "rgb(var(--color-danger))",
  archived: "rgb(var(--color-text-muted))"
};

function useChartTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    const observer = new window.MutationObserver(() => {
      setDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return dark
    ? {
      axis: "#cbd5e1",
      grid: "#334155",
      tooltipBg: "#1e293b",
      tooltipBorder: "#334155",
      tooltipText: "#f8fafc"
    }
    : {
      axis: "#475569",
      grid: "#e2e8f0",
      tooltipBg: "#ffffff",
      tooltipBorder: "#e2e8f0",
      tooltipText: "#0f172a"
    };
}

function normalizeTrend(rawTrend, stats) {
  if (Array.isArray(rawTrend) && rawTrend.length > 0) {
    return rawTrend.map((item, index) => ({
      day: item.day || item.label || `Day ${index + 1}`,
      participants: Number(item.participants ?? item.count ?? item.value ?? 0)
    }));
  }

  const total = Number(stats.submitted_sessions || stats.active_exams || 0);
  return Array.from({ length: 7 }, (_, index) => ({
    day: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][index],
    participants: Math.max(0, Math.round((total / 7) * (index + 1) * 0.45))
  }));
}

function normalizeStatus(rawStatus, stats) {
  if (Array.isArray(rawStatus) && rawStatus.length > 0) {
    return rawStatus.map(item => ({
      name: item.name || item.status || item.label,
      value: Number(item.value ?? item.count ?? 0)
    }));
  }
  if (rawStatus && typeof rawStatus === "object") {
    return Object.entries(rawStatus).map(([name, value]) => ({ name, value: Number(value || 0) }));
  }
  return [
    { name: "active", value: Number(stats.active_exams || 0) },
    { name: "published", value: Number(stats.published_results || 0) },
    { name: "closed", value: Math.max(Number(stats.total_exams || 0) - Number(stats.active_exams || 0), 0) },
    { name: "draft", value: 0 }
  ].filter(item => item.value > 0 || item.name === "draft");
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function AdminDashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const chartTheme = useChartTheme();

  const loadDashboard = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/dashboard");
      setDashboard(data);
    } catch {
      notify.error("Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const stats = useMemo(() => dashboard?.stats || {}, [dashboard?.stats]);
  const participationTrend = useMemo(() => normalizeTrend(dashboard?.participation_trend, stats), [dashboard?.participation_trend, stats]);
  const statusDistribution = useMemo(() => normalizeStatus(dashboard?.status_distribution, stats), [dashboard?.status_distribution, stats]);
  const recentActivity = dashboard?.recent_activity || [];
  const suspiciousStudents = dashboard?.suspicious_students || [];

  if (loading) return <Card className="p-8 text-center text-text-muted">Loading dashboard...</Card>;
  if (!dashboard) return <Card className="p-8 text-center text-danger">Failed to load dashboard data</Card>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase text-text-muted">Admin overview</p>
          <h1 className="text-3xl font-bold text-text-primary">Platform Health</h1>
          <p className="mt-1 text-text-secondary">Live role counts, exam activity, alerts, and report shortcuts.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" size="sm" as="a" href="/react/admin/users">
            <Plus size={16} /> Create Teacher
          </Button>
          <Button variant="secondary" size="sm" as="a" href="/admin/users?role=student">
            <Upload size={16} /> Import Students
          </Button>
          <Button variant="secondary" size="sm" as="a" href="/admin/violations">
            <AlertTriangle size={16} /> View Violations
          </Button>
          <Button variant="secondary" size="sm" as="a" href="/react/admin/settings">
            <DatabaseBackup size={16} /> Backup Database
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
        <StatCard icon={Users} label="Total Users" value={stats.total_users || 0} />
        <StatCard icon={Users} label="Teachers" value={stats.total_teachers || 0} />
        <StatCard icon={Users} label="Students" value={stats.total_students || 0} />
        <StatCard icon={BookOpenCheck} label="Active Exams" value={stats.active_exams || 0} />
        <StatCard icon={AlertTriangle} label="Violations Today" value={stats.violations_today || 0} variant="danger" />
        <StatCard icon={BarChart3} label="Pending Reviews" value={stats.pending_reviews || 0} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-text-primary">Exam Participation</h2>
                <p className="text-sm text-text-secondary">Last 7 days, using API data when available.</p>
              </div>
              <Badge variant="info">7 days</Badge>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={participationTrend} margin={{ top: 12, right: 16, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
                  <XAxis dataKey="day" tick={{ fill: chartTheme.axis, fontSize: 12 }} axisLine={{ stroke: chartTheme.grid }} tickLine={false} />
                  <YAxis tick={{ fill: chartTheme.axis, fontSize: 12 }} axisLine={{ stroke: chartTheme.grid }} tickLine={false} />
                  <RechartsTooltip
                    contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 12, color: chartTheme.tooltipText }}
                    labelStyle={{ color: chartTheme.tooltipText }}
                  />
                  <Line type="monotone" dataKey="participants" stroke="rgb(var(--color-brand-primary))" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-text-primary">Exam Status Distribution</h2>
                <p className="text-sm text-text-secondary">Draft, published/active, closed, and archived mix.</p>
              </div>
              <Badge variant="purple">{statusDistribution.reduce((sum, item) => sum + Number(item.value || 0), 0)} exams</Badge>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusDistribution} dataKey="value" nameKey="name" innerRadius={70} outerRadius={100} paddingAngle={3}>
                    {statusDistribution.map(item => (
                      <Cell key={item.name} fill={donutColors[item.name] || "rgb(var(--color-brand-primary))"} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 12, color: chartTheme.tooltipText }}
                    labelStyle={{ color: chartTheme.tooltipText }}
                  />
                  <Legend wrapperStyle={{ color: chartTheme.axis }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        <Card className="flex min-h-96 flex-col p-5">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-text-primary">Recent Activity</h2>
            <p className="text-sm text-text-secondary">Latest audit feed when returned by the dashboard API.</p>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto">
            {recentActivity.length > 0 ? (
              recentActivity.slice(0, 10).map((activity, index) => (
                <div key={activity.id || index} className="rounded-lg border border-border bg-background-base p-3">
                  <p className="font-semibold text-text-primary">{activity.description || activity.action || "Activity"}</p>
                  <p className="text-xs text-text-muted">{activity.user || activity.actor || "System"} {formatTime(activity.timestamp || activity.created_at)}</p>
                </div>
              ))
            ) : (
              <div className="grid flex-1 place-items-center rounded-lg border border-dashed border-border p-6 text-center text-sm text-text-muted">
                No recent activity returned by the current dashboard API.
              </div>
            )}
          </div>
        </Card>
      </div>

      {suspiciousStudents.length > 0 && (
        <Card className="border-warning/30 bg-warning/5 p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-warning">Suspicious Students</h2>
              <p className="text-sm text-text-secondary">Students with repeated violations across exams.</p>
            </div>
            <Button as="a" href="/admin/suspicious-activity" variant="warning" size="sm">
              <Eye size={16} /> Review
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {suspiciousStudents.map(student => (
              <div key={student.id || student.name} className="rounded-lg border border-warning/30 bg-background-base p-4">
                <strong className="block text-text-primary">{student.name}</strong>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="warning">{student.exam_count || 0} exams</Badge>
                  <Badge variant="danger">{student.total_violations || student.violation_count || 0} violations</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
