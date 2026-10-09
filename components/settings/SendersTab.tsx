import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  LuChevronDown, LuCircleCheck, LuKeyRound, LuMail, LuPause, LuPencil, LuPlay, LuPlus, LuSend, LuSettings, LuTrash2, LuTrendingUp,
  LuTriangleAlert, LuUserPlus, LuCheck, LuX,
} from "react-icons/lu";
import { RiLinkedinBoxFill } from "react-icons/ri";
import { useDismiss } from "@/components/agents/leads/Listbox";
import Confirm from "@/components/contacts/Confirm";
import LinkedInAccountDrawer from "@/components/agents/settings/LinkedInAccountDrawer";
import EmailSenderDrawer, { warmup } from "@/components/agents/settings/EmailSenderDrawer";

/**
 * Settings → Sender accounts: every LinkedIn seat and mailbox the workspace sends from, with
 * today's limits at a glance and a side panel for each one's settings & limits. Adding and
 * signing in reuse the existing dialogs (passed in as callbacks).
 */

export interface LiRow {
  id: string; name: string; email: string | null; is_authenticated: number; daily_connection_limit: number | null; daily_message_limit: number | null;
  proxy_url: string | null; created_at: string;
}
export interface MailRow {
  id: string; name: string | null; from_email: string; provider: string | null; is_verified: number; daily_email_limit: number | null;
  ramp_up_enabled: number | null; ramp_start_date: string | null; paused_at: string | null; paused_reason: string | null; created_at: string; sent_today?: number;
}

