import { RiArrowRightLine, RiShieldCheckLine } from "react-icons/ri";
import { countSignals } from "@/components/agents/SourcePicker";
import { Card, SIGNAL_LABEL } from "@/components/agents/ui";
import type { WizardState } from "@/components/agents/wizard/types";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card className="space-y-2"><div className="text-xs font-semibold uppercase tracking-wide">{title}</div><div className="space-y-1.5 text-sm">{children}</div></Card>;
}

const join = (l: string[] | undefined) => (l ?? []).filter(Boolean).join(", ") || "—";

export default function ReviewStep({ state, startOutreach, setStartOutreach }: { state: WizardState; startOutreach: boolean; setStartOutreach: (v: boolean) => void }) {
  const o = state.outreach;
  const enabled = state.sources.filter((s) => s.enabled);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-[-.02em]">Review your agent</h2>
        <p className="mt-1 text-sm text-base-content/55">Take a quick look — you stay in control at every step.</p>
      </div>
      <p className="flex items-center gap-2 rounded-xl bg-warning/10 px-4 py-3 text-sm text-warning"><RiShieldCheckLine size={16} /><span><b>You&apos;re always in control.</b> Pause or adjust your agent at any time.</span></p>

      <Block title="Lead sources">
        {state.sourceKind === "signals" ? enabled.map((s) => (
          <div key={s.source_type}><b className="font-medium">{SIGNAL_LABEL[s.source_type] ?? s.source_type}:</b> {s.config.keywords?.length ? join(s.config.keywords) : s.config.urls?.length ? join(s.config.urls) : s.config.boards?.length ? join(s.config.boards.map((b) => `${b.ats}:${b.slug}`)) : "on"}</div>
        )) : <div>{state.sourceKind === "lookalike" ? "Warm lookalikes from Sales Navigator" : state.sourceKind === "existing" ? `${state.listIds.length} existing list(s)` : `Import: ${state.importUrl}`}</div>}
        {state.sourceKind === "signals" && <div className="text-xs text-base-content/45">{countSignals(state.sources)} signals tracked</div>}
      </Block>

      <Block title="Targeting">
        <div><b className="font-medium">Job roles:</b> {join(state.icp.personas.flatMap((p) => p.titles))}</div>
        <div><b className="font-medium">Industries:</b> {join(state.icp.industries)}</div>
        <div><b className="font-medium">Company size:</b> {join(state.icp.company_sizes)}</div>
        <div><b className="font-medium">Location:</b> {join(state.icp.geographies)}</div>
        {state.icp.exclusions.length > 0 && <div><b className="font-medium">Excluded:</b> {join(state.icp.exclusions)}</div>}
        <div className="text-xs text-base-content/45">Match level: {state.minScore >= 70 ? "High precision" : state.minScore >= 55 ? "Balanced" : "Broad"}</div>
      </Block>

      <Block title="Outreach">
        <div>{o.build === "ai" ? `AI-generated ${o.channel === "multi" ? "multi-channel" : o.channel === "linkedin" ? "LinkedIn" : "email"} sequence · ${o.tone} tone · goal: ${o.goal === "meetings" ? "book meetings" : "start conversations"}` : "Your own campaign"}</div>
        <div>{o.mode === "copilot" ? "Review mode: you approve each lead and its messages before anything is sent." : "Autopilot: leads are approved after 60 minutes unless you reject them first."}</div>
        <div className="text-xs text-base-content/45">Up to {o.daily_lead_cap} new contacts per day{o.exclude_first_degree ? " · 1st-degree connections excluded" : ""}</div>
      </Block>

      <Card className="space-y-3 border-warning/40 bg-warning/5">
        <div className="flex items-center gap-2 font-semibold text-warning"><RiArrowRightLine /> What happens after launch</div>
        <p className="text-sm text-warning">Your agent starts finding, scoring and drafting for new leads right away, continuously.</p>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="toggle toggle-sm" checked={startOutreach} onChange={(e) => setStartOutreach(e.target.checked)} />
          {startOutreach ? "Start outreach now: approved contacts enter the campaign immediately." : "Keep outreach paused: start it from the agent page when you're ready."}</label>
      </Card>
    </div>
  );
}
