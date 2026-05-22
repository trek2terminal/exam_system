import { forwardRef } from "react";
import { cn } from "./utils";

const variants = {
  primary: "border-transparent bg-brand-primary text-white shadow-sm hover:bg-brand-hover focus-visible:ring-brand-primary",
  secondary: "border-border bg-background-surface text-text-primary hover:bg-background-elevated focus-visible:ring-brand-primary",
  ghost: "border-transparent bg-transparent text-text-secondary hover:bg-background-elevated hover:text-text-primary focus-visible:ring-brand-primary",
  danger: "border-transparent bg-danger text-white hover:brightness-95 focus-visible:ring-danger",
  success: "border-transparent bg-success text-white hover:brightness-95 focus-visible:ring-success"
};

const sizes = {
  sm: "min-h-11 px-3 text-sm",
  md: "min-h-11 px-4 text-sm",
  lg: "min-h-12 px-5 text-base"
};

export const Button = forwardRef(function Button(
  {
    as: Component = "button",
    type = "button",
    variant = "primary",
    size = "md",
    loading = false,
    loadingLabel = "Loading",
    disabled = false,
    className,
    children,
    ...props
  },
  ref
) {
  const isButton = Component === "button";
  return (
    <Component
      ref={ref}
      type={isButton ? type : undefined}
      aria-disabled={!isButton && (disabled || loading) ? "true" : undefined}
      disabled={isButton ? disabled || loading : undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md border font-semibold transition duration-150 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background-base",
        "active:scale-[0.97] disabled:pointer-events-none disabled:opacity-60",
        variants[variant] || variants.primary,
        sizes[size] || sizes.md,
        className
      )}
      {...props}
    >
      {loading && (
        <span className="h-5 w-5 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden="true" />
      )}
      <span>{loading ? loadingLabel : children}</span>
    </Component>
  );
});
