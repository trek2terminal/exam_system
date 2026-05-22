import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { MobileDrawer } from "./MobileDrawer";

export function PageLayout({ children, auth, platformName, notifications, theme, onToggleTheme, onMarkAllRead }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="app">
      <aside className="sidebar">
        <Sidebar auth={auth} platformName={platformName} />
      </aside>

      <main>
        <TopBar auth={auth} notifications={notifications} theme={theme} onToggleTheme={onToggleTheme} onMarkAllRead={onMarkAllRead} onOpenDrawer={() => setDrawerOpen(true)} />
        <div className="contentArea">{children}</div>
      </main>

      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} auth={auth} platformName={platformName} />
    </div>
  );
}
