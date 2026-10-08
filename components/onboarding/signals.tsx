import { useState } from "react";
import { RiArrowDownSLine, RiBriefcaseLine, RiBuilding2Line, RiCloseLine, RiGlobalLine, RiGroupLine, RiPriceTag3Line, RiSearchLine, RiShieldLine } from "react-icons/ri";
import type { Icp } from "@/lib/icp/schema";
import type { SourceDraft } from "@/components/agents/SourcePicker";
import { inputCls } from "@/components/agents/ui";
import { ChipAdd, CheckRow, ChipSelect, COMPANY_SIZES, COMPANY_TYPES, PEOPLE_EXCLUDES, RoleChips, SectionLabel, Title, buyerTitles, filled, withTitles } from "@/components/onboarding/fields";

const INTENT = [
  { type: "lookalike", label: "Top 5% active profiles in your ICP", hint: "People who match the roles and companies you chose." },
  { type: "job_change", label: "Recent job changes (< 90 days)", hint: "People who started a relevant role recently." },
  { type: "funding", label: "Companies that have recently raised funds", hint: "Buyers at companies with new funding." },
] as const;

export function defaultSources(icp: Icp): SourceDraft[] {
  const keywords = filled(icp.keywords).slice(0, 8);
  const urls = icp.competitors.map((c) => c.linkedin_url).filter((url): url is string => !!url);
  return [
    { source_type: "lookalike", enabled: true, config: {} },
    { source_type: "job_change", enabled: true, config: {} },
    { source_type: "funding", enabled: false, config: {} },
    { source_type: "keyword_engagement", enabled: keywords.length > 0, config: { keywords } },
    { source_type: "competitor_engagement", enabled: urls.length > 0, config: { urls } },
  ];
}

function source(sources: SourceDraft[], type: string): SourceDraft {
  return sources.find((item) => item.source_type === type) ?? { source_type: type, enabled: false, config: {} };
}

function putSource(sources: SourceDraft[], type: string, next: Partial<SourceDraft>): SourceDraft[] {
  const prev = source(sources, type);
  return [...sources.filter((item) => item.source_type !== type), { ...prev, ...next, source_type: type }];
}

export function IntentStep({ sources, onSources }: { sources: SourceDraft[]; onSources: (v: SourceDraft[]) => void }) {
  return (
    <div>
      <Title title="Here are the first signals we think you should track, sound good?" text="These are the strong intent triggers for your customer profile. More categories next." />
      <div className="space-y-2">
        {INTENT.map((item) => {
          const on = source(sources, item.type).enabled;
          return <CheckRow key={item.type} checked={on} label={item.label} hint={item.hint} onChange={(enabled) => onSources(putSource(sources, item.type, { enabled }))} />;
        })}
      </div>
      <p className="mt-3 text-center text-xs text-base-content/40">You can update this later.</p>
    </div>
  );
}

export function KeywordsStep({ icp, sources, onSources }: { icp: Icp; sources: SourceDraft[]; onSources: (v: SourceDraft[]) => void }) {
  const keywords = source(sources, "keyword_engagement").config.keywords ?? [];
  const suggested = filled(icp.keywords).filter((word) => !keywords.includes(word));
  const setKeywords = (next: string[]) => onSources(putSource(sources, "keyword_engagement", { enabled: next.length > 0, config: { keywords: next } }));
  return (
    <div>
      <Title title="Now, which keywords should we track?" text="We'll detect people engaging with topics related to your solution" />
      <div className="rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-4">
        <p className="text-sm font-medium">Keyword engagement</p>
        {keywords.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {keywords.map((word) => (
              <span key={word} className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary">
                {word}
                <button type="button" aria-label={`Remove ${word}`} onClick={() => setKeywords(keywords.filter((item) => item !== word))}><RiCloseLine size={12} /></button>
              </span>
            ))}
          </div>
        )}
        {suggested.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-primary">AI-suggested keywords — click to add</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggested.slice(0, 12).map((word) => (
                <button key={word} type="button" className="rounded-full border border-[var(--border-subtle)] px-2.5 py-1 text-xs text-base-content/70 hover:border-primary hover:text-primary" onClick={() => setKeywords([...keywords, word])}>+ {word}</button>
              ))}
            </div>
          </div>
        )}
        <div className="mt-3">
          <ChipAdd values={[]} onChange={([word]) => { if (word && !keywords.includes(word)) setKeywords([...keywords, word]); }} placeholder="Add a custom keyword" />
        </div>
      </div>
    </div>
  );
}

