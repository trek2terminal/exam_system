import { cn } from "./utils";

const variants = {
  default: "bg-background-elevated text-text-secondary",
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  danger: "bg-danger/12 text-danger",
  info: "bg-info/12 text-info",
  purple: "bg-brand-primary/12 text-brand-primary"
};

const sizes = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-sm"
};

export function Badge({ variant = "default", size = "sm", dot = false, className, children }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill font-semibold capitalize",
        variants[variant] || variants.default,
        sizes[size] || sizes.sm,
        className
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}
