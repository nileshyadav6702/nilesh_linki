import { useRef, useState } from "react";
import { RiAddLine, RiMagicLine } from "react-icons/ri";
import { useDismiss } from "@/components/agents/leads/Listbox";
import { InitialTile, PanelHeader, SubHeading, TrackedRow } from "@/components/agents/sources/kit";
import {
  companyUrlFromName, labelFromUrl, normalizeCompanyUrl, normalizeProfileUrlStrict, parseTopics, shortLinkedIn, SIGNAL_BUDGET, type SignalDraft,
} from "@/lib/agents/lead-source-rules";

/** Panels for the URL / topic based live signals: competitors, topics, industry experts. */

export interface PanelProps { draft: SignalDraft; onChange: (next: SignalDraft) => void; budgetLeft: number }

const fieldCls = "h-12 w-full rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-4 text-[15px] text-base-content outline-none transition placeholder:text-base-content/40 focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[var(--ring)]";
const budgetMsg = `You're tracking ${SIGNAL_BUDGET} signals, the most one agent can. Remove one to add another.`;

function withUrls(draft: SignalDraft, urls: string[]): SignalDraft {
  return { enabled: urls.length > 0, config: { ...draft.config, urls } };
}

export interface CompetitorSuggestion { name: string; linkedin_url: string | null }

