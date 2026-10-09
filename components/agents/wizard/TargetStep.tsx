import { useState } from "react";
import { toast } from "sonner";
import { RiDeleteBinLine, RiLoader4Line, RiSparkling2Line } from "react-icons/ri";
import TargetingSections from "@/components/agents/targeting/TargetingSections";
import { applyDraftTargeting, clearTargeting } from "@/lib/icp/targeting";
import type { Icp } from "@/lib/icp/schema";
import { StepHeading, StepSheet } from "@/components/agents/wizard/kit";
import type { WizardState } from "@/components/agents/wizard/types";

/** Target: the ICP as collapsible sections, one open at a time, plus match strictness. */
export default function TargetStep({ state, set }: { state: WizardState; set: (p: Partial<WizardState>) => void }) {
  const [busy, setBusy] = useState(false);
  const [sectionsKey, setSectionsKey] = useState(0);
  const update = (icp: Icp) => set({ icp, icpId: null });

  async function regenerate() {
    const site = state.website.trim() || prompt("Your company website", "https://")?.trim();
    if (!site || site === "https://") return;
    setBusy(true);
    try {
      const r = await fetch("/api/icp/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ website_url: site }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not read the website");
      set({ icp: applyDraftTargeting(state.icp, d.icp as Icp), website: d.website_url ?? site, icpId: null });
      setSectionsKey((k) => k + 1);
      toast.success("Targeting regenerated from your website");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read the website");
    } finally { setBusy(false); }
  }

  return (
    <StepSheet>
      <StepHeading title="Refine your targeting" subtitle="Your ideal customer profile is based on your company data. You can edit or skip." />
      <div className="flex items-start gap-4 rounded-[12px] bg-primary/10 px-6 py-4 text-[17px] leading-relaxed text-primary">
        <RiSparkling2Line size={22} className="mt-1 shrink-0" aria-hidden="true" />
        <p><span className="font-semibold">Targeting helps prioritize the most relevant leads and personalize outreach.</span>{" "}
          <span className="opacity-90">Fine-tune it below or choose to skip ICP filtering and scoring to include all leads.</span></p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={regenerate} disabled={busy}
          className="inline-flex h-11 items-center gap-1.5 rounded-[8px] border border-primary/30 bg-primary/10 px-4 text-[15px] text-primary transition-colors hover:bg-primary/15 disabled:opacity-60">
          {busy ? <><RiLoader4Line size={16} className="animate-spin" /> Regenerating…</> : "Regenerate with AI"}
        </button>
        <button type="button" onClick={() => { update(clearTargeting(state.icp)); setSectionsKey((k) => k + 1); }} disabled={busy}
          className="inline-flex h-11 items-center gap-2 rounded-[8px] px-3 text-[15px] font-medium text-base-content hover:bg-base-200 disabled:opacity-50">
          <RiDeleteBinLine size={17} /> Clear all
        </button>
      </div>

      <fieldset disabled={busy} className={`min-w-0 transition-opacity ${busy ? "pointer-events-none opacity-60" : ""}`} aria-busy={busy}>
        <TargetingSections key={sectionsKey} icp={state.icp} onChange={update} accordion />
      </fieldset>
    </StepSheet>
  );
}
