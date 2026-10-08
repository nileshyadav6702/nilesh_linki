import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RiArrowLeftSLine, RiArrowRightSLine, RiAtLine, RiCloseLine, RiDeleteBinLine, RiDownloadLine, RiFilter3Line, RiLinkedinBoxFill, RiMailForbidLine, RiMore2Fill, RiPhoneLine, RiSearchLine, RiUserUnfollowLine } from "react-icons/ri";
import LeadDrawer from "@/components/agents/LeadDrawer";
import { Avatar, Empty, Flames, inputCls, Panel, Pill, secondaryBtn, Segmented, SIGNAL_LABEL, timeAgo } from "@/components/agents/ui";

interface Row {
  id: string; full_name: string | null; profile_image_url?: string | null; headline: string | null; title: string | null; company: string | null; linkedin_url: string | null;
  email: string | null; email_status: string | null; phone: string | null; outreach_step: string | null;
  lead_score: number | null; intent_score: number; fit_reason: string | null; fit_verdict: string | null;
  agent_status: string | null; agent_name: string | null; created_at: string;
  signals: Array<{ id: string; type: string; title: string; snippet: string | null; occurred_at: string }>;
  drafts: Array<{ id: string }>;
}

const STEP: Record<string, string> = { visit: "Visit", connect: "Connect", message: "Message", sales_inmail: "InMail", delay: "Wait", email: "Email" };

const STATUS: Record<string, string> = { new: "Scoring", qualified: "Qualified", drafted: "To review", approved: "Approved", enrolled: "In sequence", skipped: "Rejected", disqualified: "Not a fit", needs_data: "Needs profile data" };
const FILTERS = [["", "Active"], ["drafted", "To review"], ["qualified", "Qualified"], ["enrolled", "In sequence"], ["needs_data", "Needs data"], ["disqualified", "Not a fit"], ["all", "All"]] as const;

