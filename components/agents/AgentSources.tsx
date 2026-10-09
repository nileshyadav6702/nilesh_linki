import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  RiAddLine, RiArrowDownSLine, RiArrowRightSLine, RiBriefcase4Line, RiChat3Line, RiCodeSSlashLine, RiFileList3Line, RiFocus3Line,
  RiGlobalLine, RiGroupLine, RiHashtag, RiMoneyDollarCircleLine, RiPencilLine, RiPlayLine, RiRadarLine, RiUserSearchLine, RiUserStarLine,
} from "react-icons/ri";
import LeadSourcesDrawer from "@/components/agents/sources/LeadSourcesDrawer";
import { draftsFromRows, totalSignals } from "@/components/agents/sources/catalog";
import { Avatar, ghostBtn, IconTile, nextRunLabel, Panel, Pill, primaryBtn, SectionHeading, SIGNAL_LABEL, timeAgo, Toggle, type Tone } from "@/components/agents/ui";
import type { Icp } from "@/lib/icp/schema";
import { roleTitles, sizeLabel } from "@/lib/icp/targeting";

export interface AgentSourceRow { id: string; source_type: string; config_json: string; enabled: number; last_run_at: string | null; next_run_at: string | null; last_error: string | null; leads: number }

interface SourceConfig { keywords?: string[]; urls?: string[]; boards?: Array<{ ats: string; slug: string; company?: string }>; list_ids?: string[] }

/** Icon and tint per source type, so each signal family reads at a glance. */
const SOURCE_LOOK: Record<string, { icon: ReactNode; tone: Tone }> = {
  competitor_engagement: { icon: <RiFocus3Line size={18} />, tone: "coral" },
  keyword_engagement: { icon: <RiHashtag size={18} />, tone: "teal" },
  job_change: { icon: <RiBriefcase4Line size={18} />, tone: "amber" },
  lookalike: { icon: <RiGroupLine size={18} />, tone: "ink" },
  funding: { icon: <RiMoneyDollarCircleLine size={18} />, tone: "success" },
  hiring: { icon: <RiUserSearchLine size={18} />, tone: "amber" },
  website_visit: { icon: <RiGlobalLine size={18} />, tone: "teal" },
  existing_list: { icon: <RiFileList3Line size={18} />, tone: "ink" },
  linkedin_import: { icon: <RiFileList3Line size={18} />, tone: "linkedin" },
  influencer_engagement: { icon: <RiUserStarLine size={18} />, tone: "coral" },
  own_content_engagement: { icon: <RiChat3Line size={18} />, tone: "teal" },
  technology: { icon: <RiCodeSSlashLine size={18} />, tone: "ink" },
};
const look = (type: string) => SOURCE_LOOK[type] ?? { icon: <RiRadarLine size={18} />, tone: "ink" as Tone };

function parseConfig(s: AgentSourceRow): SourceConfig {
  try { return JSON.parse(s.config_json || "{}") as SourceConfig; } catch { return {}; }
}

const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?linkedin\.com\//, "").replace(/\/$/, "");

