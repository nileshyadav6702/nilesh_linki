import { RiLinkedinFill, RiShareLine } from "react-icons/ri";
import type { Icp } from "@/lib/icp/schema";
import { Field, inputCls, textareaCls } from "@/components/agents/ui";
import { EntryList, INDUSTRIES, LANGUAGES, RadioCard, Title } from "@/components/onboarding/fields";

export function channelChosen(channel: string): "linkedin" | "multi" {
  return channel === "multi" ? "multi" : "linkedin";
}

export function CompanyStep({ website, onWebsite, analyzed, busy, icp, onIcp, onAnalyze }: {
  website: string; onWebsite: (v: string) => void; analyzed: boolean; busy: boolean; icp: Icp; onIcp: (icp: Icp) => void; onAnalyze: () => void;
}) {
  const set = <K extends keyof Icp>(key: K, value: Icp[K]) => onIcp({ ...icp, [key]: value });
  const industries = INDUSTRIES.includes(icp.company_industry) || !icp.company_industry ? INDUSTRIES : [icp.company_industry, ...INDUSTRIES];
  const languages = LANGUAGES.includes(icp.language) || !icp.language ? LANGUAGES : [icp.language, ...LANGUAGES];
  return (
    <div>
      <Title title="Create your first Outreach Agent" text="We will use your website and AI to generate it automatically" />
      <Field label="Website">
        <div className="flex overflow-hidden rounded-[8px] border border-[var(--border-subtle)] bg-base-100 focus-within:border-[var(--border-focus)] focus-within:ring-2 focus-within:ring-[var(--ring)]">
          <input className="h-10 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none" placeholder="yourcompany.com" value={website} onChange={(e) => onWebsite(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAnalyze(); } }} autoFocus />
          <button type="button" className="m-1 rounded-[6px] bg-primary px-3 text-sm font-medium text-primary-content disabled:opacity-60" disabled={busy} onClick={onAnalyze}>{busy ? "Analyzing…" : "Analyze"}</button>
        </div>
      </Field>
      {analyzed && (
        <div className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company Name" required><input className={inputCls} value={icp.company_name} onChange={(e) => set("company_name", e.target.value)} /></Field>
            <Field label="Industry" required>
              <select className={inputCls} value={icp.company_industry} onChange={(e) => set("company_industry", e.target.value)}>
                <option value="">Select an industry</option>
                {industries.map((industry) => <option key={industry}>{industry}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Company Description & Value Proposition" required>
            <textarea className={textareaCls} rows={4} value={icp.offer} onChange={(e) => set("offer", e.target.value)} />
          </Field>
          <Field label="Key features" required>
            <EntryList values={icp.value_props} onChange={(value_props) => set("value_props", value_props)} placeholder="Add key features..." />
          </Field>
          <Field label="Social Proof" required>
            <EntryList values={icp.social_proof} onChange={(social_proof) => set("social_proof", social_proof)} placeholder="Add social proof..." />
          </Field>
          <Field label="Preferred Language" required hint="This language preference will be used for AI message generation">
            <select className={`${inputCls} max-w-xs`} value={icp.language || "English (US)"} onChange={(e) => set("language", e.target.value)}>
              {languages.map((language) => <option key={language}>{language}</option>)}
            </select>
          </Field>
        </div>
      )}
    </div>
  );
}

export function ChannelStep({ channel, onChange }: { channel: string; onChange: (v: "linkedin" | "multi") => void }) {
  const linkedin = channel !== "multi";
  return (
    <div>
      <Title title="How do you want to reach prospects?" text="Choose your outreach strategy. You can change it anytime." />
      <button type="button" onClick={() => onChange("multi")} className={`w-full rounded-[12px] border bg-base-100 p-4 text-left ${!linkedin ? "border-primary" : "border-[var(--border-subtle)]"}`}>
        <span className="flex items-center gap-2 text-sm font-medium"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary"><RiShareLine size={16} /></span> Multichannel <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">Recommended</span></span>
        <span className="mt-2 block pl-10 text-xs text-base-content/55">LinkedIn now. Email joins when a mailbox is connected.</span>
      </button>
      <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-[0.08em] text-base-content/35"><span className="h-px flex-1 bg-[var(--border-subtle)]" /> or <span className="h-px flex-1 bg-[var(--border-subtle)]" /></div>
      <button type="button" onClick={() => onChange("linkedin")} className={`flex w-full items-center gap-3 rounded-[12px] border bg-base-100 p-4 text-left ${linkedin ? "border-primary" : "border-[var(--border-subtle)]"}`}>
        <span className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-[#0a66c2] text-white"><RiLinkedinFill size={16} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">LinkedIn only</span>
          <span className="mt-0.5 block text-xs text-base-content/55">Connection requests and messages from this account.</span>
        </span>
        {linkedin && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-content text-xs">✓</span>}
      </button>
    </div>
  );
}

export function GoalsStep({ icp, onIcp, goal, tone, onGoal, onTone }: {
  icp: Icp; onIcp: (icp: Icp) => void; goal: string; tone: string; onGoal: (v: "conversations" | "meetings") => void; onTone: (v: "professional" | "conversational" | "direct") => void;
}) {
  return (
    <div className="space-y-5">
      <Title title="Goals" text="We'll craft your campaign around your goals and your audience's key pain points." />
      <Field label="Customers' Pain Points" required>
        <textarea className={textareaCls} rows={3} value={icp.pain_points.join("\n")} onChange={(e) => onIcp({ ...icp, pain_points: e.target.value.split("\n") })} />
      </Field>
      <div>
        <p className="mb-2 text-[13px] font-medium text-base-content/70">Campaign Goal</p>
        <div className="space-y-2">
          <RadioCard selected={goal === "conversations"} title="Start conversations with warm prospects" text="Build relationships and nurture leads through personalized conversations" onClick={() => onGoal("conversations")} />
          <RadioCard selected={goal === "meetings"} title="Book qualified sales calls/demos" text="Direct approach to schedule meetings and product demonstrations" onClick={() => onGoal("meetings")} />
        </div>
      </div>
      <div>
        <p className="mb-2 text-[13px] font-medium text-base-content/70">Message Tone</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <RadioCard selected={tone === "professional"} title="Professional" text="Formal, polished" onClick={() => onTone("professional")} />
          <RadioCard selected={tone === "conversational"} title="Conversational" text="Friendly, casual" onClick={() => onTone("conversational")} />
          <RadioCard selected={tone === "direct"} title="Direct" text="Bold, confident" onClick={() => onTone("direct")} />
        </div>
      </div>
    </div>
  );
}
