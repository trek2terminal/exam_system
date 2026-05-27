import { cn } from "./utils";

const variants = {
  default: "bg-background-card/88 shadow-card backdrop-blur-xl",
  elevated: "bg-background-card/92 shadow-elevated backdrop-blur-xl",
  flat: "bg-background-card/80 shadow-none backdrop-blur-xl"
};

export function Card({ variant = "default", interactive = false, className, children, ...props }) {
  const interactiveClasses =
    "hover:-translate-y-0.5 hover:shadow-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/30";

  const roleAttrs = {};
  if (interactive && props.onClick) {
    roleAttrs.role = "button";
    roleAttrs.tabIndex = props.tabIndex ?? 0;
    roleAttrs.onKeyDown = event => {
      if (event.key === "Enter" || event.key === " ") {
        props.onClick?.(event);
      }
      props.onKeyDown?.(event);
    };
  }

  return (
    <section
      className={cn(
        "rounded-card border border-border/80 text-text-primary transition duration-200 ease-out",
        variants[variant] || variants.default,
        interactive && interactiveClasses,
        className
      )}
      {...roleAttrs}
      {...props}
    >
      {children}
    </section>
  );
}

export function CardHeader({ className, children }) {
  return <div className={cn("border-b border-border px-5 py-4", className)}>{children}</div>;
}

export function CardBody({ className, children }) {
  return <div className={cn("px-5 py-5", className)}>{children}</div>;
}

export function CardFooter({ className, children }) {
  return <div className={cn("border-t border-border px-5 py-4", className)}>{children}</div>;
}