/** The individual things a source tracks (topics, pages, boards, lists), shown when its row is expanded. */
function items(s: AgentSourceRow): Array<{ label: string; sub: string }> {
  const c = parseConfig(s);
  if (c.keywords?.length) return c.keywords.map((k) => ({ label: k, sub: "Engagement & interest" }));
  if (c.urls?.length) return c.urls.map((u) => ({ label: shortUrl(u), sub: /\/in\//.test(u) ? "LinkedIn profile" : "Company page" }));
  if (c.boards?.length) return c.boards.map((b) => ({ label: b.company || b.slug, sub: `${b.ats} job board` }));
  if (c.list_ids?.length) return c.list_ids.map((id, i) => ({ label: `List ${i + 1}`, sub: id }));
  return [];
}

/** "5 topics tracked" style subtitle for a source row. */
function tracked(s: AgentSourceRow): string {
  const c = parseConfig(s);
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many} tracked`;
  if (c.keywords?.length) return n(c.keywords.length, "topic", "topics");
  if (c.urls?.length) return s.source_type === "competitor_engagement" ? n(c.urls.length, "competitor", "competitors") : n(c.urls.length, "page", "pages");
  if (c.boards?.length) return n(c.boards.length, "job board", "job boards");
  if (c.list_ids?.length) return n(c.list_ids.length, "list", "lists");
  return s.last_run_at ? `Last run ${timeAgo(s.last_run_at)}` : "Not run yet";
}

/** "Who this agent targets" + "How this agent finds leads", with per-source counts, Launch now and toggles. */
export default function AgentSources({ agentId, agentName, ownListId, autoEnrichEmails, icp, rows, hasLinkedIn, onChanged, onEditTargeting, openImport = false }: {
  agentId: string; agentName: string; ownListId: string | null; autoEnrichEmails: boolean; icp: Icp; rows: AgentSourceRow[]; hasLinkedIn: boolean; onChanged: () => void; onEditTargeting?: () => void;
  /** Open the Lead sources drawer on its import options right away (Contacts → Add leads). */
  openImport?: boolean;
}) {
  const [editing, setEditing] = useState(openImport);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const chips = [...new Set([...roleTitles(icp), ...icp.industries, ...icp.company_types, ...icp.company_sizes.map(sizeLabel), ...icp.geographies])];
  const modeNote = icp.match_mode === "skip" ? "ICP filtering skipped" : icp.match_mode === "broader" ? "Broader matching" : null;
  const active = rows.filter((r) => r.enabled).length;

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
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionHeading title="Who this agent targets" subtitle="Every source below only keeps leads that match this audience." />
        <Panel className="flex flex-wrap items-center gap-2 px-5 py-4">
          {chips.slice(0, 6).map((c) => <Pill key={c} className="!px-3 !py-1 !text-[13px]">{c}</Pill>)}
          {chips.length > 6 && <Pill tone="coral" className="!px-3 !py-1 !text-[13px]">+{chips.length - 6}</Pill>}
          {!chips.length && <span className="text-sm text-base-content/45">No targeting yet.</span>}
          {modeNote && <Pill tone="amber" className="!px-3 !py-1 !text-[13px]">{modeNote}</Pill>}
          {onEditTargeting && <button type="button" className={`${ghostBtn} ml-auto !h-9 !text-sm !text-base-content`} onClick={onEditTargeting}><RiPencilLine size={15} /> Edit targeting</button>}
        </Panel>
      </section>

      <section className="space-y-3">
        <SectionHeading
          title="How this agent finds leads"
          subtitle={`${active} active source${active === 1 ? "" : "s"} · ${totalSignals(draftsFromRows(rows))} signals`}
          actions={<button type="button" className={`${primaryBtn} !bg-neutral !text-neutral-content hover:!bg-[#252320]`} onClick={() => setEditing(true)}><RiAddLine size={16} /> Lead sources</button>}
        />
        {editing && (
          <LeadSourcesDrawer initialItem={openImport ? "saved_list" : undefined} agentId={agentId} agentName={agentName} ownListId={ownListId} rows={rows} icp={icp} hasLinkedIn={hasLinkedIn}
            autoEnrichEmails={autoEnrichEmails} onClose={() => setEditing(false)} onChanged={onChanged} />
        )}
        <Panel className="overflow-hidden">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border-subtle)] bg-base-200/60 px-5 py-4">
              <div>
                <div className="flex items-center gap-2 text-[15px] font-medium text-base-content">Signals <Pill>{active} of {rows.length}</Pill></div>
                <p className="mt-0.5 text-xs text-base-content/50">How this agent continuously finds leads.</p>
              </div>
              <div className="hidden grid-cols-[72px_120px_150px_52px] gap-3 text-[11px] font-medium uppercase tracking-[0.08em] text-base-content/45 md:grid">
                <span className="text-right">Leads</span><span>Next run</span><span /><span />
              </div>
            </div>
            {rows.length === 0 && <p className="px-5 py-8 text-center text-sm text-base-content/45">No sources yet. Click Lead sources to start finding people.</p>}
            {rows.map((s) => {
              const list = items(s);
              const expanded = !!open[s.id];
              const l = look(s.source_type);
              return (
                <div key={s.id} className="border-b border-[var(--border-subtle)] last:border-0">
                  <div className="flex flex-wrap items-center gap-3 px-5 py-4 md:flex-nowrap">
                    <button type="button" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-base-content/45 hover:bg-base-200 disabled:invisible"
                      disabled={!list.length} aria-expanded={expanded} aria-label={expanded ? "Collapse" : "Expand"} onClick={() => setOpen({ ...open, [s.id]: !expanded })}>
                      {expanded ? <RiArrowDownSLine size={18} /> : <RiArrowRightSLine size={18} />}
                    </button>
                    <IconTile icon={l.icon} tone={l.tone} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-medium text-base-content">{SIGNAL_LABEL[s.source_type] ?? s.source_type}</div>
                      <div className="truncate text-[13px] text-base-content/50">{tracked(s)}</div>
                      {s.last_error && <div className="mt-0.5 truncate text-xs text-error" title={s.last_error}>{s.last_error}</div>}
                    </div>
                    <div className="ml-auto grid grid-cols-[72px_120px_150px_52px] items-center gap-3">
                      <span className="text-right font-display text-[20px] tabular-nums text-base-content">{s.leads}</span>
                      <span className="text-xs text-base-content/55">{s.enabled ? nextRunLabel(s.next_run_at, s.last_run_at) : "Off"}</span>
                      <button type="button" className={`${ghostBtn} justify-self-start border border-[var(--border-subtle)] bg-base-100`} disabled={!s.enabled} onClick={() => launch(s)}><RiPlayLine size={13} /> Launch now</button>
                      <Toggle on={!!s.enabled} onChange={() => toggle(s)} label={`Toggle ${SIGNAL_LABEL[s.source_type] ?? s.source_type}`} />
                    </div>
                  </div>
                  {expanded && list.length > 0 && (
                    <div className="space-y-1 pb-3 pl-[104px] pr-5">
                      {list.map((it) => (
                        <div key={it.label + it.sub} className="flex items-center gap-3 rounded-[8px] px-2 py-2 hover:bg-base-200/60">
                          <Avatar name={it.label} size={32} />
                          <div className="min-w-0">
                            <div className="truncate text-sm text-base-content">{it.label}</div>
                            <div className="truncate text-xs capitalize text-base-content/50">{it.sub}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
        </Panel>
      </section>
    </div>
  );
}
