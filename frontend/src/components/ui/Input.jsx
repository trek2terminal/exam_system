import { forwardRef, useId } from "react";
import { cn } from "./utils";

export const Input = forwardRef(function Input(
  { label, error, helperText, className, id, disabled, ...props },
  ref
) {
  const generatedId = useId();
  const inputId = id || generatedId;

  return (
    <label className="grid gap-2 text-sm font-medium text-text-secondary" htmlFor={inputId}>
      {label && <span>{label}</span>}
      <input
        ref={ref}
        id={inputId}
        disabled={disabled}
        className={cn(
          "min-h-11 w-full rounded-md border bg-white px-3 text-base text-text-primary outline-none transition duration-150 ease-out",
          "placeholder:text-text-muted focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20",
          "disabled:cursor-not-allowed disabled:opacity-60 dark:bg-background-base",
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
