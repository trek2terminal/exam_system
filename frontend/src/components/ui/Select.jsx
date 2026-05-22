import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "./utils";

export function Select({
  label,
  value,
  onChange,
  options = [],
  placeholder = "Select",
  error,
  helperText,
  disabled = false,
  className
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const id = useId();
  const selected = options.find(option => option.value === value);

  useEffect(() => {
    const onPointerDown = event => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return (
    <div className={cn("relative grid gap-2 text-sm font-medium text-text-secondary", className)} ref={ref}>
      {label && <label htmlFor={id}>{label}</label>}
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(current => !current)}
        className={cn(
          "flex min-h-11 w-full items-center justify-between rounded-md border bg-white px-3 text-left text-base text-text-primary transition duration-150 ease-out",
          "focus:outline-none focus:ring-2 focus:ring-brand-primary/20 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-background-base",
          error ? "border-danger" : "border-border"
        )}
      >
        <span className={selected ? "" : "text-text-muted"}>{selected?.label || placeholder}</span>
        <ChevronDown size={18} className={cn("transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-md border border-border bg-background-surface shadow-elevated">
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              className={cn(
                "block min-h-11 w-full px-3 text-left text-sm text-text-primary transition hover:bg-background-elevated",
                option.value === value && "bg-brand-primary/10 text-brand-primary"
              )}
              onClick={() => {
                onChange?.(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      {error ? <span className="text-xs font-semibold text-danger">{error}</span> : null}
      {!error && helperText ? <span className="text-xs text-text-muted">{helperText}</span> : null}
    </div>
  );
}
