import { useState } from "react";
import { toast } from "sonner";
import { RiCheckLine, RiSettings3Line } from "react-icons/ri";
import { SideDrawer } from "@/components/agents/campaign/kit";
import { primaryBtn, Toggle } from "@/components/agents/ui";

const GOALS = [
  { value: "conversations", title: "Start conversations", sub: "Warm prospects" },
  { value: "meetings", title: "Book sales calls", sub: "Qualified demos" },
] as const;
const TONES = [
  { value: "professional", label: "Professional" },
  { value: "conversational", label: "Conversational" },
  { value: "direct", label: "Direct" },
] as const;

function Caption({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-4">
      <div className="text-[13.5px] font-medium uppercase tracking-[1.5px] text-base-content/50">{title}</div>
      {sub && <div className="mt-0.5 text-[15px] text-base-content/55">{sub}</div>}
    </div>
  );
}

/** Agent-wide campaign settings: what the AI writes toward and who is skipped before outreach. */
export default function CampaignSettings({ agentId, initial, onClose, onSaved }: { agentId: string; initial: { goal: string; tone: string; exclude_first_degree: number }; onClose: () => void; onSaved: () => void }) {
  const [goal, setGoal] = useState(initial.goal || "conversations");
  const [tone, setTone] = useState(initial.tone || "professional");
  const [exclude, setExclude] = useState(!!initial.exclude_first_degree);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const r = await fetch(`/api/agents/${agentId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal, tone, exclude_first_degree: exclude }) });
    setBusy(false);
    if (!r.ok) return toast.error((await r.json().catch(() => ({}))).error ?? "Could not save settings");
    toast.success("Campaign settings saved");
    onSaved();
    onClose();
  }

  return (
    <SideDrawer title="Campaign settings" icon={<RiSettings3Line size={20} className="text-base-content/70" />} onClose={onClose} width={620}
      footer={<>
        <button type="button" className="h-10 px-4 text-[15px] font-medium text-base-content/70 hover:text-base-content" onClick={onClose}>Cancel</button>
        <button type="button" className={primaryBtn} disabled={busy} onClick={save}>Save settings</button>
      </>}>
      <section className="border-b border-[var(--border-subtle)] pb-6">
        <Caption title="Campaign AI" sub="Applies to newly generated messages only." />
        <div className="grid items-center gap-4 sm:grid-cols-[150px_1fr]">
          <div className="text-[15px] text-base-content">Campaign goal</div>
          <div className="grid grid-cols-2 gap-2">
            {GOALS.map((g) => {
              const on = goal === g.value;
              return (
                <button key={g.value} type="button" onClick={() => setGoal(g.value)} aria-pressed={on}
                  className={`rounded-[10px] border px-4 py-3 text-left transition-colors ${on ? "border-primary/60 bg-primary/[0.06]" : "border-[var(--border-subtle)] bg-base-100 hover:bg-base-200/60"}`}>
                  <span className={`flex items-center gap-1.5 text-[15px] font-medium ${on ? "text-primary" : "text-base-content"}`}>{on && <RiCheckLine size={16} />}{g.title}</span>
                  <span className="mt-0.5 block text-[14.5px] text-base-content/55">{g.sub}</span>
                </button>
              );
            })}
          </div>
          <div className="text-[15px] text-base-content">Message tone</div>
          <div className="grid grid-cols-3 overflow-hidden rounded-[10px] border border-[var(--border-subtle)]">
            {TONES.map((t, i) => {
              const on = tone === t.value;
              return (
                <button key={t.value} type="button" onClick={() => setTone(t.value)} aria-pressed={on}
                  className={`h-11 text-[15px] font-medium transition-colors ${i ? "border-l border-[var(--border-subtle)]" : ""} ${on ? "bg-primary text-primary-content" : "bg-base-100 text-base-content hover:bg-base-200/60"}`}>{t.label}</button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="pt-6">
        <Caption title="Connection rules" />
        <div className="flex items-center justify-between gap-4 rounded-[12px] border border-[var(--border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <div className="font-medium text-base-content">Automatically exclude first-degree connections</div>
            <div className="mt-0.5 text-[15px] text-base-content/55">Skips people already in your LinkedIn network</div>
          </div>
          <Toggle on={exclude} onChange={() => setExclude((v) => !v)} label="Automatically exclude first-degree connections" />
        </div>
      </section>
    </SideDrawer>
  );
}
