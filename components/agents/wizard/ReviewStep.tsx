import type { ReactNode } from "react";
import { RiArrowRightLine, RiShieldLine } from "react-icons/ri";
import { SIGNAL_LABEL } from "@/components/agents/ui";
import { roleTitles, sizeLabel } from "@/lib/icp/targeting";
import { scopeTitles } from "@/lib/agents/lookalike-rules";
import { StepHeading, StepSheet } from "@/components/agents/wizard/kit";
import type { WizardState } from "@/components/agents/wizard/types";

const MATCH: Record<string, string> = { high_precision: "High precision", broader: "Broader", skip: "No ICP filtering" };
const BUYING: Record<string, string> = { job_change: "Recent job changes (< 90 days)", funding: "Companies that recently raised funds", hiring: "Open roles" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="wizard-rise space-y-4 rounded-[16px] border border-[var(--border-subtle)] px-6 py-6">
      <h3 className="text-[15px] font-semibold uppercase">{title}</h3>
      <div className="space-y-3 text-[17px] text-base-content/85">{children}</div>
    </section>
  );
}

const Line = ({ label, values }: { label: string; values: string[] }) =>
  values.length ? <p><span className="text-base-content">{label}:</span> {values.join(", ")}</p> : null;

/** Read-only summary of the agent before launch. */
export default function ReviewStep({ state }: { state: WizardState }) {
  const o = state.outreach;
  const on = state.sources.filter((s) => s.enabled);
  const of = (type: string) => on.find((s) => s.source_type === type);
  const urls = (type: string) => (of(type)?.config.urls ?? []).map((u) => u.replace(/^https?:\/\/(www\.)?linkedin\.com\//, ""));
  const icp = state.icp;

  return (
    <StepSheet>
      <StepHeading align="left" title="Review your agent" subtitle="Take a quick look and stay in control at every step." />
      <div className="flex items-center gap-4 rounded-[12px] bg-primary/10 px-6 py-4 text-[17px] text-primary">
        <RiShieldLine size={20} className="shrink-0" aria-hidden="true" />
        <p><span className="font-semibold">You&apos;re always in control.</span> <span className="opacity-90">You can pause or readjust your agent at any time.</span></p>
      </div>

      <Section title="Lead sources">
        {state.sourceKind === "signals" ? (
          <>
            <Line label="Buying event" values={["job_change", "funding", "hiring"].filter((t) => of(t)).map((t) => BUYING[t])} />
            <Line label="Keyword engagement" values={of("keyword_engagement")?.config.keywords ?? []} />
            <Line label={SIGNAL_LABEL.influencer_engagement ?? "Market experts"} values={urls("influencer_engagement")} />
            <Line label="Competitor engagement" values={urls("competitor_engagement")} />
            <Line label="Brand awareness" values={urls("own_content_engagement")} />
            {of("lookalike") && <p><span className="text-base-content">Smart lead finder:</span> on</p>}
          </>
        ) : (
          state.sourceKind === "lookalike" && state.lookalike.scope ? (
            <>
              <p><span className="text-base-content">Warm lookalike of:</span> {state.lookalike.profile?.name ?? "your best lead"}</p>
              <Line label="Roles" values={scopeTitles(state.lookalike.scope)} />
              <Line label="Location" values={state.lookalike.scope.location ? [state.lookalike.scope.location] : []} />
              <Line label="Industry" values={state.lookalike.scope.industry ? [state.lookalike.scope.industry + (state.lookalike.scope.relatedIndustries ? " and related" : "")] : []} />
            </>
          ) : <p>{state.sourceKind === "lookalike" ? "Warm lookalikes from Sales Navigator" : state.sourceKind === "existing" ? state.existing.csvImported ? `CSV imported into "${state.existing.csvImported.listName}"` : `${state.listIds.length} existing list${state.listIds.length === 1 ? "" : "s"}` : `Imported from LinkedIn into "${state.linkedinImport?.listName ?? "your list"}"`}</p>
        )}
      </Section>

      <Section title="Targeting">
        <Line label="Job roles" values={roleTitles(icp)} />
        <Line label="Industries" values={icp.industries} />
        <Line label="Company type" values={icp.company_types} />
        <Line label="Company size" values={icp.company_sizes.map(sizeLabel)} />
        <Line label="Location" values={icp.geographies} />
        <p className="text-[15px] text-base-content/55">Match level: {MATCH[icp.match_mode] ?? "High precision"}</p>
      </Section>

      <Section title="Outreach">
        <p>{o.build === "manual" ? "Custom sequence you built" : "AI-generated sequence"}</p>
        <p>{o.mode === "copilot"
          ? "Review mode: you approve each contact and its messages before anything is sent."
          : "Autopilot mode: contacts are automatically approved for outreach. You can still review queued contacts before messages are sent."}</p>
      </Section>

      <section className="wizard-rise space-y-3 rounded-[12px] border border-primary/30 bg-primary/10 px-6 py-5 text-primary">
        <div className="flex items-center gap-2 text-[17px] font-semibold"><RiArrowRightLine size={20} /> What will happen after launch</div>
        <p className="text-[17px] opacity-90">New leads will be added continuously from automatic sources.</p>
        <p className="text-[17px] opacity-90">You can pause your agent anytime, edit sources, targeting, and outreach.</p>
      </section>
    </StepSheet>
  );
}
