import { Card } from "./Card";
import { Skeleton, SkeletonCard, SkeletonStat, SkeletonTableRows } from "./Skeleton";
import { cn } from "./utils";

export function PageLoading({ title = "Loading workspace...", variant = "dashboard", className }) {
  const showTable = variant === "table" || variant === "reports";
  const showCards = variant !== "table";

  return (
    <div className={cn("space-y-6", className)} role="status" aria-live="polite" aria-label={title}>
      <div className="workspaceLoaderShell overflow-hidden rounded-card border border-border bg-background-card/80 p-4 shadow-card backdrop-blur-xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <span className="workspaceLoaderMark shrink-0" aria-hidden="true">
              <span />
            </span>
            <div className="min-w-0 flex-1">
              <p className="mb-2 text-sm font-semibold uppercase text-text-muted">{title}</p>
              <Skeleton className="mb-3 h-8 w-72 max-w-full" />
              <Skeleton className="h-4 w-[min(34rem,100%)]" />
            </div>
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-28" />
            <Skeleton className="h-10 w-24" />
          </div>
        </div>
        <div className="workspaceLoaderRail mt-4" aria-hidden="true">
          <span />
        </div>
      </div>

      {showCards && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map(item => <SkeletonStat key={item} index={item} />)}
        </div>
      )}

      {showTable ? (
        <Card className="overflow-hidden p-0">
          <div className="grid gap-3 border-b border-border p-4 lg:grid-cols-[minmax(220px,1fr)_repeat(3,minmax(140px,180px))]">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
          <SkeletonTableRows rows={6} />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <SkeletonCard index={0} />
          <SkeletonCard index={1} />
        </div>
      )}
    </div>
  );
}
