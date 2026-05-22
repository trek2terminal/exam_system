import { useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";
import { cn } from "./utils";

export function Modal({ open, onClose, title, children, footer, required = false, className }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = event => {
      if (event.key === "Escape" && !required) onClose?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, required]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center modal-backdrop p-4 animate-page-fade"
      role="presentation"
      onClick={() => {
        if (!required) onClose?.();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        onClick={event => event.stopPropagation()}
        className={cn(
          "max-h-[88vh] w-full max-w-xl overflow-hidden rounded-card border border-border bg-background-surface shadow-elevated animate-modal-in",
          className
        )}
      >
        <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <h2 id="modal-title" className="text-xl font-semibold text-text-primary">{title}</h2>
          {!required && (
            <Button variant="ghost" size="sm" className="h-11 w-11 px-0" onClick={onClose} aria-label="Close modal">
              <X size={18} />
            </Button>
          )}
        </header>
        <div className="max-h-[58vh] overflow-auto px-5 py-5">{children}</div>
        {footer && <footer className="flex justify-end gap-3 border-t border-border px-5 py-4">{footer}</footer>}
      </section>
    </div>
  );
}
