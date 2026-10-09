import { useEffect, useState } from "react";
import { RiFocus3Line, RiFolderOpenLine, RiGroupLine, RiLinkedinBoxLine, RiPencilLine, RiSparkling2Line } from "react-icons/ri";
import { countSignals } from "@/components/agents/SourcePicker";
import { Field, inputCls } from "@/components/agents/ui";
import SignalsPicker from "@/components/agents/wizard/SignalsPicker";
import { OptionCard, RecommendedBadge, StepHeading, StepSheet } from "@/components/agents/wizard/kit";
import type { WizardState } from "@/components/agents/wizard/types";
import { SIGNAL_BUDGET } from "@/lib/agents/lead-source-rules";

export const MIN_SIGNALS = 4;

const KINDS = [
  { kind: "signals", title: "High-intent signals", why: "People showing buying or social signals", icon: RiFocus3Line, recommended: true, ai: true },
  { kind: "lookalike", title: "Warm Lookalike", why: "People similar to your best customers.", icon: RiGroupLine, ai: true },
  { kind: "existing", title: "Existing leads", why: "Lists and CSV.", icon: RiFolderOpenLine },
  { kind: "linkedin_import", title: "Import from LinkedIn", why: "Import leads directly from LinkedIn or Sales Navigator", icon: RiLinkedinBoxLine },
] as const;

