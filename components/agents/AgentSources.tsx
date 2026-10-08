import { useState } from "react";
import { toast } from "sonner";
import { RiEditLine, RiPlayLine } from "react-icons/ri";
import SourcePicker, { countSignals, type SourceDraft } from "@/components/agents/SourcePicker";
import { Card, ghostBtn, nextRunLabel, primaryBtn, secondaryBtn, SIGNAL_LABEL, timeAgo } from "@/components/agents/ui";
import type { Icp } from "@/lib/icp/schema";

export interface AgentSourceRow { id: string; source_type: string; config_json: string; enabled: number; last_run_at: string | null; next_run_at: string | null; last_error: string | null; leads: number }

function describe(s: AgentSourceRow): string {
  try {
    const c = JSON.parse(s.config_json || "{}") as { keywords?: string[]; urls?: string[]; boards?: unknown[]; list_ids?: string[] };
    if (c.keywords?.length) return `${c.keywords.length} topic${c.keywords.length > 1 ? "s" : ""}: ${c.keywords.slice(0, 4).join(", ")}${c.keywords.length > 4 ? "…" : ""}`;
    if (c.urls?.length) return c.urls.map((u) => u.replace(/^https?:\/\/(www\.)?linkedin\.com\//, "")).slice(0, 3).join(", ") + (c.urls.length > 3 ? "…" : "");
    if (c.boards?.length) return `${c.boards.length} job board${c.boards.length > 1 ? "s" : ""}`;
    if (c.list_ids?.length) return `${c.list_ids.length} list${c.list_ids.length > 1 ? "s" : ""}`;
  } catch { /* fall through */ }
  return "";
}

/** "Who this agent targets" + "How this agent finds leads", with per-source counts, Launch now and toggles. */
export default function AgentSources({ agentId, icp, rows, hasLinkedIn, onChanged, onEditTargeting }: { agentId: string; icp: Icp; rows: AgentSourceRow[]; hasLinkedIn: boolean; onChanged: () => void; onEditTargeting?: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SourceDraft[]>(() => rows.map((s) => ({ source_type: s.source_type, enabled: !!s.enabled, config: JSON.parse(s.config_json || "{}") })));
  const [busy, setBusy] = useState(false);
  const chips = [...icp.personas.flatMap((p) => p.titles), ...icp.industries, ...icp.company_sizes, ...icp.geographies];

  async function toggle(s: AgentSourceRow) {
    const r = await fetch(`/api/agents/${agentId}/sources`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source_id: s.id, enabled: !s.enabled }) });
    if (!r.ok) return toast.error("Could not update");
    onChanged();
  }
  async function launch(s: AgentSourceRow) {
    const r = await fetch(`/api/agents/${agentId}/run?source_id=${s.id}`, { method: "POST" });
    const d = await r.json();
    if (!r.ok) return toast.error(d.error ?? "Failed");
    toast.success(d.linkedin_sources_queued ? "Queued for the next LinkedIn pass" : `${d.http_sources?.[0]?.ingested ?? 0} new signal(s)`);
    onChanged();
  }
  async function save() {
    setBusy(true);
    for (const s of draft) {
      const existing = rows.find((x) => x.source_type === s.source_type);
      const r = existing
        ? await fetch(`/api/agents/${agentId}/sources`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source_id: existing.id, enabled: s.enabled, config: s.config }) })
        : s.enabled ? await fetch(`/api/agents/${agentId}/sources`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) }) : null;
      if (r && !r.ok) { toast.error((await r.json()).error ?? `Could not save ${s.source_type}`); setBusy(false); return; }
    }
    setBusy(false); setEditing(false);
    toast.success("Signals saved");
    onChanged();
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div><h2 className="text-base font-semibold">Who this agent targets</h2><p className="text-sm text-base-content/50">Every source only keeps leads that match this audience.</p></div>
        <Card className="flex flex-wrap items-center gap-2 !py-3">
          {chips.slice(0, 6).map((c) => <span key={c} className="rounded-full border border-[var(--border-subtle)] px-3 py-1 text-sm">{c}</span>)}
          {chips.length > 6 && <span className="rounded-full border border-[var(--border-subtle)] px-3 py-1 text-sm text-base-content/50">+{chips.length - 6}</span>}
          {!chips.length && <span className="text-sm text-base-content/45">No targeting yet.</span>}
          {onEditTargeting && <button className={`${secondaryBtn} ml-auto`} onClick={onEditTargeting}><RiEditLine size={15} /> Edit targeting</button>}
        </Card>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><h2 className="text-base font-semibold">How this agent finds leads</h2><p className="text-sm text-base-content/50">{rows.filter((r) => r.enabled).length} active source(s) · {countSignals(draft)} signals</p></div>
          <button className={editing ? secondaryBtn : primaryBtn} onClick={() => setEditing(!editing)}><RiEditLine size={15} /> {editing ? "Cancel" : "Edit signals"}</button>
        </div>
        {editing ? (
          <Card className="space-y-4">
            <SourcePicker value={draft} onChange={setDraft} hasLinkedIn={hasLinkedIn} suggestions={{ keywords: icp.keywords, competitorUrls: icp.competitors.map((c) => c.linkedin_url).filter((u): u is string => !!u) }} />
            <button className={primaryBtn} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save signals"}</button>
          </Card>
        ) : (
          <Card className="!p-0">
            <div className="grid grid-cols-[1fr_70px_110px_150px_50px] gap-2 border-b border-[var(--border-subtle)] px-5 py-2.5 text-xs uppercase tracking-wide text-base-content/45"><span>Source</span><span className="text-right">Leads</span><span>Next run</span><span /><span /></div>
            {rows.length === 0 && <p className="px-5 py-6 text-sm text-base-content/45">No sources yet.</p>}
            {rows.map((s) => (
              <div key={s.id} className="grid grid-cols-[1fr_70px_110px_150px_50px] items-center gap-2 border-b border-[var(--border-subtle)] px-5 py-3 last:border-0">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{SIGNAL_LABEL[s.source_type] ?? s.source_type}</div>
                  <div className="truncate text-xs text-base-content/50">{describe(s) || (s.last_run_at ? `Last run ${timeAgo(s.last_run_at)}` : "Not run yet")}</div>
                  {s.last_error && <div className="truncate text-xs text-error" title={s.last_error}>{s.last_error}</div>}
                </div>
                <div className="text-right text-sm tabular-nums">{s.leads}</div>
                <div className="text-xs text-base-content/50">{s.enabled ? nextRunLabel(s.next_run_at, s.last_run_at) : "Off"}</div>
                <button className={ghostBtn + " justify-self-start border border-[var(--border-subtle)]"} disabled={!s.enabled} onClick={() => launch(s)}><RiPlayLine size={13} /> Launch now</button>
                <input type="checkbox" className="toggle toggle-sm" checked={!!s.enabled} onChange={() => toggle(s)} aria-label={`Toggle ${s.source_type}`} />
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