/** Agent leads as a table: contact, signal, AI score, email, outreach state. Rows open the lead drawer. */
export default function LeadsTable({ agentId, showAgent = !agentId, initialAgentId, openLeadId }: { agentId?: string; showAgent?: boolean; initialAgentId?: string; openLeadId?: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [signal, setSignal] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(openLeadId ?? null);
  const [menu, setMenu] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const limit = 50;
  const agent = agentId ?? initialAgentId ?? "";

  const query = useMemo(() => new URLSearchParams(Object.entries({ agent_id: agent, status, signal_type: signal, q, limit: String(limit), offset: String(page * limit) }).filter(([, v]) => v)).toString(), [agent, status, signal, q, page]);
  const load = useCallback(() => fetch(`/api/leads?${query}`).then((r) => r.json()).then((d) => { setRows(d.leads ?? []); setTotal(d.total ?? 0); }), [query]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  // Open the drawer when the parent asks for a different lead (adjusting state on a prop change
  // during render, per React docs, instead of a setState-in-effect round trip).
  const [prevOpenLeadId, setPrevOpenLeadId] = useState(openLeadId);
  if (openLeadId !== prevOpenLeadId) {
    setPrevOpenLeadId(openLeadId);
    if (openLeadId) setOpen(openLeadId);
  }

  async function bulk(action: "find_email" | "skip") {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy(true);
    let ok = 0;
    for (const id of ids) {
      const r = await fetch(`/api/leads/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason: action === "skip" ? "Rejected in bulk" : undefined }) });
      if (r.ok && (action === "skip" || (await r.json()).found)) ok++;
    }
    setBusy(false);
    toast.success(action === "skip" ? `${ok} lead(s) rejected` : `Found ${ok} email(s) of ${ids.length}`);
    setSelected(new Set());
    load();
  }

  async function act(id: string, action: "skip" | "remove") {
    setMenu(null);
    const r = await fetch(`/api/leads/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason: action === "skip" ? "Rejected" : undefined }) });
    if (!r.ok) return toast.error((await r.json()).error ?? "Could not update lead");
    toast.success(action === "skip" ? "Lead rejected" : "Removed from list and campaign");
    load();
  }
  async function destroy(id: string) {
    setMenu(null);
    if (!confirm("Permanently delete this contact? This cannot be undone.")) return;
    const r = await fetch(`/api/targets/${id}`, { method: "DELETE" });
    if (!r.ok) return toast.error("Could not delete contact");
    toast.success("Contact deleted");
    load();
  }
  function exportSelected() {
    const picked = (rows ?? []).filter((r) => selected.has(r.id));
    const header = ["name", "title", "company", "email", "phone", "step", "score", "linkedin"];
    const lines = [header.join(",")].concat(picked.map((r) => [r.full_name, r.title, r.company, r.email, r.phone, r.outreach_step, r.lead_score, r.linkedin_url].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "leads.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pages = Math.ceil(total / limit);
  const showPhone = (rows ?? []).some((r) => r.phone);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 text-base-content/35" size={16} />
          <input className={`${inputCls} pl-9`} placeholder="Search leads" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        </div>
        <div className="relative">
          <RiFilter3Line className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base-content/45" size={15} />
          <select className={`${inputCls} w-auto pl-9 pr-8`} value={signal} onChange={(e) => { setSignal(e.target.value); setPage(0); }} aria-label="Signal type">
            <option value="">All signals</option>{Object.entries(SIGNAL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <span className="text-[13px] tabular-nums text-base-content/45">{total} lead{total === 1 ? "" : "s"}</span>
        {selected.size > 0 && (
          <span className="ml-auto flex flex-wrap gap-2">
            <button className={secondaryBtn} disabled={busy} onClick={exportSelected}><RiDownloadLine size={15} /> Export ({selected.size})</button>
            <button className={secondaryBtn} disabled={busy} onClick={() => bulk("find_email")}><RiAtLine size={15} /> Find emails ({selected.size})</button>
            <button className={secondaryBtn} disabled={busy} onClick={() => bulk("skip")}><RiCloseLine size={15} /> Reject ({selected.size})</button>
          </span>
        )}
      </div>
      <Segmented options={FILTERS.map(([v]) => v)} value={status} onChange={(v) => { setStatus(v); setPage(0); }} labels={Object.fromEntries(FILTERS.map(([v, l]) => [v, l]))} />

      {rows === null ? <p className="text-sm text-base-content/40">Loading…</p> : rows.length === 0 ? <Empty title="No leads here yet">Leads appear as your agents detect signals.</Empty> : (
        <Panel className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-base-200/60 text-left text-[12px] font-medium uppercase tracking-[0.08em] text-base-content/50">
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="w-12 px-4 py-3.5"><input type="checkbox" className="checkbox checkbox-xs" aria-label="Select all" checked={selected.size === rows.length} onChange={() => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
                  <th className="py-3.5 pr-4 font-medium">Contact</th><th className="py-3.5 pr-4 font-medium">Signal</th><th className="py-3.5 pr-4 font-medium">AI score</th>
                  <th className="py-3.5 pr-4 font-medium">Email</th>{showPhone && <th className="py-3.5 pr-4 font-medium">Phone</th>}<th className="py-3.5 pr-4 font-medium">Outreach step</th><th className="py-3.5 pr-4 font-medium">Approval</th>{showAgent && <th className="py-3.5 pr-4 font-medium">Agent</th>}<th className="py-3.5 pr-4 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer border-b border-[var(--border-subtle)] transition-colors last:border-0 hover:bg-base-200/50" onClick={() => setOpen(r.id)}>
                    <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}><input type="checkbox" className="checkbox checkbox-xs" aria-label="Select lead" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                    <td className="max-w-[300px] py-4 pr-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={r.full_name} src={r.profile_image_url} size={40} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium text-base-content">{r.full_name ?? "Unknown"}</span>
                            {r.linkedin_url && <a href={r.linkedin_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} aria-label="LinkedIn profile" className="shrink-0 text-[#0a66c2] hover:opacity-80"><RiLinkedinBoxFill size={16} /></a>}
                          </div>
                          <div className="truncate text-[13px] text-base-content/60">{r.title ?? r.headline}</div>
                          {r.company && <div className="truncate text-xs text-base-content/40">@ {r.company}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="max-w-[300px] py-4 pr-4">
                      {r.signals[0] ? (
                        <div className="flex items-start gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-[13px] text-base-content/80">{r.signals[0].title}</div>
                            <div className="truncate text-xs text-base-content/45">{r.signals[0].snippet ? `"${r.signals[0].snippet}"` : SIGNAL_LABEL[r.signals[0].type]}</div>
                          </div>
                          {r.signals.length > 1 && <Pill className="shrink-0">+{r.signals.length - 1} signal{r.signals.length > 2 ? "s" : ""}</Pill>}
                        </div>
                      ) : <span className="text-xs text-base-content/30">—</span>}
                    </td>
                    <td className="py-4 pr-4" title={r.fit_reason ?? undefined}><Flames score={r.lead_score ?? r.intent_score} /></td>
                    <td className="max-w-[220px] py-4 pr-4">
                      {r.email
                        ? <Pill tone="success" className="max-w-full"><RiAtLine size={13} className="shrink-0" /><span className="truncate">{r.email}</span></Pill>
                        : <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-base-200 text-base-content/30" title="No email yet"><RiMailForbidLine size={13} /></span>}
                    </td>
                    {showPhone && (
                      <td className="max-w-[140px] py-4 pr-4">
                        {r.phone ? <span className="inline-flex items-center gap-1.5 truncate text-xs text-base-content/70"><RiPhoneLine size={13} className="shrink-0 text-base-content/40" />{r.phone}</span> : <span className="text-xs text-base-content/30">—</span>}
                      </td>
                    )}
                    <td className="py-4 pr-4 text-[13px] text-base-content/50">{STEP[r.outreach_step ?? ""] ?? "Not contacted yet"}</td>
                    <td className="py-4 pr-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        {r.agent_status === "needs_data"
                          ? <span title="Missing headline and about — scored once the profile is enriched"><Pill tone="amber">{STATUS.needs_data}</Pill></span>
                          : <span className="text-xs text-base-content/60">{STATUS[r.agent_status ?? ""] ?? "—"}</span>}
                        {r.agent_status && !["skipped", "disqualified"].includes(r.agent_status) && (
                          <button className="inline-flex h-7 items-center rounded-[6px] border border-[var(--border-subtle)] bg-base-100 px-2.5 text-xs font-medium text-base-content/70 transition-colors hover:border-error/40 hover:text-error" onClick={() => act(r.id, "skip")}>Reject</button>
                        )}
                      </div>
                    </td>
                    {showAgent && <td className="max-w-[160px] truncate py-4 pr-4 text-xs text-base-content/50">{r.agent_name}</td>}
                    <td className="relative py-4 pr-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <span className="mr-1 text-[11px] text-base-content/35">{timeAgo(r.created_at)}</span>
                      <button className="rounded-[6px] p-1.5 text-base-content/45 hover:bg-base-200 hover:text-base-content" aria-label="Lead actions" onClick={() => setMenu(menu === r.id ? null : r.id)}><RiMore2Fill size={16} /></button>
                      {menu === r.id && (
                        <div className="absolute right-2 z-20 mt-1 w-60 rounded-[12px] border border-[var(--border-subtle)] bg-base-100 py-1 text-left text-sm shadow-[var(--shadow-overlay)]">
                          <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-base-200" onClick={() => act(r.id, "remove")}><RiUserUnfollowLine size={15} className="text-base-content/50" /> Remove from list and campaign</button>
                          <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-error hover:bg-base-200" onClick={() => destroy(r.id)}><RiDeleteBinLine size={15} /> Permanently delete</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-4 py-3 text-[13px] text-base-content/50">
              <span className="tabular-nums">{page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}</span>
              <Pager page={page} pages={pages} onPage={setPage} />
            </div>
          )}
        </Panel>
      )}
      <LeadDrawer targetId={open} onClose={() => setOpen(null)} onChanged={load} />
    </div>
  );
}

/** Numbered pages with a window around the current one; the active page is coral. */
function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  const start = Math.max(0, Math.min(page - 2, pages - 5));
  const nums = Array.from({ length: Math.min(5, pages) }, (_, i) => start + i);
  const btn = "inline-flex h-8 min-w-8 items-center justify-center rounded-[6px] px-2 text-[13px] tabular-nums transition-colors disabled:opacity-35";
  return (
    <span className="flex items-center gap-1">
      <button className={`${btn} text-base-content/55 hover:bg-base-200`} disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Previous page"><RiArrowLeftSLine size={16} /></button>
      {nums.map((n) => (
        <button key={n} className={`${btn} ${n === page ? "bg-primary font-medium text-primary-content" : "text-base-content/65 hover:bg-base-200"}`} onClick={() => onPage(n)} aria-current={n === page ? "page" : undefined}>{n + 1}</button>
      ))}
      <button className={`${btn} text-base-content/55 hover:bg-base-200`} disabled={page + 1 >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><RiArrowRightSLine size={16} /></button>
    </span>
  );
}
