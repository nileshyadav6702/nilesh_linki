import { useRef, useState, type ReactNode } from "react";
import {
  RiAddLine, RiArrowDownSLine, RiBriefcase4Line, RiCheckLine, RiCloseLine, RiCodeSSlashLine, RiEyeLine, RiMegaphoneLine, RiPriceTag3Line,
  RiLineChartLine, RiSearchLine, RiSparkling2Line,
} from "react-icons/ri";
import { countSignals, type SourceDraft } from "@/components/agents/SourcePicker";
import { Toggle } from "@/components/agents/ui";
import { Collapse, SoonBadge } from "@/components/agents/wizard/kit";
import { useDismiss } from "@/components/agents/leads/Listbox";
import {
  companyUrlFromName, labelFromUrl, normalizeCompanyUrl, normalizePageUrl, normalizeProfileUrlStrict, parseTopics, shortLinkedIn, SIGNAL_BUDGET,
} from "@/lib/agents/lead-source-rules";

/** The high-intent signals of the new-agent wizard: an accordion where one group is open at a time. */

type GroupId = "keywords" | "market" | "competitors" | "brand" | "buying" | "tech";
type Config = SourceDraft["config"];

const fieldCls = "h-12 w-full min-w-0 rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-4 text-[15px] text-base-content outline-none transition placeholder:text-base-content/40 focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:bg-base-200/50";
const full = `You're tracking ${SIGNAL_BUDGET} signals, the most one agent can. Remove one to add another.`;

