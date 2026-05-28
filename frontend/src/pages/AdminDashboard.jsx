import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  BookOpenCheck,
  CalendarClock,
  CheckCircle2,
  Code2,
  DatabaseBackup,
  Eye,
  Plus,
  Settings,
  Upload,
  Users,
  XCircle
} from "lucide-react";
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
import { Badge, Button, Card, PageLoading, RefreshStatus, StatCard } from "../components/ui";
import { cachedGet } from "../services/api";
import { notify } from "../components/ui/Toast";
import { cn } from "../components/ui/utils";
import { timeAgo } from "../utils/dateFormat";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

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

function normalizeTrend(rawTrend) {
  if (Array.isArray(rawTrend) && rawTrend.length > 0) {
    return rawTrend.map((item, index) => ({
      day: item.day || item.label || `Day ${index + 1}`,
      participants: Number(item.participants ?? item.count ?? item.value ?? 0)
    }));
  }

  return Array.from({ length: 7 }, (_, index) => ({
    day: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][index],
    participants: 0
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

function activityTone(action = "") {
  if (/create|publish|grant/.test(action)) return { icon: CheckCircle2, className: "bg-success/10 text-success" };
  if (/terminate|deactivate|delete/.test(action)) return { icon: XCircle, className: "bg-danger/10 text-danger" };
  if (/reduce|backup/.test(action)) return { icon: DatabaseBackup, className: "bg-warning/10 text-warning" };
  if (/submit|execute|code|run_python/.test(action)) return { icon: Code2, className: "bg-info/10 text-info" };
  if (/settings|logo|account/.test(action)) return { icon: Settings, className: "bg-brand-primary/10 text-brand-primary" };
  return { icon: CalendarClock, className: "bg-background-elevated text-text-secondary" };
}

export default function AdminDashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [livePaused, setLivePaused] = useState(false);
  const [loadedAt, setLoadedAt] = useState(null);
  const chartTheme = useChartTheme();

  const loadDashboard = useCallback(async (soft = false, options = {}) => {
    if (!soft) setLoading(true);
    try {
      const { data } = await cachedGet("/admin/dashboard", { cacheTtl: options.force ? 0 : soft ? 5000 : 1000 });
      setDashboard(data);
      setLoadedAt(Date.now());
    } catch {
      notify.error("Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);
  const liveRefresh = useLiveRefresh(loadDashboard, { enabled: !livePaused, intervalMs: 20000 });

  const stats = useMemo(() => dashboard?.stats || {}, [dashboard?.stats]);
  const participationTrend = useMemo(() => normalizeTrend(dashboard?.participation_trend), [dashboard?.participation_trend]);
  const statusDistribution = useMemo(() => normalizeStatus(dashboard?.status_distribution, stats), [dashboard?.status_distribution, stats]);
  const recentActivity = dashboard?.recent_activity || [];
  const suspiciousStudents = dashboard?.suspicious_students || [];
  const hasParticipationData = participationTrend.some(item => Number(item.participants || 0) > 0);
  const trends = dashboard?.trends || stats.trends || {};
  const statCards = [
    { icon: Users, label: "Total Users", value: stats.total_users || 0, variant: "indigo", trend: trends.total_users, to: "/admin/users" },
    { icon: Users, label: "Teachers", value: stats.total_teachers || 0, variant: "info", trend: trends.total_teachers, to: "/admin/users" },
    { icon: Users, label: "Students", value: stats.total_students || 0, variant: "success", trend: trends.total_students, to: "/admin/users" },
    { icon: BookOpenCheck, label: "Active Exams", value: stats.active_exams || 0, variant: "purple", trend: trends.active_exams, to: "/admin/exams" },
    {
      icon: AlertTriangle,
      label: "Violations Today",
      value: stats.violations_today || 0,
      variant: "danger",
      trend: trends.violations_today,
      to: "/admin/proctoring",
      className: Number(stats.violations_today || 0) > 0 ? "border-danger/35 bg-danger/5" : ""
    },
    {
      icon: BarChart3,
      label: "Pending Reviews",
      value: stats.pending_reviews || 0,
      variant: "warning",
      trend: trends.pending_reviews,
      to: "/admin/reports",
      className: Number(stats.pending_reviews || 0) > 0 ? "border-warning/35 bg-warning/5" : ""
    }
  ];

  if (loading) return <PageLoading title="Loading admin dashboard..." />;
  if (!dashboard) return <Card className="p-8 text-center text-danger">Failed to load dashboard data</Card>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-text-primary">Admin Workspace</h1>
          <p className="mt-1 text-text-secondary">Live role counts, exam activity, alerts, and report shortcuts.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <RefreshStatus
            refreshing={liveRefresh.refreshing}
            lastUpdated={loadedAt || liveRefresh.lastUpdated}
            isStale={liveRefresh.isStale}
            livePaused={livePaused}
            onToggleLive={() => setLivePaused(current => !current)}
            onRefresh={() => loadDashboard(true, { force: true })}
          />
          <Button variant="primary" size="sm" as={Link} to="/admin/users" className="min-h-10 px-4">
            <Plus size={16} /> Create Teacher
          </Button>
          <Button variant="info" size="sm" as={Link} to="/admin/users" className="min-h-10 px-4">
            <Upload size={16} /> Import Students
          </Button>
          <Button variant="warning" size="sm" as={Link} to="/admin/proctoring" className="min-h-10 px-4">
            <AlertTriangle size={16} /> View Violations
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
        {statCards.map(card => (
          <StatCard key={card.label} {...card} className={card.className} />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-text-primary">Exam Participation</h2>
                <p className="text-sm text-text-secondary">Exam participation over the last 7 days</p>
              </div>
              <span className="rounded-pill border border-info/30 bg-info/10 px-3 py-1 text-xs font-bold text-info">7 Days</span>
            </div>
            <div className="h-72">
              {hasParticipationData ? (
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
              ) : (
                <div className="grid h-full place-items-center rounded-lg border border-dashed border-border bg-background-base/70 text-center">
                  <div>
                    <CalendarClock size={34} className="mx-auto mb-3 text-text-muted" />
                    <p className="font-semibold text-text-primary">No exam activity yet</p>
                  </div>
                </div>
              )}
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
            <h2 className="text-xl font-semibold text-text-primary">Recent activity</h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            {recentActivity.length > 0 ? (
              <div className="divide-y divide-border">
                {recentActivity.slice(0, 8).map((activity, index) => {
                  const tone = activityTone(activity.action || activity.action_type);
                  const Icon = tone.icon;
                  return (
                    <div key={activity.id || index} className="flex items-start gap-3 py-3">
                      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", tone.className)}>
                        <Icon size={17} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-text-primary">
                          {activity.actor_name || activity.user ? <span className="font-semibold">{activity.actor_name || activity.user}</span> : null}
                          {activity.actor_name || activity.user ? " " : ""}
                          <span>{activity.formatted_message || activity.description || "Activity recorded"}</span>
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-text-muted">{timeAgo(activity.timestamp || activity.created_at)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid flex-1 place-items-center rounded-lg border border-dashed border-border p-6 text-center">
                <div>
                  <CalendarClock size={34} className="mx-auto mb-3 text-text-muted" />
                  <p className="font-semibold text-text-primary">No recent activity</p>
                </div>
              </div>
            )}
          </div>
          {recentActivity.length > 0 && (
            <a href="/react/admin/reports" className="mt-4 block border-t border-border pt-3 text-sm font-semibold text-brand-primary hover:text-brand-hover">
              View all
            </a>
          )}
        </Card>
      </div>

      {suspiciousStudents.length > 0 && (
        <Card className="border-warning/30 bg-warning/5 p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-warning">Suspicious Students</h2>
              <p className="text-sm text-text-secondary">Students with repeated violations across exams.</p>
            </div>
            <Button as="a" href="/react/admin/reports" variant="warning" size="sm">
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
