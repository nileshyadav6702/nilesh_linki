import { RiArrowLeftSLine, RiArrowRightSLine } from "react-icons/ri";

/** "Showing 1 to 100 of 897 results · Show [100] per page · ‹ 1 2 3 4 5 ›" */
/** "all" is sent as ALL_ROWS, the most the server returns in one page. */
export const ALL_ROWS = 5000;

export default function Pagination({ page, pageSize, total, setPage, setPageSize, sizes = [25, 50, 100, 200, 1000] }: {
  page: number; pageSize: number; total: number; setPage: (p: number) => void; setPageSize: (n: number) => void;
  /** Page-size options; ALL_ROWS shows as "all". */
  sizes?: number[];
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  // A window of five pages around the current one.
  const start = Math.max(0, Math.min(page - 2, pages - 5));
  const nums = Array.from({ length: Math.min(5, pages) }, (_, i) => start + i);
  const cell = "flex h-11 min-w-11 items-center justify-center border-l border-[var(--border-subtle)] px-3 text-[16px] transition-colors first:border-l-0 disabled:cursor-not-allowed disabled:text-base-content/25";
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border-subtle)] px-6 py-4">
      <div className="text-[16px] text-base-content/80">
        {total ? <>Showing <b className="font-medium">{page * pageSize + 1}</b> to <b className="font-medium">{Math.min(total, (page + 1) * pageSize)}</b> of <b className="font-medium">{total.toLocaleString()}</b> results</> : "No results"}
      </div>
      <div className="flex flex-wrap items-center gap-6">
        <label className="flex items-center gap-3 text-[16px] text-base-content/80">
          Show:
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Contacts per page"
            className="h-11 rounded-[8px] border border-[var(--border-strong)] bg-base-100 px-3 pr-8 text-[16px] outline-none focus:ring-2 focus:ring-[var(--ring)]">
            {sizes.map((n) => <option key={n} value={n}>{n === ALL_ROWS ? "all" : n}</option>)}
          </select>
          per page
        </label>
        <nav aria-label="Pagination" className="flex overflow-hidden rounded-[10px] border border-[var(--border-subtle)] bg-base-100">
          <button type="button" className={cell} disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page"><RiArrowLeftSLine size={20} /></button>
          {nums.map((n) => (
            <button key={n} type="button" onClick={() => setPage(n)} aria-current={n === page ? "page" : undefined}
              className={`${cell} tabular-nums ${n === page ? "bg-primary/10 text-primary" : "hover:bg-base-200"}`}>{n + 1}</button>
          ))}
          <button type="button" className={cell} disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Next page"><RiArrowRightSLine size={20} /></button>
        </nav>
      </div>
    </div>
  );
}
