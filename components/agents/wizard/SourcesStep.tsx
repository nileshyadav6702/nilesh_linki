import { useEffect, useState } from "react";
import { RiEditLine, RiFolderLine, RiFocus3Line, RiGroupLine, RiLinkedinBoxLine, RiSparkling2Line } from "react-icons/ri";
import SourcePicker, { countSignals } from "@/components/agents/SourcePicker";
import { Card, Field, inputCls } from "@/components/agents/ui";
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

  return (
    <div className="space-y-5">
      <div className="flex justify-center">
        <label className="inline-flex items-center gap-2 rounded-full border border-warning/40 px-4 py-1.5 text-sm">
          <span className="font-semibold text-warning">AGENT NAME</span>
          <input className="w-56 bg-transparent outline-none placeholder:italic" placeholder="Enter a name" value={state.name} onChange={(e) => set({ name: e.target.value })} aria-label="Agent name" />
          <RiEditLine className="text-warning" size={14} />
        </label>
      </div>
      <div className="text-center">
        <h2 className="text-2xl font-semibold tracking-[-.02em]">Where should your agent find leads?</h2>
        <p className="mt-1 text-sm text-base-content/55">Choose one source to get started — you can always add more later.</p>
      </div>

      {!state.sourceKind || state.sourceKind === null ? (
        <div className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-2">
          {KINDS.map((k) => (
            <button key={k.kind} type="button" onClick={() => set({ sourceKind: k.kind })} className="rounded-[12px] border border-[var(--border-subtle)] bg-base-300 p-5 text-left transition-colors hover:border-[var(--border-strong)]">
              <div className="mb-3 flex items-center justify-between">
                {"recommended" in k && k.recommended ? <span className="rounded-md bg-warning px-2 py-0.5 text-xs font-medium text-warning-content">Recommended</span> : <span />}
                {"ai" in k && k.ai ? <span className="inline-flex items-center gap-1 text-xs text-warning"><RiSparkling2Line size={12} /> AI agent</span> : null}
              </div>
              <k.icon size={22} className="mb-2 text-base-content/70" />
              <div className="font-semibold">{k.title}</div>
              <div className="text-sm text-base-content/55">{k.why}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="mx-auto max-w-3xl space-y-4">
          <Card className="flex items-center gap-4 !py-4">
            {(() => { const k = KINDS.find((x) => x.kind === state.sourceKind)!; return <><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-warning text-warning-content"><k.icon size={20} /></span><div className="flex-1"><div className="font-semibold">{k.title}</div><div className="text-sm text-base-content/55">{k.why}</div></div></>; })()}
            <button type="button" className="text-sm font-medium hover:underline" onClick={() => set({ sourceKind: null })}>Change source</button>
          </Card>

          {state.sourceKind === "signals" && (
            <Card className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div><div className="font-semibold">The signals your agent tracks</div><div className="text-sm text-base-content/55">Tracking {signals} signal{signals === 1 ? "" : "s"}. We recommend at least 4, up to 15.</div></div>
                <span className={`rounded-lg px-2.5 py-1 text-sm font-medium ${signals >= 4 ? "bg-success text-success-content" : "bg-base-200"}`}>{signals}/15 signals</span>
              </div>
              <SourcePicker value={state.sources} onChange={(sources) => set({ sources })} hasLinkedIn={hasLinkedIn} suggestions={{ keywords: state.icp.keywords, competitorUrls }} />
            </Card>
          )}

          {state.sourceKind === "lookalike" && (
            <Card className="space-y-3">
              <p className="text-sm text-base-content/60">Your agent searches Sales Navigator for people matching your ICP and imports them at a safe pace. You&apos;ll refine the targeting in the next step.</p>
              {!hasLinkedIn && <p className="text-xs text-warning">Needs a LinkedIn account with Sales Navigator.</p>}
            </Card>
          )}

          {state.sourceKind === "existing" && (
            <Card className="space-y-2">
              {lists.length === 0 && <p className="text-sm text-base-content/50">No lists yet. Import a CSV or Sales Navigator list from Lists first.</p>}
              {lists.map((l) => (
                <label key={l.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--border-subtle)] px-3 py-2.5">
                  <input type="checkbox" className="checkbox checkbox-sm" checked={state.listIds.includes(l.id)} onChange={(e) => set({ listIds: e.target.checked ? [...state.listIds, l.id] : state.listIds.filter((x) => x !== l.id) })} />
                  <span className="flex-1 text-sm">{l.name}</span><span className="text-xs text-base-content/45">{l.target_count} contacts</span>
                </label>
              ))}
            </Card>
          )}

          {state.sourceKind === "linkedin_import" && (
            <Card>
              <Field label="Sales Navigator list or search URL" hint="Imported in daily batches with human-like pacing">
                <input className={inputCls} placeholder="https://www.linkedin.com/sales/lists/people/…" value={state.importUrl} onChange={(e) => set({ importUrl: e.target.value.trim() })} />
              </Field>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
