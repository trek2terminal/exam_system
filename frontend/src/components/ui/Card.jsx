import { cn } from "./utils";

const variants = {
  default: "bg-background-surface shadow-card",
  elevated: "bg-background-elevated shadow-elevated",
  flat: "bg-background-surface shadow-none"
};

export function Card({ variant = "default", interactive = false, className, children, ...props }) {
  return (
    <section
      className={cn(
        "rounded-card border border-border text-text-primary transition duration-200 ease-out",
        variants[variant] || variants.default,
        interactive && "hover:-translate-y-0.5 hover:scale-[1.01] hover:shadow-elevated",
        className
      )}
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
