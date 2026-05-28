import { Pause, Play, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./Button";
import { cn } from "./utils";

function relativeTime(timestamp, now) {
  if (!timestamp) return "Not synced yet";
  const elapsedSeconds = Math.max(Math.floor((now - timestamp) / 1000), 0);
  if (elapsedSeconds < 5) return "Updated just now";
  if (elapsedSeconds < 60) return `Updated ${elapsedSeconds}s ago`;
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  return `Updated ${Math.floor(minutes / 60)}h ago`;
}

export function RefreshStatus({
  refreshing = false,
  lastUpdated = null,
  isStale = false,
  livePaused = false,
  onToggleLive,
  onRefresh,
  className
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(intervalId);
  }, []);

  const label = livePaused
    ? "Live paused"
    : refreshing
      ? "Syncing..."
      : relativeTime(lastUpdated, now);
  const stale = Boolean(isStale || (!livePaused && lastUpdated && now - lastUpdated > 60000));

  return (
    <div
      className={cn(
        "inline-flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background-card px-2 py-1.5 text-sm text-text-secondary shadow-sm",
        stale && !livePaused && "border-warning/40 bg-warning/5 text-warning",
        className
      )}
      aria-live="polite"
    >
      <span className="inline-flex items-center gap-2 px-1">
        <RefreshCw size={15} className={cn(refreshing && "animate-spin")} />
        <span>{label}</span>
      </span>
      {onRefresh && (
        <Button variant="ghost" size="sm" className="min-h-8 px-2" onClick={onRefresh} disabled={refreshing}>
          Refresh
        </Button>
      )}
      {onToggleLive && (
        <Button variant={livePaused ? "primary" : "secondary"} size="sm" className="min-h-8 px-2" onClick={onToggleLive}>
          {livePaused ? <Play size={14} /> : <Pause size={14} />}
          {livePaused ? "Resume live" : "Pause live"}
        </Button>
      )}
    </div>
  );
}
