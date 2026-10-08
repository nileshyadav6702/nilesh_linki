import { RiArrowRightLine, RiFocus3Line, RiSendPlaneLine, RiShieldCheckLine, RiUserSearchLine } from "react-icons/ri";
import { countSignals } from "@/components/agents/SourcePicker";
import { Callout, IconTile, Panel, SIGNAL_LABEL, Toggle } from "@/components/agents/ui";
import { Caps, StepHeading, StepSheet } from "@/components/agents/wizard/kit";
import type { WizardState } from "@/components/agents/wizard/types";

function Block({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Panel className="space-y-3 px-5 py-5">
      <div className="flex items-center gap-3"><IconTile icon={icon} tone="ink" size={32} /><Caps className="!text-base-content">{title}</Caps></div>
      <div className="space-y-2 pl-11 text-[15px] text-base-content/85">{children}</div>
    </Panel>
  );
}

const join = (l: string[] | undefined) => (l ?? []).filter(Boolean).join(", ") || "—";

export default function ReviewStep({ state, startOutreach, setStartOutreach }: { state: WizardState; startOutreach: boolean; setStartOutreach: (v: boolean) => void }) {
  const o = state.outreach;
  const enabled = state.sources.filter((s) => s.enabled);
  return (
    <StepSheet>
      <StepHeading align="left" title="Review your agent" subtitle="Take a quick look — you stay in control at every step." />
      <Callout icon={<RiShieldCheckLine size={16} />} title="You're always in control.">Pause or adjust your agent at any time.</Callout>

      <Block title="Lead sources" icon={<RiFocus3Line size={16} />}>
        {state.sourceKind === "signals" ? enabled.map((s) => (
          <div key={s.source_type}><b className="font-medium text-base-content">{SIGNAL_LABEL[s.source_type] ?? s.source_type}:</b> {s.config.keywords?.length ? join(s.config.keywords) : s.config.urls?.length ? join(s.config.urls) : s.config.boards?.length ? join(s.config.boards.map((b) => `${b.ats}:${b.slug}`)) : "on"}</div>
        )) : <div>{state.sourceKind === "lookalike" ? "Warm lookalikes from Sales Navigator" : state.sourceKind === "existing" ? `${state.listIds.length} existing list(s)` : `Import: ${state.importUrl}`}</div>}
        {state.sourceKind === "signals" && <div className="text-xs text-base-content/45">{countSignals(state.sources)} signals tracked</div>}
      </Block>

      <Block title="Targeting" icon={<RiUserSearchLine size={16} />}>
        <div><b className="font-medium text-base-content">Job roles:</b> {join(state.icp.personas.flatMap((p) => p.titles))}</div>
        <div><b className="font-medium text-base-content">Industries:</b> {join(state.icp.industries)}</div>
        <div><b className="font-medium text-base-content">Company size:</b> {join(state.icp.company_sizes)}</div>
        <div><b className="font-medium text-base-content">Location:</b> {join(state.icp.geographies)}</div>
        {state.icp.exclusions.length > 0 && <div><b className="font-medium text-base-content">Excluded:</b> {join(state.icp.exclusions)}</div>}
        <div className="text-xs text-base-content/45">Match level: {state.minScore >= 70 ? "High precision" : state.minScore >= 55 ? "Balanced" : "Broad"}</div>
      </Block>

      <Block title="Outreach" icon={<RiSendPlaneLine size={16} />}>
        <div>{o.build === "ai" ? `AI-generated ${o.channel === "multi" ? "multi-channel" : o.channel === "linkedin" ? "LinkedIn" : "email"} sequence · ${o.tone} tone · goal: ${o.goal === "meetings" ? "book meetings" : "start conversations"}` : "Your own campaign"}</div>
        <div>{o.mode === "copilot" ? "Review mode: you approve each lead and its messages before anything is sent." : "Autopilot: leads are approved after 60 minutes unless you reject them first."}</div>
        <div className="text-xs text-base-content/45">Up to {o.daily_lead_cap} new contacts per day{o.exclude_first_degree ? " · 1st-degree connections excluded" : ""}</div>
      </Block>

      <div className="space-y-3 rounded-[12px] border border-primary/30 bg-primary/5 px-5 py-4">
        <div className="flex items-center gap-2 font-semibold text-primary"><RiArrowRightLine /> What happens after launch</div>
        <p className="text-sm text-primary/90">Your agent starts finding, scoring and drafting for new leads right away, continuously.</p>
        <div className="flex items-center gap-3 text-sm text-base-content/80">
          <Toggle label="Start outreach now" on={startOutreach} onChange={() => setStartOutreach(!startOutreach)} />
          {startOutreach ? "Start outreach now: approved contacts enter the campaign immediately." : "Keep outreach paused: start it from the agent page when you're ready."}
        </div>
      </div>
    </StepSheet>
  );
}
