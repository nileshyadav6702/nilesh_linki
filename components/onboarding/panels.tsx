import type { Icp } from "@/lib/icp/schema";
import type { SourceDraft } from "@/components/agents/SourcePicker";
import { Field, inputCls, textareaCls } from "@/components/agents/ui";
import { CheckRow, ChipAdd, Choice, COMPANY_SIZES, COMPANY_TYPES, filled, LANGUAGES, PEOPLE_EXCLUDES, Pills, StackedList, StepHead, buyerTitles, withTitles } from "@/components/onboarding/fields";

export function CompanyPanel({ website, onWebsite, analyzed, icp, onIcp, onAnalyzeKey }: {
  website: string; onWebsite: (v: string) => void; analyzed: boolean; icp: Icp; onIcp: (icp: Icp) => void;
  onAnalyzeKey: () => void;
}) {
  const set = <K extends keyof Icp>(key: K, value: Icp[K]) => onIcp({ ...icp, [key]: value });
  return (
    <div>
      <StepHead title="Your website" text="We read the site and fill in the company. Edit anything before you continue." />
      <Field label="Company website">
        <input className={inputCls} placeholder="https://yourcompany.com" value={website} onChange={(e) => onWebsite(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAnalyzeKey(); } }} autoFocus />
      </Field>
      {analyzed && (
        <div className="mt-6 space-y-5">
          <Field label="Company name" required>
            <input className={inputCls} value={icp.company_name} onChange={(e) => set("company_name", e.target.value)} />
          </Field>
          <Field label="Industry" required>
            <input className={inputCls} value={icp.company_industry} onChange={(e) => set("company_industry", e.target.value)} />
          </Field>
          <Field label="Company description and value proposition" required>
            <textarea className={textareaCls} rows={4} value={icp.offer} onChange={(e) => set("offer", e.target.value)} />
          </Field>
          <Field label="Key features" required hint="One feature per box. Add as many as you need.">
            <StackedList values={icp.value_props} onChange={(value_props) => set("value_props", value_props)} placeholder="A feature customers get" />
          </Field>
          <Field label="Social proof" required hint="Customers, numbers, or awards. Add or remove rows.">
            <StackedList values={icp.social_proof} onChange={(social_proof) => set("social_proof", social_proof)} placeholder="Trusted by 200 teams" />
          </Field>
          <Field label="Preferred language" required>
            <select className={inputCls} value={icp.language || "English"} onChange={(e) => set("language", e.target.value)}>
              {(LANGUAGES.includes(icp.language) || !icp.language.trim() ? LANGUAGES : [icp.language, ...LANGUAGES]).map((language) => <option key={language}>{language}</option>)}
            </select>
          </Field>
        </div>
      )}
    </div>
  );
}

export function channelChosen(channel: string): "linkedin" | "multi" {
  return channel === "multi" ? "multi" : "linkedin";
}

export function GoalsPanel({ icp, onIcp, goal, tone, onGoal, onTone }: {
  icp: Icp; onIcp: (icp: Icp) => void; goal: string; tone: string; onGoal: (v: "conversations" | "meetings") => void; onTone: (v: "professional" | "conversational" | "direct") => void;
}) {
  return (
    <div className="space-y-6">
      <StepHead title="What should this agent do?" text="Pain points come from the website. Pick the outcome and the way it should sound." />
      <Field label="Customer pain points" required hint="Generated from the site. Edit or add another.">
        <StackedList values={icp.pain_points} onChange={(pain_points) => onIcp({ ...icp, pain_points })} placeholder="A problem your buyers have" />
      </Field>
      <div>
        <p className="mb-2 text-[13px] font-medium text-base-content/70">Campaign goal</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Choice selected={goal === "conversations"} title="Start conversations with warm prospects" text="Open a relevant conversation and let it develop." onClick={() => onGoal("conversations")} />
          <Choice selected={goal === "meetings"} title="Book qualified sales calls or demos" text="Ask for a meeting once the person is a fit." onClick={() => onGoal("meetings")} />
        </div>
      </div>
      <div>
        <p className="mb-2 text-[13px] font-medium text-base-content/70">Messaging tone</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Choice selected={tone === "professional"} title="Professional" text="Formal and polished." onClick={() => onTone("professional")} />
          <Choice selected={tone === "conversational"} title="Conversational" text="Friendly and plain." onClick={() => onTone("conversational")} />
          <Choice selected={tone === "direct"} title="Direct" text="Short and confident." onClick={() => onTone("direct")} />
        </div>
      </div>
    </div>
  );
}