function Group({ id, open, setOpen, icon, tint, title, subtitle, active, pill, action, disabled, children }: {
  id: GroupId; open: GroupId | null; setOpen: (g: GroupId | null) => void; icon: ReactNode; tint: string; title: string; subtitle: string;
  active?: number; pill?: ReactNode; action?: ReactNode; disabled?: boolean; children?: ReactNode;
}) {
  const on = open === id && !disabled;
  const toggle = () => { if (!disabled) setOpen(on ? null : id); };
  return (
    <div className={`rounded-[12px] border bg-base-100 transition-shadow duration-200 ${on ? "border-[var(--border-strong)] shadow-[0_2px_10px_rgba(20,20,19,0.05)]" : "border-[var(--border-subtle)]"}`}>
      <div className="flex items-center gap-4 px-5 py-4">
        <button type="button" onClick={toggle} aria-expanded={on} disabled={disabled} className="flex min-w-0 flex-1 items-center gap-4 text-left disabled:cursor-not-allowed">
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] ${tint} ${disabled ? "opacity-60" : ""}`}>{icon}</span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2 text-[17px] font-medium text-base-content">
              {title}
              {!!active && <span className="rounded-[6px] border border-primary/30 bg-primary/5 px-2 py-px text-[14.5px] font-normal text-primary">{active} active</span>}
              {pill}
            </span>
            <span className="mt-0.5 block text-[15px] text-base-content/60">{subtitle}</span>
          </span>
        </button>
        {action}
        {!disabled && (
          <button type="button" onClick={toggle} aria-label={on ? `Collapse ${title}` : `Expand ${title}`}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base-content/60 transition hover:bg-base-200 hover:text-base-content ${on ? "border border-base-content/70" : ""}`}>
            <RiArrowDownSLine size={22} className={`transition-transform duration-300 ${on ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>
      <Collapse open={on}><div className="space-y-4 border-t border-[var(--border-subtle)] px-5 py-5">{children}</div></Collapse>
    </div>
  );
}

const Hint = ({ children, error }: { children: ReactNode; error?: boolean }) =>
  <p className={`text-[14.5px] ${error ? "text-error" : "text-base-content/55"}`}>{children}</p>;

function Chips({ values, label, onRemove }: { values: string[]; label?: (v: string) => string; onRemove: (v: string) => void }) {
  if (!values.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {values.map((v) => (
        <span key={v} className="wizard-rise inline-flex max-w-full items-center gap-1.5 rounded-[8px] border border-primary/25 bg-primary/10 py-1 pl-3 pr-1.5 text-[15px] text-primary">
          <span className="truncate">{label ? label(v) : v}</span>
          <button type="button" onClick={() => onRemove(v)} aria-label={`Remove ${label ? label(v) : v}`} className="flex h-5 w-5 items-center justify-center rounded-[6px] text-primary/70 hover:bg-primary/15 hover:text-primary"><RiCloseLine size={14} /></button>
        </span>
      ))}
    </div>
  );
}

/** Input with an attached "Add" button on its right edge. */
function AddField({ placeholder, onAdd }: { placeholder: string; onAdd: (text: string) => string | null }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = () => { const err = onAdd(text.trim()); setError(err); if (!err) setText(""); };
  return (
    <div className="space-y-1.5">
      <div className="flex overflow-hidden rounded-[8px] border border-[var(--border-subtle)] focus-within:border-[var(--border-focus)] focus-within:ring-2 focus-within:ring-[var(--ring)]">
        <input className="h-12 min-w-0 flex-1 bg-base-100 px-4 text-[15px] outline-none placeholder:text-base-content/40" value={text} placeholder={placeholder} aria-label={placeholder}
          onChange={(e) => { setText(e.target.value); setError(null); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (text.trim()) add(); } }} />
        <button type="button" disabled={!text.trim()} onClick={add}
          className="w-20 shrink-0 border-l border-[var(--border-subtle)] bg-base-200 text-[15px] font-medium text-base-content transition-colors hover:bg-base-300 disabled:text-base-content/35 disabled:hover:bg-base-200">Add</button>
      </div>
      {error && <Hint error>{error}</Hint>}
    </div>
  );
}

function CheckItem({ label, hint, checked, onChange, soon }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; soon?: boolean }) {
  return (
    <label className={`flex items-start gap-3 ${soon ? "cursor-not-allowed" : "cursor-pointer"}`}>
      <input type="checkbox" className="peer sr-only" checked={checked && !soon} disabled={soon} onChange={(e) => onChange(e.target.checked)} />
      <span className={`mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ring)] ${checked && !soon ? "border-primary bg-primary text-primary-content" : "border-primary/50 bg-base-100"} ${soon ? "opacity-50" : ""}`}>
        {checked && !soon && <RiCheckLine size={16} />}
      </span>
      <span className="min-w-0">
        <span className={`flex flex-wrap items-center gap-2 text-[17px] ${soon ? "text-base-content/50" : "text-base-content"}`}>{label}{soon && <SoonBadge />}</span>
        <span className="mt-0.5 block text-[14px] text-base-content/55">{hint}</span>
      </span>
    </label>
  );
}

/** Company search: suggestions from the ICP's competitors plus a best-guess page for the typed name. */
function CompanySearch({ suggestions, onAdd }: { suggestions: Array<{ name: string; linkedin_url: string | null }>; onAdd: (url: string | null) => string | null }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(open, [wrap], () => setOpen(false));
  const q = text.trim();
  const isUrl = /linkedin\.com\//i.test(q);
  const known = q.length >= 3 && !isUrl
    ? suggestions.filter((s) => s.linkedin_url && normalizeCompanyUrl(s.linkedin_url) && s.name.toLowerCase().includes(q.toLowerCase())).slice(0, 5).map((s) => ({ name: s.name, url: normalizeCompanyUrl(s.linkedin_url!)! }))
    : [];
  const guess = q.length >= 3 && !isUrl ? companyUrlFromName(q) : null;
  const options = [...known, ...(guess && !known.some((k) => k.url === guess) ? [{ name: q, url: guess }] : [])];
  const add = (url: string | null) => { const err = onAdd(url); setError(err); if (!err) { setText(""); setOpen(false); } };

  return (
    <div ref={wrap} className="relative space-y-1.5">
      <div className="relative">
        <RiSearchLine size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base-content/45" />
        <input className={`${fieldCls} pl-11`} value={text} placeholder="Enter a company name..." aria-label="Company name or LinkedIn company URL"
          onChange={(e) => { setText(e.target.value); setOpen(true); setError(null); }} onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setOpen(false); return; }
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (isUrl) add(normalizeCompanyUrl(q)); else if (options[0]) add(options[0].url);
          }} />
      </div>
      {open && options.length > 0 && (
        <ul role="listbox" aria-label="Matching companies" className="wizard-rise absolute left-0 right-0 top-12 z-30 mt-1 overflow-hidden rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-1 shadow-[var(--shadow-overlay)]">
          {options.map((o) => (
            <li key={o.url}>
              <button type="button" onClick={() => add(o.url)} className="flex w-full items-center gap-3 rounded-[8px] px-3 py-2 text-left hover:bg-base-200">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#fdf3d8] text-[15px] font-semibold uppercase text-[#b45309]">{o.name.charAt(0)}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[15px]">{o.name}</span><span className="block truncate text-[14.5px] text-base-content/50">{shortLinkedIn(o.url)}</span></span>
                <RiAddLine size={16} className="text-base-content/40" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error ? <Hint error>{error}</Hint> : <Hint>Type at least 3 characters to search, or paste a LinkedIn company URL and press Enter.</Hint>}
    </div>
  );
}

export default function SignalsPicker({ value, onChange, hasLinkedIn, keywordSuggestions, competitors }: {
  value: SourceDraft[]; onChange: (v: SourceDraft[]) => void; hasLinkedIn: boolean;
  keywordSuggestions: string[]; competitors: Array<{ name: string; linkedin_url: string | null }>;
}) {
  const [open, setOpen] = useState<GroupId | null>("keywords");
  const total = countSignals(value);
  const left = SIGNAL_BUDGET - total;
  const get = (type: string): SourceDraft => value.find((s) => s.source_type === type) ?? { source_type: type, enabled: false, config: {} };
  const put = (type: string, config: Config, enabled?: boolean) => {
    const items = (config.keywords?.length ?? 0) + (config.urls?.length ?? 0) + (config.boards?.length ?? 0);
    onChange([...value.filter((s) => s.source_type !== type), { source_type: type, config, enabled: enabled ?? items > 0 }]);
  };
  const urls = (type: string) => get(type).config.urls ?? [];
  const addUrl = (type: string, url: string | null, bad: string): string | null => {
    if (!url) return bad;
    if (urls(type).includes(url)) return "Already tracked";
    if (left <= 0) return full;
    put(type, { ...get(type).config, urls: [...urls(type), url] });
    return null;
  };
  const toggle = (type: string, on: boolean) => {
    if (on && left <= 0) return;
    put(type, get(type).config, on);
  };

  const kw = get("keyword_engagement").config.keywords ?? [];
  const setKw = (next: string[]) => put("keyword_engagement", { keywords: next });
  const fresh = keywordSuggestions.filter((s) => s.trim().split(/\s+/).length <= 3 && !kw.some((k) => k.toLowerCase() === s.toLowerCase()));
  const own = urls("own_content_engagement");
  const hiring = get("hiring");
  const boards = (hiring.config.boards ?? []).map((b) => `${b.ats}:${b.slug}`);
  const buying = ["job_change", "funding", "hiring"].filter((t) => get(t).enabled).length;

  return (
    <div className="space-y-4">
      {!hasLinkedIn && <p className="rounded-[12px] bg-[#e8a55a]/15 px-4 py-3 text-[14px] text-[#8a5a1f]">Connect a LinkedIn account in Settings to track LinkedIn signals. Funding news and job boards work without one.</p>}

      <Group id="keywords" open={open} setOpen={setOpen} icon={<RiPriceTag3Line size={22} />} tint="bg-[#f6e3f6] text-[#a21caf]"
        title="Keyword engagement" subtitle="People engaging with topics related to your solution" active={kw.length}
        action={fresh.length > 0 ? (
          <button type="button" disabled={left <= 0} onClick={() => { setKw([...kw, ...fresh].slice(0, kw.length + Math.max(0, left))); setOpen("keywords"); }}
            className="hidden h-9 shrink-0 items-center gap-1.5 rounded-[8px] bg-primary px-3.5 text-[15px] font-medium text-primary-content shadow-sm transition-colors hover:bg-[var(--primary-hover)] disabled:opacity-50 sm:inline-flex">
            <RiSparkling2Line size={16} /> Generate with AI
          </button>
        ) : undefined}>
        <p className="text-[15px] text-base-content/70">Track people who like or comment on posts about these topics.</p>
        <AddField placeholder="Add a keyword or topic, e.g. open source lms" onAdd={(t) => {
          const { topics, error } = parseTopics(t);
          if (error) return error;
          const add = topics.filter((x) => !kw.some((k) => k.toLowerCase() === x.toLowerCase()));
          if (!add.length) return "Already tracked";
          if (add.length > left) return full;
          setKw([...kw, ...add]);
          return null;
        }} />
        <Hint>Press Enter to add. Separate several topics with commas; 3 words max each.</Hint>
        <Chips values={kw} onRemove={(v) => setKw(kw.filter((x) => x !== v))} />
      </Group>

      <Group id="market" open={open} setOpen={setOpen} icon={<RiMegaphoneLine size={22} />} tint="bg-[#e4ecf7] text-[#1d4ed8]"
        title="People engaging with your market" subtitle="Reach people active around experts in your space" active={urls("influencer_engagement").length}>
        <p className="text-[15px] text-base-content/70">Add LinkedIn profiles for experts, creators, or influencers in your market.</p>
        <AddField placeholder="https://www.linkedin.com/in/expert-profile"
          onAdd={(t) => addUrl("influencer_engagement", normalizeProfileUrlStrict(t), "Paste a LinkedIn profile URL (linkedin.com/in/…)")} />
        <Chips values={urls("influencer_engagement")} label={labelFromUrl} onRemove={(v) => put("influencer_engagement", { urls: urls("influencer_engagement").filter((x) => x !== v) })} />
      </Group>

      <Group id="competitors" open={open} setOpen={setOpen} icon={<RiBriefcase4Line size={22} />} tint="bg-[#fdf1c7] text-[#b45309]"
        title="Companies & competitors engagement" subtitle="Find people interacting with your competitors" active={urls("competitor_engagement").length}>
        <p className="text-[15px] text-base-content/70">Search a company name or paste a LinkedIn company URL.</p>
        <CompanySearch suggestions={competitors} onAdd={(u) => addUrl("competitor_engagement", u, "Paste a LinkedIn company page URL (linkedin.com/company/…)")} />
        <Chips values={urls("competitor_engagement")} label={(u) => competitors.find((c) => c.linkedin_url && normalizeCompanyUrl(c.linkedin_url) === u)?.name ?? labelFromUrl(u)}
          onRemove={(v) => put("competitor_engagement", { urls: urls("competitor_engagement").filter((x) => x !== v) })} />
        <Hint>Competitors&apos; own employees are filtered out automatically.</Hint>
      </Group>

      <Group id="brand" open={open} setOpen={setOpen} icon={<RiEyeLine size={22} />} tint="bg-[#dcf5e6] text-[#15803d]"
        title="People aware of your brand" subtitle="Re-engage people who already know you" active={own.length}>
        <div className="space-y-2">
          <div className="text-[15px] font-medium text-base-content">Track interaction with your profile</div>
          <AddField placeholder="https://www.linkedin.com/in/your-profile"
            onAdd={(t) => addUrl("own_content_engagement", normalizePageUrl(t), "Paste your LinkedIn profile or company page URL")} />
          <Hint>Add your LinkedIn Profile URL. We track people who react to your posts.</Hint>
          <Chips values={own} label={labelFromUrl} onRemove={(v) => put("own_content_engagement", { urls: own.filter((x) => x !== v) })} />
        </div>
        <CheckItem label="Track your profile visitors" hint="Requires LinkedIn Premium or Sales Navigator." checked={false} onChange={() => {}} soon />
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[15px] font-medium text-base-content/55">Track followers of your company LinkedIn page <SoonBadge /></div>
          <input className={fieldCls} disabled placeholder="https://www.linkedin.com/company/107433042" aria-label="Company page URL" />
          <Hint>The URL must include the numeric LinkedIn company ID, and the selected seat should be a page admin.</Hint>
        </div>
      </Group>

      <Group id="buying" open={open} setOpen={setOpen} icon={<RiLineChartLine size={22} />} tint="bg-[#ece6fb] text-[#6d28d9]"
        title="Buying events" subtitle="Catch leads at the right moment" active={buying}>
        <div className="grid gap-x-10 gap-y-5 md:grid-cols-2">
          <CheckItem label="Track top 5% active profiles in your ICP" hint="Identifies highly active LinkedIn users who are more likely to reply." checked={false} onChange={() => {}} soon />
          <CheckItem label="Companies that have recently raised funds" hint="Spot companies in growth mode that may be ready to buy." checked={get("funding").enabled} onChange={(v) => toggle("funding", v)} />
          <CheckItem label="Recent job changes (< 90 days)" hint="Reach people who recently changed roles and may be open to new solutions." checked={get("job_change").enabled} onChange={(v) => toggle("job_change", v)} />
          <CheckItem label="Open Roles" hint="Companies with active job openings." checked={hiring.enabled} onChange={(v) => toggle("hiring", v)} />
        </div>
        {hiring.enabled && (
          <div className="wizard-rise space-y-2 rounded-[10px] bg-base-200/50 p-4">
            <div className="text-[15px] font-medium">Job boards to watch</div>
            <AddField placeholder="greenhouse:acme, lever:globex or ashby:initech" onAdd={(t) => {
              if (!/^(greenhouse|lever|ashby):[\w.-]+$/i.test(t)) return "Use ats:slug, e.g. greenhouse:acme";
              if (boards.includes(t.toLowerCase())) return "Already added";
              const [ats, slug] = t.split(":");
              put("hiring", { ...hiring.config, boards: [...(hiring.config.boards ?? []), { ats: ats.toLowerCase() as "greenhouse", slug }] }, true);
              return null;
            }} />
            <Chips values={boards} onRemove={(v) => put("hiring", { ...hiring.config, boards: (hiring.config.boards ?? []).filter((b) => `${b.ats}:${b.slug}` !== v) }, true)} />
            {!boards.length && <Hint>Add the Greenhouse, Lever or Ashby boards of companies you want to watch.</Hint>}
          </div>
        )}
        {get("job_change").enabled && !hasLinkedIn && <Hint error>Recent job changes need a connected LinkedIn account.</Hint>}
      </Group>

      <Group id="tech" open={open} setOpen={setOpen} icon={<RiCodeSSlashLine size={22} />} tint="bg-[#d9f3f4] text-[#0e7490]"
        title="Tech Stack" subtitle="Find companies using specific tools" disabled
        pill={<><span className="rounded-[6px] border border-[#93c5fd] bg-[#eff6ff] px-2 py-px text-[14.5px] font-normal text-[#2563eb]">Beta</span><SoonBadge /></>} />

      <div className="flex items-center gap-4 rounded-[12px] border border-[var(--border-subtle)] bg-base-100 px-5 py-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-primary/10 text-primary"><RiSparkling2Line size={22} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-medium text-base-content">Smart lead finder</span>
          <span className="mt-0.5 block text-[15px] text-base-content/60">Automatically find more warm leads when signals are low</span>
        </span>
        <Toggle label="Smart lead finder" on={get("lookalike").enabled} disabled={!hasLinkedIn} onChange={() => toggle("lookalike", !get("lookalike").enabled)} />
      </div>
      {left <= 0 && <Hint error>{full}</Hint>}
    </div>
  );
}
