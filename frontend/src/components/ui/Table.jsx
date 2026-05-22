import { useMemo, useState } from "react";
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
      return String(leftValue ?? "").localeCompare(String(rightValue ?? "")) * (sort.direction === "asc" ? 1 : -1);
    });
  }, [columns, data, sort]);

  const pageCount = Math.max(Math.ceil(sortedData.length / rowsPerPage), 1);
  const visibleRows = sortedData.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  const toggleSort = key => {
    setSort(current => {
      if (!current || current.key !== key) return { key, direction: "asc" };
      if (current.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  };

  return (
    <section className={cn("overflow-hidden rounded-card border border-border bg-background-surface shadow-card", className)}>
      <div className="overflow-auto">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 bg-background-surface text-text-secondary">
            <tr>
              {columns.map(column => {
                const isSorted = sort?.key === column.key;
                const ariaSort = isSorted ? (sort.direction === "asc" ? "ascending" : "descending") : "none";
                return (
                  <th
                    className="whitespace-nowrap px-4 py-3 font-semibold"
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
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={columns.length}><SkeletonTableRows rows={rowsPerPage} /></td>
              </tr>
            ) : visibleRows.map((row, index) => (
              <tr className="group bg-background-base transition hover:bg-background-elevated/70" key={row[rowKey] || index} role="row">
                {columns.map(column => (
                  <td className="px-4 py-3 text-text-primary" key={column.key} role="cell">
                    {column.render ? column.render(row) : row[column.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && data.length === 0 && (
        <EmptyState icon={Inbox} heading={emptyMessage} description="The table will update as soon as data is available." compact className="rounded-none border-0" />
      )}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-text-secondary">
        <span>Page {page} of {pageCount}</span>
        <div className="flex items-center gap-2">
          <select
            className="h-10 rounded-md border border-border bg-background-base px-2 text-text-primary"
            value={rowsPerPage}
            onChange={event => {
              setRowsPerPage(Number(event.target.value));
              setPage(1);
            }}
          >
            {rowsPerPageOptions.map(option => <option key={option} value={option}>{option} rows</option>)}
          </select>
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(current => current - 1)}>Previous</Button>
          <Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => setPage(current => current + 1)}>Next</Button>
        </div>
      </footer>
    </section>
  );
}
