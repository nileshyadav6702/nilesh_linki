import { useRef, useState, type ReactNode } from "react";
import { RiAddLine, RiSearchLine } from "react-icons/ri";
import { useDismiss } from "@/components/agents/leads/Listbox";
import { CheckRow, InitialTile, NewPill, PanelHeader, SoonPill, SubHeading, TrackedRow } from "@/components/agents/sources/kit";
import { labelFromUrl, normalizeCompanyUrl, normalizePageUrl, shortLinkedIn, SIGNAL_BUDGET, type DrawerSignalType, type SignalDraft } from "@/lib/agents/lead-source-rules";
import { POPULAR_TECH, searchTechnologies, TECHNOLOGIES } from "@/lib/signals/tech-catalog";
import type { Drafts } from "@/components/agents/sources/catalog";

/** Checkbox-style live signals: buying events, people engaging with you, lookalike, tech stack, website visitors. */

interface Props { drafts: Drafts; set: (type: DrawerSignalType, next: SignalDraft) => void; budgetLeft: number; hasLinkedIn: boolean }

const inputCls = "h-12 min-w-0 flex-1 rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-4 text-[16.5px] text-base-content outline-none transition placeholder:text-base-content/40 focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[var(--ring)]";
const addBtn = "inline-flex h-12 shrink-0 items-center gap-1.5 rounded-[8px] border border-[var(--border-subtle)] bg-base-200 px-5 text-[16.5px] font-medium text-base-content hover:bg-base-300 disabled:opacity-50";
const budgetMsg = `You're tracking ${SIGNAL_BUDGET} signals, the most one agent can. Remove one first.`;
const note = "text-[15.5px]";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <div className="space-y-1.5"><SubHeading>{title}</SubHeading><div className="border-t border-[var(--border-subtle)]">{children}</div></div>;
}

