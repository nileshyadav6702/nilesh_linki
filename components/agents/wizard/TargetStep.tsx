import { useState } from "react";
import { toast } from "sonner";
import { RiDeleteBinLine, RiMagicLine, RiSparkling2Line } from "react-icons/ri";
import IcpEditor, { EMPTY_ICP } from "@/components/agents/IcpEditor";
import { Card, Field, ghostBtn, inputCls, secondaryBtn } from "@/components/agents/ui";
import type { WizardState } from "@/components/agents/wizard/types";

const STRICTNESS = [
  { value: 40, label: "Broad", hint: "More leads; looser match" },
  { value: 55, label: "Balanced", hint: "Recommended" },
  { value: 70, label: "High precision", hint: "Fewer, closer matches" },
] as const;

export default function TargetStep({ state, set }: { state: WizardState; set: (p: Partial<WizardState>) => void }) {
  const [busy, setBusy] = useState(false);
  const [editorKey, setEditorKey] = useState(0);

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

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="text-center">
        <h2 className="text-2xl font-semibold tracking-[-.02em]">Refine your targeting</h2>
        <p className="mt-1 text-sm text-base-content/55">Your ideal customer profile is drafted from your website. Edit anything before continuing.</p>
      </div>
      <p className="flex items-start gap-2 rounded-xl bg-warning/10 px-4 py-3 text-sm text-warning"><RiSparkling2Line size={16} className="mt-0.5 shrink-0" />Targeting decides which leads your agent keeps and how it personalises outreach. People outside it are scored low and never contacted.</p>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[240px] flex-1"><Field label="Your website"><input className={inputCls} placeholder="https://yourcompany.com" value={state.website} onChange={(e) => set({ website: e.target.value })} /></Field></div>
          <button type="button" className={secondaryBtn} disabled={busy} onClick={generate}><RiMagicLine size={16} />{busy ? "Reading your site…" : state.icp.personas.length ? "Regenerate with AI" : "Generate with AI"}</button>
          <button type="button" className={ghostBtn + " h-10"} onClick={() => { set({ icp: EMPTY_ICP, icpId: null }); setEditorKey((k) => k + 1); }}><RiDeleteBinLine size={14} /> Clear all</button>
        </div>
        <IcpEditor key={editorKey} value={state.icp} onChange={(icp) => set({ icp, icpId: null })} />
      </Card>
      <Card className="space-y-3">
        <div><div className="font-semibold">ICP filtering and scoring</div><div className="text-sm text-base-content/55">How strictly leads must match before your agent reaches out.</div></div>
        <div className="grid gap-2 sm:grid-cols-3">
          {STRICTNESS.map((s) => (
            <button key={s.value} type="button" onClick={() => set({ minScore: s.value })} className={`rounded-xl border px-3 py-2.5 text-left ${state.minScore === s.value ? "border-warning bg-warning/5" : "border-[var(--border-subtle)]"}`}>
              <div className="text-sm font-medium">{s.label}</div><div className="text-xs text-base-content/50">{s.hint}</div>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
