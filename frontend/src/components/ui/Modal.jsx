import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";
import { cn } from "./utils";

export function Modal({ open, onClose, title, children, footer, required = false, className }) {
  const [mounted, setMounted] = useState(open);
  const [isVisible, setIsVisible] = useState(false);
  const closeTimeoutRef = useRef(null);

  useEffect(() => () => window.clearTimeout(closeTimeoutRef.current), []);

  useEffect(() => {
    window.clearTimeout(closeTimeoutRef.current);

    if (open) {
      setMounted(true);
      const frame = window.requestAnimationFrame(() => setIsVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }

    setIsVisible(false);
    closeTimeoutRef.current = window.setTimeout(() => setMounted(false), 150);
    return undefined;
  }, [open]);

  const startClose = useCallback(() => {
    if (required) return;
    window.clearTimeout(closeTimeoutRef.current);
    setIsVisible(false);
    closeTimeoutRef.current = window.setTimeout(() => {
      setMounted(false);
      onClose?.();
    }, 150);
  }, [onClose, required]);

  useEffect(() => {
    if (!mounted) return undefined;
    const onKeyDown = event => {
      if (event.key === "Escape" && !required) startClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mounted, required, startClose]);

  if (!mounted) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 grid place-items-center modal-backdrop p-4 transition-opacity",
        isVisible ? "opacity-100 duration-200 ease-out" : "opacity-0 duration-150 ease-in"
      )}
      role="presentation"
      onClick={() => {
        startClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        onClick={event => event.stopPropagation()}
        className={cn(
          "max-h-[88vh] w-full max-w-xl overflow-hidden rounded-card border border-border/80 bg-background-card/95 shadow-elevated backdrop-blur-2xl transition",
          isVisible ? "scale-100 opacity-100 duration-200 ease-out" : "scale-95 opacity-0 duration-150 ease-in",
          className
        )}
      >
        <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
          <h2 id="modal-title" className="text-lg font-semibold text-text-primary">{title}</h2>
          {!required && (
            <Button variant="ghost" size="sm" className="h-11 w-11 px-0" onClick={startClose} aria-label="Close modal">
              <X size={18} />
            </Button>
          )}
        </header>
        <div className="max-h-[58vh] overflow-auto px-4 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-3 border-t border-border px-4 py-3">{footer}</footer>}
      </section>
    </div>
  );
}
