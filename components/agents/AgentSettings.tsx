import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, Field, inputCls, primaryBtn } from "@/components/agents/ui";

interface Option { id: string; name?: string; email?: string; from_email?: string; is_authenticated?: number }

export interface AgentForm {
  name: string; mode: string; min_score: number; fit_weight: number; daily_lead_cap: number; autopilot_delay_minutes: number;
  linkedin_account_id: string | null; email_account_id: string | null; workflow_id: string | null; booking_url: string | null; enrich_emails: number;
  goal: string; tone: string; exclude_first_degree: number;
}

const FORM_KEYS = ["name", "mode", "min_score", "fit_weight", "daily_lead_cap", "autopilot_delay_minutes", "linkedin_account_id", "email_account_id", "booking_url", "enrich_emails", "goal", "tone", "exclude_first_degree"] as const;

/** Agent settings: senders, thresholds and review mode. The sequence is edited on the Campaign tab. */
export default function AgentSettings({ agentId, initial, onSaved }: { agentId: string; initial: AgentForm; onSaved: () => void }) {
  const [f, setF] = useState(initial);
  const [opts, setOpts] = useState<{ accounts: Option[]; email: Option[] }>({ accounts: [], email: [] });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    Promise.all([fetch("/api/accounts"), fetch("/api/email-accounts")].map((p) => p.then((r) => r.json()).catch(() => [])))
      .then(([accounts, email]) => setOpts({ accounts, email }));
  }, []);

  async function save() {
    setSaving(true);
    const r = await fetch(`/api/agents/${agentId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      // Only this form's fields: status and outreach have their own controls.
      body: JSON.stringify({ ...Object.fromEntries(FORM_KEYS.map((k) => [k, f[k]])), min_score: Number(f.min_score), fit_weight: Number(f.fit_weight), daily_lead_cap: Number(f.daily_lead_cap), autopilot_delay_minutes: Number(f.autopilot_delay_minutes), enrich_emails: !!f.enrich_emails, exclude_first_degree: !!f.exclude_first_degree, booking_url: f.booking_url || null }),
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
        <Field label="Review" hint="Review: you approve each lead before it is sent. Autopilot: drafts send after the delay unless you reject them on the lead.">
          <select className={inputCls} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="copilot">Review each lead</option><option value="autopilot">Autopilot</option></select>
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
        <Field label="Meeting link"><input className={inputCls} value={f.booking_url ?? ""} onChange={(e) => setF({ ...f, booking_url: e.target.value })} placeholder="https://cal.com/you" /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Min lead score"><input type="number" min={0} max={100} className={inputCls} value={f.min_score} onChange={(e) => setF({ ...f, min_score: Number(e.target.value) })} /></Field>
        <Field label="Fit weight" hint="0 = intent only, 1 = fit only"><input type="number" min={0} max={1} step={0.1} className={inputCls} value={f.fit_weight} onChange={(e) => setF({ ...f, fit_weight: Number(e.target.value) })} /></Field>
        <Field label="Leads per day"><input type="number" min={1} max={500} className={inputCls} value={f.daily_lead_cap} onChange={(e) => setF({ ...f, daily_lead_cap: Number(e.target.value) })} /></Field>
        <Field label="Autopilot delay (min)"><input type="number" min={0} className={inputCls} value={f.autopilot_delay_minutes} onChange={(e) => setF({ ...f, autopilot_delay_minutes: Number(e.target.value) })} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Campaign goal"><select className={inputCls} value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })}><option value="conversations">Start conversations</option><option value="meetings">Book meetings</option></select></Field>
        <Field label="Message tone"><select className={inputCls} value={f.tone} onChange={(e) => setF({ ...f, tone: e.target.value })}><option value="professional">Professional</option><option value="conversational">Conversational</option><option value="direct">Direct</option></select></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="checkbox checkbox-sm" checked={!!f.exclude_first_degree} onChange={(e) => setF({ ...f, exclude_first_degree: e.target.checked ? 1 : 0 })} /> Exclude 1st-degree connections</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="checkbox checkbox-sm" checked={!!f.enrich_emails} onChange={(e) => setF({ ...f, enrich_emails: e.target.checked ? 1 : 0 })} /> Find emails for qualified leads (waterfall)</label>
      <button className={primaryBtn} disabled={saving} onClick={save}>{saving ? "Saving…" : "Save settings"}</button>
    </Card>
  );
}
