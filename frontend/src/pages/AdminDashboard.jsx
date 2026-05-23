import { useCallback, useEffect, useState } from "react";
import { Users, BookOpenCheck, AlertTriangle, BarChart3, Plus, Upload, Eye } from "lucide-react";
import { Button, Card, StatCard } from "../components/ui";
import { api } from "../services/api";
import { notify } from "../components/ui/Toast";

export default function AdminDashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) return <div className="p-8 text-center">Loading dashboard...</div>;
  if (!dashboard) return <div className="p-8 text-center">Failed to load data</div>;

  const stats = dashboard.stats || {};
  const recentActivity = dashboard.recent_activity || [];
  const suspiciousStudents = dashboard.suspicious_students || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-sm font-semibold text-text-muted">ADMIN OVERVIEW</p>
        <h1 className="text-3xl font-bold text-text-primary">Platform Health</h1>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" size="sm" as="a" href="/admin/users/create">
          <Plus size={16} /> Create Teacher
        </Button>
        <Button variant="secondary" size="sm">
          <Upload size={16} /> Import Students
        </Button>
        <Button variant="secondary" size="sm">
          <AlertTriangle size={16} /> View Violations
        </Button>
        <Button variant="secondary" size="sm">
          <BarChart3 size={16} /> Backup Database
        </Button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6">
        <StatCard
          icon={Users}
          label="Total Users"
          value={stats.total_users || 0}
          variant="default"
        />
        <StatCard
          icon={Users}
          label="Teachers"
          value={stats.total_teachers || 0}
          variant="default"
        />
        <StatCard
          icon={Users}
          label="Students"
          value={stats.total_students || 0}
          variant="default"
        />
        <StatCard
          icon={BookOpenCheck}
          label="Active Exams"
          value={stats.active_exams || 0}
          variant="default"
        />
        <StatCard
          icon={AlertTriangle}
          label="Violations Today"
          value={stats.violations_today || 0}
          variant="danger"
        />
        <StatCard
          icon={BarChart3}
          label="Pending Reviews"
          value={stats.pending_reviews || 0}
          variant="default"
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Charts Column - 2 cols */}
        <div className="lg:col-span-2 space-y-6">
          {/* Participation Chart */}
          <Card className="p-5">
            <h3 className="font-semibold text-text-primary mb-4">Exam Participation (Last 7 Days)</h3>
            <div className="h-64 bg-background-elevated/50 rounded flex items-end justify-around p-4">
              {[45, 52, 48, 61, 55, 70, 65].map((value, index) => (
                <div key={index} className="flex flex-col items-center gap-2">
                  <div
                    className="w-8 rounded-t bg-gradient-to-t from-brand-primary to-brand-primary/60 transition hover:opacity-80"
                    style={{ height: `${(value / 70) * 200}px` }}
                  />
                  <span className="text-xs text-text-muted">Day {index + 1}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Status Distribution */}
          <Card className="p-5">
            <h3 className="font-semibold text-text-primary mb-4">Exam Status Distribution</h3>
            <div className="space-y-3">
              {[
                { label: "Active", value: 12, color: "bg-success", width: "60%" },
                { label: "Upcoming", value: 8, color: "bg-info", width: "40%" },
                { label: "Closed", value: 20, color: "bg-danger", width: "100%" },
                { label: "Draft", value: 5, color: "bg-text-muted", width: "25%" }
              ].map((item, index) => (
                <div key={index}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-text-primary">{item.label}</span>
                    <span className="text-sm text-text-muted">{item.value} exams</span>
                  </div>
                  <div className="h-2 rounded-pill bg-background-elevated overflow-hidden">
                    <div className={`h-full ${item.color} transition`} style={{ width: item.width }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Activity & Alerts Column */}
        <div className="lg:col-span-1 space-y-6">
          {/* Recent Activity */}
          <Card className="p-5 h-full flex flex-col">
            <h3 className="font-semibold text-text-primary mb-4">Recent Activity</h3>
            <div className="space-y-3 flex-1 overflow-y-auto">
              {recentActivity.length > 0 ? (
                recentActivity.slice(0, 8).map((activity, index) => (
                  <div key={index} className="text-sm border-l-2 border-brand-primary pl-3 py-1">
                    <p className="font-semibold text-text-primary">{activity.action}</p>
                    <p className="text-xs text-text-muted">{activity.user}</p>
                    <p className="text-xs text-text-muted">{new Date(activity.timestamp).toLocaleTimeString()}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-text-muted text-center py-8">No recent activity</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Suspicious Activity Alert */}
      {suspiciousStudents.length > 0 && (
        <Card className="border-warning/30 bg-warning/5 p-5">
          <h3 className="font-semibold text-warning mb-3">Suspicious Activity Detected</h3>
          <p className="text-sm text-text-secondary mb-3">
            {suspiciousStudents.length} student(s) have cross-exam violations:
          </p>
          <div className="space-y-2">
            {suspiciousStudents.map((student, index) => (
              <div key={index} className="flex items-center justify-between text-sm">
                <span className="text-text-primary">{student.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-text-muted">{student.violation_count} violations</span>
                  <Button variant="warning" size="sm">
                    <Eye size={14} /> Review
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