export function RolesPanel({ icp, onIcp }: { icp: Icp; onIcp: (icp: Icp) => void }) {
  return (
    <div>
      <StepHead kicker="Ideal customer · 1 of 3" title="Who is your ideal customer?" text="These roles were drafted from your site. Add the ones we missed." />
      <Field label="Roles" required>
        <ChipAdd values={buyerTitles(icp)} onChange={(titles) => onIcp(withTitles(icp, titles))} placeholder="Add a job title, then Enter" />
      </Field>
    </div>
  );
}

export function CompaniesPanel({ icp, onIcp }: { icp: Icp; onIcp: (icp: Icp) => void }) {
  const set = <K extends keyof Icp>(key: K, value: Icp[K]) => onIcp({ ...icp, [key]: value });
  return (
    <div className="space-y-6">
      <StepHead kicker="Ideal customer · 2 of 3" title="What companies are you targeting?" text="Industries were selected from the site. Adjust size, type, and location." />
      <Field label="Industry" required>
        <ChipAdd values={icp.industries} onChange={(industries) => set("industries", industries)} placeholder="Add an industry" />
      </Field>
      <Field label="Location" required>
        <ChipAdd values={icp.geographies} onChange={(geographies) => set("geographies", geographies)} placeholder="Add a location" />
      </Field>
      <Field label="Company type" required><Pills options={[...new Set([...COMPANY_TYPES, ...icp.company_types])]} selected={icp.company_types} onChange={(company_types) => set("company_types", company_types)} /></Field>
      <Field label="Company size" required><Pills options={[...new Set([...COMPANY_SIZES, ...icp.company_sizes])]} selected={icp.company_sizes} onChange={(company_sizes) => set("company_sizes", company_sizes)} /></Field>
    </div>
  );
}

export function ExcludePanel({ icp, onIcp }: { icp: Icp; onIcp: (icp: Icp) => void }) {
  const custom = icp.exclusions.filter((item) => !PEOPLE_EXCLUDES.includes(item));
  const toggle = (label: string, on: boolean) => {
    const rest = icp.exclusions.filter((item) => item !== label);
    onIcp({ ...icp, exclusions: on ? [...rest, label] : rest });
  };
  return (
    <div className="space-y-6">
      <StepHead kicker="Ideal customer · 3 of 3" title="Who should be excluded?" text="Checked groups are skipped. Add companies or keywords that should never be contacted." />
      <div>
        <p className="mb-2 text-[13px] font-medium text-base-content/70">Exclude these people</p>
        <div className="space-y-2">
          {PEOPLE_EXCLUDES.map((label) => <CheckRow key={label} label={label} checked={icp.exclusions.includes(label)} onChange={(on) => toggle(label, on)} />)}
        </div>
      </div>
      <Field label="Companies and keywords to avoid">
        <ChipAdd values={custom} onChange={(extra) => onIcp({ ...icp, exclusions: [...icp.exclusions.filter((item) => PEOPLE_EXCLUDES.includes(item)), ...extra] })} placeholder="Add a company or keyword" />
      </Field>
    </div>
  );
}