export function CompetitorPanel({ draft, onChange, budgetLeft, suggestions }: PanelProps & { suggestions: CompetitorSuggestion[] }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(open, [wrap], () => setOpen(false));
  const urls = draft.config.urls ?? [];
  const nameFor = (url: string) => suggestions.find((s) => s.linkedin_url && normalizeCompanyUrl(s.linkedin_url) === url)?.name ?? labelFromUrl(url);

  function add(url: string | null) {
    if (!url) { setError("Paste a LinkedIn company page URL (linkedin.com/company/…)"); return; }
    if (urls.includes(url)) { setError("Already tracked"); return; }
    if (budgetLeft <= 0) { setError(budgetMsg); return; }
    onChange(withUrls(draft, [...urls, url]));
    setText(""); setError(null); setOpen(false);
  }

  const q = text.trim();
  const isUrl = /linkedin\.com\//i.test(q);
  const matches = q.length >= 3 && !isUrl
    ? suggestions.filter((s) => s.linkedin_url && normalizeCompanyUrl(s.linkedin_url) && s.name.toLowerCase().includes(q.toLowerCase())).slice(0, 5)
    : [];
  const guess = q.length >= 3 && !isUrl ? companyUrlFromName(q) : null;
  const options = [
    ...matches.map((s) => ({ name: s.name, url: normalizeCompanyUrl(s.linkedin_url!)! })),
    ...(guess && !matches.some((m) => normalizeCompanyUrl(m.linkedin_url!) === guess) ? [{ name: q, url: guess }] : []),
  ];

  return (
    <div className="space-y-6">
      <PanelHeader title="Competitor engagement" count={urls.length} description="Find people engaging with your competitors and surface the ones that match your ICP" />
      <div className="space-y-2">
        <SubHeading>Add competitors</SubHeading>
        <div ref={wrap} className="relative">
          <input className={fieldCls} value={text} placeholder="Company name or LinkedIn URL" aria-label="Company name or LinkedIn URL"
            onChange={(e) => { setText(e.target.value); setOpen(true); setError(null); }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); return; }
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (isUrl) add(normalizeCompanyUrl(q)); else if (options[0]) add(options[0].url);
            }} />
          {open && options.length > 0 && (
            <ul className="absolute left-0 right-0 z-30 mt-1.5 overflow-hidden rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-1 shadow-[var(--shadow-overlay)]" role="listbox" aria-label="Matching companies">
              {options.map((o) => (
                <li key={o.url}>
                  <button type="button" onClick={() => add(o.url)} className="flex w-full items-center gap-3 rounded-[8px] px-3 py-2 text-left hover:bg-base-200 focus-visible:bg-base-200 focus-visible:outline-none">
                    <InitialTile label={o.name} size={32} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-[15px] text-base-content">{o.name}</span><span className="block truncate text-[13px] text-base-content/50">{shortLinkedIn(o.url)}</span></span>
                    <RiAddLine size={16} className="text-base-content/40" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {error ? <p className="text-[13px] text-error">{error}</p>
          : <p className="text-[13px] text-base-content/55">Type at least 3 characters to search, or paste a LinkedIn company URL and press Enter.</p>}
      </div>
      <div>
        <SubHeading>Tracked competitors ({urls.length})</SubHeading>
        <div className="mt-2">
          {urls.map((u) => <TrackedRow key={u} lead={<InitialTile label={nameFor(u)} />} title={nameFor(u)} sub={shortLinkedIn(u)} onRemove={() => onChange(withUrls(draft, urls.filter((x) => x !== u)))} />)}
          {!urls.length && <p className="py-3 text-sm text-base-content/45">No competitors tracked yet.</p>}
        </div>
      </div>
    </div>
  );
}

export function TopicPanel({ draft, onChange, budgetLeft, suggestions }: PanelProps & { suggestions: string[] }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const topics = draft.config.keywords ?? [];
  const has = (t: string) => topics.some((x) => x.toLowerCase() === t.toLowerCase());
  const set = (next: string[]) => onChange({ enabled: next.length > 0, config: { ...draft.config, keywords: next } });

  function addTopics(list: string[]) {
    const fresh = [...new Set(list)].filter((t) => !has(t));
    if (!fresh.length) { setError(list.length ? "Already tracked" : null); return false; }
    if (fresh.length > budgetLeft) { setError(budgetMsg); return false; }
    set([...topics, ...fresh]); setError(null);
    return true;
  }
  const suggested = suggestions.filter((s) => s.trim().split(/\s+/).length <= 3 && !has(s)).slice(0, 8);

  return (
    <div className="space-y-6">
      <PanelHeader title="Topic engagement" count={topics.length} description="Find people engaging with content relevant to your market and matching your ICP" />
      <div className="space-y-2">
        <SubHeading>Add topics</SubHeading>
        <input className={fieldCls} value={text} placeholder="Search a keyword or topic" aria-label="Add topics"
          onChange={(e) => { setText(e.target.value); setError(null); }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const { topics: parsed, error: err } = parseTopics(text);
            if (err) { setError(err); return; }
            if (addTopics(parsed)) setText("");
          }} />
        {error ? <p className="text-[13px] text-error">{error}</p>
          : <p className="text-[13px] text-base-content/55">Press Enter to add. Separate several topics with commas; 3 words max each.</p>}
      </div>
      {suggested.length > 0 && (
        <div className="space-y-2.5">
          <SubHeading><span className="inline-flex items-center gap-2">Suggested topics <span className="inline-flex items-center gap-1 rounded-full bg-[#efe8fd] px-2 py-0.5 text-[12px] font-medium text-[#7c3aed]"><RiMagicLine size={12} /> AI</span></span></SubHeading>
          <div className="flex flex-wrap gap-2">
            {suggested.map((s) => (
              <button key={s} type="button" onClick={() => addTopics([s])}
                className="inline-flex items-center gap-1.5 rounded-[8px] bg-primary/10 px-3 py-1.5 text-sm text-base-content/80 hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
                <RiAddLine size={15} /> {s}
              </button>
            ))}
          </div>
          <p className="text-xs text-base-content/45">From the keywords in this agent&apos;s ICP.</p>
        </div>
      )}
      <div>
        <SubHeading>Tracked topics ({topics.length})</SubHeading>
        <div className="mt-1">
          {topics.map((t) => <TrackedRow key={t} title={t} onRemove={() => set(topics.filter((x) => x !== t))} />)}
          {!topics.length && <p className="py-3 text-sm text-base-content/45">No topics tracked yet.</p>}
        </div>
      </div>
    </div>
  );
}

export function ExpertsPanel({ draft, onChange, budgetLeft }: PanelProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const urls = draft.config.urls ?? [];
  function add() {
    const url = normalizeProfileUrlStrict(text);
    if (!url) { setError("Paste a LinkedIn profile URL (linkedin.com/in/…)"); return; }
    if (urls.includes(url)) { setError("Already tracked"); return; }
    if (budgetLeft <= 0) { setError(budgetMsg); return; }
    onChange(withUrls(draft, [...urls, url]));
    setText(""); setError(null);
  }
  return (
    <div className="space-y-6">
      <PanelHeader title="Industry experts" count={urls.length} description="Find prospects engaging with experts in your market" />
      <div className="space-y-2">
        <SubHeading>Add experts</SubHeading>
        <div className="flex gap-2">
          <input className={fieldCls} value={text} placeholder="Paste a LinkedIn profile URL" aria-label="Expert LinkedIn profile URL"
            onChange={(e) => { setText(e.target.value); setError(null); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
          <button type="button" onClick={add} disabled={!text.trim()}
            className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded-[8px] bg-primary px-5 text-[15px] font-medium text-primary-content hover:bg-[var(--primary-hover)] disabled:bg-[#e6dfd8] disabled:text-[#8e8b82]">
            <RiAddLine size={18} /> Add
          </button>
        </div>
        {error ? <p className="text-[13px] text-error">{error}</p>
          : <p className="text-[13px] text-base-content/55">Each expert uses 1 signal · Add experts, creators, or influencers in your market.</p>}
      </div>
      {urls.length > 0 && (
        <div>
          <SubHeading>Tracked experts ({urls.length})</SubHeading>
          <div className="mt-2">
            {urls.map((u) => <TrackedRow key={u} lead={<InitialTile label={labelFromUrl(u)} />} title={labelFromUrl(u)} sub={shortLinkedIn(u)} onRemove={() => onChange(withUrls(draft, urls.filter((x) => x !== u)))} />)}
          </div>
        </div>
      )}
    </div>
  );
}