export function CompetitorsStep({ icp, sources, onIcp, onSources }: { icp: Icp; sources: SourceDraft[]; onIcp: (icp: Icp) => void; onSources: (v: SourceDraft[]) => void }) {
  const competitors = icp.competitors.filter((c) => c.name || c.linkedin_url);
  const sync = (next: Icp["competitors"]) => {
    onIcp({ ...icp, competitors: next });
    const urls = next.map((item) => item.linkedin_url).filter((url): url is string => !!url);
    onSources(putSource(sources, "competitor_engagement", { enabled: urls.length > 0, config: { urls } }));
  };
  return (
    <div>
      <Title title="Track competitors engagement" text="We'll detect people following or interacting with your competitors on LinkedIn" />
      <div className="rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-4">
        <p className="text-sm font-medium">Competitor profiles</p>
        <p className="mt-1 text-xs leading-5 text-base-content/50">Add companies whose audience matters. A LinkedIn company page is what this signal follows. A name is kept on the profile either way.</p>
        {competitors.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {competitors.map((c) => (
              <span key={(c.linkedin_url ?? "") + c.name} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary">
                <span className="truncate">{c.name || c.linkedin_url}</span>
                <button type="button" aria-label="Remove" onClick={() => sync(icp.competitors.filter((item) => item !== c))}><RiCloseLine size={12} /></button>
              </span>
            ))}
          </div>
        )}
        <div className="relative mt-3">
          <RiSearchLine size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base-content/35" />
          <AddCompetitor onAdd={(raw) => {
            const value = raw.trim();
            if (!value) return;
            const isUrl = /linkedin\.com\/company\//i.test(value);
            const linkedin_url = isUrl ? (value.startsWith("http") ? value : `https://${value}`) : null;
            const name = isUrl ? value.replace(/https?:\/\/(www\.)?linkedin\.com\/company\//i, "").replace(/[/?#].*$/, "") || "Competitor" : value;
            sync([...icp.competitors, { name, linkedin_url, website: null }]);
          }} />
        </div>
      </div>
    </div>
  );
}

function AddCompetitor({ onAdd }: { onAdd: (value: string) => void }) {
  const [text, setText] = useState("");
  return (
    <input className={`${inputCls} pl-9`} placeholder="Company name or LinkedIn company page" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAdd(text); setText(""); } }} />
  );
}

const join = (values: string[], all: string) => values.length ? values.join(", ") : all;

