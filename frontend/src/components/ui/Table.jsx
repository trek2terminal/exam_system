import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Inbox } from "lucide-react";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import { SkeletonTableRows } from "./Skeleton";
import { cn } from "./utils";

export function Table({
  columns = [],
  data = [],
  loading = false,
  emptyMessage = "No records found",
  rowKey = "id",
  rowsPerPageOptions = [5, 10, 20],
  renderRowActions,
  tableClassName,
  className
}) {
  const [sort, setSort] = useState(null);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(rowsPerPageOptions[0] || 5);

  const sortedData = useMemo(() => {
    if (!sort) return data;
    const column = columns.find(item => item.key === sort.key);
    if (!column?.sortable) return data;
    return [...data].sort((left, right) => {
      const leftValue = column.accessor ? column.accessor(left) : left[sort.key];
      const rightValue = column.accessor ? column.accessor(right) : right[sort.key];
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        return (leftValue - rightValue) * (sort.direction === "asc" ? 1 : -1);
      }
      return String(leftValue ?? "").localeCompare(String(rightValue ?? "")) * (sort.direction === "asc" ? 1 : -1);
    });
  }, [columns, data, sort]);

  const pageCount = Math.max(Math.ceil(sortedData.length / rowsPerPage), 1);
  const visibleRows = sortedData.slice((page - 1) * rowsPerPage, page * rowsPerPage);
  const totalColumns = columns.length + (renderRowActions ? 1 : 0);

  useEffect(() => {
    setPage(current => Math.min(current, pageCount));
  }, [pageCount]);

  const toggleSort = key => {
    setSort(current => {
      if (!current || current.key !== key) return { key, direction: "asc" };
      if (current.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  };

  const paginationItems = useMemo(() => {
    if (pageCount <= 5) return Array.from({ length: pageCount }, (_, index) => index + 1);
    if (page <= 3) return [1, 2, 3, 4, "ellipsis-end", pageCount];
    if (page >= pageCount - 2) return [1, "ellipsis-start", pageCount - 3, pageCount - 2, pageCount - 1, pageCount];
    return [1, "ellipsis-start", page - 1, page, page + 1, "ellipsis-end", pageCount];
  }, [page, pageCount]);

  return (
    <section className={cn("overflow-hidden rounded-card border border-border/80 bg-background-card/88 shadow-card backdrop-blur-xl", className)}>
      <div className="overflow-auto">
        <table className={cn("min-w-full border-collapse text-left text-sm", tableClassName)}>
          <thead className="sticky top-0 z-10 bg-background-surface/95 text-text-secondary backdrop-blur-xl">
            <tr>
              {columns.map(column => {
                const isSorted = sort?.key === column.key;
                const ariaSort = isSorted ? (sort.direction === "asc" ? "ascending" : "descending") : "none";
                return (
                  <th
                    className={cn("whitespace-nowrap px-3 py-2.5 text-xs font-bold uppercase", column.headerClassName)}
                    key={column.key}
                    role="columnheader"
                    scope="col"
                    aria-sort={column.sortable ? ariaSort : undefined}
                  >
                    {column.sortable ? (
                      <button
                        className="group inline-flex items-center gap-1"
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        aria-label={`Sort by ${column.header}`}
                      >
                        {column.header}
                        {isSorted ? (
                          sort.direction === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                        ) : (
                          <ChevronsUpDown size={14} className="opacity-0 transition group-hover:opacity-100" />
                        )}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
              {renderRowActions && (
                <th className="w-[190px] whitespace-nowrap px-3 py-2.5 text-right text-xs font-bold uppercase" scope="col">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={totalColumns}><SkeletonTableRows rows={rowsPerPage} /></td>
              </tr>
            ) : visibleRows.map((row, index) => (
              <tr className="group animate-fade-in-up bg-background-card/70 transition hover:bg-background-surface/90" key={row[rowKey] || index} role="row" style={{ animationDelay: `${Math.min(index, 8) * 25}ms` }}>
                {columns.map(column => (
                  <td className={cn("px-3 py-2.5 text-text-primary", column.cellClassName)} key={column.key} role="cell">
                    {column.render ? column.render(row) : row[column.key]}
                  </td>
                ))}
                {renderRowActions && (
                  <td className="w-[190px] min-w-[190px] px-3 py-2.5 text-right" role="cell">
                    <div className="inline-flex min-h-10 items-center justify-end gap-1.5 opacity-100 transition md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                      {renderRowActions(row)}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && data.length === 0 && (
        <EmptyState icon={Inbox} heading={emptyMessage} description="New records will appear here when available." compact className="rounded-none border-0" />
      )}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2.5 text-sm text-text-secondary">
        <span>Page {page} of {pageCount}</span>
        <div className="flex items-center gap-2">
          <select
            className="h-9 rounded-md border border-border bg-background-card px-2 text-sm text-text-primary shadow-sm"
            aria-label="Rows per page"
            value={rowsPerPage}
            onChange={event => {
              setRowsPerPage(Number(event.target.value));
              setPage(1);
            }}
          >
            {rowsPerPageOptions.map(option => <option key={option} value={option}>{option} rows</option>)}
          </select>
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(current => current - 1)}>Previous</Button>
          <div className="hidden items-center gap-1 sm:flex">
            {paginationItems.map(item => (
              typeof item === "number" ? (
                <Button
                  key={item}
                  variant={item === page ? "primary" : "secondary"}
                  size="sm"
                  className="h-10 min-h-10 w-10 px-0"
                  aria-current={item === page ? "page" : undefined}
                  onClick={() => setPage(item)}
                >
                  {item}
                </Button>
              ) : (
                <span key={item} className="px-2 text-text-muted" aria-hidden="true">...</span>
              )
            ))}
          </div>
          <Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => setPage(current => current + 1)}>Next</Button>
        </div>
      </footer>
    </section>
  );
}
