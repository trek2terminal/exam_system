import { cn } from "./utils";

const sizes = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
  xl: "h-14 w-14 text-lg"
};

const palette = [
  "rgb(var(--color-brand-primary))",
  "rgb(var(--color-info))",
  "rgb(var(--color-success))",
  "rgb(var(--color-warning))",
  "rgb(var(--color-danger))",
  "rgb(var(--color-brand-primary-hover))",
  "rgb(var(--color-success))"
];

function initials(name = "") {
  return String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join("") || "U";
}

function colorFor(name = "") {
  const sum = Array.from(String(name)).reduce((total, char) => total + char.charCodeAt(0), 0);
  return palette[sum % palette.length];
}

export function Avatar({ name, src, size = "md", className }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white",
        sizes[size] || sizes.md,
        className
      )}
      style={{ backgroundColor: src ? undefined : colorFor(name) }}
      aria-label={name || "User avatar"}
    >
      {src ? <img className="h-full w-full object-cover" src={src} alt="" /> : initials(name)}
    </span>
  );
}
