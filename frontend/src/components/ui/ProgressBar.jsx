import { cn } from "./utils";

const variants = {
  default: "bg-brand-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  purple: "bg-brand-primary"
};

export function ProgressBar({ value = 0, max = 100, variant = "default", className, label }) {
  const percent = max > 0 ? Math.min(Math.max((Number(value) / Number(max)) * 100, 0), 100) : 0;
  return (
    <div className={cn("grid gap-2", className)}>
      {label && <div className="text-xs font-semibold text-text-muted">{label}</div>}
      <div className="h-2 overflow-hidden rounded-pill bg-background-elevated">
        <div
          className={cn("h-full rounded-pill transition-[width] duration-300 ease-out", variants[variant] || variants.default)}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
