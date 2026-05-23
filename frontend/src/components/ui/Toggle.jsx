import { cn } from "./utils";

const sizes = {
  sm: {
    track: "h-5 w-9",
    knob: "h-4 w-4 peer-checked:translate-x-4",
    label: "text-sm"
  },
  md: {
    track: "h-6 w-11",
    knob: "h-5 w-5 peer-checked:translate-x-5",
    label: "text-sm"
  },
  lg: {
    track: "h-7 w-14",
    knob: "h-6 w-6 peer-checked:translate-x-7",
    label: "text-base"
  }
};

export function Toggle({ checked = false, onChange, label, disabled = false, size = "md", className }) {
  const scale = sizes[size] || sizes.md;

  return (
    <label
      className={cn(
        "inline-flex min-h-11 items-center gap-3",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        className
      )}
    >
      <span className="relative inline-flex shrink-0 items-center">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={event => onChange?.(event.target.checked, event)}
          className="peer sr-only"
        />
        <span
          className={cn(
            "rounded-pill bg-background-elevated transition-colors duration-200 ease-out peer-focus-visible:ring-2 peer-focus-visible:ring-brand-primary/30 peer-checked:bg-brand-primary",
            scale.track
          )}
        />
        <span
          className={cn(
            "pointer-events-none absolute left-0.5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out",
            scale.knob
          )}
        />
      </span>
      {label && <span className={cn("font-semibold text-text-primary", scale.label)}>{label}</span>}
    </label>
  );
}
