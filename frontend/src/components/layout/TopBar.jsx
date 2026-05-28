import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Bell, ChevronDown, Contrast, LogOut, Menu, Moon, Search, Settings, Sun, User } from "lucide-react";
import { Avatar, Badge, Button, cn } from "../ui";
import { breadcrumbFor, logoutHref, normalizeReactHref, roleLabel, roleNavigation, userName, userSubtitle } from "./navigation";
import { formatDate } from "../../utils/dateFormat";
import { api } from "../../services/api";

function humanizeLabel(value) {
  if (!value) return "Notice";
  const text = String(value).replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function TopBar({ auth, notifications, theme, highContrast, onToggleTheme, onToggleContrast, onMarkAllRead, onOpenDrawer }) {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const containerRef = useRef(null);
  const searchInputRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const breadcrumbs = breadcrumbFor(location.pathname, auth?.role);
  const unreadCount = notifications?.unread_count || 0;
  const unreadItems = useMemo(() => notifications?.recent || notifications?.items || [], [notifications]);
  const profilePath = auth?.role ? `/${auth.role}/profile` : "/profile";
  const settingsPath = auth?.role && auth.role !== "admin" ? `/${auth.role}/settings` : "/settings";

  useEffect(() => {
    function onDocClick(event) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target)) {
        setShowNotifications(false);
        setShowUserMenu(false);
        setSearchOpen(false);
      }
    }
    document.addEventListener("pointerdown", onDocClick);
    return () => document.removeEventListener("pointerdown", onDocClick);
  }, []);

  useEffect(() => {
    if (!searchOpen) return undefined;
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen || !auth?.role) return undefined;
    const query = searchTerm.trim();
    if (query.length < 2) {
      setSearchResults((roleNavigation[auth.role] || []).slice(0, 8).map(item => ({
        type: "destination",
        title: item.label,
        subtitle: `Open ${roleLabel(auth.role).toLowerCase()} workspace`,
        href: `/react${item.to}`
      })));
      setSearchError("");
      setSearchLoading(false);
      return undefined;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError("");
      try {
        const { data } = await api.get("/search", {
          params: { q: query, limit: 8 }
        });
        if (!active) return;
        setSearchResults(data.items || []);
        setActiveSearchIndex(0);
      } catch (error) {
        if (!active) return;
        setSearchResults([]);
        setSearchError(error.message || "Search failed");
      } finally {
        if (active) setSearchLoading(false);
      }
    }, 320);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [auth?.role, searchOpen, searchTerm]);

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchTerm("");
    setSearchError("");
    setActiveSearchIndex(0);
  };

  const openSearch = () => {
    setSearchOpen(true);
    setShowNotifications(false);
    setShowUserMenu(false);
  };

  const selectSearchResult = item => {
    if (!item?.href) return;
    const fallback = auth?.role ? `/react/${auth.role}` : "/react";
    const href = normalizeReactHref(item.href, fallback);
    closeSearch();
    if (href.startsWith("/react/") || href === "/react") {
      navigate(href.replace(/^\/react/, "") || "/");
      return;
    }
    window.location.href = href;
  };

  const onSearchKeyDown = event => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSearchIndex(current => Math.min(current + 1, Math.max(searchResults.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSearchIndex(current => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter" && searchResults[activeSearchIndex]) {
      event.preventDefault();
      selectSearchResult(searchResults[activeSearchIndex]);
    }
  };

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border/80 bg-background-card/82 px-3 shadow-sm backdrop-blur-2xl md:px-5">
      <Button variant="ghost" className="h-10 w-10 px-0 md:hidden" aria-label="Open menu" onClick={onOpenDrawer}>
        <Menu size={19} />
      </Button>

      <div className="min-w-0">
        <div className="hidden items-center gap-2 text-[11px] font-semibold text-text-muted sm:flex">
          {breadcrumbs.map((item, index) => (
            <span className="inline-flex items-center gap-2" key={item}>
              {index > 0 && <span className="text-text-muted">/</span>}
              <span>{item}</span>
            </span>
          ))}
        </div>
        <h1 className="truncate text-base font-semibold text-text-primary md:text-lg">
          {auth?.role ? `${roleLabel(auth.role)} Workspace` : "Exam Platform"}
        </h1>
      </div>

      <div className="ml-auto flex items-center gap-2" ref={containerRef}>
        <div className={cn("relative", searchOpen && "md:w-80")}>
          {searchOpen && (
            <>
              <label className="fixed left-3 right-3 top-16 z-50 flex h-11 items-center gap-2 rounded-md border border-border bg-background-card/95 px-3 text-sm text-text-secondary shadow-elevated backdrop-blur-2xl md:static md:mt-0 md:w-full md:shadow-sm">
                <Search size={21} strokeWidth={2.4} />
                <input
                  ref={searchInputRef}
                  className="min-w-0 flex-1 bg-transparent text-text-primary outline-none placeholder:text-text-muted"
                  placeholder={`Search ${roleLabel(auth?.role).toLowerCase()} workspace`}
                  value={searchTerm}
                  onChange={event => setSearchTerm(event.target.value)}
                  onKeyDown={onSearchKeyDown}
                  autoComplete="off"
                />
              </label>
              <div className="fixed left-3 right-3 top-[7.25rem] z-50 overflow-hidden rounded-card border border-border bg-background-card/95 shadow-elevated backdrop-blur-2xl md:absolute md:left-auto md:right-0 md:top-[calc(100%+0.5rem)] md:w-full">
                <div className="border-b border-border px-3 py-2 text-xs font-semibold text-text-muted">
                  {searchTerm.trim() ? "Search results" : "Quick destinations"}
                </div>
                <div className="max-h-80 overflow-auto">
                  {searchLoading && (
                    <div className="px-3 py-4 text-sm text-text-muted">Searching...</div>
                  )}
                  {!searchLoading && searchError && (
                    <div className="px-3 py-4 text-sm text-danger">{searchError}</div>
                  )}
                  {!searchLoading && !searchError && searchResults.length === 0 && (
                    <div className="px-3 py-4 text-sm text-text-muted">No results found.</div>
                  )}
                  {!searchLoading && !searchError && searchResults.map((item, index) => (
                    <button
                      key={`${item.type}-${item.href}-${item.title}-${index}`}
                      type="button"
                      className={cn(
                        "flex w-full items-start gap-3 border-b border-border/70 px-3 py-3 text-left transition last:border-b-0",
                        index === activeSearchIndex ? "bg-brand-primary/10" : "hover:bg-background-elevated"
                      )}
                      onMouseEnter={() => setActiveSearchIndex(index)}
                      onClick={() => selectSearchResult(item)}
                    >
                      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-primary/10 text-brand-primary">
                        <Search size={17} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-text-primary">{item.title}</span>
                          <Badge variant="secondary" size="sm">{item.type}</Badge>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-text-muted">{item.subtitle || item.href}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            className={cn(
              "h-11 w-11 rounded-lg px-0 transition duration-150 hover:bg-black/[0.08] dark:hover:bg-white/10",
              searchOpen && "bg-background-elevated dark:bg-white/10"
            )}
            aria-label="Search"
            onClick={() => searchOpen ? closeSearch() : openSearch()}
          >
            <Search size={24} strokeWidth={2.35} />
          </Button>

          <Button
            className="h-11 w-11 rounded-lg px-0 transition duration-150 hover:bg-black/[0.08] dark:hover:bg-white/10"
            variant="ghost"
            aria-label="Toggle theme"
            onClick={onToggleTheme}
          >
            {theme === "dark" ? <Moon size={24} strokeWidth={2.35} /> : <Sun size={24} strokeWidth={2.35} />}
          </Button>

          <Button
            className={cn(
              "h-11 w-11 rounded-lg px-0 transition duration-150 hover:bg-black/[0.08] dark:hover:bg-white/10",
              highContrast && "bg-background-elevated text-brand-primary dark:bg-white/10"
            )}
            variant="ghost"
            aria-label={highContrast ? "Disable high contrast" : "Enable high contrast"}
            onClick={onToggleContrast}
          >
            <Contrast size={23} strokeWidth={2.35} />
          </Button>

          <div className="relative">
            <Button
              className="relative h-11 w-11 rounded-lg px-0 transition duration-150 hover:bg-black/[0.08] dark:hover:bg-white/10"
              variant="ghost"
              aria-label="Notifications"
              aria-expanded={showNotifications}
              onClick={() => {
                setShowNotifications(current => !current);
                setShowUserMenu(false);
                setSearchOpen(false);
              }}
            >
              <Bell size={24} strokeWidth={2.35} />
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

        <div className="hidden h-7 w-px bg-text-muted/20 sm:block" />

        <div className="relative">
          <Button
            variant="ghost"
            className="h-9 gap-2 rounded-pill border border-transparent px-1.5 hover:border-border hover:bg-background-elevated sm:px-2"
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
              <Link className="flex min-h-11 items-center gap-2 px-4 text-sm font-semibold text-text-secondary hover:bg-background-elevated hover:text-text-primary" to={profilePath}>
                <User size={17} /> Profile
              </Link>
              <Link className="flex min-h-11 items-center gap-2 px-4 text-sm font-semibold text-text-secondary hover:bg-background-elevated hover:text-text-primary" to={settingsPath}>
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
