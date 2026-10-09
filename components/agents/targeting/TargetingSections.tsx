import { useState } from "react";
import {
  RiBriefcaseLine, RiBuilding2Line, RiBuildingLine, RiCheckLine, RiForbidLine, RiGroupLine, RiInformationLine, RiMap2Line, RiShieldLine,
} from "react-icons/ri";
import type { Icp, MatchMode } from "@/lib/icp/schema";
import { INDUSTRY_TREE } from "@/lib/icp/data/industries";
import { LOCATION_TREE } from "@/lib/icp/data/locations";
import { addRole, removeRole, roleTitles, setRoles, SIZE_PRESETS, sizeKey, sizeLabel, sizePreset, toggleSize, toggleType, TYPE_PRESETS } from "@/lib/icp/targeting";
import { Toggle } from "@/components/agents/ui";
import { AddInput, Chip, ChipField, ToggleChip } from "@/components/agents/targeting/Chips";
import { PlainSection, SectionCard } from "@/components/agents/targeting/SectionCard";
import TitlePicker from "@/components/agents/targeting/TitlePicker";
import TreePicker from "@/components/agents/targeting/TreePicker";

const join = (l: string[], empty: string) => (l.length ? l.join(", ") : empty);
const toggleIn = (list: string[], v: string) => (list.some((x) => x.toLowerCase() === v.toLowerCase()) ? list.filter((x) => x.toLowerCase() !== v.toLowerCase()) : [...list, v]);

const MODES: Array<{ value: MatchMode; title: string; hint: string; badge?: string }> = [
  { value: "high_precision", title: "High precision", hint: "Best matches only", badge: "Recommended" },
  { value: "broader", title: "Broader", hint: "Less strict criteria, more leads" },
  { value: "skip", title: "Skip ICP filtering and scoring", hint: "Keep every lead - no ICP filtering, no scoring" },
];

type Key = "roles" | "industries" | "types" | "sizes" | "locations" | "excluded" | "competitors" | "mode" | "advanced";

/**
 * Every collapsible section of the Edit targeting drawer, editing `icp` in place via `onChange`.
 * `accordion` keeps at most one section open (the new-agent wizard).
 */
