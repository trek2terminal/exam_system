import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Bell, ChevronDown, LogOut, Menu, Moon, Search, Settings, Sun, User } from "lucide-react";
import { Avatar, Badge, Button, cn } from "../ui";
import { breadcrumbFor, logoutHref, normalizeReactHref, roleLabel, userName, userSubtitle } from "./navigation";
import { formatDate } from "../../utils/dateFormat";

function humanizeLabel(value) {
  if (!value) return "Notice";
  const text = String(value).replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function TopBar({ auth, notifications, theme, onToggleTheme, onMarkAllRead, onOpenDrawer }) {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const containerRef = useRef(null);
  const location = useLocation();
  const breadcrumbs = breadcrumbFor(location.pathname, auth?.role);
  const unreadCount = notifications?.unread_count || 0;
  const unreadItems = useMemo(() => notifications?.recent || notifications?.items || [], [notifications]);

  useEffect(() => {
    function onDocClick(event) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target)) {
        setShowNotifications(false);
        setShowUserMenu(false);
      }
    }
    document.addEventListener("pointerdown", onDocClick);
    return () => document.removeEventListener("pointerdown", onDocClick);
  }, []);

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background-card/95 px-4 shadow-sm backdrop-blur md:px-6">
      <Button variant="ghost" className="h-11 w-11 px-0 md:hidden" aria-label="Open menu" onClick={onOpenDrawer}>
        <Menu size={20} />
      </Button>

      <div className="min-w-0">
        <div className="flex items-center gap-2 text-xs font-semibold text-text-muted">
          {breadcrumbs.map((item, index) => (
            <span className="inline-flex items-center gap-2" key={item}>
              {index > 0 && <span className="text-text-muted">/</span>}
              <span>{item}</span>
            </span>
          ))}
        </div>
        <h1 className="truncate text-lg font-semibold text-text-primary md:text-xl">
          {auth?.role ? `${roleLabel(auth.role)} Workspace` : "Exam Platform"}
        </h1>
      </div>

      <div className="ml-auto flex items-center gap-2" ref={containerRef}>
        {searchOpen && (
          <label className="hidden h-9 w-64 items-center gap-2 rounded-md border border-border bg-background-card px-3 text-sm text-text-secondary shadow-sm md:flex">
            <Search size={17} />
            <input
              className="min-w-0 flex-1 bg-transparent text-text-primary outline-none placeholder:text-text-muted"
              placeholder="Search"
              autoFocus
            />
          </label>
        )}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            className={cn(
              "h-10 w-10 rounded-lg px-0 transition duration-150 hover:bg-black/[0.08] dark:hover:bg-white/10",
              searchOpen && "bg-background-elevated dark:bg-white/10"
            )}
            aria-label="Search"
            onClick={() => setSearchOpen(current => !current)}
          >
            <Search size={20} />
          </Button>

          <Button
            className="h-10 w-10 rounded-lg px-0 transition duration-150 hover:bg-black/[0.08] dark:hover:bg-white/10"
            variant="ghost"
            aria-label="Toggle theme"
            onClick={onToggleTheme}
          >
            {theme === "dark" ? <Moon size={20} /> : <Sun size={20} />}
          </Button>

          <div className="relative">
            <Button
              className="relative h-10 w-10 rounded-lg px-0 transition duration-150 hover:bg-black/[0.08] dark:hover:bg-white/10"
              variant="ghost"
              aria-label="Notifications"
              aria-expanded={showNotifications}
              onClick={() => {
                setShowNotifications(current => !current);
                setShowUserMenu(false);
              }}
            >
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-pill bg-danger px-1 text-[11px] font-bold text-white">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Button>

            {showNotifications && (
              <div className="absolute right-0 top-full z-50 mt-2 w-[min(360px,calc(100vw-2rem))] origin-top-right overflow-hidden rounded-card border border-border bg-background-card shadow-elevated animate-modal-in">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <strong className="block text-sm text-text-primary">Notifications</strong>
                  <span className="text-xs text-text-muted">{unreadCount} unread</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={unreadCount === 0}
                  onClick={async () => {
                    await onMarkAllRead?.();
                    setShowNotifications(false);
                  }}
                >
                  Mark all as read
                </Button>
              </div>
              <div className="max-h-80 overflow-auto">
                {unreadItems.length > 0 ? (
                  unreadItems.map(item => (
                    <a
                      className="block border-b border-border px-4 py-3 transition hover:bg-background-elevated"
                      href={normalizeReactHref(item.href, "/react/notifications")}
                      key={item.id || item.message}
                    >
                      <div className="flex items-start gap-3">
                        <Badge variant={item.type === "result_published" ? "success" : "info"} dot>{humanizeLabel(item.type)}</Badge>
                        <div className="min-w-0">
                          <p className="mb-1 text-sm font-semibold text-text-primary">{item.title || item.message}</p>
                          <span className="text-xs text-text-muted">{item.summary || formatDate(item.created_at)}</span>
                        </div>
                      </div>
                    </a>
                  ))
                ) : (
                  <div className="px-4 py-8 text-center text-sm text-text-muted">No unread notifications.</div>
                )}
              </div>
              <Link className="block border-t border-border px-4 py-3 text-center text-sm font-semibold text-brand-primary hover:bg-background-elevated" to="/notifications">
                View all notifications
              </Link>
              </div>
            )}
          </div>
        </div>

        <div className="h-8 w-px bg-text-muted/20" />

        <div className="relative">
          <Button
            variant="ghost"
            className="h-9 gap-2 rounded-pill border border-transparent px-2 hover:border-border hover:bg-background-elevated"
            aria-label="User menu"
            aria-expanded={showUserMenu}
            onClick={() => {
              setShowUserMenu(current => !current);
              setShowNotifications(false);
            }}
          >
            <Avatar name={userName(auth)} src={auth?.profile_picture} size="md" />
            <span className="hidden max-w-32 truncate text-sm font-semibold md:inline">{userName(auth)}</span>
            <ChevronDown size={16} className="hidden text-text-muted md:block" />
          </Button>

          {showUserMenu && (
            <div className="absolute right-0 top-full z-50 mt-2 w-64 origin-top-right overflow-hidden rounded-card border border-border bg-background-card shadow-elevated animate-modal-in">
              <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                <Avatar name={userName(auth)} src={auth?.profile_picture} size="lg" />
                <div className="min-w-0">
                  <strong className="block truncate text-sm text-text-primary">{userName(auth)}</strong>
                  <span className="block truncate text-xs text-text-muted">{userSubtitle(auth)}</span>
                </div>
              </div>
              <Link className="flex min-h-11 items-center gap-2 px-4 text-sm font-semibold text-text-secondary hover:bg-background-elevated hover:text-text-primary" to="/profile">
                <User size={17} /> Profile
              </Link>
              <Link className="flex min-h-11 items-center gap-2 px-4 text-sm font-semibold text-text-secondary hover:bg-background-elevated hover:text-text-primary" to="/settings">
                <Settings size={17} /> Settings
              </Link>
              <a className="flex min-h-11 items-center gap-2 border-t border-border px-4 text-sm font-semibold text-danger hover:bg-danger/10" href={logoutHref(auth?.role)}>
                <LogOut size={17} /> Logout
              </a>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