const INTENT = [
  { type: "lookalike", label: "Top active profiles in your ICP", hint: "People who match the roles and companies above." },
  { type: "job_change", label: "Recent job changes", hint: "People who started a relevant role recently." },
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

export function SignalsPanel({ icp, sources, onSources, onIcp }: { icp: Icp; sources: SourceDraft[]; onSources: (v: SourceDraft[]) => void; onIcp: (icp: Icp) => void }) {
  const put = (type: string, next: Partial<SourceDraft>) => {
    const prev = source(sources, type);
    onSources([...sources.filter((item) => item.source_type !== type), { ...prev, ...next, source_type: type }]);
  };
  const keywords = source(sources, "keyword_engagement").config.keywords ?? [];
  const suggested = filled(icp.keywords).filter((word) => !keywords.includes(word));
  const competitors = icp.competitors.filter((c) => c.name || c.linkedin_url);
  return (
    <div className="space-y-6">
      <StepHead title="Which signals should we track?" text="These are the intent triggers for your customer profile. You can change them later." />
      <div className="space-y-2">
        {INTENT.map((item) => {
          const on = source(sources, item.type).enabled;
          return <CheckRow key={item.type} checked={on} label={item.label} hint={item.hint} onChange={(enabled) => put(item.type, { enabled, config: source(sources, item.type).config })} />;
        })}
      </div>
      <div className="rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-4">
        <p className="text-sm font-medium">Keyword engagement</p>
        <p className="mt-1 text-xs text-base-content/50">People talking about topics related to your product.</p>
        <div className="mt-3">
          <ChipAdd values={keywords} onChange={(next) => put("keyword_engagement", { enabled: next.length > 0, config: { keywords: next } })} placeholder="Add a keyword" />
        </div>
        {suggested.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {suggested.slice(0, 8).map((word) => (
              <button key={word} type="button" className="rounded-full border border-dashed border-[var(--border-subtle)] px-2.5 py-1 text-xs text-base-content/60 hover:border-primary hover:text-base-content" onClick={() => put("keyword_engagement", { enabled: true, config: { keywords: [...keywords, word] } })}>+ {word}</button>
            ))}
          </div>
        )}
      </div>
      <div className="rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-4">
        <p className="text-sm font-medium">Competitor profiles</p>
        <p className="mt-1 text-xs text-base-content/50">People following or interacting with these companies on LinkedIn.</p>
        <ul className="mt-3 space-y-2">
          {competitors.map((c) => (
            <li key={c.name + (c.linkedin_url ?? "")} className="flex items-center justify-between gap-3 rounded-[8px] border border-[var(--border-subtle)] px-3 py-2 text-sm">
              <span className="min-w-0"><span className="block truncate font-medium">{c.name || "Competitor"}</span>{c.linkedin_url && <span className="block truncate text-xs text-base-content/45">{c.linkedin_url}</span>}</span>
              <button type="button" className="text-xs text-base-content/45 hover:text-error" onClick={() => {
                const next = icp.competitors.filter((item) => item !== c);
                onIcp({ ...icp, competitors: next });
                put("competitor_engagement", { enabled: next.some((item) => item.linkedin_url), config: { urls: next.map((item) => item.linkedin_url).filter((url): url is string => !!url) } });
              }}>Remove</button>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <ChipAdd values={[]} onChange={([url]) => {
            if (!url) return;
            const next = [...icp.competitors, { name: url.replace(/https?:\/\/(www\.)?linkedin\.com\/company\//i, "").replace(/\/$/, "") || "Competitor", linkedin_url: url, website: null }];
            onIcp({ ...icp, competitors: next });
            put("competitor_engagement", { enabled: true, config: { urls: next.map((item) => item.linkedin_url).filter((item): item is string => !!item) } });
          }} placeholder="https://www.linkedin.com/company/…" />
        </div>
      </div>
    </div>
  );
}

export interface SampleLead {
  id: string; full_name: string | null; title: string | null; company: string | null; location: string | null; headline: string | null;
  lead_score?: number | null; signal_title?: string | null; industry?: string | null;
}

export function LeadsPanel({ searching, leads, note, onReject }: { searching: boolean; leads: SampleLead[]; note: string; onReject: (id: string) => void }) {
  return (
    <div>
      <StepHead title={searching ? "Searching for leads matching your ICP…" : "Here are the first opportunities we identified"} text={searching ? "Matching profiles, signals, and company data." : "Your agent will use this profile to find more after launch."} />
      {searching && (
        <ul className="mx-auto max-w-sm space-y-2 text-sm text-base-content/55">
          <li>Matching profiles against the roles and companies you chose</li>
          <li>Filtering by industry, size, and location</li>
          <li>Scoring the people the signals return</li>
        </ul>
      )}
      {!searching && note && <p className="mb-4 rounded-[12px] border border-[var(--border-subtle)] bg-base-100 px-4 py-3 text-sm text-base-content/70">{note}</p>}
      {!searching && leads.length === 0 && !note && <p className="text-center text-sm text-base-content/55">No sample leads yet. Launch anyway and the agent will keep looking.</p>}
      <ul className="mt-4 space-y-2">
        {leads.map((lead) => (
          <li key={lead.id} className="flex items-start justify-between gap-3 rounded-[12px] border border-[var(--border-subtle)] bg-base-100 px-4 py-3">
            <div className="flex min-w-0 gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral text-xs font-medium text-neutral-content">{(lead.full_name || "?").slice(0, 1)}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{lead.full_name || "Unknown"}</p>
                <p className="truncate text-xs text-base-content/55">{[lead.title || lead.headline, lead.company].filter(Boolean).join(" · ") || "No title yet"}</p>
                <p className="truncate text-xs text-base-content/40">{[lead.location, lead.industry, lead.signal_title].filter(Boolean).join(" · ")}</p>
              </div>
            </div>
            <button type="button" className="shrink-0 text-xs font-medium text-base-content/45 hover:text-error" onClick={() => onReject(lead.id)}>Reject</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
