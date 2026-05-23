import { cn } from "./utils";

export function Skeleton({ className }) {
  return (
    <span
      className={cn(
        "block rounded-md skeleton",
        className
      )}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-card border border-border bg-background-card p-5 shadow-card">
      <Skeleton className="mb-4 h-5 w-2/3" />
      <Skeleton className="mb-3 h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  );
}

export function SkeletonTableRows({ rows = 5 }) {
  return Array.from({ length: rows }).map((_, index) => (
    <div className="grid grid-cols-4 gap-4 border-t border-border px-4 py-3" key={index}>
      <Skeleton className="h-4" />
      <Skeleton className="h-4" />
      <Skeleton className="h-4" />
      <Skeleton className="h-4" />
    </div>
  ));
}

export function SkeletonStat() {
  return (
    <div className="rounded-card border border-border bg-background-card p-5 shadow-card">
      <Skeleton className="mb-5 h-10 w-10 rounded-lg" />
      <Skeleton className="mb-3 h-4 w-1/2" />
      <Skeleton className="h-8 w-1/3" />
    </div>
  );
}
