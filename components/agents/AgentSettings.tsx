import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  RiArrowDownSLine, RiCheckboxCircleFill, RiDeleteBinLine, RiErrorWarningLine, RiInformationLine, RiLineChartLine, RiLinkedinBoxFill,
  RiMailLine, RiSave3Line, RiSendPlaneLine, RiSettings3Line, RiUserAddLine,
} from "react-icons/ri";
import { Avatar, Field, inputCls, Panel, Pill, primaryBtn } from "@/components/agents/ui";
import { Tip } from "@/components/agents/campaign/kit";
import { parseDays } from "@/components/agents/settings/kit";
import LinkedInAccountDrawer from "@/components/agents/settings/LinkedInAccountDrawer";
import EmailSenderDrawer from "@/components/agents/settings/EmailSenderDrawer";

export interface AgentForm {
  name: string; mode: string; min_score: number; fit_weight: number; daily_lead_cap: number; autopilot_delay_minutes: number;
  linkedin_account_id: string | null; email_account_id: string | null; workflow_id: string | null; booking_url: string | null; enrich_emails: number;
  goal: string; tone: string; exclude_first_degree: number; reply_instructions?: string | null;
  language?: string | null; split_messages?: number;
}

interface LinkedInAcc {
  id: string; name: string | null; email: string | null; is_authenticated: number; daily_connection_limit: number | null; daily_message_limit: number | null; working_days: string | null;
  weekly_connection_limit?: number | null; weekly_message_limit?: number | null;
}
interface EmailAcc { id: string; from_email: string | null; from_name: string | null; daily_email_limit: number | null; ramp_up_enabled: number | null; sent_today?: number; effective_limit?: number }
interface Option { id: string; name?: string | null; email?: string | null; from_email?: string | null; from_name?: string | null; is_authenticated?: number }

/** Section heading: large and plain, no icon tile. */
const H2 = "text-[24px] font-semibold leading-tight text-base-content";

/** Fields the bottom Save bar owns. Senders save the moment they are picked or removed. */
const EDITABLE = ["name", "mode", "min_score", "fit_weight", "daily_lead_cap", "autopilot_delay_minutes", "enrich_emails"] as const;
type Editable = Pick<AgentForm, (typeof EDITABLE)[number]>;
const pick = (a: AgentForm): Editable => Object.fromEntries(EDITABLE.map((k) => [k, a[k]])) as Editable;

