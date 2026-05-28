import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  ariaLabel,
  className
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [floatingStyle, setFloatingStyle] = useState(null);
  const ref = useRef(null);
  const triggerRef = useRef(null);
  const listboxRef = useRef(null);
  const id = useId();
  const listboxId = `${id}-listbox`;
  const selected = options.find(option => option.value === value);
  const activeOption = options[activeIndex];

  const updateFloatingStyle = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const gutter = 12;
    const offset = 8;
    const preferredHeight = Math.min(260, Math.max(44, options.length * 44));
    const spaceBelow = viewportHeight - rect.bottom - gutter;
    const spaceAbove = rect.top - gutter;
    const placement = spaceBelow < Math.min(preferredHeight, 220) && spaceAbove > spaceBelow ? "top" : "bottom";
    const availableHeight = Math.max(140, placement === "top" ? spaceAbove - offset : spaceBelow - offset);
    const width = Math.min(Math.max(rect.width, 180), viewportWidth - gutter * 2);
    const left = Math.min(Math.max(rect.left, gutter), Math.max(gutter, viewportWidth - width - gutter));

    setFloatingStyle({
      left,
      width,
      maxHeight: Math.min(260, availableHeight),
      ...(placement === "top"
        ? { bottom: viewportHeight - rect.top + offset, transformOrigin: "bottom center" }
        : { top: rect.bottom + offset, transformOrigin: "top center" }),
      placement
    });
  }, [options.length]);

  const selectOption = option => {
    if (!option) return;
    onChange?.(option.value);
    setOpen(false);
    setActiveIndex(options.findIndex(item => item.value === option.value));
  };

  useEffect(() => {
    const onPointerDown = event => {
      const target = event.target;
      if (
        ref.current
        && !ref.current.contains(target)
        && listboxRef.current
        && !listboxRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    updateFloatingStyle();

    const onViewportChange = () => updateFloatingStyle();
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    window.visualViewport?.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      window.visualViewport?.removeEventListener("resize", onViewportChange);
    };
  }, [open, updateFloatingStyle]);

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
    <div className={cn("uiInputFrame grid min-w-0 gap-2 text-sm font-medium text-text-secondary", className)} ref={ref}>
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
        aria-label={!label ? (ariaLabel || placeholder) : undefined}
        ref={triggerRef}
        onClick={() => setOpen(current => !current)}
        onKeyDown={onKeyDown}
        className={cn(
          "uiInputControl flex min-h-10 w-full min-w-0 items-center justify-between gap-3 rounded-md border bg-background-card/90 px-3 text-left text-sm text-text-primary shadow-sm transition duration-150 ease-out",
          "focus:outline-none focus:ring-2 focus:ring-brand-primary/20 disabled:cursor-not-allowed disabled:opacity-60",
          error ? "border-danger" : "border-border"
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", selected ? "" : "text-text-muted")}>{selected?.label || placeholder}</span>
        <ChevronDown size={18} className={cn("shrink-0 transition", open && "rotate-180")} />
      </button>
      {open && floatingStyle && createPortal(
        <div
          id={listboxId}
          ref={listboxRef}
          role="listbox"
          style={{
            left: floatingStyle.left,
            width: floatingStyle.width,
            maxHeight: floatingStyle.maxHeight,
            top: floatingStyle.top,
            bottom: floatingStyle.bottom,
            transformOrigin: floatingStyle.transformOrigin
          }}
          className={cn(
            "selectFloatingMenu fixed z-[1000] overflow-auto rounded-md border border-border/90 bg-background-card/95 shadow-elevated backdrop-blur-xl",
            floatingStyle.placement === "top" && "selectFloatingMenuTop"
          )}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              id={`${listboxId}-${option.value}`}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={cn(
                "flex min-h-10 w-full min-w-0 items-center justify-between gap-3 px-3 text-left text-sm text-text-primary transition hover:bg-background-elevated",
                index === activeIndex && "bg-background-elevated",
                option.value === value && "bg-brand-primary/10 text-brand-primary"
              )}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectOption(option)}
            >
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.value === value && <Check size={16} className="shrink-0" aria-hidden="true" />}
            </button>
          ))}
        </div>,
        document.body
      )}
      {error ? <span className="text-xs font-semibold text-danger">{error}</span> : null}
      {!error && helperText ? <span className="text-xs text-text-muted">{helperText}</span> : null}
    </div>
  );
}
