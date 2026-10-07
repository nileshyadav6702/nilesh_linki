import { inputCls, textareaCls, toList, fromList } from "@/components/agents/ui";

export interface SourceDraft {
  source_type: string;
  enabled: boolean;
  config: { urls?: string[]; keywords?: string[]; boards?: Array<{ ats: "greenhouse" | "lever" | "ashby"; slug: string; company?: string }>; role_keywords?: string[]; feeds?: string[] };
}

export const SOURCE_META: Array<{ type: string; title: string; why: string; needsLinkedIn: boolean; input: "urls" | "keywords" | "boards" | "feeds" | "none"; placeholder?: string }> = [
  { type: "competitor_engagement", title: "Competitor engagement", why: "People reacting to or commenting on your competitors' posts", needsLinkedIn: true, input: "urls", placeholder: "https://www.linkedin.com/company/competitor" },
  { type: "influencer_engagement", title: "Influencer engagement", why: "People engaging with creators your buyers follow", needsLinkedIn: true, input: "urls", placeholder: "https://www.linkedin.com/in/creator" },
  { type: "own_content_engagement", title: "Engaged with you", why: "People engaging with your own or your company's posts", needsLinkedIn: true, input: "urls", placeholder: "https://www.linkedin.com/in/you" },
  { type: "keyword_engagement", title: "Active in your space", why: "People engaging with recent posts on your topics", needsLinkedIn: true, input: "keywords", placeholder: "outbound automation, sales hiring" },
  { type: "job_change", title: "Job changes", why: "Contacts in this agent's list who start a new role", needsLinkedIn: true, input: "none" },
  { type: "hiring", title: "Hiring", why: "Companies opening roles that signal a need for you", needsLinkedIn: false, input: "boards" },
  { type: "funding", title: "Recently funded", why: "ICP companies announcing a funding round", needsLinkedIn: false, input: "feeds", placeholder: "https://techcrunch.com/category/venture/feed/" },
  { type: "lookalike", title: "Lookalikes", why: "People matching your ICP from Sales Navigator, to fill capacity", needsLinkedIn: true, input: "none" },
];

function parseBoards(text: string): SourceDraft["config"]["boards"] {
  return toList(text).map((line) => {
    const [ats, slug] = line.split(":").map((s) => s.trim());
    return ["greenhouse", "lever", "ashby"].includes(ats) && slug ? { ats: ats as "greenhouse" | "lever" | "ashby", slug } : null;
  }).filter((x): x is { ats: "greenhouse" | "lever" | "ashby"; slug: string } => !!x);
}

/** Pick signal sources and their settings. Controlled: `value` holds one entry per source type. */
export default function SourcePicker({ value, onChange, hasLinkedIn }: { value: SourceDraft[]; onChange: (v: SourceDraft[]) => void; hasLinkedIn: boolean }) {
  const get = (type: string) => value.find((s) => s.source_type === type) ?? { source_type: type, enabled: false, config: {} };
  const put = (next: SourceDraft) => onChange([...value.filter((s) => s.source_type !== next.source_type), next]);

  return (
    <div className="grid gap-3">
      {SOURCE_META.map((m) => {
        const s = get(m.type);
        const blocked = m.needsLinkedIn && !hasLinkedIn;
        return (
          <div key={m.type} className={`rounded-xl border p-4 transition-colors ${s.enabled ? "border-[var(--border-strong)] bg-base-100" : "border-[var(--border-subtle)] bg-base-200/40"}`}>
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" className="checkbox checkbox-sm mt-0.5" checked={s.enabled} disabled={blocked} onChange={(e) => put({ ...s, enabled: e.target.checked })} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{m.title}</span>
                <span className="block text-xs text-base-content/50">{m.why}{blocked ? " — connect a LinkedIn account first" : ""}</span>
              </span>
            </label>
            {s.enabled && m.input !== "none" && (
              <div className="mt-3 pl-7">
                {m.input === "urls" && <textarea rows={2} className={textareaCls} placeholder={m.placeholder} defaultValue={fromList(s.config.urls)} onBlur={(e) => put({ ...s, config: { ...s.config, urls: toList(e.target.value) } })} />}
                {m.input === "keywords" && <input className={inputCls} placeholder={m.placeholder} defaultValue={fromList(s.config.keywords)} onBlur={(e) => put({ ...s, config: { ...s.config, keywords: toList(e.target.value) } })} />}
                {m.input === "feeds" && <textarea rows={2} className={textareaCls} placeholder={m.placeholder} defaultValue={fromList(s.config.feeds)} onBlur={(e) => put({ ...s, config: { ...s.config, feeds: toList(e.target.value) } })} />}
                {m.input === "boards" && (
                  <div className="space-y-2">
                    <textarea rows={2} className={textareaCls} placeholder="greenhouse:acme, lever:globex, ashby:initech" defaultValue={(s.config.boards ?? []).map((b) => `${b.ats}:${b.slug}`).join(", ")} onBlur={(e) => put({ ...s, config: { ...s.config, boards: parseBoards(e.target.value) } })} />
                    <input className={inputCls} placeholder="Role keywords, e.g. SDR, account executive" defaultValue={fromList(s.config.role_keywords)} onBlur={(e) => put({ ...s, config: { ...s.config, role_keywords: toList(e.target.value) } })} />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
