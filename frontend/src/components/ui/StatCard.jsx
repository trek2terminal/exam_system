import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card } from "./Card";
import { cn } from "./utils";

const iconTones = {
  default: "bg-brand-primary/10 text-brand-primary",
  indigo: "bg-brand-primary/10 text-brand-primary",
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
  purple: "bg-purple-500/10 text-purple-500 dark:text-purple-300",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger"
};

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

  const hasTrend = trend != null && trend !== "";
  const trendUp = Number(trend || 0) >= 0;

  return (
    <Card
      interactive
      className={cn(
        "grid gap-4 p-5 animate-fade-in-up hover:border-brand-primary/35 hover:shadow-elevated",
        className
      )}
      style={{ animationDelay: "var(--stagger-delay, 0ms)" }}
    >
      <div className="flex items-start justify-between gap-4">
        <span className={cn(
          "grid h-11 w-11 place-items-center rounded-lg",
          iconTones[variant] || iconTones.default
        )}>
          {Icon && <Icon size={22} />}
        </span>
        {hasTrend && (
          <span className={cn("inline-flex items-center gap-1 rounded-pill px-2 py-1 text-xs font-semibold", trendUp ? "bg-success/10 text-success" : "bg-danger/10 text-danger")}>
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