/** Why the Sources step can't continue yet, or null when it can. */
export function sourcesReady(s: WizardState): string | null {
  if (!s.sourceKind) return "Choose where your agent finds leads";
  const n = countSignals(s.sources);
  if (s.sourceKind === "signals" && n < MIN_SIGNALS) return `Add at least ${MIN_SIGNALS} signals to continue. Maximum ${SIGNAL_BUDGET}.`;
  if (s.sourceKind === "signals" && n > SIGNAL_BUDGET) return `Track at most ${SIGNAL_BUDGET} signals.`;
  if (s.sourceKind === "existing" && !s.listIds.length) return "Pick at least one list";
  if (s.sourceKind === "linkedin_import" && !/linkedin\.com\/sales\//.test(s.importUrl)) return "Paste a Sales Navigator list or search URL";
  if (!s.name.trim()) return "Give your agent a name";
  return null;
}

const tile = "flex h-10 w-10 items-center justify-center rounded-[10px] bg-primary/10 text-base-content";

export default function SourcesStep({ state, set, hasLinkedIn }: { state: WizardState; set: (p: Partial<WizardState>) => void; hasLinkedIn: boolean }) {
  const [lists, setLists] = useState<Array<{ id: string; name: string; target_count: number }>>([]);
  useEffect(() => { fetch("/api/lists").then((r) => r.json()).then((l) => setLists(Array.isArray(l) ? l : [])).catch(() => {}); }, []);
  const signals = countSignals(state.sources);
  const chosen = KINDS.find((x) => x.kind === state.sourceKind);

  return (
    <StepSheet>
      <div className="flex justify-center">
        <label className="inline-flex max-w-full items-center gap-2 rounded-full border border-dashed border-primary/50 bg-primary/5 px-5 py-2.5 transition focus-within:border-solid focus-within:ring-2 focus-within:ring-primary/20">
          <span className="whitespace-nowrap text-[15px] font-medium uppercase text-primary">Agent name</span>
          <input className="w-44 min-w-0 bg-transparent text-[15px] text-base-content outline-none placeholder:italic placeholder:text-primary/60" placeholder="Enter a name" value={state.name} onChange={(e) => set({ name: e.target.value })} aria-label="Agent name" />
          <RiPencilLine className="shrink-0 text-primary" size={18} />
        </label>
      </div>
      <StepHeading title="Where should your agent find leads?" subtitle="Choose one source to get started - you can always add more later." />

      {!chosen ? (
        <div className="mx-auto grid max-w-[740px] gap-5 sm:grid-cols-2">
          {KINDS.map((k) => (
            <OptionCard key={k.kind} selected={false} onClick={() => set({ sourceKind: k.kind })} iconBelow className="wizard-rise"
              icon={<span className={tile}><k.icon size={22} /></span>}
              badge={"recommended" in k && k.recommended ? <RecommendedBadge /> : undefined}
              corner={"ai" in k && k.ai ? <span className="inline-flex items-center gap-1.5 rounded-[6px] bg-primary/10 px-2.5 py-1 text-[14px] text-primary"><RiSparkling2Line size={15} /> AI agent</span> : undefined}
              title={k.title} text={k.why} />
          ))}
        </div>
      ) : (
        <div className="wizard-rise space-y-6">
          <div className="flex items-center gap-4 rounded-[12px] border border-[var(--border-subtle)] bg-base-100 px-6 py-5">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[12px] bg-primary text-primary-content"><chosen.icon size={28} /></span>
            <div className="min-w-0 flex-1"><div className="text-[17px] font-medium">{chosen.title}</div><div className="text-[17px] text-base-content/60">{chosen.why}</div></div>
            <button type="button" className="rounded-[8px] px-3 py-2 text-[15px] font-medium text-base-content hover:bg-base-200" onClick={() => set({ sourceKind: null })}>Change source</button>
          </div>

          {state.sourceKind === "signals" && (
            <div className="space-y-6 rounded-[16px] border border-primary/15 bg-primary/[0.06] px-4 py-6 sm:px-8">
              <div className="flex items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><RiSparkling2Line size={22} /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-[17px] font-medium">The signals your agent tracks</div>
                  <div className="text-[17px] text-base-content/60">Tracking {signals} signal{signals === 1 ? "" : "s"}. Add at least {MIN_SIGNALS} and up to <b className="font-semibold text-base-content">{SIGNAL_BUDGET}</b> signals.</div>
                </div>
                <span className={`shrink-0 rounded-[6px] px-3 py-1 text-[17px] tabular-nums text-white transition-colors duration-300 ${signals >= MIN_SIGNALS ? "bg-[#5cc28a]" : "bg-base-content/35"}`}>{signals}/{SIGNAL_BUDGET} signals</span>
              </div>
              <div className="flex items-baseline justify-between pt-6">
                <span className="text-[17px] font-medium">Signals to track</span>
                <span className="text-[15px] tabular-nums text-base-content/55">{signals}/{SIGNAL_BUDGET} signals</span>
              </div>
              <SignalsPicker value={state.sources} onChange={(sources) => set({ sources })} hasLinkedIn={hasLinkedIn}
                keywordSuggestions={state.icp.keywords} competitors={state.icp.competitors} />
            </div>
          )}

          {state.sourceKind === "lookalike" && (
            <div className="space-y-3 rounded-[12px] border border-[var(--border-subtle)] p-5">
              <p className="text-[15px] text-base-content/65">Your agent searches Sales Navigator for people matching your ICP and imports them at a safe pace. You&apos;ll refine the targeting in the next step.</p>
              {!hasLinkedIn && <p className="text-[14px] text-[#8a5a1f]">Needs a LinkedIn account with Sales Navigator.</p>}
            </div>
          )}

          {state.sourceKind === "existing" && (
            <div className="space-y-2 rounded-[12px] border border-[var(--border-subtle)] p-5">
              {lists.length === 0 && <p className="text-sm text-base-content/50">No lists yet. Import a CSV or Sales Navigator list from Lists first.</p>}
              {lists.map((l) => (
                <label key={l.id} className={`flex cursor-pointer items-center gap-3 rounded-[10px] border px-3 py-2.5 transition-colors ${state.listIds.includes(l.id) ? "border-primary/50 bg-primary/5" : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"}`}>
                  <input type="checkbox" className="checkbox checkbox-sm checkbox-primary" checked={state.listIds.includes(l.id)} onChange={(e) => set({ listIds: e.target.checked ? [...state.listIds, l.id] : state.listIds.filter((x) => x !== l.id) })} />
                  <RiFolderOpenLine size={16} className="text-base-content/45" />
                  <span className="flex-1 text-sm">{l.name}</span><span className="text-xs tabular-nums text-base-content/45">{l.target_count} contacts</span>
                </label>
              ))}
            </div>
          )}

          {state.sourceKind === "linkedin_import" && (
            <div className="rounded-[12px] border border-[var(--border-subtle)] p-5">
              <Field label="Sales Navigator list or search URL" hint="Imported in daily batches with human-like pacing">
                <input className={inputCls} placeholder="https://www.linkedin.com/sales/lists/people/…" value={state.importUrl} onChange={(e) => set({ importUrl: e.target.value.trim() })} />
              </Field>
            </div>
          )}
        </div>
      )}
    </StepSheet>
  );
}
