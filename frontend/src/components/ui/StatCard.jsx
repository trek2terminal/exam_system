import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, ChevronRight } from "lucide-react";
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

export function StatCard({
  icon: Icon,
  label,
  value = 0,
  trend,
  variant = "default",
  className,
  to,
  href,
  onClick,
  ariaLabel,
  style
}) {
  const [displayValue, setDisplayValue] = useState(0);
  const previousValueRef = useRef(0);
  const numericValue = Number(value || 0);

  useEffect(() => {
    const startValue = previousValueRef.current;
    previousValueRef.current = numericValue;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      setDisplayValue(numericValue);
      return undefined;
    }
    let frameId;
    const start = (window.performance && window.performance.now && window.performance.now()) || Date.now();
    const duration = 600;
    const tick = now => {
      const current = now || ((window.performance && window.performance.now && window.performance.now()) || Date.now());
      const progress = Math.min((current - start) / duration, 1);
      setDisplayValue(Math.round(startValue + (numericValue - startValue) * progress));
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
  const clickable = Boolean(to || href || onClick);
  const Component = to ? Link : href ? "a" : onClick ? "button" : "section";
  const navigationProps = to ? { to } : href ? { href } : {};

  return (
    <Card
      as={Component}
      interactive={clickable}
      onClick={onClick}
      aria-label={ariaLabel || (clickable ? `Open ${label}` : undefined)}
      {...navigationProps}
      className={cn(
        "statCardSurface group grid min-h-[10.25rem] gap-3 p-4 animate-fade-in-up text-left no-underline hover:border-brand-primary/35 hover:shadow-elevated",
        clickable && "cursor-pointer active:scale-[0.99]",
        className
      )}
      style={{ animationDelay: "var(--stagger-delay, 0ms)", ...style }}
    >
      <div className="flex items-start justify-between gap-4">
        <span className={cn(
          "grid h-9 w-9 place-items-center rounded-lg",
          iconTones[variant] || iconTones.default
        )}>
          {Icon && <Icon size={19} />}
        </span>
        {hasTrend && (
          <span className={cn("inline-flex items-center gap-1 rounded-pill px-2 py-1 text-xs font-semibold", trendUp ? "bg-success/10 text-success" : "bg-danger/10 text-danger")}>
            {trendUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            {Math.abs(Number(trend))}%
          </span>
        )}
        {!hasTrend && clickable && (
          <span className="statCardCue grid h-8 w-8 place-items-center rounded-full border border-border/80 bg-background-base text-text-muted transition group-hover:border-brand-primary/30 group-hover:text-brand-primary" aria-hidden="true">
            <ChevronRight size={16} />
          </span>
        )}
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold text-text-secondary">{label}</p>
        <strong className="text-2xl font-bold text-text-primary">{displayValue.toLocaleString()}</strong>
      </div>
    </Card>
  );
}
