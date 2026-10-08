import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RiDownloadLine, RiMore2Fill, RiSearchLine } from "react-icons/ri";
import LeadDrawer from "@/components/agents/LeadDrawer";
import { Empty, Flames, ghostBtn, inputCls, secondaryBtn, SIGNAL_LABEL, timeAgo } from "@/components/agents/ui";

interface Row {
  id: string; full_name: string | null; headline: string | null; title: string | null; company: string | null; linkedin_url: string | null;
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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 text-base-content/35" size={15} />
          <input className={`${inputCls} pl-9`} placeholder="Search leads" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        </div>
        <select className={`${inputCls} w-auto`} value={signal} onChange={(e) => { setSignal(e.target.value); setPage(0); }} aria-label="Signal type">
          <option value="">All signals</option>{Object.entries(SIGNAL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="flex flex-wrap gap-0.5 rounded-[10px] bg-base-200 p-1">
          {FILTERS.map(([v, label]) => (
            <button key={label} onClick={() => { setStatus(v); setPage(0); }} className={`rounded-[7px] px-3 py-1.5 text-xs font-medium ${status === v ? "border border-[var(--border-subtle)] bg-base-100 shadow-[var(--shadow-raised)]" : "text-base-content/45 hover:text-base-content/70"}`}>{label}</button>
          ))}
        </div>
        <span className="text-xs tabular-nums text-base-content/45">{total} lead{total === 1 ? "" : "s"}</span>
        {selected.size > 0 && (
          <span className="ml-auto flex gap-2">
            <button className={secondaryBtn} disabled={busy} onClick={exportSelected}><RiDownloadLine size={14} /> Export ({selected.size})</button>
            <button className={secondaryBtn} disabled={busy} onClick={() => bulk("find_email")}>Find emails ({selected.size})</button>
            <button className={secondaryBtn} disabled={busy} onClick={() => bulk("skip")}>Reject ({selected.size})</button>
          </span>
        )}
      </div>

      {rows === null ? <p className="text-sm text-base-content/40">Loading…</p> : rows.length === 0 ? <Empty title="No leads here yet">Leads appear as your agents detect signals.</Empty> : (
        <div className="overflow-x-auto rounded-[12px] border border-[var(--border-subtle)] bg-base-300">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-base-content/45">
              <tr className="border-b border-[var(--border-subtle)]">
                <th className="w-10 px-3 py-3"><input type="checkbox" className="checkbox checkbox-xs" aria-label="Select all" checked={selected.size === rows.length} onChange={() => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
                <th className="py-3 font-medium">Contact</th><th className="py-3 font-medium">Signals</th><th className="py-3 font-medium">AI score</th>
                <th className="py-3 font-medium">Email</th>{showPhone && <th className="py-3 font-medium">Phone</th>}<th className="py-3 font-medium">Step</th><th className="py-3 font-medium">Approval</th>{showAgent && <th className="py-3 font-medium">Agent</th>}<th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-b border-[var(--border-subtle)] last:border-0 hover:bg-base-200/60" onClick={() => setOpen(r.id)}>
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}><input type="checkbox" className="checkbox checkbox-xs" aria-label="Select lead" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td className="max-w-[260px] py-3 pr-3">
                    <div className="truncate font-medium text-[var(--viz-1,#2563eb)]">{r.full_name ?? "Unknown"}</div>
                    <div className="truncate text-xs text-base-content/55">{r.title ?? r.headline}</div>
                    {r.company && <div className="truncate text-xs text-base-content/40">@ {r.company}</div>}
                  </td>
                  <td className="max-w-[280px] py-3 pr-3">
                    {r.signals[0] ? <>
                      <div className="truncate text-xs text-base-content/75">{r.signals[0].title}</div>
                      <div className="flex items-center gap-2 text-[11px] text-base-content/40"><span className="truncate">{r.signals[0].snippet ? `"${r.signals[0].snippet}"` : SIGNAL_LABEL[r.signals[0].type]}</span>{r.signals.length > 1 && <span className="shrink-0 rounded bg-base-200 px-1.5">+{r.signals.length - 1} signal{r.signals.length > 2 ? "s" : ""}</span>}</div>
                    </> : <span className="text-xs text-base-content/30">—</span>}
                  </td>
                  <td className="py-3" title={r.fit_reason ?? undefined}><Flames score={r.lead_score ?? r.intent_score} /></td>
                  <td className="max-w-[180px] truncate py-3 pr-3 text-xs">{r.email ? <span className="rounded-full bg-success/10 px-2 py-0.5 text-success">{r.email}</span> : <span className="text-base-content/30">—</span>}</td>
                  {showPhone && <td className="max-w-[120px] truncate py-3 pr-3 text-xs">{r.phone}</td>}
                  <td className="py-3 text-xs">{STEP[r.outreach_step ?? ""] ?? <span className="text-base-content/30">—</span>}</td>
                  <td className="py-3 text-xs text-base-content/60" onClick={(e) => e.stopPropagation()}>
                    {r.agent_status === "needs_data"
                      ? <span className="rounded-full bg-warning/10 px-2 py-0.5 text-warning" title="Missing headline and about — scored once the profile is enriched">{STATUS.needs_data}</span>
                      : STATUS[r.agent_status ?? ""] ?? "—"}
                    {r.agent_status && !["skipped", "disqualified"].includes(r.agent_status) && <button className="ml-2 text-error" onClick={() => act(r.id, "skip")}>Reject</button>}
                  </td>
                  {showAgent && <td className="max-w-[160px] truncate py-3 text-xs text-base-content/50">{r.agent_name}</td>}
                  <td className="relative py-3 pr-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <span className="mr-1 text-[11px] text-base-content/35">{timeAgo(r.created_at)}</span>
                    <button className="rounded p-1 hover:bg-base-200" aria-label="Lead actions" onClick={() => setMenu(menu === r.id ? null : r.id)}><RiMore2Fill /></button>
                    {menu === r.id && (
                      <div className="absolute right-2 z-20 mt-1 w-56 rounded-xl border border-[var(--border-subtle)] bg-base-100 py-1 text-left text-sm shadow-[var(--shadow-overlay)]">
                        <button className="block w-full px-3 py-2 text-left hover:bg-base-200" onClick={() => act(r.id, "remove")}>Remove from list and campaign</button>
                        <button className="block w-full px-3 py-2 text-left text-error hover:bg-base-200" onClick={() => destroy(r.id)}>Permanently delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-between text-xs text-base-content/50">
          <span>{page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}</span>
          <span className="flex gap-1"><button className={ghostBtn} disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><button className={ghostBtn} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button></span>
        </div>
      )}
      <LeadDrawer targetId={open} onClose={() => setOpen(null)} onChanged={load} />
    </div>
  );
}
