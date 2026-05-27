import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
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
  required = false,
  className
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref = useRef(null);
  const id = useId();
  const listboxId = `${id}-listbox`;
  const selected = options.find(option => option.value === value);
  const activeOption = options[activeIndex];

  const selectOption = option => {
    if (!option) return;
    onChange?.(option.value);
    setOpen(false);
    setActiveIndex(options.findIndex(item => item.value === option.value));
  };

  useEffect(() => {
    const onPointerDown = event => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = options.findIndex(option => option.value === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, options, value]);

  const onKeyDown = event => {
    if (disabled) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(current => {
        const fallback = options.findIndex(option => option.value === value);
        const start = current >= 0 ? current : Math.max(fallback, 0);
        if (event.key === "ArrowDown") return Math.min(start + 1, options.length - 1);
        return Math.max(start - 1, 0);
      });
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      selectOption(options[activeIndex]);
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className={cn("relative grid gap-2 text-sm font-medium text-text-secondary", className)} ref={ref}>
      {label && (
        <label htmlFor={id}>
          {label}
          {required && <span className="ml-1 text-danger" aria-hidden="true">*</span>}
        </label>
      )}
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-required={required || undefined}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && activeOption ? `${listboxId}-${activeOption.value}` : undefined}
        onClick={() => setOpen(current => !current)}
        onKeyDown={onKeyDown}
        className={cn(
          "flex min-h-10 w-full items-center justify-between rounded-md border bg-background-card/90 px-3 text-left text-sm text-text-primary shadow-sm transition duration-150 ease-out",
          "focus:outline-none focus:ring-2 focus:ring-brand-primary/20 disabled:cursor-not-allowed disabled:opacity-60",
          error ? "border-danger" : "border-border"
        )}
      >
        <span className={selected ? "" : "text-text-muted"}>{selected?.label || placeholder}</span>
        <ChevronDown size={18} className={cn("transition", open && "rotate-180")} />
      </button>
      {open && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-40 mt-2 max-h-64 overflow-auto rounded-md border border-border bg-background-card/95 shadow-elevated backdrop-blur-xl"
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              id={`${listboxId}-${option.value}`}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={cn(
                "flex min-h-10 w-full items-center justify-between gap-3 px-3 text-left text-sm text-text-primary transition hover:bg-background-elevated",
                index === activeIndex && "bg-background-elevated",
                option.value === value && "bg-brand-primary/10 text-brand-primary"
              )}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectOption(option)}
            >
              <span>{option.label}</span>
              {option.value === value && <Check size={16} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
      {error ? <span className="text-xs font-semibold text-danger">{error}</span> : null}
      {!error && helperText ? <span className="text-xs text-text-muted">{helperText}</span> : null}
    </div>
  );
}