const LinkedInNote = ({ show }: { show: boolean }) => show
  ? <p className={`rounded-[10px] bg-[#e8a55a]/15 px-4 py-2.5 ${note} text-[#8a5a1f]`}>This needs a LinkedIn account on the agent. Add one in the agent&apos;s Settings tab; it starts working once connected.</p>
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
    <div className="space-y-2 pb-3 pl-12 pr-3">
      <div className="flex gap-2">
        <input className={inputCls} value={text} placeholder={placeholder} aria-label={placeholder} onChange={(e) => { setText(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" className={addBtn} disabled={!text.trim()} onClick={add}><RiAddLine size={18} /> Add</button>
      </div>
      {error && <p className={`${note} text-error`}>{error}</p>}
      {values.map((v) => { const r = render?.(v) ?? { title: v }; return <TrackedRow key={v} lead={r.lead} title={r.title} sub={r.sub} onRemove={() => onRemove(v)} />; })}
    </div>
  );
}

/** On/off toggles that respect the signal budget. */
function useToggle(drafts: Drafts, set: Props["set"], budgetLeft: number) {
  const [blocked, setBlocked] = useState<string | null>(null);
  const toggle = (type: DrawerSignalType, on: boolean) => {
    if (on && budgetLeft <= 0) { setBlocked(budgetMsg); return; }
    setBlocked(null);
    set(type, { ...drafts[type], enabled: on });
  };
  return { blocked, toggle };
}

const BUYING: DrawerSignalType[] = ["top_active", "job_change", "new_decision_maker", "funding", "hiring", "hiring_surge"];

export function BuyingEventsPanel({ drafts, set, budgetLeft, hasLinkedIn }: Props) {
  const { blocked, toggle } = useToggle(drafts, set, budgetLeft);
  const hiring = drafts.hiring;
  const boards = (hiring.config.boards ?? []).map((b) => `${b.ats}:${b.slug}`);
  const count = BUYING.filter((t) => drafts[t].enabled).length;
  // Job openings and Hiring surge both read the boards listed here.
  const needBoards = hiring.enabled || drafts.hiring_surge.enabled;
  return (
    <div className="space-y-7">
      <PanelHeader title="Buying events" count={count} description="Find people and companies showing signals that make now a good time to reach out" />
      {blocked && <p className={`${note} text-error`}>{blocked}</p>}
      <Group title="People signals">
        <CheckRow label="Track top 5% active profiles in your ICP" hint="People in your ICP among the top 5% most active on LinkedIn." checked={drafts.top_active.enabled} onChange={(v) => toggle("top_active", v)} />
        <CheckRow label="Recent job changes (< 90 days)" hint="People who changed roles in the last 90 days." checked={drafts.job_change.enabled} onChange={(v) => toggle("job_change", v)} />
        <CheckRow label="New decision-makers in role" pill={<NewPill />} hint="Decision-makers who recently joined a company or were promoted." checked={drafts.new_decision_maker.enabled} onChange={(v) => toggle("new_decision_maker", v)} />
      </Group>
      <LinkedInNote show={drafts.job_change.enabled && !hasLinkedIn} />
      <Group title="Company signals">
        <CheckRow label="Companies that have recently raised funds" hint="Companies that recently raised funding." checked={drafts.funding.enabled} onChange={(v) => toggle("funding", v)} />
        <CheckRow label="Job openings" hint="Companies currently hiring for open roles." checked={hiring.enabled} onChange={(v) => toggle("hiring", v)} />
        <CheckRow label="Hiring surge" pill={<NewPill />} hint="Companies whose hiring activity has increased significantly." checked={drafts.hiring_surge.enabled} onChange={(v) => toggle("hiring_surge", v)} />
        {needBoards && (
          <div className="space-y-1 border-t border-[var(--border-subtle)] pt-3">
            <p className={`pb-1 pl-12 pr-3 ${note} text-base-content/60`}>Optional: job boards to watch (Greenhouse, Lever or Ashby). Leave empty and Kairo finds the boards on your leads&apos; company careers pages.{drafts.hiring_surge.enabled ? " Hiring surge compares each board's open roles with a few weeks earlier, so it starts flagging after two weeks." : ""}</p>
            <MiniList values={boards} placeholder="Job board, e.g. greenhouse:acme or lever:globex"
              validate={(v) => /^(greenhouse|lever|ashby):[\w.-]+$/i.test(v) ? null : "Use ats:slug, e.g. greenhouse:acme"}
              onAdd={(v) => {
                if (boards.includes(v.toLowerCase())) return "Already added";
                const [ats, slug] = v.split(":");
                set("hiring", { ...hiring, config: { ...hiring.config, boards: [...(hiring.config.boards ?? []), { ats: ats.toLowerCase() as "greenhouse", slug }] } });
                return null;
              }}
              onRemove={(v) => set("hiring", { ...hiring, config: { ...hiring.config, boards: (hiring.config.boards ?? []).filter((b) => `${b.ats}:${b.slug}` !== v) } })} />
            {hiring.enabled && (
              <MiniList values={hiring.config.role_keywords ?? []} placeholder="Role keywords for openings (optional), e.g. SDR"
                onAdd={(v) => {
                  const cur = hiring.config.role_keywords ?? [];
                  if (v.length < 2) return "Too short";
                  if (cur.some((x) => x.toLowerCase() === v.toLowerCase())) return "Already added";
                  set("hiring", { ...hiring, config: { ...hiring.config, role_keywords: [...cur, v] } });
                  return null;
                }}
                onRemove={(v) => set("hiring", { ...hiring, config: { ...hiring.config, role_keywords: (hiring.config.role_keywords ?? []).filter((x) => x !== v) } })} />
            )}
          </div>
        )}
      </Group>
    </div>
  );
}

const PremiumPill = () => <span className="rounded-full bg-base-200 px-2.5 py-0.5 text-[14px] text-base-content/65">LinkedIn Premium</span>;

export function EngagingPanel({ drafts, set, budgetLeft, hasLinkedIn }: Props) {
  const { blocked, toggle } = useToggle(drafts, set, budgetLeft);
  const d = drafts.own_content_engagement;
  const urls = d.config.urls ?? [];
  const f = drafts.company_followers;
  const page = f.config.urls ?? [];
  const count = urls.length * Number(d.enabled) + Number(drafts.profile_visitors.enabled) + Number(f.enabled);
  const anyOn = d.enabled || drafts.profile_visitors.enabled || f.enabled;
  return (
    <div className="space-y-7">
      <PanelHeader title="People engaging with you" count={count} description="Find prospects already engaging with you or your company" />
      {blocked && <p className={`${note} text-error`}>{blocked}</p>}
      <Group title="What to track">
        <CheckRow label="Post engagement" hint="People who like or comment on your LinkedIn posts." checked={d.enabled} onChange={(v) => set("own_content_engagement", { ...d, enabled: v })} />
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
            render={(v) => ({ title: labelFromUrl(v), sub: shortLinkedIn(v), lead: <InitialTile label={labelFromUrl(v)} size={36} /> })} />
        )}
        {d.enabled && !urls.length && <p className={`pb-2 pl-12 ${note} text-error`}>Add your profile or company page so we know whose posts to watch.</p>}
        <CheckRow label="Profile visitors" pill={<PremiumPill />} hint="People who viewed your LinkedIn profile." checked={drafts.profile_visitors.enabled} onChange={(v) => toggle("profile_visitors", v)} />
        <CheckRow label="Company page followers" hint="People who follow your company page on LinkedIn." checked={f.enabled} onChange={(v) => toggle("company_followers", v)} />
        {f.enabled && (
          <>
            {page.length ? <div className="pl-12 pr-3"><TrackedRow lead={<InitialTile label={labelFromUrl(page[0])} size={36} />} title={labelFromUrl(page[0])} sub={shortLinkedIn(page[0])} onRemove={() => set("company_followers", { ...f, config: { ...f.config, urls: [] } })} /></div>
              : <MiniList values={[]} placeholder="Your company page URL (linkedin.com/company/…)"
                  validate={(v) => normalizeCompanyUrl(v) ? null : "Paste your LinkedIn company page URL"}
                  onAdd={(v) => { set("company_followers", { enabled: true, config: { ...f.config, urls: [normalizeCompanyUrl(v)!] } }); return null; }}
                  onRemove={() => {}} />}
            <p className={`pb-2 pl-12 pr-3 ${note} ${page.length ? "text-base-content/55" : "text-error"}`}>{page.length ? "LinkedIn shows followers only to page admins, so the agent's LinkedIn account must be an admin of this page." : "Add your company page."}</p>
          </>
        )}
      </Group>
      <LinkedInNote show={anyOn && !hasLinkedIn} />
    </div>
  );
}

