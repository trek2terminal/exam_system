import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Bell,
  CalendarClock,
  CheckCircle2,
  Hash,
  Info,
  Mail,
  MailCheck,
  Megaphone,
  MessageCircle,
  Phone,
  ShieldAlert,
  Trophy,
  User
} from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, Modal, PageLoading, RefreshStatus, Textarea } from "../components/ui";
import { api, cachedGet } from "../services/api";
import { notify } from "../components/ui/Toast";
import { normalizeReactHref } from "../components/layout/navigation";
import { timeAgo } from "../utils/dateFormat";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

function notificationIcon(item) {
  if (item?.category === "admin" || String(item?.type || "").includes("registration_request")) return MessageCircle;
  if (item?.category === "security" || item?.severity === "danger" || item?.severity === "warning") return ShieldAlert;
  if (item?.category === "results") return Trophy;
  if (item?.category === "exams") return CalendarClock;
  if (item?.category === "announcements") return Megaphone;
  if (item?.severity === "success") return CheckCircle2;
  if (item?.category === "system") return Info;
  return Bell;
}

function severityClasses(severity) {
  if (severity === "danger") return "bg-danger/10 text-danger";
  if (severity === "warning") return "bg-warning/10 text-warning";
  if (severity === "success") return "bg-success/10 text-success";
  return "bg-info/10 text-info";
}

function severityBadge(severity) {
  if (severity === "danger") return "danger";
  if (severity === "warning") return "warning";
  if (severity === "success") return "success";
  return "info";
}

function isRegistrationRequest(item) {
  return item?.related_entity_type === "registration_request" || String(item?.type || "").includes("registration_request");
}

function notificationHref(item) {
  if (item.href) return normalizeReactHref(item.href);
  if (item.related_entity_type === "result") return "/react/student/results";
  if (item.related_entity_type === "student_session") return "/react/teacher";
  if (String(item.type || "").includes("violation")) return "/react/admin/proctoring";
  return "/react/notifications";
}

