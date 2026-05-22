import { Link, useLocation } from "react-router-dom";
import { LogOut } from "lucide-react";
import { Avatar, Badge, Button, Tooltip, cn } from "../ui";
import { logoutHref, platformIcon as PlatformIcon, roleLabel, roleNavigation, userName, userSubtitle } from "./navigation";

export function Sidebar({ auth, platformName, mobile = false, onNavigate }) {
  const location = useLocation();
  const role = auth?.role;
  const items = roleNavigation[role] || [];

  return (
    <aside
      className={cn(
        "flex h-full flex-col overflow-y-auto border-r border-border bg-background-base text-text-primary",
        mobile ? "w-72 p-5" : "fixed inset-y-0 left-0 z-30 hidden w-16 p-3 md:flex lg:w-60 lg:p-5"
      )}
    >
      <div className={cn("mb-6 flex items-center gap-3", !mobile && "md:justify-center lg:justify-start")}>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand-primary text-white shadow-sm">
          <PlatformIcon size={22} />
        </span>
        <div className={cn("min-w-0", !mobile && "hidden lg:block")}>
          <strong className="block truncate text-sm font-bold">{platformName || "Exam Platform"}</strong>
          <span className="block truncate text-xs text-text-muted">Focused assessment</span>
        </div>
      </div>

      <nav className="grid gap-2">
        {items.map(item => {
          const Icon = item.icon;
          const active = location.pathname === item.to || (item.to !== `/${role}` && location.pathname.startsWith(`${item.to}/`));
          const link = (
            <Link
              key={item.to}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold transition duration-150 ease-out",
                active
                  ? "bg-brand-primary text-white shadow-sm"
                  : "text-text-secondary hover:bg-background-elevated hover:text-text-primary",
                !mobile && "md:justify-center lg:justify-start"
              )}
              to={item.to}
              onClick={onNavigate}
            >
              <Icon size={19} />
              <span className={cn(!mobile && "hidden lg:inline")}>{item.label}</span>
            </Link>
          );

          return mobile ? link : <Tooltip label={item.label} key={item.to}>{link}</Tooltip>;
        })}
      </nav>

      <div className="mt-auto border-t border-border pt-4">
        <div className={cn("mb-3 flex items-center gap-3", !mobile && "md:justify-center lg:justify-start")}>
          <Avatar name={userName(auth)} size="lg" />
          <div className={cn("min-w-0", !mobile && "hidden lg:block")}>
            <strong className="block truncate text-sm">{userName(auth)}</strong>
            <div className="mt-1 flex items-center gap-2">
              <Badge variant="purple">{roleLabel(role)}</Badge>
              <span className="truncate text-xs text-text-muted">{userSubtitle(auth)}</span>
            </div>
          </div>
        </div>
        <Button
          as="a"
          href={logoutHref(role)}
          variant="ghost"
          className={cn("w-full justify-start", !mobile && "md:justify-center lg:justify-start")}
        >
          <LogOut size={18} />
          <span className={cn(!mobile && "hidden lg:inline")}>Logout</span>
        </Button>
      </div>
    </aside>
  );
}
