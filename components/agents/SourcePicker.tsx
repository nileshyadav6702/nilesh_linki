import { useState, type ReactNode } from "react";
import { RiAddLine, RiArrowDownSLine, RiArrowUpSLine, RiBriefcaseLine, RiCloseLine, RiEyeLine, RiMagicLine, RiMegaphoneLine, RiPriceTag3Line, RiLineChartLine } from "react-icons/ri";
import { inputCls, ghostBtn } from "@/components/agents/ui";

export interface SourceDraft {
  source_type: string;
  enabled: boolean;
  config: { urls?: string[]; keywords?: string[]; boards?: Array<{ ats: "greenhouse" | "lever" | "ashby"; slug: string; company?: string }>; role_keywords?: string[]; feeds?: string[]; list_ids?: string[] };
}

/** Chips with an input: type and press Enter (or Add). */
export function ChipInput({ values, onChange, placeholder, validate }: { values: string[]; onChange: (v: string[]) => void; placeholder: string; validate?: (v: string) => string | null }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const v = text.trim();
    if (!v) return;
    const problem = validate?.(v) ?? null;
    if (problem) { setError(problem); return; }
    if (!values.includes(v)) onChange([...values, v]);
    setText(""); setError(null);
  };
  return (
    <div className="space-y-2">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span key={v} className="inline-flex max-w-full items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-base-100 px-2 py-1 text-xs">
              <span className="truncate">{v}</span>
              <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`} className="text-base-content/40 hover:text-error"><RiCloseLine size={12} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input className={inputCls} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" className={ghostBtn + " h-10 border border-[var(--border-subtle)] px-3"} onClick={add}><RiAddLine size={14} /> Add</button>
      </div>
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}

const linkedinUrl = (kind: "company" | "profile" | "any") => (v: string) => {
  const ok = kind === "company" ? /linkedin\.com\/(company|showcase)\//i : kind === "profile" ? /linkedin\.com\/in\//i : /linkedin\.com\/(company|showcase|in)\//i;
  return ok.test(v) ? null : `Paste a LinkedIn ${kind === "company" ? "company page" : kind === "profile" ? "profile" : "profile or company page"} URL`;
};

function Group({ icon, title, subtitle, active, children, defaultOpen }: { icon: ReactNode; title: string; subtitle: string; active: number; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen || active > 0);
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-base-100">
      <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-base-200 text-base-content/70">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-semibold">{title}{active > 0 && <span className="rounded-md bg-warning/10 px-1.5 text-[11px] font-medium text-warning">{active} active</span>}</span>
          <span className="block text-xs text-base-content/50">{subtitle}</span>
        </span>
        {open ? <RiArrowUpSLine size={18} /> : <RiArrowDownSLine size={18} />}
      </button>
      {open && <div className="space-y-3 border-t border-[var(--border-subtle)] px-4 py-3">{children}</div>}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input type="checkbox" className="toggle toggle-sm mt-0.5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span><span className="block text-sm font-medium">{label}</span>{hint && <span className="block text-xs text-base-content/50">{hint}</span>}</span>
    </label>
  );
}

/** How many individual signals a source set tracks (each keyword, URL, board, or toggle counts once). */
export function countSignals(sources: SourceDraft[]): number {
  return sources.filter((s) => s.enabled).reduce((n, s) => {
    const c = s.config;
    if (s.source_type === "keyword_engagement") return n + (c.keywords?.length ?? 0);
    if (["competitor_engagement", "influencer_engagement", "own_content_engagement"].includes(s.source_type)) return n + (c.urls?.length ?? 0);
    if (s.source_type === "hiring") return n + Math.max(1, c.boards?.length ?? 0);
    if (["job_change", "funding", "lookalike"].includes(s.source_type)) return n + 1;
    return n;
  }, 0);
}

/**
 * The signals an agent tracks, grouped the way buyers show intent. Controlled: `value` holds
 * one entry per source type; empty groups are stored disabled.
 */
export default function SourcePicker({ value, onChange, hasLinkedIn, suggestions }: {
  value: SourceDraft[]; onChange: (v: SourceDraft[]) => void; hasLinkedIn: boolean;
  suggestions?: { keywords?: string[]; competitorUrls?: string[] };
}) {
  const get = (type: string): SourceDraft => value.find((s) => s.source_type === type) ?? { source_type: type, enabled: false, config: {} };
  const put = (type: string, config: SourceDraft["config"], enabled?: boolean) => {
    const prev = get(type);
    const items = (config.keywords?.length ?? 0) + (config.urls?.length ?? 0) + (config.boards?.length ?? 0);
    const next = { source_type: type, config, enabled: enabled ?? items > 0 };
    onChange([...value.filter((s) => s.source_type !== type), { ...prev, ...next }]);
  };
  const urls = (type: string) => get(type).config.urls ?? [];
  const li = !hasLinkedIn;
  const kw = get("keyword_engagement").config.keywords ?? [];

  return (
    <div className="space-y-3">
      {li && <p className="rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">Connect a LinkedIn account in Settings to track LinkedIn signals. Job boards and news work without one.</p>}

      <Group icon={<RiPriceTag3Line size={18} />} title="Keyword engagement" subtitle="People engaging with topics related to your solution" active={kw.length} defaultOpen>
        {suggestions?.keywords?.length ? (
          <button type="button" className={ghostBtn + " border border-warning/40 text-warning"} onClick={() => put("keyword_engagement", { keywords: [...new Set([...kw, ...suggestions.keywords!])].slice(0, 15) })}>
            <RiMagicLine size={13} /> Generate with AI
          </button>
        ) : null}
        <ChipInput values={kw} onChange={(v) => put("keyword_engagement", { keywords: v.slice(0, 15) })} placeholder="Add a keyword…" />
      </Group>

      <Group icon={<RiMegaphoneLine size={18} />} title="People engaging with your market" subtitle="Reach people active around experts and creators in your space" active={urls("influencer_engagement").length}>
        <ChipInput values={urls("influencer_engagement")} onChange={(v) => put("influencer_engagement", { urls: v })} placeholder="https://www.linkedin.com/in/creator" validate={linkedinUrl("any")} />
      </Group>

      <Group icon={<RiBriefcaseLine size={18} />} title="Companies & competitors engagement" subtitle="Find people interacting with your competitors" active={urls("competitor_engagement").length}>
        {suggestions?.competitorUrls?.length ? (
          <button type="button" className={ghostBtn} onClick={() => put("competitor_engagement", { urls: [...new Set([...urls("competitor_engagement"), ...suggestions.competitorUrls!])] })}><RiMagicLine size={13} /> Add competitors from your ICP</button>
        ) : null}
        <ChipInput values={urls("competitor_engagement")} onChange={(v) => put("competitor_engagement", { urls: v })} placeholder="https://www.linkedin.com/company/competitor" validate={linkedinUrl("any")} />
        <p className="text-xs text-base-content/45">Competitors&apos; own employees are filtered out automatically.</p>
      </Group>

      <Group icon={<RiEyeLine size={18} />} title="People aware of your brand" subtitle="Re-engage people who engage with you and your company" active={urls("own_content_engagement").length}>
        <ChipInput values={urls("own_content_engagement")} onChange={(v) => put("own_content_engagement", { urls: v })} placeholder="Your LinkedIn profile or company page" validate={linkedinUrl("any")} />
      </Group>

      <Group icon={<RiLineChartLine size={18} />} title="Buying events" subtitle="Catch leads at the right moment" active={["job_change", "hiring", "funding"].filter((t) => get(t).enabled).length}>
        <Toggle label="Recent job changes" hint="Contacts in this agent who start a new role" checked={get("job_change").enabled} disabled={li} onChange={(v) => put("job_change", {}, v)} />
        <Toggle label="Recently raised funds" hint="ICP companies announcing a round in the news" checked={get("funding").enabled} onChange={(v) => put("funding", get("funding").config, v)} />
        <Toggle label="Hiring for relevant roles" hint="Companies opening roles on Greenhouse, Lever or Ashby" checked={get("hiring").enabled} onChange={(v) => put("hiring", get("hiring").config, v)} />
        {get("hiring").enabled && (
          <div className="space-y-2 pl-12">
            <ChipInput values={(get("hiring").config.boards ?? []).map((b) => `${b.ats}:${b.slug}`)} placeholder="greenhouse:acme, lever:globex, ashby:initech"
              validate={(v) => /^(greenhouse|lever|ashby):[\w.-]+$/i.test(v) ? null : "Use ats:slug, e.g. greenhouse:acme"}
              onChange={(v) => put("hiring", { ...get("hiring").config, boards: v.map((x) => { const [ats, slug] = x.split(":"); return { ats: ats.toLowerCase() as "greenhouse", slug }; }) }, true)} />
            <ChipInput values={get("hiring").config.role_keywords ?? []} placeholder="Role keywords, e.g. SDR, account executive" onChange={(v) => put("hiring", { ...get("hiring").config, role_keywords: v }, true)} />
          </div>
        )}
      </Group>

      <div className="rounded-2xl border border-[var(--border-subtle)] bg-base-100 px-4 py-3">
        <Toggle label="Smart lead finder" hint="Automatically find more warm leads that match your ICP when signals are low (Sales Navigator)" checked={get("lookalike").enabled} disabled={li} onChange={(v) => put("lookalike", {}, v)} />
      </div>
    </div>
  );
}
