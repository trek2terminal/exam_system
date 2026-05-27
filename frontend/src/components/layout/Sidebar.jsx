import { Link, useLocation } from "react-router-dom";
import { LogOut } from "lucide-react";
import { Avatar, Badge, Button, PlatformLogo, Tooltip, cn } from "../ui";
import { logoutHref, roleLabel, roleNavigation, userName } from "./navigation";

export function Sidebar({ auth, platformName, platformLogoUrl, mobile = false, onNavigate }) {
  const location = useLocation();
  const role = auth?.role;
  const items = roleNavigation[role] || [];

  return (
    <aside
      className={cn(
        "flex h-full flex-col overflow-y-auto border-r border-white/10 bg-background-card/95 text-text-primary shadow-lg backdrop-blur-2xl dark:bg-[#0b1020]/95",
        mobile ? "w-72 p-5" : "fixed inset-y-0 left-0 z-30 hidden w-16 p-3 md:flex lg:w-56 lg:p-4"
      )}
    >
      <div className={cn("mb-5 flex items-center gap-3", !mobile && "md:justify-center lg:justify-start")}>
        <PlatformLogo
          src={platformLogoUrl}
          name={platformName || "Exam Platform"}
          size="xs"
          fallbackRounded="full"
          className="border-0 shadow-none"
          imageClassName="max-h-9 max-w-9 p-0"
        />
        <div className={cn("min-w-0", !mobile && "hidden lg:block")}>
          <strong className="block truncate text-sm font-bold">{platformName || "Exam Platform"}</strong>
          <span className="block truncate text-xs text-text-muted">Focused assessment</span>
        </div>
      </div>

      <nav className="grid gap-1.5 border-b border-white/10 pb-4">
        {items.map(item => {
          const Icon = item.icon;
          const active = location.pathname === item.to || (item.to !== `/${role}` && location.pathname.startsWith(`${item.to}/`));
          const link = (
            <Link
              key={item.to}
              className={cn(
                "flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-all duration-200",
                active
                  ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-950/25"
                  : "text-gray-400 hover:bg-white/5 hover:text-white hover:translate-x-0.5",
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

      <div className="mt-auto border-t border-white/10 pt-4">
        <div className={cn("mb-3 flex min-h-11 items-center gap-3", !mobile && "md:justify-center lg:justify-start")}>
          <Avatar name={userName(auth)} src={auth?.profile_picture} size="md" />
          <div className={cn("min-w-0 flex-1 items-center gap-2", !mobile && "hidden lg:flex", mobile && "flex")}>
            <strong className="min-w-0 flex-1 truncate text-sm">{userName(auth)}</strong>
            <Badge variant="purple" size="sm">{roleLabel(role)}</Badge>
          </div>
        </div>
        <Button
          as="a"
          href={logoutHref(role)}
          variant="ghost"
          className={cn(
            "w-full justify-start text-text-secondary hover:bg-danger/10 hover:text-danger",
            !mobile && "md:justify-center lg:justify-start"
          )}
        >
          <LogOut size={18} />
          <span className={cn(!mobile && "hidden lg:inline")}>Logout</span>
        </Button>
      </div>
    </aside>
  );
}
