import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../ui";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { MobileDrawer } from "./MobileDrawer";
import { roleNavigation } from "./navigation";

export function PageLayout({ children, auth, platformName, notifications, theme, onToggleTheme, onMarkAllRead }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const studentTabs = (roleNavigation.student || []).filter(item => ["Dashboard", "My Exams", "Results"].includes(item.label));

  return (
    <div className="min-h-screen bg-background-base text-text-primary">
      <Sidebar auth={auth} platformName={platformName} />
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} auth={auth} platformName={platformName} />
      <div className="min-h-screen md:pl-16 lg:pl-60">
        <TopBar
          auth={auth}
          notifications={notifications}
          theme={theme}
          onToggleTheme={onToggleTheme}
          onMarkAllRead={onMarkAllRead}
          onOpenDrawer={() => setDrawerOpen(true)}
        />
        <main className={cn("animate-page-fade px-4 pb-8 pt-4 md:px-6 lg:px-8", auth?.role === "student" && "pb-24 md:pb-8")}>
          {children}
        </main>
        {auth?.role === "student" && (
          <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-border bg-background-surface shadow-elevated md:hidden" aria-label="Student quick navigation">
            {studentTabs.map(item => {
              const Icon = item.icon;
              const active = location.pathname === item.to || (item.to !== "/student" && location.pathname.startsWith(`${item.to}/`));
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "grid min-h-16 place-items-center gap-1 px-2 py-2 text-xs font-semibold transition",
                    active ? "text-brand-primary" : "text-text-muted hover:text-text-primary"
                  )}
                >
                  <Icon size={20} />
                  <span>{item.label.replace("My ", "")}</span>
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}
