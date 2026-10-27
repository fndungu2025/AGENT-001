import type { ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  numeric?: boolean;
  sortable?: boolean;
  /** first column is rendered as a row header */
  rowHeader?: boolean;
}

interface Props<T> {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sort?: { key: string; dir: "asc" | "desc" };
  onSort?: (key: string) => void;
  hideCaption?: boolean;
  empty?: string;
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  hideCaption,
  empty = "Nothing to show.",
}: Props<T>) {
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="data">
        <caption className={hideCaption ? "sr-only" : undefined}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={c.numeric ? "num" : undefined}
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                >
                  {c.sortable && onSort ? (
                    <button
                      type="button"
                      className="th-btn"
                      onClick={() => {
                        onSort(c.key);
                      }}
                    >
                      {c.header}
                      <span aria-hidden="true">{active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>{empty}</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={rowKey(r)}>
                {columns.map((c) =>
                  c.rowHeader ? (
                    <th key={c.key} scope="row">
                      {c.render(r)}
                    </th>
                  ) : (
                    <td key={c.key} className={c.numeric ? "num" : undefined}>
                      {c.render(r)}
                    </td>
                  ),
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
