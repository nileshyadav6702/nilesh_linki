import { useEffect, useState } from "react";
import { RiEditLine, RiFolderLine, RiFocus3Line, RiGroupLine, RiLinkedinBoxLine, RiSparkling2Line } from "react-icons/ri";
import SourcePicker, { countSignals } from "@/components/agents/SourcePicker";
import { Field, IconTile, inputCls, Panel, Pill } from "@/components/agents/ui";
import { OptionCard, RecommendedBadge, StepHeading, StepSheet } from "@/components/agents/wizard/kit";
import type { WizardState } from "@/components/agents/wizard/types";

const KINDS = [
  { kind: "signals", title: "High-intent signals", why: "People showing buying or social signals", icon: RiFocus3Line, recommended: true, ai: true },
  { kind: "lookalike", title: "Warm lookalike", why: "People similar to your best customers", icon: RiGroupLine, ai: true },
  { kind: "existing", title: "Existing leads", why: "Your lists and CSV imports", icon: RiFolderLine },
  { kind: "linkedin_import", title: "Import from LinkedIn", why: "A Sales Navigator list or search", icon: RiLinkedinBoxLine },
] as const;

export function sourcesReady(s: WizardState): string | null {
  if (!s.name.trim()) return "Give your agent a name";
  if (!s.sourceKind) return "Choose where your agent finds leads";
  if (s.sourceKind === "signals" && countSignals(s.sources) < 1) return "Add at least one signal (we recommend 4 or more)";
  if (s.sourceKind === "existing" && !s.listIds.length) return "Pick at least one list";
  if (s.sourceKind === "linkedin_import" && !/linkedin\.com\/sales\//.test(s.importUrl)) return "Paste a Sales Navigator list or search URL";
  return null;
}

export default function SourcesStep({ state, set, hasLinkedIn }: { state: WizardState; set: (p: Partial<WizardState>) => void; hasLinkedIn: boolean }) {
  const [lists, setLists] = useState<Array<{ id: string; name: string; target_count: number }>>([]);
  useEffect(() => { fetch("/api/lists").then((r) => r.json()).then((l) => setLists(Array.isArray(l) ? l : [])).catch(() => {}); }, []);
  const signals = countSignals(state.sources);
  const competitorUrls = state.icp.competitors.map((c) => c.linkedin_url).filter((u): u is string => !!u);
  const chosen = KINDS.find((x) => x.kind === state.sourceKind);

  return (
    <StepSheet>
      <div className="flex justify-center">
        <label className="inline-flex max-w-full items-center gap-2 rounded-full border border-primary/40 bg-primary/5 px-4 py-2 text-sm focus-within:ring-2 focus-within:ring-primary/20">
          <span className="text-[12px] font-semibold uppercase tracking-[1.2px] text-primary">Agent name</span>
          <input className="w-56 min-w-0 bg-transparent text-base-content outline-none placeholder:italic placeholder:text-primary/60" placeholder="Enter a name" value={state.name} onChange={(e) => set({ name: e.target.value })} aria-label="Agent name" />
          <RiEditLine className="shrink-0 text-primary" size={14} />
        </label>
      </div>
      <StepHeading title="Where should your agent find leads?" subtitle="Choose one source to get started — you can always add more later." />

      {!chosen ? (
        <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2">
          {KINDS.map((k) => (
            <OptionCard key={k.kind} selected={false} onClick={() => set({ sourceKind: k.kind })} className="!p-5"
              icon={<IconTile icon={<k.icon size={20} />} tone={"recommended" in k && k.recommended ? "coral" : "ink"} />}
              badge={"recommended" in k && k.recommended ? <RecommendedBadge /> : undefined}
              corner={"ai" in k && k.ai ? <Pill tone="coral"><RiSparkling2Line size={12} /> AI agent</Pill> : undefined}
              title={k.title} text={k.why} />
          ))}
        </div>
      ) : (
        <div className="mx-auto max-w-3xl space-y-4">
          <Panel className="flex items-center gap-4 px-5 py-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-primary text-primary-content"><chosen.icon size={22} /></span>
            <div className="min-w-0 flex-1"><div className="font-semibold">{chosen.title}</div><div className="text-sm text-base-content/55">{chosen.why}</div></div>
            <button type="button" className="text-sm font-medium text-base-content/75 hover:text-base-content hover:underline" onClick={() => set({ sourceKind: null })}>Change source</button>
          </Panel>

          {state.sourceKind === "signals" && (
            <div className="space-y-4 rounded-[16px] border border-[var(--border-subtle)] bg-base-200 p-5">
              <div className="flex items-start gap-3">
                <IconTile icon={<RiSparkling2Line size={18} />} tone="coral" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">The signals your agent tracks</div>
                  <div className="text-sm text-base-content/55">Tracking {signals} signal{signals === 1 ? "" : "s"}. We recommend at least 4, up to 15.</div>
                </div>
                <span className={`shrink-0 rounded-[8px] px-2.5 py-1 text-sm font-medium tabular-nums ${signals >= 4 ? "bg-success text-success-content" : "bg-base-100 text-base-content/70"}`}>{signals}/15 signals</span>
              </div>
              <SourcePicker value={state.sources} onChange={(sources) => set({ sources })} hasLinkedIn={hasLinkedIn} suggestions={{ keywords: state.icp.keywords, competitorUrls }} />
            </div>
          )}

          {state.sourceKind === "lookalike" && (
            <Panel className="space-y-3 p-5">
              <p className="text-sm text-base-content/65">Your agent searches Sales Navigator for people matching your ICP and imports them at a safe pace. You&apos;ll refine the targeting in the next step.</p>
              {!hasLinkedIn && <Pill tone="amber">Needs a LinkedIn account with Sales Navigator</Pill>}
            </Panel>
          )}

          {state.sourceKind === "existing" && (
            <Panel className="space-y-2 p-5">
              {lists.length === 0 && <p className="text-sm text-base-content/50">No lists yet. Import a CSV or Sales Navigator list from Lists first.</p>}
              {lists.map((l) => (
                <label key={l.id} className={`flex cursor-pointer items-center gap-3 rounded-[10px] border px-3 py-2.5 transition-colors ${state.listIds.includes(l.id) ? "border-primary/50 bg-primary/5" : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"}`}>
                  <input type="checkbox" className="checkbox checkbox-sm checkbox-primary" checked={state.listIds.includes(l.id)} onChange={(e) => set({ listIds: e.target.checked ? [...state.listIds, l.id] : state.listIds.filter((x) => x !== l.id) })} />
                  <RiFolderLine size={16} className="text-base-content/45" />
                  <span className="flex-1 text-sm">{l.name}</span><span className="text-xs tabular-nums text-base-content/45">{l.target_count} contacts</span>
                </label>
              ))}
            </Panel>
          )}

          {state.sourceKind === "linkedin_import" && (
            <Panel className="p-5">
              <Field label="Sales Navigator list or search URL" hint="Imported in daily batches with human-like pacing">
                <input className={inputCls} placeholder="https://www.linkedin.com/sales/lists/people/…" value={state.importUrl} onChange={(e) => set({ importUrl: e.target.value.trim() })} />
              </Field>
            </Panel>
          )}
        </div>
      )}
    </StepSheet>
  );
}
