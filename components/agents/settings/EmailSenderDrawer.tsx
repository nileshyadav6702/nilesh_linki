import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RiCloseCircleLine, RiInformationLine, RiLock2Line, RiMailFill, RiPlayCircleLine, RiSave3Line } from "react-icons/ri";
import { SideDrawer } from "@/components/agents/campaign/kit";
import { inputCls, primaryBtn, Toggle } from "@/components/agents/ui";
import SignatureEditor, { plainLength, sanitizeSignature, signatureToHtml, SIGNATURE_MAX } from "@/components/agents/settings/SignatureEditor";

/** Settings & limits of one mailbox used by an agent: quota, warm-up, tracking, unsubscribe link and signature. */

interface EmailAccount {
  id: string; from_email: string | null; from_name: string | null; daily_email_limit: number | null; signature: string | null;
  ramp_up_enabled: number | null; ramp_start_date: string | null; track_opens?: number | null; include_unsubscribe?: number | null;
  sent_today?: number | null; effective_limit?: number | null;
}

interface Form { from_name: string; daily_email_limit: number; ramp_up_enabled: boolean; ramp_start_date: string | null; track_opens: boolean; include_unsubscribe: boolean; signature: string }

const today = () => new Date().toISOString().slice(0, 10);

/** Same rule as effectiveEmailLimit (lib/linkedin/campaign/schedule.ts): 2 more per day, up to the target. */
export function warmup(limit: number, start: string | null) {
  const total = Math.max(1, Math.ceil(limit / 2));
  const t = start ? Date.parse(start) : NaN;
  const day = Number.isNaN(t) ? 1 : Math.max(1, Math.floor((Date.now() - t) / 86_400_000) + 1);
  return { day: Math.min(day, total), total, todayLimit: Math.min(limit, 2 * day), done: day >= total };
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 flex items-start gap-1.5 text-[13px] text-base-content/50"><RiInformationLine size={14} className="mt-px shrink-0" />{children}</p>;
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[17px] font-semibold text-base-content">{title}</h3>
      {subtitle && <p className="mt-0.5 text-[15px] text-base-content/60">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function EmailSenderDrawer({ emailAccountId, onClose, onSaved }: { emailAccountId: string; onClose: () => void; onSaved: () => void }) {
  const [acct, setAcct] = useState<EmailAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [initial, setInitial] = useState<Form | null>(null);
  const [initialHtml, setInitialHtml] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/email-accounts/${emailAccountId}`)
      .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Could not load this mailbox"); return r.json(); })
      .then((a: EmailAccount) => {
        if (!alive) return;
        const html = signatureToHtml(a.signature);
        const f: Form = {
          from_name: a.from_name ?? "", daily_email_limit: a.daily_email_limit ?? 50, ramp_up_enabled: !!a.ramp_up_enabled,
          ramp_start_date: a.ramp_start_date, track_opens: !!a.track_opens, include_unsubscribe: !!a.include_unsubscribe, signature: html,
        };
        setAcct(a); setForm(f); setInitial(f); setInitialHtml(html);
      })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [emailAccountId]);

  const ramp = useMemo(() => (form ? warmup(form.daily_email_limit, form.ramp_start_date) : null), [form]);
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

  async function save() {
    if (!form || !initial) return;
    if (plainLength(form.signature) > SIGNATURE_MAX) return toast.error(`The signature is over ${SIGNATURE_MAX} characters`);
    const next: Record<string, unknown> = {};
    if (form.from_name.trim() !== initial.from_name) next.from_name = form.from_name.trim() || null;
    if (form.daily_email_limit !== initial.daily_email_limit) next.daily_email_limit = form.daily_email_limit;
    if (form.ramp_up_enabled !== initial.ramp_up_enabled) next.ramp_up_enabled = form.ramp_up_enabled;
    if (form.ramp_start_date !== initial.ramp_start_date) next.ramp_start_date = form.ramp_start_date;
    if (form.track_opens !== initial.track_opens) next.track_opens = form.track_opens;
    if (form.include_unsubscribe !== initial.include_unsubscribe) next.include_unsubscribe = form.include_unsubscribe;
    const sig = sanitizeSignature(form.signature);
    if (sig !== sanitizeSignature(initial.signature)) next.signature = plainLength(sig) ? sig : null;
    if (Object.keys(next).length === 0) { onClose(); return; }
    setBusy(true);
    const r = await fetch(`/api/email-accounts/${emailAccountId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
    setBusy(false);
    if (!r.ok) return toast.error((await r.json().catch(() => ({}))).error ?? "Could not save the mailbox settings");
    toast.success("Email sender saved");
    onSaved();
    onClose();
  }

  const title = (
    <span className="flex flex-col">
      <span className="flex items-center gap-2">Email Sender <RiMailFill size={20} className="text-[#ea4335]" /></span>
      {acct?.from_email && <span className="font-sans text-[15px] font-normal text-base-content/55">{acct.from_email}</span>}
    </span>
  );

  return (
    <SideDrawer title={title} onClose={onClose} width={720} footer={
      <>
        <button type="button" onClick={onClose} className="px-3 text-[15px] font-medium text-base-content/70 hover:text-base-content">Cancel</button>
        <button type="button" className={primaryBtn} disabled={!form || busy} onClick={save}><RiSave3Line size={16} /> {busy ? "Saving…" : "Save"}</button>
      </>
    }>
      {error ? <p className="rounded-[10px] bg-error/10 px-4 py-3 text-[15px] text-error">{error}</p>
        : !form || !acct || !ramp ? <p className="text-[15px] text-base-content/45">Loading…</p> : (
        <div className="space-y-7">
          <section>
            <label className="text-[17px] font-semibold text-base-content" htmlFor="es-limit">
              Emails limit per day <span className="text-[15px] font-normal text-base-content/50">(usage today: <span className="font-semibold text-success">{acct.sent_today ?? 0}</span> / {form.ramp_up_enabled ? ramp.todayLimit : form.daily_email_limit})</span>
            </label>
            <input id="es-limit" type="number" min={1} max={500} className={`${inputCls} !h-12 !text-[16px] mt-2 ${form.ramp_up_enabled ? "!bg-primary/[0.07] text-base-content/50" : ""}`}
              disabled={form.ramp_up_enabled} value={form.ramp_up_enabled ? ramp.todayLimit : form.daily_email_limit}
              onChange={(e) => set({ daily_email_limit: Math.min(500, Math.max(1, Math.round(Number(e.target.value) || 1))) })} />
            {form.ramp_up_enabled && <p className="mt-2 flex items-center gap-1.5 text-[13px] text-base-content/50"><RiLock2Line size={13} /> Managed by warm-up. Stop warm-up to set a custom quota.</p>}
          </section>

          <section>
            <label className="text-[17px] font-semibold text-base-content" htmlFor="es-name">Sender name</label>
            <input id="es-name" className={`${inputCls} !h-12 !text-[16px] mt-2`} value={form.from_name} maxLength={120} placeholder="Your name" onChange={(e) => set({ from_name: e.target.value })} />
            <p className="mt-2 text-[13px] text-base-content/50">Displayed as the &quot;From&quot; name in your recipients&apos; inbox.</p>
          </section>

          <Section title="Open Tracking" subtitle="Track when recipients open your emails using a tracking pixel.">
            <div className="flex items-center gap-3">
              <Toggle on={form.track_opens} onChange={() => set({ track_opens: !form.track_opens })} label="Open tracking" />
              <span className="text-[15px] font-medium text-base-content">{form.track_opens ? "Enabled" : "Disabled"}</span>
            </div>
            <Note>Note: tracking may be unreliable if the recipient&apos;s email client blocks tracking pixels. Turning it on sends emails as HTML.</Note>
          </Section>

          <Section title="Unsubscribe Link" subtitle="Add an unsubscribe link to campaign emails sent with this sender.">
            <div className="flex items-center gap-3">
              <Toggle on={form.include_unsubscribe} onChange={() => set({ include_unsubscribe: !form.include_unsubscribe })} label="Unsubscribe link" />
              <span className="text-[15px] font-medium text-base-content">{form.include_unsubscribe ? "Included" : "Not included"}</span>
            </div>
            <Note>Including an unsubscribe link can improve deliverability and may be required for marketing emails in some regions.</Note>
          </Section>

          <div className="rounded-[12px] border border-[var(--border-subtle)] p-5">
            <h3 className="text-[17px] font-semibold text-base-content">Email Warm-up</h3>
            <p className="mt-1 text-[15px] text-base-content/60">Automatically ramps your daily quota from 2 to {form.daily_email_limit} over {ramp.total} day{ramp.total === 1 ? "" : "s"} to build sender reputation and avoid spam filters.</p>
            {form.ramp_up_enabled ? (
              <>
                <div className="mt-4 flex items-center justify-between text-[15px] text-base-content/70">
                  <span>Day {ramp.day} of {ramp.total}{ramp.done ? " · complete" : ""}</span>
                  <span className="tabular-nums">{ramp.todayLimit} / {form.daily_email_limit} emails/day</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-primary/15">
                  <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.max(4, Math.round((ramp.todayLimit / Math.max(1, form.daily_email_limit)) * 100))}%` }} />
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
                  <label className="flex items-center gap-2 text-[15px] text-base-content/70">
                    Warm-up target
                    <input type="number" min={2} max={500} className={`${inputCls} !h-10 !w-24 !text-[16px]`} value={form.daily_email_limit}
                      onChange={(e) => set({ daily_email_limit: Math.min(500, Math.max(2, Math.round(Number(e.target.value) || 2))) })} />
                    emails/day
                  </label>
                  <button type="button" onClick={() => set({ ramp_up_enabled: false })}
                    className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-error/60 px-4 text-[15px] font-medium text-error hover:bg-error/5">
                    <RiCloseCircleLine size={16} /> Stop ramp-up
                  </button>
                </div>
              </>
            ) : (
              <div className="mt-4 flex justify-center">
                <button type="button" onClick={() => set({ ramp_up_enabled: true, ramp_start_date: today() })}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-primary/60 px-4 text-[15px] font-medium text-primary hover:bg-primary/5">
                  <RiPlayCircleLine size={16} /> Start ramp-up
                </button>
              </div>
            )}
          </div>

          <Section title="Email Signature" subtitle="Add a reusable signature to campaign emails sent with this sender.">
            <SignatureEditor initialHtml={initialHtml} onChange={(html) => set({ signature: html })} />
          </Section>
        </div>
      )}
    </SideDrawer>
  );
}
