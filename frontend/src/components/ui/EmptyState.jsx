import { SearchX } from "lucide-react";
import { Button } from "./Button";
import { cn } from "./utils";

export function EmptyState({ icon: Icon = SearchX, heading, description, action, compact = false, className }) {
  return (
    <div
      className={cn(
        "grid place-items-center rounded-card border border-dashed border-border bg-background-card px-6 text-center shadow-card",
        compact ? "min-h-52 py-8" : "min-h-72 py-12",
        className
      )}
    >
      <div className="grid max-w-md place-items-center gap-3">
        <span className="grid h-14 w-14 place-items-center rounded-card bg-brand-primary/10 text-brand-primary">
          <Icon size={30} />
        </span>
        <h3 className="text-xl font-semibold text-text-primary">{heading}</h3>
        {description && <p className="text-text-secondary">{description}</p>}
        {action && (
          <Button as={action.href ? "a" : "button"} href={action.href} onClick={action.onClick} variant={action.variant || "primary"}>
            {action.label}
          </Button>
        )}
      </div>
    </div>
  );
}
