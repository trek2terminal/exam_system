import { CalendarDays } from "lucide-react";
import { cn } from "./utils";

export function DateInput({ label, id, className, inputClassName, ...props }) {
  const inputId = id || props.name || `date-${label || "input"}`.replace(/\s+/g, "-").toLowerCase();
  const required = Boolean(props.required);

  return (
    <label className={cn("block", className)} htmlFor={inputId}>
      {label && (
        <span className="mb-2 block text-sm font-semibold text-text-secondary">
          {label}
          {required && <span className="ml-1 text-danger" aria-hidden="true">*</span>}
        </span>
      )}
      <span className="relative block">
        <input
          id={inputId}
          type="date"
          aria-required={required || undefined}
          className={cn(
            "h-10 w-full rounded-md border border-border bg-background-card px-3 pr-10 text-sm text-text-primary shadow-sm outline-none transition duration-150 placeholder:text-text-muted focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-background-base [&::-webkit-calendar-picker-indicator]:opacity-0",
            inputClassName
          )}
          {...props}
        />
        <CalendarDays className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" size={18} />
      </span>
    </label>
  );
}
