import { useState, type ReactNode } from "react";
import { RiAddLine } from "react-icons/ri";
import { CheckRow, InitialTile, NewPill, PanelHeader, SoonPill, SubHeading, TrackedRow } from "@/components/agents/sources/kit";
import { labelFromUrl, normalizePageUrl, shortLinkedIn, SIGNAL_BUDGET, type DrawerSignalType, type SignalDraft } from "@/lib/agents/lead-source-rules";
import type { Drafts } from "@/components/agents/sources/catalog";

/** Checkbox-style live signals: buying events, people engaging with you, lookalike, and the Coming soon ones. */

interface Props { drafts: Drafts; set: (type: DrawerSignalType, next: SignalDraft) => void; budgetLeft: number; hasLinkedIn: boolean }

const inputCls = "h-11 min-w-0 flex-1 rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-3 text-sm text-base-content outline-none transition placeholder:text-base-content/40 focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[var(--ring)]";
const addBtn = "inline-flex h-11 shrink-0 items-center gap-1 rounded-[8px] border border-[var(--border-subtle)] bg-base-200 px-4 text-sm font-medium text-base-content hover:bg-base-300 disabled:opacity-50";
const budgetMsg = `You're tracking ${SIGNAL_BUDGET} signals, the most one agent can. Remove one first.`;

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <div className="space-y-1"><SubHeading>{title}</SubHeading><div className="border-t border-[var(--border-subtle)]">{children}</div></div>;
}

const LinkedInNote = ({ show }: { show: boolean }) => show
  ? <p className="rounded-[10px] bg-[#e8a55a]/15 px-3 py-2 text-[13px] text-[#8a5a1f]">This needs a LinkedIn account on the agent. Add one in the agent&apos;s Settings tab; it starts working once connected.</p>
  : null;