/** Agent settings: name, senders (with their own drawers), review mode and scoring thresholds. */
export default function AgentSettings({ agentId, initial, onSaved }: { agentId: string; initial: AgentForm; onSaved: () => void }) {
  const [f, setF] = useState<Editable>(() => pick(initial));
  const [base, setBase] = useState<Editable>(() => pick(initial));
  const [li, setLi] = useState<LinkedInAcc | null>(null);
  const [mail, setMail] = useState<EmailAcc | null>(null);
  const [drawer, setDrawer] = useState<"linkedin" | "email" | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  // Rows render only for the agent's current sender ids, so a stale row from a removed sender never shows.
  const loadSenders = useCallback(() => {
    if (initial.linkedin_account_id) fetch(`/api/accounts/${initial.linkedin_account_id}`).then((r) => (r.ok ? r.json() : null)).then(setLi).catch(() => setLi(null));
    if (initial.email_account_id) fetch(`/api/email-accounts/${initial.email_account_id}`).then((r) => (r.ok ? r.json() : null)).then(setMail).catch(() => setMail(null));
  }, [initial.linkedin_account_id, initial.email_account_id]);
  useEffect(() => { loadSenders(); }, [loadSenders]);
  const liRow = li && li.id === initial.linkedin_account_id ? li : null;
  const mailRow = mail && mail.id === initial.email_account_id ? mail : null;

  const dirty = EDITABLE.some((k) => String(f[k]) !== String(base[k]));

  async function patch(body: Record<string, unknown>, ok: string): Promise<boolean> {
    const r = await fetch(`/api/agents/${agentId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { toast.error((await r.json().catch(() => ({}))).error ?? "Could not save"); return false; }
    toast.success(ok);
    return true;
  }

  async function save() {
    if (!f.name.trim()) return toast.error("The agent needs a name");
    setSaving(true);
    const ok = await patch({
      name: f.name.trim(), mode: f.mode, min_score: Number(f.min_score), fit_weight: Number(f.fit_weight),
      daily_lead_cap: Number(f.daily_lead_cap), autopilot_delay_minutes: Number(f.autopilot_delay_minutes), enrich_emails: !!f.enrich_emails,
    }, "Agent saved");
    setSaving(false);
    if (ok) { setBase(f); onSaved(); }
  }

  async function setSender(kind: "linkedin" | "email", id: string | null) {
    const field = kind === "linkedin" ? "linkedin_account_id" : "email_account_id";
    if (!id && !confirm(`Remove this ${kind === "linkedin" ? "LinkedIn" : "email"} sender from the agent? The account itself stays connected.`)) return;
    if (await patch({ [field]: id }, id ? "Sender added" : "Sender removed")) onSaved();
  }

  const activeDays = parseDays(liRow?.working_days).size;
  const connLimit = liRow?.daily_connection_limit ?? 20;
  const msgLimit = liRow?.daily_message_limit ?? 40;

  return (
    <div className="space-y-6 pb-24">
      <Panel className="px-8 py-8">
        <h2 className={H2}>Agent Name</h2>
        <input className={`${inputCls} mt-5 max-w-xl !h-12 !text-[17px]`} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Panel>

      <Panel className="px-8 py-8">
        <h2 className={H2}>Senders</h2>
        <div className="mt-5 space-y-3">
          {initial.linkedin_account_id ? (
            <SenderRow
              lead={<Avatar name={liRow?.name || liRow?.email || "L"} size={40} />}
              name={liRow?.name || liRow?.email || "LinkedIn account"} kind="LinkedIn sender"
              status={liRow ? (liRow.is_authenticated ? <Pill tone="success"><RiLinkedinBoxFill size={12} /> Connected</Pill> : <Pill tone="error"><RiErrorWarningLine size={12} /> Logged out</Pill>) : null}
              stats={liRow ? [
                <><RiUserAddLine size={17} className="text-primary" /> {connLimit}/day · {liRow.weekly_connection_limit ?? connLimit * activeDays}/wk</>,
                <><RiSendPlaneLine size={17} className="text-primary" /> {msgLimit}/day · {liRow.weekly_message_limit ?? msgLimit * activeDays}/wk</>,
              ] : []}
              onRemove={() => setSender("linkedin", null)} onSettings={() => setDrawer("linkedin")} />
          ) : <SenderPicker kind="linkedin" onPick={(id) => setSender("linkedin", id)} />}

          {initial.email_account_id ? (
            <SenderRow
              lead={<span className="flex h-10 w-10 items-center justify-center rounded-full bg-error/10 text-error"><RiMailLine size={19} /></span>}
              name={mailRow?.from_email || "Email sender"} kind={mailRow?.from_name ? `Email sender · ${mailRow.from_name}` : "Email sender"}
              status={mailRow ? <Pill tone="success"><RiCheckboxCircleFill size={12} /> Connected</Pill> : null}
              stats={mailRow ? [
                <><RiSendPlaneLine size={13} /> {mailRow.sent_today ?? 0}/{mailRow.effective_limit ?? mailRow.daily_email_limit ?? 50} today</>,
                ...(mailRow.ramp_up_enabled ? [<span key="ramp" className="inline-flex items-center gap-1 text-primary"><RiLineChartLine size={13} /> Ramping up</span>] : []),
              ] : []}
              onRemove={() => setSender("email", null)} onSettings={() => setDrawer("email")} />
          ) : <SenderPicker kind="email" onPick={(id) => setSender("email", id)} />}
        </div>
      </Panel>

      <Panel className="px-8 py-8">
        <h2 className={H2}>Review Mode</h2>
        <label className="mt-4 flex cursor-pointer items-start gap-3">
          <input type="checkbox" className="checkbox checkbox-primary mt-1" checked={f.mode === "copilot"} onChange={(e) => setF({ ...f, mode: e.target.checked ? "copilot" : "autopilot" })} />
          <span>
            <span className="block text-[18.5px] text-base-content">Enable Review Mode</span>
            <span className="mt-1 block text-[16px] text-base-content/60">When enabled, you approve each lead&apos;s messages before anything is sent. When off, the agent sends on autopilot after the review delay.</span>
          </span>
        </label>
      </Panel>

      <Panel>
        <button type="button" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced} className="flex w-full items-center justify-between gap-3 px-8 py-7 text-left">
          <span>
            <span className={H2}>Advanced</span>
            <span className="mt-1 block text-[16px] text-base-content/60">Lead scoring, daily lead volume, autopilot delay and email finding.</span>
          </span>
          <RiArrowDownSLine size={20} className={`shrink-0 text-base-content/45 transition-transform ${advanced ? "rotate-180" : ""}`} />
        </button>
        {advanced && (
          <div className="space-y-4 border-t border-[var(--border-subtle)] px-8 py-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Min score to contact" hint="Leads at or above it get emails found and go to outreach. Warm = 60, hot = 80; cooler leads wait for your approval."><input type="number" min={0} max={100} className={inputCls} value={f.min_score} onChange={(e) => setF({ ...f, min_score: Number(e.target.value) })} /></Field>
              <Field label="Leads per day"><input type="number" min={1} max={500} className={inputCls} value={f.daily_lead_cap} onChange={(e) => setF({ ...f, daily_lead_cap: Number(e.target.value) })} /></Field>
              <Field label="Autopilot delay (min)" hint="How long a draft waits for review before autopilot sends it"><input type="number" min={0} className={inputCls} value={f.autopilot_delay_minutes} onChange={(e) => setF({ ...f, autopilot_delay_minutes: Number(e.target.value) })} /></Field>
            </div>
            <label className="flex items-center gap-2 text-[15px]"><input type="checkbox" className="checkbox checkbox-sm checkbox-primary" checked={!!f.enrich_emails} onChange={(e) => setF({ ...f, enrich_emails: e.target.checked ? 1 : 0 })} /> Find emails for qualified leads (waterfall)</label>
          </div>
        )}
      </Panel>

      <div className="sticky bottom-0 z-20 -mx-1 flex justify-end border-t border-[var(--border-subtle)] bg-base-100/95 px-1 py-3 backdrop-blur">
        <button type="button" className={primaryBtn} disabled={!dirty || saving} onClick={save}><RiSave3Line size={16} /> {saving ? "Saving…" : "Save"}</button>
      </div>

      {drawer === "linkedin" && initial.linkedin_account_id && (
        <LinkedInAccountDrawer accountId={initial.linkedin_account_id} agentId={agentId}
          inbox={{ booking_url: initial.booking_url, reply_instructions: initial.reply_instructions ?? null }}
          onClose={() => setDrawer(null)} onSaved={() => { loadSenders(); onSaved(); }} />
      )}
      {drawer === "email" && initial.email_account_id && (
        <EmailSenderDrawer emailAccountId={initial.email_account_id} onClose={() => setDrawer(null)} onSaved={() => { loadSenders(); onSaved(); }} />
      )}
    </div>
  );
}

function SenderRow({ lead, name, kind, status, stats, onRemove, onSettings }: {
  lead: ReactNode; name: string; kind: string; status: ReactNode; stats: ReactNode[]; onRemove: () => void; onSettings: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[12px] border border-[var(--border-subtle)] bg-base-200/40 px-6 py-5">
      {lead}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5"><span className="truncate text-[18px] text-base-content">{name}</span>{status}</div>
        <div className="text-[16px] text-base-content/55">{kind}</div>
      </div>
      {stats.length > 0 && <span className="hidden h-8 w-px bg-[var(--border-subtle)] sm:block" />}
      <div className="flex flex-wrap gap-2">{stats.map((s, i) => <span key={i} className="inline-flex items-center gap-1.5 rounded-[6px] bg-base-200 px-2.5 py-1 text-[16px] tabular-nums text-base-content/70">{s}</span>)}</div>
      <div className="ml-auto flex items-center gap-4">
        <button type="button" onClick={onRemove} className="inline-flex items-center gap-2 text-[16px] text-[#e5484d] hover:underline"><RiDeleteBinLine size={19} /> Remove</button>
        <button type="button" onClick={onSettings} className="inline-flex items-center gap-2 text-[16px] text-base-content hover:text-primary"><RiSettings3Line size={19} /> Settings &amp; Limits</button>
      </div>
    </div>
  );
}

/** Dashed empty slot that opens a short list of the workspace's connected accounts. */
function SenderPicker({ kind, onPick }: { kind: "linkedin" | "email"; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Option[] | null>(null);
  useEffect(() => {
    if (!open || options) return;
    fetch(kind === "linkedin" ? "/api/accounts" : "/api/email-accounts").then((r) => r.json()).then((x) => setOptions(Array.isArray(x) ? x : [])).catch(() => setOptions([]));
  }, [open, options, kind]);
  const label = kind === "linkedin" ? "Select a LinkedIn sender for this campaign" : "Select an email sender for this campaign";
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-center gap-2 rounded-[12px] border border-dashed border-base-content/20 bg-base-100/60 px-5 py-4 text-[15px] text-base-content/55 hover:border-primary/40 hover:text-base-content">
        {kind === "linkedin" ? <RiLinkedinBoxFill size={18} className="text-[#0a66c2]" /> : <RiMailLine size={18} className="text-error" />}
        {label}
        <Tip text={kind === "linkedin" ? "Invitations, messages, visits and likes are sent from this LinkedIn account." : "Email steps are sent from this mailbox. Without one, email steps are skipped."}>
          <RiInformationLine size={15} className="text-primary" />
        </Tip>
      </button>
      {open && (
        <div className="absolute left-1/2 z-30 mt-1 w-80 -translate-x-1/2 rounded-[12px] border border-[var(--border-subtle)] bg-base-100 py-1 shadow-[var(--shadow-overlay)]">
          {options === null ? <p className="px-4 py-3 text-[15px] text-base-content/45">Loading…</p>
            : options.length === 0 ? (
              <p className="px-4 py-3 text-[15px] text-base-content/60">No {kind === "linkedin" ? "LinkedIn account" : "mailbox"} connected yet. <Link href="/settings" className="font-medium text-primary hover:underline">Connect one in Settings</Link></p>
            ) : options.map((o) => (
              <button key={o.id} type="button" onClick={() => { setOpen(false); onPick(o.id); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] hover:bg-base-200">
                {kind === "linkedin" ? <Avatar name={o.name || o.email || "L"} size={28} /> : <RiMailLine size={18} className="text-error" />}
                <span className="min-w-0 flex-1 truncate">{kind === "linkedin" ? (o.name || o.email) : (o.from_email || o.name)}</span>
                {kind === "linkedin" && o.is_authenticated === 0 && <span className="text-[13.5px] text-error">Logged out</span>}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
