import { cn } from "./utils";

const variants = {
  default: "bg-background-elevated text-text-secondary",
  primary: "bg-brand-primary text-white",
  secondary: "bg-background-elevated text-text-secondary",
  calm: "bg-background-elevated text-text-muted",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
  info: "bg-info/10 text-info",
  purple: "bg-brand-primary/10 text-brand-primary"
};

const sizes = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-sm"
};

export function Badge({ variant = "default", size = "sm", dot = false, className, children }) {
  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill font-semibold capitalize focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/30",
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