export function LookalikePanel({ drafts, set, budgetLeft, hasLinkedIn, icpQuery }: Props & { icpQuery: string }) {
  const d = drafts.lookalike;
  const { blocked, toggle } = useToggle(drafts, set, budgetLeft);
  const query = d.config.keywords?.[0] ?? "";
  return (
    <div className="space-y-7">
      <PanelHeader title="Lookalike" description="Find more prospects similar to your best-fit customers" />
      {blocked && <p className={`${note} text-error`}>{blocked}</p>}
      <div className="border-t border-[var(--border-subtle)]">
        <CheckRow label="Find lookalike prospects" hint="Continuously discover similar prospects for this agent." checked={d.enabled} onChange={(v) => toggle("lookalike", v)} />
      </div>
      {d.enabled && (
        <label className="block space-y-2">
          <span className="text-[16.5px] font-medium text-base-content">Sales Navigator keyword query {icpQuery ? <span className="font-normal text-base-content/50">(optional)</span> : <span className="text-error">*</span>}</span>
          <input className={`${inputCls} w-full`} value={query} placeholder={icpQuery || "e.g. (\"VP Sales\" OR \"Head of Sales\") AND SaaS"}
            onChange={(e) => set("lookalike", { ...d, config: { ...d.config, keywords: e.target.value.trim() ? [e.target.value] : [] } })} maxLength={80} />
          <span className={`block ${note} text-base-content/55`}>{icpQuery ? "Leave empty to use the query from your ICP." : "Your ICP has no Sales Navigator query yet, so add one here."}</span>
        </label>
      )}
      <LinkedInNote show={d.enabled && !hasLinkedIn} />
    </div>
  );
}

