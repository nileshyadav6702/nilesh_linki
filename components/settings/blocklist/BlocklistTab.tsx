import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { format } from "date-fns";
import { LuBan, LuChevronLeft, LuChevronRight, LuDownload, LuLoaderCircle, LuPlus, LuSearch, LuTrash2 } from "react-icons/lu";
import Confirm from "@/components/contacts/Confirm";
import AddBlockDrawer, { KindSwitch, type BlockKind } from "@/components/settings/blocklist/AddBlockDrawer";
import CompetitorCard from "@/components/settings/blocklist/CompetitorCard";

/** Settings → Organization Blocklist: AI competitor filtering + companies and people never to contact. */

interface Row { id: string; value: string; label: string | null; source: string | null; created_at: string }
interface Page { rows: Row[]; total: number; page: number; page_size: number; counts: Record<BlockKind, number> }

const toDate = (s: string) => new Date(`${s.replace(" ", "T")}Z`);

export default function BlocklistTab() {
  const [kind, setKind] = useState<BlockKind>("company");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [want, setWant] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);

  const key = `${kind}|${q}|${page}`;
  const load = useCallback(() => {
    const k = `${kind}|${q}|${page}`;
    return fetch(`/api/settings/blocklist?kind=${kind}&q=${encodeURIComponent(q)}&page=${page}`).then((r) => r.json())
      .then((d: Page) => { setData(d); setWant(k); }).catch(() => toast.error("Could not load the blocklist"));
  }, [kind, q, page]);
  useEffect(() => { const t = setTimeout(() => void load(), q ? 200 : 0); return () => clearTimeout(t); }, [load, q]);

  const loading = want !== key;
  const switchKind = (k: BlockKind) => { setKind(k); setPage(1); setQ(""); setSelected(new Set()); };
  const rows = data?.rows ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const empty = data && data.total === 0 && !q;

  async function remove() {
    const r = await fetch("/api/settings/blocklist", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, ids: [...selected] }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(d.error ?? "Could not delete"); return; }
    toast.success(`${d.removed} removed from the blocklist`);
    setSelected(new Set()); setRemoving(false);
    await load();
  }

  const noun = kind === "company" ? "companies" : "people";
  return (
    <div className="wizard-rise rounded-[16px] border border-[var(--border-subtle)] bg-base-100">
      <div className="border-b border-[var(--border-subtle)] px-8 py-6">
        <div role="heading" aria-level={2} className="text-[24px] font-medium">Blocklist</div>
        <div className="mt-1 text-[17px] text-base-content/70">Prevent specific companies or people from being added to your campaigns.</div>
      </div>

      <div className="px-8 py-8">
        <CompetitorCard />

        <div className="mt-8 border-t border-[var(--border-subtle)] pt-8">
          <div className="text-[20px] font-medium">Manual blocklist</div>
          <div className="mt-1 text-[17px] text-base-content/70">Companies and people you block yourself. Always free and unlimited, whether AI Competitor Filtering is on or off.</div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
            <div className="w-full max-w-[380px]"><KindSwitch kind={kind} onChange={switchKind} counts={data?.counts} /></div>
            <div className="flex items-center gap-2">
              <button type="button" disabled={!selected.size} onClick={() => setRemoving(true)} className="inline-flex h-11 items-center gap-2 rounded-[10px] px-4 text-[16px] font-medium text-base-content/75 hover:bg-[#ef4444]/10 hover:text-[#dc2626] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-base-content/75">
                <LuTrash2 size={18} />Delete{selected.size ? ` (${selected.size})` : ""}
              </button>
              <button type="button" onClick={() => setAdding(true)} className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-primary px-5 text-[16px] font-semibold text-primary-content shadow-[0_6px_16px_-8px_var(--color-primary)] hover:bg-[var(--primary-hover)]"><LuPlus size={19} />Add</button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <label className="relative block w-full max-w-[560px]">
              <LuSearch size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base-content/45" />
              <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder={kind === "company" ? "Search company or domain" : "Search LinkedIn profile URL…"} aria-label={`Search blocked ${noun}`}
                className="h-12 w-full rounded-[10px] border border-[var(--border-strong)] bg-base-100 pl-11 pr-4 text-[16px] outline-none focus:border-primary/60 focus:ring-2 focus:ring-[var(--ring)]" />
            </label>
            {data && data.counts[kind] > 0
              ? <a href={`/api/settings/blocklist?kind=${kind}&format=csv`} className="inline-flex h-11 items-center gap-2 rounded-[10px] px-3 text-[16px] font-medium text-base-content/75 hover:bg-base-200"><LuDownload size={18} />Download CSV</a>
              : <span className="inline-flex h-11 items-center gap-2 px-3 text-[16px] text-base-content/35"><LuDownload size={18} />Download CSV</span>}
          </div>

          <div className="mt-4">
            {!data && <div className="flex justify-center py-14"><LuLoaderCircle size={26} className="animate-spin text-primary" /></div>}
            {empty && (
              <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-[var(--border-strong)] px-6 py-16 text-center">
                <LuBan size={48} className="text-base-content/45" />
                <div className="mt-1 text-[19px] font-medium">No blocked {noun} yet</div>
                <div className="text-[16px] text-base-content/65">{kind === "company" ? "Add companies or domains to prevent them from being contacted." : "Add LinkedIn profiles to prevent those people from being contacted."}</div>
              </div>
            )}
            {data && !empty && (
              <div className={`overflow-x-auto rounded-[12px] border border-[var(--border-subtle)] transition-opacity ${loading ? "opacity-60" : ""}`}>
                <table className="w-full min-w-[640px] text-[16px]">
                  <thead>
                    <tr className="text-left text-[15px] text-base-content/60">
                      <th className="w-14 px-5 py-3.5"><input type="checkbox" className="h-[18px] w-[18px] cursor-pointer accent-[var(--color-primary)]" aria-label="Select all on this page" checked={allOnPage}
                        onChange={() => setSelected((s) => { const n = new Set(s); for (const r of rows) { if (allOnPage) n.delete(r.id); else n.add(r.id); } return n; })} /></th>
                      <th className="px-5 py-3.5 font-medium">{kind === "company" ? "Website domain" : "LinkedIn profile"}</th>
                      {kind === "company" && <th className="px-5 py-3.5 font-medium">Company name</th>}
                      <th className="px-5 py-3.5 font-medium">Added</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t border-[var(--border-subtle)] hover:bg-base-200/30">
                        <td className="px-5 py-3.5"><input type="checkbox" className="h-[18px] w-[18px] cursor-pointer accent-[var(--color-primary)]" aria-label={`Select ${r.value}`} checked={selected.has(r.id)}
                          onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} /></td>
                        <td className="px-5 py-3.5">{kind === "company" ? r.value : <a href={`https://www.${r.value}`} target="_blank" rel="noreferrer" className="hover:underline">{r.value.replace(/^linkedin\.com\/in\//, "in/")}</a>}</td>
                        {kind === "company" && <td className="px-5 py-3.5" style={{ color: r.label ? "#e5603b" : undefined }}>{r.label ?? <span className="text-base-content/40">—</span>}</td>}
                        <td className="whitespace-nowrap px-5 py-3.5 text-base-content/60">{format(toDate(r.created_at), "MMM d, yyyy")}{r.source && r.source !== "manual" && r.source !== "csv" ? <span className="ml-2 rounded-full bg-base-200 px-2 py-0.5 text-[12px]">{r.source}</span> : null}</td>
                      </tr>
                    ))}
                    {!rows.length && <tr><td colSpan={4} className="px-5 py-10 text-center text-base-content/60">Nothing matches &ldquo;{q}&rdquo;.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
            {data && !empty && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <span className="text-[15px] text-base-content/60">Showing {data.total ? (data.page - 1) * data.page_size + 1 : 0}–{Math.min(data.total, data.page * data.page_size)} of {data.total}</span>
                {pages > 1 && (
                  <div className="inline-flex items-center overflow-hidden rounded-[10px] border border-[var(--border-subtle)]">
                    <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)} className="flex h-10 w-11 items-center justify-center hover:bg-base-200 disabled:cursor-default disabled:text-base-content/30"><LuChevronLeft size={18} /></button>
                    <span className="border-x border-[var(--border-subtle)] px-4 text-[15px] font-medium leading-10 tabular-nums">Page {page} / {pages}</span>
                    <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)} className="flex h-10 w-11 items-center justify-center hover:bg-base-200 disabled:cursor-default disabled:text-base-content/30"><LuChevronRight size={18} /></button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {adding && createPortal(<AddBlockDrawer initialKind={kind} onClose={() => setAdding(false)} onAdded={(k) => { setAdding(false); if (k !== kind) switchKind(k); else void load(); }} />, document.body)}
      {removing && createPortal(<Confirm title={`Remove ${selected.size} ${selected.size === 1 ? "entry" : "entries"}?`} action="Remove from blocklist" onCancel={() => setRemoving(false)} onConfirm={remove}
        text={<>These {noun} can be contacted again by your agents and campaigns.</>} />, document.body)}
    </div>
  );
}