const card = "rounded-[16px] border border-[var(--border-subtle)] bg-base-100";
const row = "flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[14px] border border-[var(--border-subtle)] bg-primary/[0.03] px-6 py-4 transition-colors hover:border-[var(--border-strong)]";
const pillBtn = "inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[var(--border-strong)] bg-base-100 px-3.5 text-[15px] text-base-content transition-colors hover:bg-base-200";
const primary = "inline-flex h-12 items-center gap-2 rounded-[10px] bg-primary px-5 text-[16px] font-semibold text-primary-content shadow-[0_6px_16px_-8px_var(--color-primary)] transition-colors hover:bg-[var(--primary-hover)]";
const when = (iso: string) => { const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`); return Number.isNaN(d.getTime()) ? "" : format(d, "MMM d, yyyy"); };

function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span role="tooltip" className="pointer-events-none invisible absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-[320px] -translate-x-1/2 rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-3 py-2 text-[14px] font-normal text-base-content opacity-0 shadow-[var(--shadow-overlay)] transition-opacity group-hover/tip:visible group-hover/tip:opacity-100">{text}</span>
    </span>
  );
}

function Stat({ icon, text, tip }: { icon: React.ReactNode; text: string; tip: string }) {
  return <Tip text={tip}><span className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-base-200 px-2.5 text-[14px] tabular-nums text-base-content/70">{icon}{text}</span></Tip>;
}

/** Account name with a pencil to rename it in place. */
function Rename({ name, onSave }: { name: string; onSave: (v: string) => Promise<boolean> }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(name);
  if (!edit) return (
    <span className="flex items-center gap-2">
      <span className="truncate text-[17px] font-medium text-base-content">{name}</span>
      <button type="button" onClick={() => { setV(name); setEdit(true); }} aria-label={`Rename ${name}`} className="text-base-content/40 hover:text-base-content"><LuPencil size={15} /></button>
    </span>
  );
  return (
    <form className="flex items-center gap-1.5" onSubmit={async (e) => { e.preventDefault(); if (v.trim() && (await onSave(v.trim()))) setEdit(false); }}>
      <input autoFocus value={v} maxLength={80} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEdit(false)} aria-label="Account name"
        onFocus={(e) => e.currentTarget.select()} className="h-9 w-[220px] rounded-[8px] border border-primary/50 bg-base-100 px-3 text-[16px] outline-none ring-2 ring-[var(--ring)]" />
      <button type="submit" aria-label="Save name" className="flex h-9 w-9 items-center justify-center rounded-[8px] text-success hover:bg-success/10"><LuCheck size={18} /></button>
      <button type="button" onClick={() => setEdit(false)} aria-label="Cancel" className="flex h-9 w-9 items-center justify-center rounded-[8px] text-base-content/50 hover:bg-base-200"><LuX size={17} /></button>
    </form>
  );
}

function ProviderMark({ provider, email }: { provider: string | null; email: string }) {
  const p = (provider ?? "").toLowerCase();
  const google = p.includes("gmail") || p.includes("google") || /@gmail\.com$/i.test(email);
  const ms = p.includes("outlook") || p.includes("microsoft") || /@(outlook|hotmail|live)\./i.test(email);
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-base-200 text-[18px] font-bold" style={{ color: google ? "#ea4335" : ms ? "#0078d4" : undefined }}>
      {google ? "G" : ms ? "O" : <LuMail size={19} className="text-base-content/60" />}
    </span>
  );
}

export default function SendersTab({ onAddLinkedIn, onAuthLinkedIn, onGmail, onSmtp, onEditCredentials, reloadKey }: {
  onAddLinkedIn: () => void; onAuthLinkedIn: (a: LiRow) => void; onGmail: () => void; onSmtp: () => void; onEditCredentials: (m: MailRow) => void; reloadKey: number;
}) {
  const [li, setLi] = useState<LiRow[] | null>(null);
  const [mail, setMail] = useState<MailRow[] | null>(null);
  const [drawer, setDrawer] = useState<{ kind: "li" | "mail"; id: string } | null>(null);
  const [removing, setRemoving] = useState<{ kind: "li"; a: LiRow } | { kind: "mail"; m: MailRow } | null>(null);
  const [connectMenu, setConnectMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(connectMenu, [menuRef], () => setConnectMenu(false));

  const load = useCallback(() => {
    fetch("/api/accounts").then((r) => r.json()).then(setLi).catch(() => toast.error("Could not load LinkedIn accounts"));
    fetch("/api/email-accounts").then((r) => r.json()).then(setMail).catch(() => toast.error("Could not load mailboxes"));
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  async function renameLi(a: LiRow, name: string) {
    const r = await fetch(`/api/accounts/${a.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    if (!r.ok) { toast.error((await r.json().catch(() => ({}))).error ?? "Could not rename"); return false; }
    setLi((cur) => cur?.map((x) => (x.id === a.id ? { ...x, name } : x)) ?? null);
    toast.success("Account renamed");
    return true;
  }

  async function togglePause(m: MailRow) {
    const paused = !m.paused_at;
    const r = await fetch(`/api/email-accounts/${m.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paused }) });
    if (!r.ok) { toast.error("Could not update the mailbox"); return; }
    toast.success(paused ? "Mailbox paused — it won't send until resumed" : "Mailbox resumed");
    load();
  }

  async function remove() {
    if (!removing) return;
    const url = removing.kind === "li" ? `/api/accounts/${removing.a.id}` : `/api/email-accounts/${removing.m.id}`;
    const r = await fetch(url, { method: "DELETE" });
    if (!r.ok) {
      const d = await r.json().catch(() => ({})) as { error?: string; message?: string; campaigns?: Array<{ name: string }> };
      const names = (d.campaigns ?? []).map((c) => c.name).join(", ");
      toast.error(`${d.message ?? d.error ?? "Could not remove"}${names ? ` (${names})` : ""}`);
      return;
    }
    toast.success(removing.kind === "li" ? `${removing.a.name} removed` : `${removing.m.from_email} removed`);
    setRemoving(null);
    load();
  }

  return (
    <section className={card}>
      <div className="border-b border-[var(--border-subtle)] px-8 py-6">
        <div role="heading" aria-level={2} className="text-[24px] font-semibold text-base-content">Senders Accounts</div>
        <div className="mt-1.5 text-[17px] text-base-content/65">Manage the LinkedIn and email accounts you send from</div>
      </div>

      <div className="space-y-7 px-8 py-7">
        {/* LinkedIn */}
        <div className={`${card} p-7`}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3"><RiLinkedinBoxFill size={32} style={{ color: "#3f2bd1" }} /><div className="text-[22px] font-semibold">LinkedIn Accounts ({li?.length ?? 0})</div></div>
            <button type="button" onClick={onAddLinkedIn} className={primary}><LuPlus size={20} />Add LinkedIn Account</button>
          </div>
          <div className="mt-3 text-[16px] text-base-content/70">Manage your LinkedIn account connections and monitor their status.</div>
          <div className="mt-5 space-y-3">
            {li === null ? <div className="h-20 animate-pulse rounded-[14px] bg-base-200/60" /> : !li.length ? (
              <div className="rounded-[14px] border border-dashed border-[var(--border-strong)] px-6 py-10 text-center text-[16px] text-base-content/55">No LinkedIn accounts yet — add one to start reaching out.</div>
            ) : li.map((a) => (
              <div key={a.id} className={row}>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#f29a6b] to-[#d4553a] text-[16px] font-semibold text-white">{(a.name || "?")[0].toUpperCase()}</span>
                <div className="min-w-0">
                  <Rename name={a.name} onSave={(v) => renameLi(a, v)} />
                  {a.email && <div className="truncate text-[14px] text-base-content/55">{a.email}</div>}
                </div>
                <Tip text="Quotas, schedule and proxy"><button type="button" onClick={() => setDrawer({ kind: "li", id: a.id })} className={pillBtn}>Settings &amp; Limits</button></Tip>
                {a.is_authenticated ? <>
                  <Stat icon={<LuUserPlus size={15} />} text={`${a.daily_connection_limit ?? 0}/day`} tip="Connection requests per day" />
                  <Stat icon={<LuSend size={14} />} text={`${a.daily_message_limit ?? 0}/day`} tip="Messages per day" />
                </> : null}
                {!a.proxy_url && <Tip text="No proxy: LinkedIn sees this server's IP. Add one in Settings & Limits → Advanced parameters."><LuTriangleAlert size={20} className="text-[#e5484d]" aria-label="No proxy set" /></Tip>}
                <div className="ml-auto flex items-center gap-3">
                  {a.is_authenticated ? (
                    <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-success/12 px-3.5 text-[15px] font-medium text-[#1f8a4c]"><LuCircleCheck size={17} />Connected</span>
                  ) : (
                    <>
                      <span className="text-[16px] text-base-content">Not connected</span>
                      <button type="button" onClick={() => onAuthLinkedIn(a)} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-primary px-4 text-[15px] font-semibold text-primary-content hover:bg-[var(--primary-hover)]"><LuKeyRound size={16} />Connect account</button>
                    </>
                  )}
                  {!!a.is_authenticated && <Tip text="Sign in again (e.g. after a LinkedIn security check)"><button type="button" onClick={() => onAuthLinkedIn(a)} aria-label={`Reconnect ${a.name}`} className="flex h-9 w-9 items-center justify-center rounded-[8px] text-base-content/50 hover:bg-base-200 hover:text-base-content"><LuKeyRound size={17} /></button></Tip>}
                  <Tip text="Remove this account"><button type="button" onClick={() => setRemoving({ kind: "li", a })} aria-label={`Remove ${a.name}`} className="flex h-9 w-9 items-center justify-center rounded-[8px] hover:bg-[#ef4444]/10" style={{ color: "#ef4444" }}><LuTrash2 size={17} /></button></Tip>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Mailboxes */}
        <div className={`${card} p-7`}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3"><LuMail size={30} style={{ color: "#e5484d" }} /><div className="text-[22px] font-semibold">Mailboxes ({mail?.length ?? 0})</div></div>
            <div ref={menuRef} className="relative">
              <button type="button" onClick={() => setConnectMenu((v) => !v)} aria-expanded={connectMenu} className={primary}><LuMail size={19} />Connect Mailbox<LuChevronDown size={18} className={`transition-transform ${connectMenu ? "rotate-180" : ""}`} /></button>
              {connectMenu && (
                <div className="wizard-rise absolute right-0 top-full z-30 mt-2 w-[300px] rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-1.5 shadow-[var(--shadow-overlay)]">
                  <button type="button" onClick={() => { setConnectMenu(false); onGmail(); }} className="flex w-full items-start gap-3 rounded-[8px] px-3 py-2.5 text-left hover:bg-base-200">
                    <span className="mt-0.5 text-[18px] font-bold" style={{ color: "#ea4335" }}>G</span>
                    <span><span className="block text-[15px] font-medium">Gmail</span><span className="block text-[13px] text-base-content/55">With an app password; sending and inbox are verified first</span></span>
                  </button>
                  <button type="button" onClick={() => { setConnectMenu(false); onSmtp(); }} className="flex w-full items-start gap-3 rounded-[8px] px-3 py-2.5 text-left hover:bg-base-200">
                    <LuMail size={18} className="mt-0.5 text-base-content/60" />
                    <span><span className="block text-[15px] font-medium">Other SMTP / IMAP</span><span className="block text-[13px] text-base-content/55">Outlook, Zoho, your own mail server…</span></span>
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="mt-3 text-[16px] text-base-content/70">Connect your email accounts to send outreach messages directly from your inbox.</div>
          <div className="mt-5 space-y-3">
            {mail === null ? <div className="h-20 animate-pulse rounded-[14px] bg-base-200/60" /> : !mail.length ? (
              <div className="rounded-[14px] border border-dashed border-[var(--border-strong)] px-6 py-10 text-center text-[16px] text-base-content/55">No mailboxes yet — connect one to send emails.</div>
            ) : mail.map((m) => {
              const ramp = m.ramp_up_enabled ? warmup(m.daily_email_limit ?? 50, m.ramp_start_date) : null;
              const limit = ramp ? ramp.todayLimit : m.daily_email_limit ?? 50;
              const status = m.paused_at ? { t: "Paused", cls: "bg-warning/15 text-[#a16207]" } : m.is_verified ? { t: "Connected", cls: "bg-success/12 text-[#1f8a4c]" } : { t: "Not verified", cls: "bg-base-200 text-base-content/60" };
              return (
                <div key={m.id} className={row}>
                  <ProviderMark provider={m.provider} email={m.from_email} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[17px] font-medium text-base-content">{m.from_email}</span>
                      <Tip text={m.paused_reason ?? (m.is_verified ? "Sending and inbox verified" : "Not verified yet — test it from Credentials")}><span className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[13px] font-medium ${status.cls}`}>{status.t}</span></Tip>
                    </div>
                    <div className="text-[14px] text-base-content/55">{(m.provider ?? "SMTP").replace(/^\w/, (c) => c.toUpperCase())} · Connected {when(m.created_at)}</div>
                  </div>
                  <span className="hidden h-8 w-px bg-[var(--border-subtle)] sm:block" />
                  <Stat icon={<LuSend size={14} />} text={`${m.sent_today ?? 0}/${limit} today`} tip="Campaign emails sent today / today's limit" />
                  {ramp && !ramp.done && <Tip text={`Warm-up day ${ramp.day} of ${ramp.total}: the daily limit grows by 2 each day`}><span className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-primary/30 bg-primary/[0.06] px-2.5 text-[13px] text-primary"><LuTrendingUp size={14} />Ramping up</span></Tip>}
                  <div className="ml-auto flex flex-wrap items-center gap-1">
                    <button type="button" onClick={() => void togglePause(m)} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] px-3 text-[15px] text-base-content/75 hover:bg-base-200 hover:text-base-content">{m.paused_at ? <><LuPlay size={16} />Resume</> : <><LuPause size={16} />Pause</>}</button>
                    <button type="button" onClick={() => onEditCredentials(m)} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] px-3 text-[15px] text-base-content/75 hover:bg-base-200 hover:text-base-content"><LuKeyRound size={16} />Credentials</button>
                    <button type="button" onClick={() => setRemoving({ kind: "mail", m })} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] px-3 text-[15px] hover:bg-[#ef4444]/10" style={{ color: "#ef4444" }}><LuTrash2 size={16} />Remove</button>
                    <button type="button" onClick={() => setDrawer({ kind: "mail", id: m.id })} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] px-3 text-[15px] font-medium text-base-content hover:bg-base-200"><LuSettings size={17} />Settings &amp; Limits</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {drawer?.kind === "li" && <LinkedInAccountDrawer accountId={drawer.id} onClose={() => setDrawer(null)} onSaved={load} />}
      {drawer?.kind === "mail" && <EmailSenderDrawer emailAccountId={drawer.id} onClose={() => setDrawer(null)} onSaved={load} />}
      {removing && (
        <Confirm title={removing.kind === "li" ? `Remove ${removing.a.name}?` : `Remove ${removing.m.from_email}?`} action="Remove" onCancel={() => setRemoving(null)} onConfirm={remove}
          text={removing.kind === "li"
            ? <>The account and its campaign run history are deleted. Accounts used by running campaigns can&apos;t be removed — pause those first. To keep its history, disconnect it in Settings &amp; Limits instead.</>
            : <>Campaigns stop sending from this mailbox and its stored credentials are deleted.</>} />
      )}
    </section>
  );
}