export function ReviewStep({ icp, onIcp, sources, industries, locations }: {
  icp: Icp; onIcp: (icp: Icp) => void; sources: SourceDraft[]; industries: string[]; locations: string[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const keywords = source(sources, "keyword_engagement").config.keywords ?? [];
  const avoided = [...icp.exclusions.filter((item) => !PEOPLE_EXCLUDES.includes(item)), ...icp.competitors.map((c) => c.name).filter(Boolean)];
  const rows = [
    { id: "roles", icon: <RiGroupLine size={15} />, label: "Job roles", value: join(buyerTitles(icp), "Add a role") },
    { id: "industries", icon: <RiBuilding2Line size={15} />, label: "Industries", value: join(icp.industries, "All industries") },
    { id: "types", icon: <RiBriefcaseLine size={15} />, label: "Company type", value: join(icp.company_types, "All company types") },
    { id: "sizes", icon: <RiBuilding2Line size={15} />, label: "Company size", value: join(icp.company_sizes, "All company sizes") },
    { id: "locations", icon: <RiGlobalLine size={15} />, label: "Locations", value: join(icp.geographies, "All locations") },
    { id: "excluded", icon: <RiShieldLine size={15} />, label: "Excluded", value: join(icp.exclusions.filter((item) => PEOPLE_EXCLUDES.includes(item)), "None") },
    { id: "avoid", icon: <RiPriceTag3Line size={15} />, label: "Competitors / keywords", value: join([...new Set([...avoided, ...keywords])], "None") },
  ];
  return (
    <div>
      <Title title="Check your ICP before previewing your leads" text="Review your ICP to make sure your agent surfaces the right people" />
      <p className="mb-3 rounded-[10px] bg-base-100 px-3 py-2 text-xs text-base-content/60">Your agent will use this profile to detect and surface high-intent leads. Open a row to fine-tune it.</p>
      <div className="overflow-hidden rounded-[12px] border border-[var(--border-subtle)] bg-base-100">
        {rows.map((row) => (
          <div key={row.id} className="border-b border-[var(--border-subtle)] last:border-b-0">
            <button type="button" className="flex w-full items-start gap-3 px-4 py-3 text-left" onClick={() => setOpen(open === row.id ? null : row.id)}>
              <span className="mt-0.5 text-base-content/40">{row.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium uppercase tracking-[0.05em] text-base-content/40">{row.label}</span>
                <span className="mt-0.5 block text-sm text-base-content">{row.value}</span>
              </span>
              <RiArrowDownSLine size={16} className={`mt-1 text-base-content/35 transition ${open === row.id ? "rotate-180" : ""}`} />
            </button>
            {open === row.id && <div className="px-4 pb-4"><ReviewEditor id={row.id} icp={icp} onIcp={onIcp} industries={industries} locations={locations} /></div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewEditor({ id, icp, onIcp, industries, locations }: { id: string; icp: Icp; onIcp: (icp: Icp) => void; industries: string[]; locations: string[] }) {
  const set = <K extends keyof Icp>(key: K, value: Icp[K]) => onIcp({ ...icp, [key]: value });
  if (id === "roles") return <RoleChips values={buyerTitles(icp)} onChange={(titles) => onIcp(withTitles(icp, titles))} />;
  if (id === "industries") return <ChipSelect allLabel="All industries" options={industries} selected={icp.industries} onChange={(next) => set("industries", next)} allowAdd />;
  if (id === "types") return <ChipSelect allLabel="All company types" options={[...COMPANY_TYPES, ...icp.company_types]} selected={icp.company_types} onChange={(company_types) => set("company_types", company_types)} />;
  if (id === "sizes") return <ChipSelect allLabel="All company sizes" options={[...COMPANY_SIZES, ...icp.company_sizes]} selected={icp.company_sizes} onChange={(company_sizes) => set("company_sizes", company_sizes)} />;
  if (id === "locations") return <ChipSelect allLabel="All locations" options={locations} selected={icp.geographies} onChange={(geographies) => set("geographies", geographies)} allowAdd />;
  if (id === "excluded") {
    return (
      <div className="space-y-2">
        {PEOPLE_EXCLUDES.map((label) => (
          <label key={label} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="checkbox checkbox-sm checkbox-primary" checked={icp.exclusions.includes(label)} onChange={(e) => set("exclusions", e.target.checked ? [...icp.exclusions, label] : icp.exclusions.filter((item) => item !== label))} />
            {label}
          </label>
        ))}
      </div>
    );
  }
  const custom = icp.exclusions.filter((item) => !PEOPLE_EXCLUDES.includes(item));
  return (
    <div className="space-y-3">
      <div>
        <SectionLabel>Companies and keywords to avoid</SectionLabel>
        <ChipAdd values={custom} onChange={(extra) => set("exclusions", [...icp.exclusions.filter((item) => PEOPLE_EXCLUDES.includes(item)), ...extra])} placeholder="Add a company or keyword" />
      </div>
    </div>
  );
}