export default function NotificationsPage({ notifications, auth, onMarkAllRead }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState("all");
  const [items, setItems] = useState(() => notifications?.recent || notifications?.items || []);
  const [unreadCount, setUnreadCount] = useState(notifications?.unread_count || 0);
  const [counts, setCounts] = useState(notifications?.counts || {});
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [livePaused, setLivePaused] = useState(false);
  const [loadedAt, setLoadedAt] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestSaving, setRequestSaving] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const requestParam = searchParams.get("request");

  const loadNotifications = useCallback(async (soft = false, options = {}) => {
    if (!soft) setLoading(true);
    try {
      const { data } = await cachedGet("/notifications", { params: { filter, per_page: 50 }, cacheTtl: options.force ? 0 : soft ? 5000 : 1000 });
      setItems(data.items || []);
      setUnreadCount(data.unread_count || 0);
      setCounts(data.counts || {});
      setLoadedAt(Date.now());
    } catch (error) {
      notify.warning(error.message || "Could not refresh notifications.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);
  const liveRefresh = useLiveRefresh(loadNotifications, { enabled: !livePaused, intervalMs: 20000 });

  const displayedItems = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    return items.filter(item => {
      if (!search) return true;
      return `${item.title || ""} ${item.summary || ""} ${item.message || ""} ${item.type || ""}`.toLowerCase().includes(search);
    });
  }, [items, searchTerm]);

  const markNotificationRead = async item => {
    if (item.is_read === true || !item.id) return;
    setItems(current => current.map(row => row.id === item.id ? { ...row, is_read: true, read: true } : row));
    setUnreadCount(current => Math.max(current - 1, 0));
    try {
      const { data } = await api.post(`/notifications/${item.id}/read`);
      setUnreadCount(data.unread_count || 0);
      setCounts(data.counts || {});
    } catch {
      notify.warning("Could not mark notification as read.");
    }
  };

  const loadRegistrationRequest = useCallback(async requestId => {
    if (!requestId || auth?.role !== "admin") return;
    setRequestLoading(true);
    setRequestError("");
    try {
      const { data } = await api.get(`/admin/registration-requests/${requestId}`);
      setSelectedRequest(data.request || null);
      setAdminNote(data.request?.admin_note || "");
    } catch (error) {
      setSelectedRequest(null);
      setRequestError(error.message || "Could not load registration request.");
    } finally {
      setRequestLoading(false);
    }
  }, [auth?.role]);

  useEffect(() => {
    if (!requestParam || auth?.role !== "admin") return;
    loadRegistrationRequest(requestParam);
  }, [auth?.role, loadRegistrationRequest, requestParam]);

  const openRegistrationRequest = async item => {
    const requestId = item.related_entity_id;
    if (!requestId) return;
    await markNotificationRead(item);
    const next = new URLSearchParams(searchParams);
    next.set("request", requestId);
    setSearchParams(next, { replace: true });
    loadRegistrationRequest(requestId);
  };

  const closeRegistrationRequest = () => {
    setSelectedRequest(null);
    setRequestError("");
    const next = new URLSearchParams(searchParams);
    next.delete("request");
    setSearchParams(next, { replace: true });
  };

  const updateRegistrationRequest = async status => {
    if (!selectedRequest?.id) return;
    setRequestSaving(true);
    try {
      const { data } = await api.patch(`/admin/registration-requests/${selectedRequest.id}`, {
        status,
        admin_note: adminNote
      });
      setSelectedRequest(data.request || selectedRequest);
      setAdminNote(data.request?.admin_note || "");
      notify.success(status === "closed" ? "Request closed" : "Request marked reviewed");
      loadNotifications(true);
    } catch (error) {
      notify.error(error.message || "Could not update request");
    } finally {
      setRequestSaving(false);
    }
  };

  const markAll = async () => {
    setItems(current => current.map(item => ({ ...item, is_read: true, read: true })));
    setUnreadCount(0);
    setCounts(current => ({ ...current, unread: 0 }));
    await onMarkAllRead?.();
    await loadNotifications(true);
  };

  const tabs = [
    { id: "all", label: "All", count: counts.all },
    { id: "unread", label: "Unread", count: counts.unread ?? unreadCount },
    { id: "exams", label: "Exams", count: counts.exams },
    { id: "results", label: "Results", count: counts.results },
    { id: "security", label: "Security", count: counts.security },
    { id: "messages", label: "Messages", count: counts.messages },
    ...(auth?.role === "admin" ? [{ id: "admin", label: "Admin", count: counts.admin }] : []),
    { id: "system", label: "System", count: counts.system }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase text-text-muted">Workspace</p>
          <h1 className="text-3xl font-bold text-text-primary">Notifications</h1>
          <p className="mt-1 text-text-secondary">Unread alerts and system notices from your exam workspace.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RefreshStatus
            refreshing={liveRefresh.refreshing}
            lastUpdated={loadedAt || liveRefresh.lastUpdated}
            isStale={liveRefresh.isStale}
            livePaused={livePaused}
            onToggleLive={() => setLivePaused(current => !current)}
            onRefresh={() => loadNotifications(true, { force: true })}
          />
          <Button variant="secondary" disabled={unreadCount === 0} onClick={markAll}>
            <MailCheck size={18} /> Mark all as read
          </Button>
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <NotificationMetric icon={Mail} label="Unread" value={unreadCount} tone="info" />
        <NotificationMetric icon={CalendarClock} label="Exam Updates" value={counts.exams || 0} tone="info" />
        <NotificationMetric icon={ShieldAlert} label="Security" value={counts.security || 0} tone={counts.security ? "warning" : "success"} />
        <NotificationMetric icon={Trophy} label="Results" value={counts.results || 0} tone="success" />
      </section>

      <Card className="grid gap-3 p-3 lg:grid-cols-[minmax(220px,1fr)_auto] lg:items-center">
        <Input
          value={searchTerm}
          onChange={event => setSearchTerm(event.target.value)}
          placeholder="Search notifications"
          aria-label="Search notifications"
        />
        <div className="flex flex-wrap gap-2">
          {tabs.map(tab => (
            <Button key={tab.id} variant={filter === tab.id ? "primary" : "ghost"} size="sm" onClick={() => setFilter(tab.id)}>
              {tab.label}
              {Number(tab.count || 0) > 0 && <Badge variant={filter === tab.id ? "secondary" : "calm"}>{tab.count}</Badge>}
            </Button>
          ))}
        </div>
      </Card>

      {loading ? (
        <PageLoading title="Loading notifications..." variant="table" />
      ) : displayedItems.length === 0 ? (
        <EmptyState icon={Bell} heading="No notifications" description="You are all caught up." />
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-border">
            {displayedItems.slice(0, 50).map(item => {
              const Icon = notificationIcon(item);
              const unread = item.is_read === false || item.read === false;
              return (
                <div
                  key={item.id || `${item.message}-${item.created_at}`}
                  className={[
                    "group flex min-h-20 items-start gap-4 px-5 py-4 transition hover:bg-background-elevated",
                    unread ? "bg-background-surface" : "bg-background-card/70"
                  ].join(" ")}
                >
                  <span className="mt-1 h-2 w-2 rounded-full bg-brand-primary opacity-0 group-hover:opacity-100 data-[unread=true]:opacity-100" data-unread={unread || undefined} />
                  <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg ${severityClasses(item.severity)}`}>
                    <Icon size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="mb-1 flex flex-wrap items-center gap-2">
                      <strong className="text-text-primary">{item.title || item.message || "Notification"}</strong>
                      <Badge variant={severityBadge(item.severity)}>{item.category || item.type || "system"}</Badge>
                      {unread && <Badge variant="purple">new</Badge>}
                    </span>
                    {item.summary && <span className="block text-sm text-text-secondary">{item.summary}</span>}
                    {item.message && item.title && item.message !== item.summary && <span className="block text-sm text-text-secondary">{item.message}</span>}
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
                    {isRegistrationRequest(item) && auth?.role === "admin" ? (
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold text-brand-primary"
                        onClick={() => openRegistrationRequest(item)}
                      >
                        {item.action_label || "View details"}
                      </button>
                    ) : (
                      <a
                        href={notificationHref(item)}
                        className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold text-brand-primary"
                        onClick={() => markNotificationRead(item)}
                      >
                        {item.action_label || "Open"}
                      </a>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          {displayedItems.length > 50 && (
            <div className="border-t border-border px-5 py-3 text-sm text-text-muted">
              Showing the latest 50 notifications.
            </div>
          )}
        </Card>
      )}

      <Modal
        open={requestLoading || Boolean(selectedRequest) || Boolean(requestError)}
        onClose={closeRegistrationRequest}
        title="Registration request"
        className="max-w-3xl"
        footer={selectedRequest && (
          <>
            <Button variant="secondary" onClick={() => updateRegistrationRequest("reviewed")} loading={requestSaving} disabled={selectedRequest.status === "reviewed"}>
              Mark reviewed
            </Button>
            <Button variant="primary" onClick={() => updateRegistrationRequest("closed")} loading={requestSaving} disabled={selectedRequest.status === "closed"}>
              Close request
            </Button>
          </>
        )}
      >
        {requestLoading ? (
          <Card className="p-6 text-center text-text-muted">Opening message...</Card>
        ) : requestError ? (
          <Card className="border-danger/30 bg-danger/10 p-5 text-sm font-semibold text-danger">{requestError}</Card>
        ) : selectedRequest ? (
          <div className="space-y-5">
            <div className="rounded-card border border-border bg-background-surface p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase text-text-muted">From</p>
                  <h3 className="mt-1 text-xl font-semibold text-text-primary">{selectedRequest.full_name}</h3>
                  <p className="mt-1 text-sm text-text-secondary">Sent {timeAgo(selectedRequest.created_at)}</p>
                </div>
                <Badge variant={selectedRequest.status === "closed" ? "secondary" : selectedRequest.status === "reviewed" ? "info" : "warning"}>
                  {selectedRequest.status}
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <RequestDetailRow icon={Hash} label="Roll Number" value={selectedRequest.roll_number} />
              <RequestDetailRow icon={User} label="Preferred Username" value={selectedRequest.preferred_username || "-"} />
              <RequestDetailRow icon={Mail} label="Email" value={selectedRequest.email || "-"} />
              <RequestDetailRow icon={Phone} label="Phone" value={selectedRequest.phone || "-"} />
            </div>

            {selectedRequest.class_name && (
              <RequestDetailRow icon={Info} label="Class / Batch" value={selectedRequest.class_name} />
            )}

            <div className="rounded-card border border-border bg-background-card p-5 shadow-sm">
              <p className="mb-3 text-xs font-semibold uppercase text-text-muted">Message</p>
              <p className="whitespace-pre-wrap text-sm leading-7 text-text-primary">{selectedRequest.message}</p>
            </div>

            <Textarea
              label="Admin note"
              value={adminNote}
              onChange={event => setAdminNote(event.target.value)}
              placeholder="Add a private follow-up note for this request."
              helperText={selectedRequest.reviewed_by ? `Last reviewed by ${selectedRequest.reviewed_by}` : "This note is visible only to admins."}
            />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function NotificationMetric({ icon: Icon, label, value, tone }) {
  const color = tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-brand-primary";
  return (
    <Card className="p-4">
      <Icon size={18} className={`mb-3 ${color}`} />
      <p className="text-xs font-semibold uppercase text-text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold text-text-primary">{Number(value || 0).toLocaleString()}</p>
    </Card>
  );
}

function RequestDetailRow({ icon: Icon, label, value }) {
  return (
    <div className="flex min-h-16 items-center gap-3 rounded-card border border-border bg-background-surface px-4 py-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-background-elevated text-text-secondary">
        <Icon size={18} />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold uppercase text-text-muted">{label}</span>
        <span className="block truncate text-sm font-semibold text-text-primary">{value}</span>
      </span>
    </div>
  );
}
