import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { MobileDrawer } from "./MobileDrawer";

export function PageLayout({ children, auth, platformName, notifications, theme, onToggleTheme, onMarkAllRead }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

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
        <main className="animate-page-fade px-4 pb-8 pt-4 md:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