export function SoonPanel({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-3"><PanelHeader title={title} description={description} /><SoonPill /></div>
      <div className="pointer-events-none select-none space-y-3 opacity-55" aria-disabled="true">{children}</div>
      <p className="rounded-[10px] bg-base-200 px-4 py-3 text-[16px] text-base-content/60">This source isn&apos;t available yet. We&apos;ll let you know when it is.</p>
    </div>
  );
}

/** Tool logos: a tinted initial, so no third-party marks are bundled. */
const TechMark = ({ name }: { name: string }) => <InitialTile label={name} size={22} />;

export function TechStackPanel({ drafts, set, budgetLeft }: Props) {
  const d = drafts.tech_stack;
  const tracked = d.config.keywords ?? [];
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(open, [wrap], () => setOpen(false));
  const matches = searchTechnologies(text).filter((t) => !tracked.includes(t.name));

  function add(name: string) {
    const canonical = TECHNOLOGIES.find((t) => t.name.toLowerCase() === name.trim().toLowerCase())?.name;
    if (!canonical) { setError("Pick a technology from the list: these are the ones we can detect on websites"); return; }
    if (tracked.includes(canonical)) { setError("Already tracked"); return; }
    if (budgetLeft <= 0) { setError(budgetMsg); return; }
    set("tech_stack", { enabled: true, config: { ...d.config, keywords: [...tracked, canonical] } });
    setText(""); setError(null); setOpen(false);
  }
  const remove = (name: string) => {
    const keywords = tracked.filter((t) => t !== name);
    set("tech_stack", { enabled: keywords.length > 0, config: { ...d.config, keywords } });
  };

  return (
    <div className="space-y-7">
      <PanelHeader title="Tech stack" count={tracked.length} description="Find companies using specific technologies and surface matching prospects" />
      <div className="space-y-2.5">
        <SubHeading>Add technologies</SubHeading>
        <div ref={wrap} className="relative">
          <RiSearchLine size={19} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base-content/40" />
          <input className={`${inputCls} w-full pl-11`} value={text} placeholder="Search tools like Shopify, WordPress, Mixpanel…" aria-label="Search technologies"
            onChange={(e) => { setText(e.target.value); setOpen(true); setError(null); }} onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); return; }
              if (e.key === "Enter") { e.preventDefault(); if (matches[0]) add(matches[0].name); else if (text.trim()) add(text); }
            }} />
          {open && matches.length > 0 && (
            <ul role="listbox" aria-label="Technologies" className="absolute left-0 right-0 z-30 mt-1.5 max-h-72 overflow-y-auto rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-1 shadow-[var(--shadow-overlay)]">
              {matches.map((t) => (
                <li key={t.name}>
                  <button type="button" onClick={() => add(t.name)} className="flex w-full items-center gap-3 rounded-[8px] px-3 py-2.5 text-left hover:bg-base-200 focus-visible:bg-base-200 focus-visible:outline-none">
                    <InitialTile label={t.name} size={30} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-[16.5px] text-base-content">{t.name}</span><span className="block truncate text-[14.5px] text-base-content/50">{t.category}</span></span>
                    <RiAddLine size={18} className="text-base-content/40" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {error ? <p className={`${note} text-error`}>{error}</p>
          : <p className={`${note} text-base-content/55`}>Kairo finds companies using these tools, then prioritizes people matching your target.</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className={`${note} mr-1 text-base-content/55`}>Popular</span>
          {POPULAR_TECH.filter((p) => !tracked.includes(p)).map((p) => (
            <button key={p} type="button" onClick={() => add(p)} className="inline-flex items-center gap-2 rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-3 py-1.5 text-[15.5px] text-base-content/85 hover:bg-base-200">
              <TechMark name={p} />{p}
            </button>
          ))}
        </div>
      </div>
      {tracked.length > 0 && (
        <div className="space-y-1">
          <SubHeading>Tracked technologies ({tracked.length})</SubHeading>
          <div>{tracked.map((t) => <TrackedRow key={t} lead={<InitialTile label={t} size={36} />} title={t} sub={TECHNOLOGIES.find((x) => x.name === t)?.category} onRemove={() => remove(t)} />)}</div>
        </div>
      )}
    </div>
  );
}

export function WebsitePanel() {
  return <SoonPanel title="Website visitors" description="Find visitors, or people at companies visiting your website" />;
}
