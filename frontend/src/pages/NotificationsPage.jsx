import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Bell, CheckCircle2, Hash, Info, Mail, MailCheck, MessageCircle, Phone, User } from "lucide-react";
import { Badge, Button, Card, EmptyState, Modal, Textarea } from "../components/ui";
import { api } from "../services/api";
import { notify } from "../components/ui/Toast";
import { normalizeReactHref } from "../components/layout/navigation";
import { timeAgo } from "../utils/dateFormat";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

function notificationIcon(type) {
  if (String(type).includes("registration_request")) return MessageCircle;
  if (String(type).includes("warning") || String(type).includes("violation")) return AlertTriangle;
  if (String(type).includes("result") || String(type).includes("success")) return CheckCircle2;
  if (String(type).includes("system")) return Info;
  return Bell;
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
  const [loading, setLoading] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestSaving, setRequestSaving] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const requestParam = searchParams.get("request");

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
      if (filter === "admin") return String(item.type || "").includes("admin") || isRegistrationRequest(item);
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
                        Open
                      </a>
                    )}
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