export default function TargetingSections({ icp, onChange, accordion = false }: { icp: Icp; onChange: (next: Icp) => void; accordion?: boolean }) {
  const [open, setOpen] = useState<Partial<Record<Key, boolean>>>({});
  const flip = (k: Key) => setOpen((o) => (accordion ? { [k]: !o[k] } : { ...o, [k]: !o[k] }));
  const set = <K extends keyof Icp>(key: K, v: Icp[K]) => onChange({ ...icp, [key]: v });

  const roles = roleTitles(icp);
  const typeExtras = icp.company_types.filter((t) => !TYPE_PRESETS.some((p) => p.toLowerCase() === t.toLowerCase()));
  const sizeExtras = icp.company_sizes.filter((s) => !sizePreset(s));
  const sizeOn = (value: string) => icp.company_sizes.some((s) => sizeKey(s) === sizeKey(value));
  const mode = MODES.find((m) => m.value === icp.match_mode) ?? MODES[0];

  return (
    <div className="space-y-4">
      <SectionCard icon={<RiGroupLine size={20} />} label="Job roles" count={roles.length} summary={join(roles, "Any job role")} open={!!open.roles} onToggle={() => flip("roles")}>
        <ChipField items={roles.map((r) => ({ value: r, label: r }))} onRemove={(r) => onChange(removeRole(icp, r))}
          picker={(close) => (
            <TitlePicker selected={roles} onClose={close} onClear={() => onChange(setRoles(icp, []))}
              onToggle={(t) => onChange(roles.some((r) => r.toLowerCase() === t.toLowerCase()) ? removeRole(icp, t) : addRole(icp, t))} />
          )} />
      </SectionCard>

      <SectionCard icon={<RiBuilding2Line size={20} />} label="Industries" count={icp.industries.length} summary={join(icp.industries, "All industries")} open={!!open.industries} onToggle={() => flip("industries")}>
        <ChipField items={icp.industries.map((v) => ({ value: v, label: v }))} onRemove={(v) => set("industries", icp.industries.filter((x) => x !== v))}
          picker={(close) => (
            <TreePicker label="Add industries" placeholder="Search industries…" nodes={INDUSTRY_TREE} selected={icp.industries} onClose={close}
              onToggle={(v) => set("industries", toggleIn(icp.industries, v))} />
          )} />
      </SectionCard>

      <SectionCard icon={<RiBriefcaseLine size={20} />} label="Company type" count={icp.company_types.length} summary={join(icp.company_types, "All company types")} open={!!open.types} onToggle={() => flip("types")}>
        <div className="flex flex-wrap gap-2">
          {TYPE_PRESETS.map((t) => <ToggleChip key={t} label={t} on={icp.company_types.some((x) => x.toLowerCase() === t.toLowerCase())} onToggle={() => set("company_types", toggleType(icp.company_types, t))} />)}
          {typeExtras.map((t) => <Chip key={t} label={t} onRemove={() => set("company_types", icp.company_types.filter((x) => x !== t))} />)}
        </div>
      </SectionCard>

      <SectionCard icon={<RiBuildingLine size={20} />} label="Company size" count={icp.company_sizes.length} summary={join(icp.company_sizes.map(sizeLabel), "All company sizes")} open={!!open.sizes} onToggle={() => flip("sizes")}>
        <div className="flex flex-wrap gap-2">
          {SIZE_PRESETS.map((p) => <ToggleChip key={p.value} label={p.label} on={sizeOn(p.value)} onToggle={() => set("company_sizes", toggleSize(icp.company_sizes, p))} />)}
          {sizeExtras.map((s) => <Chip key={s} label={s} onRemove={() => set("company_sizes", icp.company_sizes.filter((x) => x !== s))} />)}
        </div>
      </SectionCard>

      <SectionCard icon={<RiMap2Line size={20} />} label="Locations" count={icp.geographies.length} summary={join(icp.geographies, "All locations")} open={!!open.locations} onToggle={() => flip("locations")}>
        <ChipField items={icp.geographies.map((v) => ({ value: v, label: v }))} onRemove={(v) => set("geographies", icp.geographies.filter((x) => x !== v))}
          picker={(close) => (
            <TreePicker label="Add locations" placeholder="Search locations…" nodes={LOCATION_TREE} selected={icp.geographies} onClose={close}
              childValue={(c, p) => `${c}, ${p}`} onToggle={(v) => set("geographies", toggleIn(icp.geographies, v))} />
          )} />
      </SectionCard>

      <SectionCard icon={<RiShieldLine size={20} />} label="Excluded" count={icp.exclude_service_providers ? 1 : 0} summary={icp.exclude_service_providers ? "Service providers excluded" : "Nothing excluded"} open={!!open.excluded} onToggle={() => flip("excluded")}>
        <label className={`flex cursor-pointer items-start gap-3 rounded-[12px] border px-4 py-3.5 transition-colors ${icp.exclude_service_providers ? "border-primary/40 bg-primary/5" : "border-[var(--border-subtle)] hover:bg-base-200/50"}`}>
          <input type="checkbox" className="checkbox checkbox-sm checkbox-primary mt-0.5" checked={icp.exclude_service_providers} onChange={(e) => set("exclude_service_providers", e.target.checked)} />
          <span>
            <span className="block text-[15px] font-medium text-base-content">Exclude service providers, freelancers, and consultants</span>
            <span className="mt-0.5 block text-[15px] text-base-content/55">Filter out agencies, consultants, and B2B service companies from your results.</span>
          </span>
        </label>
      </SectionCard>

      <SectionCard icon={<RiForbidLine size={20} />} label="Competitors / keywords to exclude" count={icp.exclusions.length} summary={join(icp.exclusions, "None")} open={!!open.competitors} onToggle={() => flip("competitors")}>
        <div className="space-y-4">
          <div className="flex items-center gap-4 rounded-[12px] border border-[var(--border-subtle)] bg-base-200/40 px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-[15px] font-medium text-base-content">
                AI Competitor Filtering
                <span className="rounded-[6px] border border-primary/40 px-1.5 py-px text-[12.5px] font-medium text-primary">Uses AI credits</span>
              </div>
              <p className="mt-0.5 text-[15px] text-base-content/55">Auto-exclude competitors you haven&apos;t listed.</p>
            </div>
            <Toggle on={icp.ai_competitor_filtering} onChange={() => set("ai_competitor_filtering", !icp.ai_competitor_filtering)} label="AI competitor filtering" />
          </div>
          <AddInput values={icp.exclusions} onChange={(v) => set("exclusions", v)} placeholder="Add an ignored company…" label="Add an ignored company or keyword" />
        </div>
      </SectionCard>

      <PlainSection title="ICP filtering and scoring" description="Choose how strictly leads should match this ICP." open={!!open.mode} onToggle={() => flip("mode")}>
        <div role="radiogroup" aria-label="ICP filtering and scoring" className="grid gap-3 md:grid-cols-3">
          {MODES.map((m) => {
            const on = m.value === mode.value;
            return (
              <button key={m.value} type="button" role="radio" aria-checked={on} onClick={() => set("match_mode", m.value)}
                className={`rounded-[12px] border px-4 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${on ? "border-primary/60 bg-primary/5" : "border-[var(--border-subtle)] hover:bg-base-200/50"}`}>
                <span className="flex flex-wrap items-center gap-2 text-[15px] font-medium text-base-content">
                  {m.title}
                  {m.badge && <span className="rounded-[6px] bg-primary px-2 py-px text-[12.5px] font-medium text-primary-content">{m.badge}</span>}
                  {on && <RiCheckLine size={16} className="ml-auto text-primary" aria-hidden="true" />}
                </span>
                <span className="mt-1 block text-[15px] text-base-content/55">{m.hint}</span>
              </button>
            );
          })}
        </div>
      </PlainSection>

      <PlainSection title="Specify your targeting (optional)" description="Add advanced criteria only when needed. Your ICP above stays the main targeting setup." open={!!open.advanced} onToggle={() => flip("advanced")}>
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[15px] font-medium text-base-content">
            Mandatory keywords
            <span tabIndex={0} className="text-base-content/45" title="Leads must mention at least one of these words in their headline, title, about or company. Others are disqualified before scoring." aria-label="About mandatory keywords">
              <RiInformationLine size={15} />
            </span>
          </div>
          <AddInput values={icp.mandatory_keywords} onChange={(v) => set("mandatory_keywords", v)} placeholder="e.g., AI, Web3, etc." label="Add a mandatory keyword" />
        </div>
      </PlainSection>
    </div>
  );
}