/** Small "type + Add" list editor used inside a checked row. */
function MiniList({ values, placeholder, onAdd, onRemove, validate, render }: {
  values: string[]; placeholder: string; onAdd: (v: string) => string | null; onRemove: (v: string) => void; validate?: (v: string) => string | null; render?: (v: string) => { title: string; sub?: string; lead?: ReactNode };
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const bad = validate?.(text.trim()) ?? null;
    const err = bad ?? onAdd(text.trim());
    setError(err);
    if (!err) setText("");
  };
  return (
    <div className="space-y-2 pb-3 pl-8">
      <div className="flex gap-2">
        <input className={inputCls} value={text} placeholder={placeholder} aria-label={placeholder} onChange={(e) => { setText(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" className={addBtn} disabled={!text.trim()} onClick={add}><RiAddLine size={15} /> Add</button>
      </div>
      {error && <p className="text-[13px] text-error">{error}</p>}
      {values.map((v) => { const r = render?.(v) ?? { title: v }; return <TrackedRow key={v} lead={r.lead} title={r.title} sub={r.sub} onRemove={() => onRemove(v)} />; })}
    </div>
  );
}

export function BuyingEventsPanel({ drafts, set, budgetLeft, hasLinkedIn }: Props) {
  const [blocked, setBlocked] = useState<string | null>(null);
  const toggle = (type: DrawerSignalType, on: boolean) => {
    if (on && budgetLeft <= 0) { setBlocked(budgetMsg); return; }
    setBlocked(null);
    set(type, { ...drafts[type], enabled: on });
  };
  const hiring = drafts.hiring;
  const boards = (hiring.config.boards ?? []).map((b) => `${b.ats}:${b.slug}`);
  const count = ["job_change", "funding", "hiring"].filter((t) => drafts[t as DrawerSignalType].enabled).length;
  return (
    <div className="space-y-6">
      <PanelHeader title="Buying events" count={count} description="Find people and companies showing signals that make now a good time to reach out" />
      {blocked && <p className="text-[13px] text-error">{blocked}</p>}
      <Group title="People signals">
        <CheckRow label="Track top 5% active profiles in your ICP" hint="People in your ICP among the top 5% most active on LinkedIn." checked={false} onChange={() => {}} soon />
        <CheckRow label="Recent job changes" hint="Contacts in this agent who start a new role. Profiles are re-checked every 30 days." checked={drafts.job_change.enabled} onChange={(v) => toggle("job_change", v)} />
        <CheckRow label="New decision-makers in role" pill={<NewPill />} hint="Decision-makers who recently joined a company or were promoted." checked={false} onChange={() => {}} soon />
      </Group>
      <LinkedInNote show={drafts.job_change.enabled && !hasLinkedIn} />
      <Group title="Company signals">
        <CheckRow label="Companies that have recently raised funds" hint="Funding rounds in the news at companies matching your ICP." checked={drafts.funding.enabled} onChange={(v) => toggle("funding", v)} />
        <CheckRow label="Job openings" hint="Companies hiring for roles you care about, read from their Greenhouse, Lever or Ashby job board." checked={hiring.enabled} onChange={(v) => toggle("hiring", v)} />
        {hiring.enabled && (
          <div className="space-y-1">
            <MiniList values={boards} placeholder="Job board, e.g. greenhouse:acme or lever:globex"
              validate={(v) => /^(greenhouse|lever|ashby):[\w.-]+$/i.test(v) ? null : "Use ats:slug, e.g. greenhouse:acme"}
              onAdd={(v) => {
                if (boards.includes(v.toLowerCase())) return "Already added";
                const [ats, slug] = v.split(":");
                set("hiring", { ...hiring, config: { ...hiring.config, boards: [...(hiring.config.boards ?? []), { ats: ats.toLowerCase() as "greenhouse", slug }] } });
                return null;
              }}
              onRemove={(v) => set("hiring", { ...hiring, config: { ...hiring.config, boards: (hiring.config.boards ?? []).filter((b) => `${b.ats}:${b.slug}` !== v) } })} />
            <MiniList values={hiring.config.role_keywords ?? []} placeholder="Role keywords (optional), e.g. SDR"
              onAdd={(v) => {
                const cur = hiring.config.role_keywords ?? [];
                if (v.length < 2) return "Too short";
                if (cur.some((x) => x.toLowerCase() === v.toLowerCase())) return "Already added";
                set("hiring", { ...hiring, config: { ...hiring.config, role_keywords: [...cur, v] } });
                return null;
              }}
              onRemove={(v) => set("hiring", { ...hiring, config: { ...hiring.config, role_keywords: (hiring.config.role_keywords ?? []).filter((x) => x !== v) } })} />
            {!boards.length && <p className="pb-2 pl-8 text-[13px] text-error">Add at least one job board to track openings.</p>}
          </div>
        )}
        <CheckRow label="Hiring surge" pill={<NewPill />} hint="Companies whose hiring activity has increased significantly." checked={false} onChange={() => {}} soon />
      </Group>
    </div>
  );
}

export function EngagingPanel({ drafts, set, budgetLeft, hasLinkedIn }: Props) {
  const d = drafts.own_content_engagement;
  const urls = d.config.urls ?? [];
  return (
    <div className="space-y-6">
      <PanelHeader title="People engaging with you" count={d.enabled ? urls.length : 0} description="Find prospects already engaging with you or your company" />
      <Group title="What to track">
        <CheckRow label="Post engagement" hint="People who like your LinkedIn posts or your company page's posts." checked={d.enabled} onChange={(v) => set("own_content_engagement", { ...d, enabled: v })} />
        {d.enabled && (
          <MiniList values={urls} placeholder="Your LinkedIn profile or company page URL"
            validate={(v) => normalizePageUrl(v) ? null : "Paste a LinkedIn profile or company page URL"}
            onAdd={(v) => {
              const url = normalizePageUrl(v)!;
              if (urls.includes(url)) return "Already added";
              if (budgetLeft <= 0) return budgetMsg;
              set("own_content_engagement", { enabled: true, config: { ...d.config, urls: [...urls, url] } });
              return null;
            }}
            onRemove={(v) => set("own_content_engagement", { ...d, config: { ...d.config, urls: urls.filter((x) => x !== v) } })}
            render={(v) => ({ title: labelFromUrl(v), sub: shortLinkedIn(v), lead: <InitialTile label={labelFromUrl(v)} size={32} /> })} />
        )}
        {d.enabled && !urls.length && <p className="pb-2 pl-8 text-[13px] text-error">Add your profile or company page so we know whose posts to watch.</p>}
        <CheckRow label="Profile visitors" pill={<span className="rounded-full bg-base-200 px-2 py-0.5 text-[12px] text-base-content/65">LinkedIn Premium</span>} hint="People who viewed your LinkedIn profile." checked={false} onChange={() => {}} soon />
        <CheckRow label="Company page followers" hint="People who follow your company page on LinkedIn." checked={false} onChange={() => {}} soon />
      </Group>
      <LinkedInNote show={d.enabled && !hasLinkedIn} />
    </div>
  );
}

export function LookalikePanel({ drafts, set, budgetLeft, hasLinkedIn, icpQuery }: Props & { icpQuery: string }) {
  const d = drafts.lookalike;
  const [blocked, setBlocked] = useState<string | null>(null);
  const query = d.config.keywords?.[0] ?? "";
  return (
    <div className="space-y-6">
      <PanelHeader title="Lookalike" description="Find prospects similar to your best customers" />
      {blocked && <p className="text-[13px] text-error">{blocked}</p>}
      <div className="border-t border-[var(--border-subtle)]">
        <CheckRow label="Find lookalike prospects" hint="Continuously discover similar prospects for this agent from Sales Navigator, using your ICP's keyword query."
          checked={d.enabled} onChange={(v) => { if (v && budgetLeft <= 0) { setBlocked(budgetMsg); return; } setBlocked(null); set("lookalike", { ...d, enabled: v }); }} />
      </div>
      {d.enabled && (
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-base-content">Sales Navigator keyword query {icpQuery ? <span className="font-normal text-base-content/50">(optional)</span> : <span className="text-error">*</span>}</span>
          <input className={`${inputCls} w-full`} value={query} placeholder={icpQuery || "e.g. (\"VP Sales\" OR \"Head of Sales\") AND SaaS"}
            onChange={(e) => set("lookalike", { ...d, config: { ...d.config, keywords: e.target.value.trim() ? [e.target.value] : [] } })} maxLength={80} />
          <span className="block text-[13px] text-base-content/55">{icpQuery ? "Leave empty to use the query from your ICP." : "Your ICP has no Sales Navigator query yet, so add one here."}</span>
        </label>
      )}
      <LinkedInNote show={d.enabled && !hasLinkedIn} />
    </div>
  );
}

export function SoonPanel({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><PanelHeader title={title} description={description} /><SoonPill /></div>
      <div className="pointer-events-none select-none space-y-3 opacity-55" aria-disabled="true">{children}</div>
      <p className="rounded-[10px] bg-base-200 px-4 py-3 text-sm text-base-content/60">This source isn&apos;t available yet. We&apos;ll let you know when it is.</p>
    </div>
  );
}

const POPULAR = ["Intercom", "Drift", "Zendesk", "Hotjar", "Google Analytics", "Google Tag Manager", "Segment", "Mixpanel", "Shopify", "WordPress"];

export function TechStackPanel() {
  return (
    <SoonPanel title="Tech stack" description="Find companies using specific technologies and surface matching prospects">
      <SubHeading>Add technologies</SubHeading>
      <input disabled className="h-12 w-full rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-4 text-[15px]" placeholder="Search tools like Shopify, WordPress, Mixpanel…" aria-label="Search technologies" />
      <div className="flex flex-wrap items-center gap-2 text-sm text-base-content/60">
        Popular {POPULAR.map((p) => <span key={p} className="rounded-[8px] bg-base-200 px-2.5 py-1 text-base-content/80">{p}</span>)}
      </div>
    </SoonPanel>
  );
}

export function WebsitePanel() {
  return <SoonPanel title="Website visitors" description="Find visitors, or people at companies visiting your website" />;
}
