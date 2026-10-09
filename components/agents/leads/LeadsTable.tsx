import { useState } from "react";
import { toast } from "sonner";
import { RiArrowDownLine, RiArrowLeftSLine, RiArrowRightSLine, RiArrowUpDownLine, RiArrowUpLine, RiPushpinFill, RiPushpinLine } from "react-icons/ri";
import LeadDrawer from "@/components/agents/LeadDrawer";
import { Panel, SIGNAL_LABEL } from "@/components/agents/ui";
import LeadRow, { pinnedEdge } from "./LeadRow";
import LeadsToolbar from "./LeadsToolbar";
import type { LeadRowData } from "./types";
import { leadsParams, PAGE_SIZE, useLeadsQuery } from "./useLeadsQuery";
import { failToast } from "@/components/settings/billing/credits-toast";

const STATUS_TEXT: Record<string, string> = { new: "Scoring", qualified: "Qualified", drafted: "To review", approved: "Approved", enrolled: "In sequence", skipped: "Rejected", disqualified: "Not a fit", needs_data: "Needs profile data" };

function downloadCsv(rows: LeadRowData[], name: string) {
  const header = ["name", "title", "company", "email", "phone", "status", "outreach_step", "score", "signal", "linkedin"];
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [header.join(",")].concat(rows.map((r) => [
    r.full_name, r.title ?? r.headline, r.company, r.email, r.phone, STATUS_TEXT[r.agent_status ?? ""] ?? r.agent_status,
    r.outreach?.next?.label ?? r.outreach?.prev?.label ?? "", r.lead_score ?? r.intent_score, r.signals[0] ? SIGNAL_LABEL[r.signals[0].type] ?? r.signals[0].type : "", r.linkedin_url,
  ].map(cell).join(",")));
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

/** Agent leads as a scrollable table with a pinned contact column. Rows open the lead drawer. */
export default function LeadsTable({ agentId, showAgent = !agentId, initialAgentId, openLeadId }: { agentId?: string; showAgent?: boolean; initialAgentId?: string; openLeadId?: string }) {
  const agent = agentId ?? initialAgentId ?? "";
  const { filters, patch, clearFilters, q, search, page, setPage, rows, total, facets, error, load } = useLeadsQuery(agent);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(openLeadId ?? null);
  const [busy, setBusy] = useState(false);
  const [pinned, setPinned] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  // Open the drawer when the parent asks for a different lead (adjusting state on a prop change
  // during render, per React docs, instead of a setState-in-effect round trip).
  const [prevOpenLeadId, setPrevOpenLeadId] = useState(openLeadId);
  if (openLeadId !== prevOpenLeadId) {
    setPrevOpenLeadId(openLeadId);
    if (openLeadId) setOpen(openLeadId);
  }

  async function bulk(ids: string[], action: "find_email" | "skip") {
    if (!ids.length) return;
    setBusy(true);
    let ok = 0;
    for (const id of ids) {
      const r = await fetch(`/api/leads/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason: action === "skip" ? "Rejected in bulk" : undefined }) });
      // Out of credits: stop here instead of failing every remaining lead.
      if (r.status === 402) { setBusy(false); failToast(await r.json().catch(() => null), "Not enough credits"); load(); return; }
      if (r.ok && (action === "skip" || (await r.json()).found)) ok++;
    }
    setBusy(false);
    toast.success(action === "skip" ? `${ok} lead(s) rejected` : `Found ${ok} email(s) of ${ids.length}`);
    setSelected(new Set());
    load();
  }
  async function act(id: string, action: "skip" | "remove") {
    const r = await fetch(`/api/leads/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason: action === "skip" ? "Rejected" : undefined }) });
    if (!r.ok) return toast.error((await r.json()).error ?? "Could not update lead");
    toast.success(action === "skip" ? "Lead rejected" : "Removed from list and campaign");
    load();
  }
  async function destroy(id: string) {
    if (!confirm("Permanently delete this contact? This cannot be undone.")) return;
    const r = await fetch(`/api/targets/${id}`, { method: "DELETE" });
    if (!r.ok) return toast.error("Could not delete contact");
    toast.success("Contact deleted");
    load();
  }
  async function exportAll() {
    setBusy(true);
    try {
      const all: LeadRowData[] = [];
      for (let offset = 0; offset < 10_000; offset += 100) {
        const r = await fetch(`/api/leads?${leadsParams(agent, filters, q, { limit: "100", offset: String(offset) })}`);
        if (!r.ok) throw new Error("Could not export leads");
        const d = await r.json() as { leads: LeadRowData[]; total: number };
        all.push(...d.leads);
        if (!d.leads.length || all.length >= d.total) break;
      }
      downloadCsv(all, "leads.csv");
      toast.success(`Exported ${all.length} lead(s)`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const list = rows ?? [];
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = list.length > 0 && list.every((r) => selected.has(r.id));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const sortIcon = filters.sort === "score_desc" ? <RiArrowDownLine size={14} /> : filters.sort === "score_asc" ? <RiArrowUpLine size={14} /> : <RiArrowUpDownLine size={14} />;
  const thBase = "sticky top-0 border-b border-[var(--border-subtle)] bg-base-200 px-3 py-3 text-left text-[12px] font-medium uppercase tracking-[0.08em] text-base-content/50 whitespace-nowrap";
  const th = `${thBase} z-20`;

  return (
    <div className="space-y-4">
      <LeadsToolbar filters={filters} patch={patch} clearFilters={clearFilters} q={q} search={search} total={total} facets={facets} actions={{
        selected: selected.size, busy, pageWithoutEmail: list.filter((r) => !r.email).length,
        exportSelected: () => downloadCsv(list.filter((r) => selected.has(r.id)), "leads-selected.csv"),
        exportAll, findSelected: () => bulk([...selected], "find_email"),
        findPage: () => bulk(list.filter((r) => !r.email).map((r) => r.id), "find_email"),
        rejectSelected: () => bulk([...selected], "skip"),
      }} />

      <Panel className="overflow-hidden">
        <div className="max-h-[calc(100vh-300px)] min-h-[320px] overflow-auto" onScroll={(e) => setScrolled(e.currentTarget.scrollLeft > 0)}>
          {rows === null ? <p className="p-6 text-sm text-base-content/40">Loading…</p>
            : error ? <p className="p-6 text-sm text-error">{error}</p>
            : list.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <p className="text-sm font-medium text-base-content/70">No leads match</p>
                <p className="mt-2 text-sm text-base-content/45">Leads appear as your agent detects signals. Try clearing filters.</p>
              </div>
            ) : (
              <table className="w-full min-w-[1480px] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th className={`${thBase} w-12 min-w-12 max-w-12 pl-4 pr-2 ${pinned ? "left-0 z-30" : "z-20"}`}>
                      <input type="checkbox" className="checkbox checkbox-xs" aria-label="Select all on this page" checked={allOn}
                        onChange={() => setSelected(allOn ? new Set() : new Set(list.map((r) => r.id)))} />
                    </th>
                    <th className={`${thBase} ${pinned ? `left-12 z-30 ${scrolled ? pinnedEdge : ""}` : "z-20"}`}>
                      <span className="flex items-center justify-between gap-2">
                        Contact
                        <button type="button" aria-pressed={pinned} aria-label={pinned ? "Unpin contact column" : "Pin contact column"} onClick={() => setPinned((p) => !p)}
                          className={`inline-flex h-6 w-6 items-center justify-center rounded-[6px] transition-colors ${pinned ? "bg-primary/10 text-primary" : "text-base-content/35 hover:bg-base-300"}`}>
                          {pinned ? <RiPushpinFill size={13} /> : <RiPushpinLine size={13} />}
                        </button>
                      </span>
                    </th>
                    <th className={th}>Signal</th>
                    <th className={th} aria-sort={filters.sort === "score_desc" ? "descending" : filters.sort === "score_asc" ? "ascending" : "none"}>
                      <button type="button" onClick={() => patch({ sort: filters.sort === "score_desc" ? "score_asc" : "score_desc" })}
                        className={`inline-flex items-center gap-1 uppercase tracking-[0.08em] hover:text-base-content ${filters.sort.startsWith("score") ? "text-base-content/75" : ""}`}>
                        AI score {sortIcon}
                      </button>
                    </th>
                    <th className={th}>Email</th>
                    <th className={th}>Phone</th>
                    <th className={th}>Outreach step</th>
                    <th className={th}>Approval</th>
                    {showAgent && <th className={th}>Agent</th>}
                    <th className={`${th} pr-4 text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody className="[&>tr:last-child>td]:border-b-0">
                  {list.map((r) => (
                    <LeadRow key={r.id} lead={r} selected={selected.has(r.id)} pinned={pinned} scrolled={scrolled} showAgent={showAgent}
                      onToggle={() => toggle(r.id)} onOpen={() => setOpen(r.id)} onReject={() => act(r.id, "skip")}
                      onRemove={() => act(r.id, "remove")} onDelete={() => destroy(r.id)} />
                  ))}
                </tbody>
              </table>
            )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-4 py-3 text-[13px] text-base-content/50">
          <span className="tabular-nums">{total ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}` : "0 of 0"}</span>
          <Pager page={page} pages={pages} onPage={(p) => { setPage(p); setSelected(new Set()); }} />
        </div>
      </Panel>
      <LeadDrawer targetId={open} onClose={() => setOpen(null)} onChanged={load} siblings={list.map((r) => r.id)} onOpen={setOpen} />
    </div>
  );
}

/** Numbered pages with a window around the current one; the active page is coral. */
export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  const start = Math.max(0, Math.min(page - 2, pages - 5));
  const nums = Array.from({ length: Math.min(5, pages) }, (_, i) => start + i);
  const btn = "inline-flex h-8 min-w-8 items-center justify-center rounded-[6px] px-2 text-[13px] tabular-nums transition-colors disabled:opacity-35";
  return (
    <nav className="flex items-center gap-1" aria-label="Pagination">
      <button type="button" className={`${btn} text-base-content/55 hover:bg-base-200`} disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Previous page"><RiArrowLeftSLine size={16} /></button>
      {nums.map((n) => (
        <button type="button" key={n} className={`${btn} ${n === page ? "bg-primary font-medium text-primary-content" : "text-base-content/65 hover:bg-base-200"}`} onClick={() => onPage(n)} aria-current={n === page ? "page" : undefined}>{n + 1}</button>
      ))}
      <button type="button" className={`${btn} text-base-content/55 hover:bg-base-200`} disabled={page + 1 >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><RiArrowRightSLine size={16} /></button>
    </nav>
  );
}
