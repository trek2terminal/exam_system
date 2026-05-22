import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card } from "./Card";
import { cn } from "./utils";

export function StatCard({ icon: Icon, label, value = 0, trend, variant = "default", className }) {
  const [displayValue, setDisplayValue] = useState(0);
  const numericValue = Number(value || 0);

  useEffect(() => {
    let frameId;
    const start = (window.performance && window.performance.now && window.performance.now()) || Date.now();
    const duration = 600;
    const tick = now => {
      const current = now || ((window.performance && window.performance.now && window.performance.now()) || Date.now());
      const progress = Math.min((current - start) / duration, 1);
      setDisplayValue(Math.round(numericValue * progress));
      if (progress < 1) frameId = (window.requestAnimationFrame || (fn => window.setTimeout(fn, 16)))(tick);
    };
    frameId = (window.requestAnimationFrame || (fn => window.setTimeout(fn, 16)))(tick);
    return () => {
      if (window.cancelAnimationFrame) window.cancelAnimationFrame(frameId);
      else window.clearTimeout(frameId);
    };
  }, [numericValue]);

  const trendUp = Number(trend || 0) >= 0;

  return (
    <Card
      interactive
      className={cn("grid gap-4 p-5 animate-fade-in-up", className)}
      style={{ animationDelay: "var(--stagger-delay, 0ms)" }}
    >
      <div className="flex items-start justify-between gap-4">
        <span className={cn(
          "grid h-11 w-11 place-items-center rounded-lg",
          variant === "danger" ? "bg-danger/12 text-danger" : "bg-brand-primary/10 text-brand-primary"
        )}>
          {Icon && <Icon size={22} />}
        </span>
        {trend != null && (
          <span className={cn("inline-flex items-center gap-1 rounded-pill px-2 py-1 text-xs font-semibold", trendUp ? "bg-success/12 text-success" : "bg-danger/12 text-danger")}>
            {trendUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            {Math.abs(Number(trend))}%
          </span>
        )}
      </div>
      <div>
        <p className="mb-1 text-sm font-medium text-text-secondary">{label}</p>
        <strong className="text-3xl font-bold text-text-primary">{displayValue.toLocaleString()}</strong>
      </div>
    </Card>
  );
}
