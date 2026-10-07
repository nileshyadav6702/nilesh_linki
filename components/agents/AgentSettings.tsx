import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, Field, inputCls, primaryBtn } from "@/components/agents/ui";

interface Option { id: string; name?: string; email?: string; from_email?: string; is_authenticated?: number }

export interface AgentForm {
  name: string; mode: string; min_score: number; fit_weight: number; daily_lead_cap: number; autopilot_delay_minutes: number;
  linkedin_account_id: string | null; email_account_id: string | null; workflow_id: string | null; booking_url: string | null; enrich_emails: number;
}

/** Agent settings: senders, campaign, thresholds and mode. */
export default function AgentSettings({ agentId, initial, onSaved }: { agentId: string; initial: AgentForm; onSaved: () => void }) {
  const [f, setF] = useState(initial);
  const [opts, setOpts] = useState<{ accounts: Option[]; email: Option[]; workflows: Option[] }>({ accounts: [], email: [], workflows: [] });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    Promise.all([fetch("/api/accounts"), fetch("/api/email-accounts"), fetch("/api/workflows")].map((p) => p.then((r) => r.json()).catch(() => [])))
      .then(([accounts, email, workflows]) => setOpts({ accounts, email, workflows }));
  }, []);

  async function save() {
    setSaving(true);
    const r = await fetch(`/api/agents/${agentId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...f, min_score: Number(f.min_score), fit_weight: Number(f.fit_weight), daily_lead_cap: Number(f.daily_lead_cap), autopilot_delay_minutes: Number(f.autopilot_delay_minutes), enrich_emails: !!f.enrich_emails, booking_url: f.booking_url || null }),
    });
    setSaving(false);
    if (!r.ok) return toast.error((await r.json()).error ?? "Could not save");
    toast.success("Agent saved");
    onSaved();
  }

  return (
    <Card className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Mode" hint="Copilot: you approve each first message. Autopilot: drafts send after the delay unless rejected.">
          <select className={inputCls} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="copilot">Copilot</option><option value="autopilot">Autopilot</option></select>
        </Field>
        <Field label="LinkedIn account">
          <select className={inputCls} value={f.linkedin_account_id ?? ""} onChange={(e) => setF({ ...f, linkedin_account_id: e.target.value || null })}>
            <option value="">None</option>{opts.accounts.map((a) => <option key={a.id} value={a.id}>{a.name ?? a.email}</option>)}
          </select>
        </Field>
        <Field label="Email account">
          <select className={inputCls} value={f.email_account_id ?? ""} onChange={(e) => setF({ ...f, email_account_id: e.target.value || null })}>
            <option value="">None</option>{opts.email.map((a) => <option key={a.id} value={a.id}>{a.from_email ?? a.name}</option>)}
          </select>
        </Field>
        <Field label="Campaign">
          <select className={inputCls} value={f.workflow_id ?? ""} onChange={(e) => setF({ ...f, workflow_id: e.target.value || null })}>
            <option value="">None</option>{opts.workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        <Field label="Meeting link"><input className={inputCls} value={f.booking_url ?? ""} onChange={(e) => setF({ ...f, booking_url: e.target.value })} placeholder="https://cal.com/you" /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Min lead score"><input type="number" min={0} max={100} className={inputCls} value={f.min_score} onChange={(e) => setF({ ...f, min_score: Number(e.target.value) })} /></Field>
        <Field label="Fit weight" hint="0 = intent only, 1 = fit only"><input type="number" min={0} max={1} step={0.1} className={inputCls} value={f.fit_weight} onChange={(e) => setF({ ...f, fit_weight: Number(e.target.value) })} /></Field>
        <Field label="Leads per day"><input type="number" min={1} max={500} className={inputCls} value={f.daily_lead_cap} onChange={(e) => setF({ ...f, daily_lead_cap: Number(e.target.value) })} /></Field>
        <Field label="Autopilot delay (min)"><input type="number" min={0} className={inputCls} value={f.autopilot_delay_minutes} onChange={(e) => setF({ ...f, autopilot_delay_minutes: Number(e.target.value) })} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="checkbox checkbox-sm" checked={!!f.enrich_emails} onChange={(e) => setF({ ...f, enrich_emails: e.target.checked ? 1 : 0 })} /> Find emails for qualified leads (waterfall)</label>
      <button className={primaryBtn} disabled={saving} onClick={save}>{saving ? "Saving…" : "Save settings"}</button>
    </Card>
  );
}
