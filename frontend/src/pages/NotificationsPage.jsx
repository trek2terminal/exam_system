import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, Info, MailCheck } from "lucide-react";
import { Badge, Button, Card, EmptyState } from "../components/ui";
import { api } from "../services/api";
import { notify } from "../components/ui/Toast";
import { normalizeReactHref } from "../components/layout/navigation";
import { timeAgo } from "../utils/dateFormat";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

function notificationIcon(type) {
  if (String(type).includes("warning") || String(type).includes("violation")) return AlertTriangle;
  if (String(type).includes("result") || String(type).includes("success")) return CheckCircle2;
  if (String(type).includes("system")) return Info;
  return Bell;
}

function notificationHref(item) {
  if (item.href) return normalizeReactHref(item.href);
  if (item.related_entity_type === "result") return "/react/student/results";
  if (item.related_entity_type === "student_session") return "/react/teacher";
  if (String(item.type || "").includes("violation")) return "/react/admin/proctoring";
  return "/react/notifications";
}

export default function NotificationsPage({ notifications, auth, onMarkAllRead }) {
  const [filter, setFilter] = useState("all");
  const [items, setItems] = useState(() => notifications?.recent || notifications?.items || []);
  const [unreadCount, setUnreadCount] = useState(notifications?.unread_count || 0);
  const [loading, setLoading] = useState(false);

  const loadNotifications = useCallback(async (soft = false) => {
    if (!soft) setLoading(true);
    try {
      const { data } = await api.get("/notifications", { params: { filter, per_page: 50 } });
      setItems(data.items || []);
      setUnreadCount(data.unread_count || 0);
    } catch (error) {
      notify.warning(error.message || "Could not refresh notifications.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);
  useLiveRefresh(loadNotifications, { intervalMs: 20000 });

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (filter === "all") return true;
      if (filter === "unread") return item.is_read === false || item.read === false;
      if (filter === "admin") return String(item.type || "").includes("admin");
      if (filter === "system") return String(item.type || "").includes("system") || !item.type;
      return true;
    });
  }, [filter, items]);

  const markNotificationRead = async item => {
    if (item.is_read === true || !item.id) return;
    setItems(current => current.map(row => row.id === item.id ? { ...row, is_read: true, read: true } : row));
    setUnreadCount(current => Math.max(current - 1, 0));
    try {
      await api.post(`/notifications/${item.id}/read`);
    } catch {
      notify.warning("Could not mark notification as read.");
    }
  };

  const markAll = async () => {
    setItems(current => current.map(item => ({ ...item, is_read: true, read: true })));
    setUnreadCount(0);
    await onMarkAllRead?.();
  };

  const tabs = [
    { id: "all", label: "All" },
    { id: "unread", label: "Unread" },
    ...(auth?.role === "admin" ? [{ id: "admin", label: "Admin" }] : []),
    { id: "system", label: "System" }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase text-text-muted">Workspace</p>
          <h1 className="text-3xl font-bold text-text-primary">Notifications</h1>
          <p className="mt-1 text-text-secondary">Unread alerts and system notices from your exam workspace.</p>
        </div>
        <Button variant="secondary" disabled={unreadCount === 0} onClick={markAll}>
          <MailCheck size={18} /> Mark all as read
        </Button>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap gap-2">
          {tabs.map(tab => (
            <Button key={tab.id} variant={filter === tab.id ? "primary" : "ghost"} size="sm" onClick={() => setFilter(tab.id)}>
              {tab.label}
            </Button>
          ))}
        </div>
      </Card>

      {loading ? (
        <Card className="p-8 text-center text-text-muted">Loading notifications...</Card>
      ) : filteredItems.length === 0 ? (
        <EmptyState icon={Bell} heading="No notifications" description="You are all caught up." />
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-border">
            {filteredItems.slice(0, 20).map(item => {
              const Icon = notificationIcon(item.type);
              const unread = item.is_read === false || item.read === false;
              return (
                <div
                  key={item.id || `${item.message}-${item.created_at}`}
                  className="group flex min-h-20 items-start gap-4 bg-background-surface px-5 py-4 transition hover:bg-background-elevated"
                >
                  <span className="mt-1 h-2 w-2 rounded-full bg-brand-primary opacity-0 group-hover:opacity-100 data-[unread=true]:opacity-100" data-unread={unread || undefined} />
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-background-elevated text-text-secondary">
                    <Icon size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="mb-1 flex flex-wrap items-center gap-2">
                      <strong className="text-text-primary">{item.title || item.message || "Notification"}</strong>
                      <Badge variant={item.type === "result_published" ? "success" : "info"}>{item.type || "system"}</Badge>
                    </span>
                    {item.summary && <span className="block text-sm text-text-secondary">{item.summary}</span>}
                    {item.message && item.title && <span className="block text-sm text-text-secondary">{item.message}</span>}
                    <span className="mt-2 block text-xs text-text-muted">{timeAgo(item.created_at)}</span>
                  </span>
                  <span className="flex shrink-0 flex-col gap-2 sm:flex-row">
                    {!unread ? null : (
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold text-brand-primary opacity-100 transition md:opacity-0 md:group-hover:opacity-100"
                        onClick={() => markNotificationRead(item)}
                      >
                        Mark read
                      </button>
                    )}
                    <a
                      href={notificationHref(item)}
                      className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold text-brand-primary"
                      onClick={() => markNotificationRead(item)}
                    >
                      Open
                    </a>
                  </span>
                </div>
              );
            })}
          </div>
          {filteredItems.length > 20 && (
            <div className="border-t border-border px-5 py-3 text-sm text-text-muted">
              Showing the latest 20 notifications.
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
