import { useState, useRef, useEffect } from "react";
import { Menu } from "lucide-react";
import { Bell, Moon, Sun } from "lucide-react";

export function TopBar({ auth, notifications, theme, onToggleTheme, onMarkAllRead, onOpenDrawer }) {
  const [showNotifications, setShowNotifications] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target)) setShowNotifications(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  return (
    <header className="topbar">
      <div className="flex items-center gap-4">
        <button className="iconButton md:hidden" aria-label="Open menu" onClick={onOpenDrawer}><Menu size={18} /></button>
      <div>
        <span className="eyebrow">{auth?.role ? `${auth.role} workspace` : "Welcome"}</span>
        <h1>{auth?.student_name || auth?.teacher_name || auth?.admin_name || "Exam Platform"}</h1>
      </div>

      </div>

      <div className="topbarActions" ref={containerRef}>
        <div className="relative">
          <button
            className="iconButton badgeButton"
            type="button"
            aria-label="Notifications"
            onClick={() => setShowNotifications(s => !s)}
          >
            <Bell size={18} />
            {notifications?.unread_count > 0 && <span>{notifications.unread_count}</span>}
          </button>

          {showNotifications && (
            <div className="notifDropdown">
              <div className="notifHeader">
                <strong>Notifications</strong>
                <button className="notifMarkAll" onClick={async () => { await onMarkAllRead(); setShowNotifications(false); }}>Mark all as read</button>
              </div>
              <div className="notifList">
                {notifications?.items?.length > 0 ? (
                  notifications.items.slice(0, 20).map((n, idx) => (
                    <a key={idx} href={n.href || '#'} className="notifItem">
                      <div className="notifItemInner">
                        <div className="notifTitle">{n.title || n.message}</div>
                        <div className="notifMeta">{n.summary || n.time}</div>
                      </div>
                    </a>
                  ))
                ) : (
                  <div className="notifEmpty">No notifications</div>
                )}
              </div>
              <div className="notifFooter">
                <a className="notifViewAll" href="/notifications">View all</a>
              </div>
            </div>
          )}
        </div>

        <button className="iconButton" type="button" aria-label="Toggle theme" onClick={onToggleTheme}>
          {theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}
        </button>
      </div>
    </header>
  );
}
