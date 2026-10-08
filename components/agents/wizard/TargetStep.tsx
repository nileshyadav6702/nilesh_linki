import { useState } from "react";
import { toast } from "sonner";
import {
  RiArrowDownSLine, RiBriefcaseLine, RiBuilding2Line, RiDeleteBinLine, RiForbidLine, RiMagicLine, RiMapPinLine, RiShieldLine,
  RiSparkling2Line, RiTeamLine, RiUserLine,
} from "react-icons/ri";
import IcpEditor, { EMPTY_ICP } from "@/components/agents/IcpEditor";
import { Callout, Field, ghostBtn, inputCls, Panel } from "@/components/agents/ui";
import { Caps, OptionCard, StepHeading, StepSheet } from "@/components/agents/wizard/kit";
import type { WizardState } from "@/components/agents/wizard/types";

const STRICTNESS = [
  { value: 40, label: "Broad", hint: "More leads; looser match" },
  { value: 55, label: "Balanced", hint: "Recommended" },
  { value: 70, label: "High precision", hint: "Fewer, closer matches" },
] as const;

/** Collapsible section: icon, uppercase label with a count, the current values, and its body when open. */
function Section({ icon, label, count, summary, open, onToggle, children }: { icon: React.ReactNode; label: string; count?: number; summary: React.ReactNode; open: boolean; onToggle: () => void; children?: React.ReactNode }) {
  return (
    <Panel>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-4 px-5 py-4 text-left">
        <span className="shrink-0 text-base-content/45">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2"><Caps>{label}</Caps>{count !== undefined && <span className="rounded-[6px] border border-primary/30 px-1.5 text-[11px] tabular-nums text-primary">{count}</span>}</span>
          <span className="mt-1 block truncate text-[15px] text-base-content">{summary}</span>
        </span>
        <RiArrowDownSLine size={18} className={`shrink-0 text-base-content/40 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && children && <div className="border-t border-[var(--border-subtle)] px-5 py-5">{children}</div>}
    </Panel>
  );
}

const join = (l: string[]) => l.filter(Boolean).join(", ");

export default function TargetStep({ state, set }: { state: WizardState; set: (p: Partial<WizardState>) => void }) {
  const [busy, setBusy] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (k: string) => setOpen(open === k ? null : k);

  async function generate() {
    if (!state.website.trim()) return toast.error("Enter your website first");
    setBusy(true);
    try {
      const r = await fetch("/api/icp/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ website_url: state.website }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      set({ icp: d.icp, website: d.website_url, icpId: null });
      setEditorKey((k) => k + 1);
      toast.success(`Read ${d.pages.length} page${d.pages.length === 1 ? "" : "s"} of your site`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read the website");
    } finally { setBusy(false); }
  }

  const icp = state.icp;
  const titles = icp.personas.flatMap((p) => p.titles).filter(Boolean);
  const rows = [
    { key: "roles", icon: <RiUserLine size={18} />, label: "Job roles", values: titles },
    { key: "industries", icon: <RiBuilding2Line size={18} />, label: "Industries", values: icp.industries },
    { key: "types", icon: <RiBriefcaseLine size={18} />, label: "Company type", values: icp.company_types },
    { key: "sizes", icon: <RiTeamLine size={18} />, label: "Company size", values: icp.company_sizes },
    { key: "locations", icon: <RiMapPinLine size={18} />, label: "Locations", values: icp.geographies },
    { key: "excluded", icon: <RiShieldLine size={18} />, label: "Excluded", values: icp.exclusions },
    { key: "competitors", icon: <RiForbidLine size={18} />, label: "Competitors", values: icp.competitors.map((c) => c.name) },
  ];

  return (
    <StepSheet>
      <StepHeading title="Refine your targeting" subtitle="Your ideal customer profile is drafted from your website. Edit anything before continuing." />
      <Callout icon={<RiSparkling2Line size={16} />} title="Targeting decides which leads your agent keeps and how it personalises outreach.">
        People outside it are scored low and never contacted.
      </Callout>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[240px] flex-1"><Field label="Your website"><input className={inputCls} placeholder="https://yourcompany.com" value={state.website} onChange={(e) => set({ website: e.target.value })} /></Field></div>
        <button type="button" className="inline-flex h-10 items-center gap-1.5 rounded-[8px] border border-primary/40 bg-primary/5 px-4 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50" disabled={busy} onClick={generate}>
          <RiMagicLine size={16} />{busy ? "Reading your site…" : icp.personas.length ? "Regenerate with AI" : "Generate with AI"}
        </button>
        <button type="button" className={ghostBtn + " h-10"} onClick={() => { set({ icp: EMPTY_ICP, icpId: null }); setEditorKey((k) => k + 1); }}><RiDeleteBinLine size={14} /> Clear all</button>
      </div>

      <div className="space-y-3">
        {rows.map((r) => (
          <Section key={r.key} icon={r.icon} label={r.label} count={r.values.length} open={false} onToggle={() => setOpen("edit")}
            summary={r.values.length ? join(r.values) : <span className="text-base-content/40">Not set — open to edit</span>} />
        ))}
        <Section icon={<RiMagicLine size={18} />} label="Edit targeting" summary="Every field of your ideal customer profile" open={open === "edit"} onToggle={() => toggle("edit")}>
          <IcpEditor key={editorKey} value={icp} onChange={(v) => set({ icp: v, icpId: null })} />
        </Section>
      </div>

      <Panel className="space-y-4 px-5 py-5">
        <div><div className="font-display text-[19px] text-base-content">ICP filtering and scoring</div><div className="text-sm text-base-content/55">How strictly leads must match before your agent reaches out.</div></div>
        <div className="grid gap-3 sm:grid-cols-3">
          {STRICTNESS.map((s) => (
            <OptionCard key={s.value} selected={state.minScore === s.value} onClick={() => set({ minScore: s.value })} title={s.label} text={s.hint} className="!py-3" />
          ))}
        </div>
      </Panel>
    </StepSheet>
  );
}
