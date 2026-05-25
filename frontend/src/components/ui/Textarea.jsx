import { forwardRef, useId } from "react";
import { cn } from "./utils";

export const Textarea = forwardRef(function Textarea(
  { label, error, helperText, className, id, disabled, required = false, ...props },
  ref
) {
  const generatedId = useId();
  const inputId = id || generatedId;

  return (
    <label className="grid gap-2 text-sm font-medium text-text-secondary" htmlFor={inputId}>
      {label && (
        <span>
          {label}
          {required && <span className="ml-1 text-danger" aria-hidden="true">*</span>}
        </span>
      )}
      <textarea
        ref={ref}
        id={inputId}
        disabled={disabled}
        required={required}
        aria-required={required || undefined}
        className={cn(
          "min-h-28 w-full resize-y rounded-md border bg-background-card px-3 py-3 text-base text-text-primary shadow-sm outline-none transition duration-150 ease-out",
          "placeholder:text-text-muted focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20",
          "disabled:cursor-not-allowed disabled:opacity-60",
          error ? "border-danger focus:border-danger focus:ring-danger/20" : "border-border",
          className
        )}
        {...props}
      />
      {error ? <span className="text-xs font-semibold text-danger">{error}</span> : null}
      {!error && helperText ? <span className="text-xs text-text-muted">{helperText}</span> : null}
    </label>
  );
});
