import { cn } from "./utils";

export function Tooltip({ label, children, className }) {
  return (
    <span className={cn("group relative inline-flex", className)}>
      {children}
      <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 rounded-md tooltip-bg px-2.5 py-1.5 text-xs font-semibold text-white opacity-0 shadow-lg transition delay-300 duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
        {label}
      </span>
    </span>
  );
}
