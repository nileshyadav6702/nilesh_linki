import { RiFocus3Line, RiFolderOpenLine, RiGroupLine, RiLinkedinBoxLine, RiPencilLine, RiSparkling2Line } from "react-icons/ri";
import { countSignals } from "@/components/agents/SourcePicker";
import SignalsPicker from "@/components/agents/wizard/SignalsPicker";
import LookalikePanel from "@/components/agents/wizard/LookalikePanel";
import ExistingLeadsPanel from "@/components/agents/wizard/ExistingLeadsPanel";
import LinkedInImportPanel from "@/components/agents/wizard/LinkedInImportPanel";
import { OptionCard, RecommendedBadge, StepHeading, StepSheet } from "@/components/agents/wizard/kit";
import type { LookalikeState, WizardState } from "@/components/agents/wizard/types";
import { publicIdFromUrl } from "@/lib/agents/lookalike-rules";
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
  if (s.sourceKind === "lookalike") {
    const lk = s.lookalike;
    if (lk.phase === "input" && !publicIdFromUrl(lk.url)) return "Paste the LinkedIn profile URL of your best lead";
    if (lk.phase === "analyzing" || lk.phase === "searching") return "Working on it…";
    if (lk.phase === "profile" && !lk.scope?.title.trim()) return "Add the role to look for";
    // The name is filled from the seed profile; it only has to be set before the agent is created.
    if (lk.phase !== "leads") return null;
    if (!lk.leads.length) return "No matches yet. Go back and widen the search scope";
  }
  if (s.sourceKind === "existing") {
    if (!s.existing.mode) return "Pick a list or import a CSV";
    if (s.existing.mode === "csv" && !s.existing.csvImported) return "Import your CSV to continue";
    if (!s.listIds.length) return "Pick a lead list";
  }
  if (s.sourceKind === "linkedin_import" && !s.linkedinImport) return "Import leads from LinkedIn to continue";
  if (!s.name.trim()) return "Give your agent a name";
  return null;
}

const tile = "flex h-10 w-10 items-center justify-center rounded-[10px] bg-primary/10 text-base-content";

export default function SourcesStep({ state, set, setLookalike, hasLinkedIn, ensureAgent }: {
  state: WizardState; set: (p: Partial<WizardState>) => void; setLookalike: (p: Partial<LookalikeState>) => void; hasLinkedIn: boolean;
  /** Creates the agent now (draft) when a source needs one before Next, e.g. the LinkedIn import modal. */
  ensureAgent: () => Promise<string>;
}) {
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
            {state.lookalike.phase !== "analyzing" && state.lookalike.phase !== "searching" && (
              <button type="button" className="rounded-[8px] px-3 py-2 text-[15px] font-medium text-base-content hover:bg-base-200" onClick={() => set({ sourceKind: null })}>Change source</button>
            )}
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
            hasLinkedIn ? <LookalikePanel state={state.lookalike} set={setLookalike} />
              : <p className="rounded-[12px] bg-[#e8a55a]/15 px-5 py-4 text-[15px] text-[#8a5a1f]">Warm Lookalike searches Sales Navigator, so it needs a connected LinkedIn account with Sales Navigator. Connect one in Settings first.</p>
          )}

          {state.sourceKind === "existing" && <ExistingLeadsPanel state={state} set={set} />}

          {state.sourceKind === "linkedin_import" && <LinkedInImportPanel state={state} set={set} ensureAgent={ensureAgent} />}
        </div>
      )}
    </StepSheet>
  );
}
