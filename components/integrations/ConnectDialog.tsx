import { useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { LuArrowLeftRight, LuCheck, LuInfo, LuLoaderCircle, LuPlus, LuRefreshCw, LuTrash2, LuX } from "react-icons/lu";
import Listbox from "@/components/agents/leads/Listbox";
import AppLogo from "@/components/integrations/AppLogo";
import { OPTION_TEXT, type AppDef, type Field, type OptionKey } from "@/lib/integrations/catalog";
import { BRAND } from "@/lib/brand";

/** Connect / manage one app: credentials (with Verify), the campaign to push into, and sync options. */

export interface AppState {
  app: string; installed: boolean; status: string | null; last_error: string | null; last_synced_at: string | null;
  options: Partial<Record<OptionKey, boolean>>; fields: Record<string, string>; choice_label: string | null;
  stats: { synced: number; pending: number; failed: number };
}
type Hook = { url: string; trigger: "lead" | "reply" };

const input = "h-12 w-full rounded-[10px] border border-[var(--border-strong)] bg-base-100 px-4 text-[16px] outline-none focus:border-primary/60 focus:ring-2 focus:ring-[var(--ring)]";
const link = { color: "#4f2fd0" };

function Check({ on, onChange, title, body, note, nested }: { on: boolean; onChange: (v: boolean) => void; title: string; body: string; note?: string; nested?: boolean }) {
  return (
    <label className={`flex cursor-pointer items-start gap-4 ${nested ? "ml-4 border-l-2 border-[var(--border-subtle)] pl-6" : "rounded-[12px] border border-[var(--border-subtle)] px-5 py-4"}`}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 cursor-pointer accent-[var(--color-primary)]" />
      <span><span className="block text-[17px] font-medium">{title}</span><span className="mt-1 block text-[15px] leading-relaxed text-base-content/65">{body}</span>
        {note && <span className="mt-1.5 block text-[13px] text-base-content/50">{note}</span>}</span>
    </label>
  );
}

export default function ConnectDialog({ app, state, callbackBase, onClose, onChanged }: { app: AppDef; state: AppState | undefined; callbackBase: string; onClose: () => void; onChanged: () => void }) {
  const installed = !!state?.installed;
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(app.fields.map((f) => [f.key, state?.fields[f.key] || f.default || ""])),
    ...(app.key === "webhook" ? { secret: state?.fields.secret ?? "" } : {}),
  }));
  const [options, setOptions] = useState<Partial<Record<OptionKey, boolean>>>(() => installed ? state!.options : Object.fromEntries(app.options.map((o) => [o, o !== "create_on_reply" && o !== "verify_on_import"])));
  const [verified, setVerified] = useState<{ account?: string } | null>(installed && state?.status === "connected" ? {} : null);
  const [choices, setChoices] = useState<Array<{ value: string; label: string }>>([]);
  const [choice, setChoice] = useState<{ value: string; label: string } | null>(null);
  const [hooks, setHooks] = useState<Hook[]>(() => {
    try { const saved = JSON.parse(state?.fields.webhooks ?? "[]") as Hook[]; if (saved.length) return saved; } catch { /* none saved */ }
    return [{ url: "", trigger: "lead" }];
  });
  const [busy, setBusy] = useState<"" | "verify" | "save" | "sync" | "remove">("");
  const keyField = app.fields.find((f) => f.type === "secret" && f.key === "api_key");
  const isWebhook = app.key === "webhook";
  const enrichment = app.category === "enrichment";

  const payload = () => ({ fields: values, options, choice, ...(isWebhook ? { webhooks: hooks.filter((h) => h.url.trim()) } : {}) });
  async function send(method: string, query = "") {
    const r = await fetch(`/api/integrations/${app.key}${query}`, { method, headers: { "Content-Type": "application/json" }, body: method === "DELETE" ? undefined : JSON.stringify(payload()) });
    return { ok: r.ok, d: await r.json().catch(() => ({})) };
  }
  async function verify() {
    setBusy("verify");
    const { ok, d } = await send("POST", "?action=verify");
    setBusy("");
    if (!ok) { toast.error(d.error ?? "Could not verify"); setVerified(null); return; }
    setVerified({ account: d.account });
    if (d.choices) { setChoices(d.choices); if (d.choices.length === 1) setChoice(d.choices[0]); }
    toast.success(d.account ? `Connected to ${d.account}` : "Key verified");
  }
  async function save() {
    setBusy("save");
    const { ok, d } = await send("PUT");
    setBusy("");
    if (!ok) { if (d.choices) setChoices(d.choices); toast.error(d.error ?? "Could not connect"); return; }
    if (d.oauth) { window.location.assign(d.oauth); return; }
    toast.success(installed ? `${app.name} settings saved` : `${app.name} connected`);
    onChanged();
  }
  async function syncNow() {
    setBusy("sync");
    const r = await fetch(`/api/integrations/${app.key}?action=sync`, { method: "POST" });
    const d = await r.json().catch(() => ({}));
    setBusy("");
    if (!r.ok) { toast.error(d.error ?? "Could not sync"); return; }
    toast.success(d.queued ? `${d.queued} lead${d.queued === 1 ? "" : "s"} queued for ${app.name}` : `Everything is already in ${app.name}`);
    onChanged();
  }
  async function remove() {
    if (!window.confirm(`Disconnect ${app.name}? Leads stop syncing; records already in ${app.name} stay there.`)) return;
    setBusy("remove");
    await send("DELETE");
    setBusy("");
    toast.success(`${app.name} disconnected`);
    onChanged();
  }

  const required = app.fields.every((f) => values[f.key]?.trim());
  const needsPick = !!app.pick && !installed && !choice;
  const canSave = (isWebhook ? hooks.some((h) => h.url.trim()) : required) && !needsPick && (app.oauth || isWebhook || enrichment || !!verified || installed);
  const field = (f: Field) => (
    <div key={f.key}>
      <div className="mb-2 text-[16px] font-medium">{f.label} <span className="text-error">*</span></div>
      {f.type === "select" ? (
        <Listbox label={f.label} value={values[f.key] ?? ""} onChange={(v) => setValues({ ...values, [f.key]: v })} placeholder={f.placeholder}
          options={(f.options ?? []).map((o) => ({ value: o.value, label: o.label }))} className="[&>button]:h-12 [&>button]:text-[16px]" />
      ) : (
        <div className="flex gap-2">
          <input type={f.type === "secret" ? "password" : "text"} autoComplete="off" value={values[f.key] ?? ""} placeholder={f.placeholder} aria-label={f.label}
            onFocus={(e) => { if (/^•/.test(e.target.value)) setValues({ ...values, [f.key]: "" }); }}
            onChange={(e) => { setValues({ ...values, [f.key]: e.target.value }); if (f === keyField) setVerified(null); }} className={input} />
          {f === keyField && !app.oauth && !enrichment && (
            <button type="button" disabled={!values[f.key]?.trim() || busy !== ""} onClick={() => void verify()}
              className="inline-flex h-12 shrink-0 items-center gap-2 rounded-[10px] border border-[var(--border-strong)] px-4 text-[15px] font-medium hover:bg-base-200 disabled:opacity-50">
              {busy === "verify" ? <LuLoaderCircle size={16} className="animate-spin" /> : verified ? <LuCheck size={16} className="text-success" /> : null}{verified ? "Verified" : "Verify"}
            </button>
          )}
        </div>
      )}
      {f.help && <div className="mt-1.5 text-[14px] leading-relaxed text-base-content/60">{f.help}{f.helpUrl && <> <a href={f.helpUrl} target="_blank" rel="noreferrer" className="font-medium" style={link}>Need help?</a></>}</div>}
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button type="button" tabIndex={-1} aria-label="Close" onClick={onClose} className="absolute inset-0 bg-[#141413]/45" />
      <div role="dialog" aria-modal="true" aria-label={`Connect ${app.name}`} className="wizard-rise relative flex max-h-[90vh] w-full max-w-[780px] flex-col overflow-hidden rounded-[16px] bg-base-100 shadow-[var(--shadow-overlay)]">
        <div className="flex items-start gap-4 border-b border-[var(--border-subtle)] px-7 py-5">
          {isWebhook || app.category === "enrichment" ? <AppLogo app={app} size={48} /> : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-primary/10 text-primary"><LuArrowLeftRight size={24} /></span>}
          <div className="min-w-0 flex-1">
            <div className="text-[22px] font-medium">{isWebhook ? "Add Webhook URLs" : `Connect ${app.name} to ${BRAND.name}`}</div>
            <div className="mt-0.5 text-[15px] text-base-content/65">{isWebhook ? "Receive real-time lead notifications in your own systems." : app.tagline}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-[8px] text-base-content/60 hover:bg-base-200"><LuX size={20} /></button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-7 py-6">
          {app.banner.title && (
            <div className="flex items-start gap-4 rounded-[12px] bg-primary/[0.06] px-5 py-4">
              <LuInfo size={22} className="mt-0.5 shrink-0" style={{ color: "#4f46e5" }} />
              <div><div className="text-[16px] font-semibold" style={{ color: "#4f46e5" }}>{app.banner.title}</div><div className="mt-0.5 text-[15px]" style={{ color: "#4f46e5cc" }}>{app.banner.body}</div></div>
            </div>
          )}
          {installed && state?.status === "error" && state.last_error && (
            <div className="rounded-[10px] border border-[#f3b4a8] bg-[#fdecea] px-4 py-3 text-[15px]" style={{ color: "#b42318" }}>Sync stopped: {state.last_error}. Update the credentials and save to resume.</div>
          )}
          {installed && state?.status === "pending_oauth" && <div className="rounded-[10px] bg-[#fdf3c4]/70 px-4 py-3 text-[15px] text-[#7a4a06]">Sign-in wasn&apos;t finished. Save to continue to {app.name}.</div>}

          {app.fields.map(field)}

          {app.oauth && (
            <div className="text-[15px] leading-relaxed text-base-content/70">
              In your {app.name} app, set the callback (redirect) URL to <code className="rounded bg-base-200 px-1.5 py-0.5 font-mono text-[14px]">{callbackBase}{app.key}</code> before connecting. After saving you&apos;ll sign in to {app.name} to approve access.
            </div>
          )}

          {isWebhook && (
            <>
              <div>
                <div className="mb-2 text-[16px] font-medium">Webhook URLs <span className="text-error">*</span></div>
                <div className="space-y-3">
                  {hooks.map((h, i) => (
                    <div key={i} className="grid grid-cols-[1fr_200px_40px] gap-3 rounded-[12px] border border-[var(--border-subtle)] p-4">
                      <input value={h.url} placeholder="https://your-webhook-url.com/endpoint" aria-label="Webhook URL" onChange={(e) => setHooks(hooks.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} className={input} />
                      <Listbox label="Trigger type" value={h.trigger} onChange={(v) => setHooks(hooks.map((x, j) => (j === i ? { ...x, trigger: v as Hook["trigger"] } : x)))}
                        options={[{ value: "lead", label: "On Lead Created" }, { value: "reply", label: "On Lead Reply" }]} className="[&>button]:h-12 [&>button]:text-[15px]" />
                      <button type="button" aria-label="Remove webhook" disabled={hooks.length === 1} onClick={() => setHooks(hooks.filter((_, j) => j !== i))} className="flex h-12 w-10 items-center justify-center rounded-[8px] text-base-content/50 hover:bg-base-200 disabled:opacity-30"><LuX size={18} /></button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => setHooks([...hooks, { url: "", trigger: "lead" }])} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-[10px] border border-dashed border-primary/60 text-[16px] font-medium text-primary hover:bg-primary/5"><LuPlus size={18} />Add another webhook</button>
                <div className="mt-2 text-[14px] text-base-content/60">Each webhook receives JSON lead data when the selected trigger occurs.{installed ? " Saving replaces the saved list." : ""}</div>
              </div>
              <div className="rounded-[12px] border border-[var(--border-subtle)] p-5">
                <div className="text-[16px] font-medium">Signing secret (optional)</div>
                <div className="mt-2 flex gap-2">
                  <input value={values.secret ?? ""} placeholder="whsec_…" aria-label="Signing secret" onChange={(e) => setValues({ ...values, secret: e.target.value })} className={`${input} font-mono`} />
                  <button type="button" onClick={() => setValues({ ...values, secret: `whsec_${Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("")}` })}
                    className="inline-flex h-12 shrink-0 items-center gap-2 rounded-[10px] border border-primary/60 px-4 text-[15px] font-medium text-primary hover:bg-primary/5"><LuRefreshCw size={16} />Generate</button>
                </div>
                <div className="mt-2 text-[14px] leading-relaxed text-base-content/60">When set, each request includes an <code className="font-mono">x-kairo-signature</code> header (HMAC-SHA256 of <code className="font-mono">timestamp.body</code>, timestamp in <code className="font-mono">x-kairo-timestamp</code>) so you can verify it came from {BRAND.name}. Leave empty to disable signing.</div>
              </div>
            </>
          )}

          {app.pick && (verified || installed) && (
            <div>
              <div className="mb-2 text-[16px] font-medium">{app.pick.label} <span className="text-error">*</span></div>
              {choices.length ? (
                <Listbox label={app.pick.label} value={choice?.value ?? ""} placeholder={`Choose a ${app.pick.label.toLowerCase()}`} onChange={(v) => setChoice(choices.find((c) => c.value === v) ?? null)} options={choices} className="[&>button]:h-12 [&>button]:text-[16px]" />
              ) : installed && state?.choice_label ? (
                <div className="flex items-center justify-between rounded-[10px] border border-[var(--border-subtle)] px-4 py-3 text-[16px]"><span>{state.choice_label}</span><button type="button" onClick={() => void verify()} className="text-[15px] font-medium" style={link}>Change</button></div>
              ) : <div className="text-[15px] text-base-content/60">No {app.pick.label.toLowerCase()}s found. Create one in {app.name} first.</div>}
              <div className="mt-1.5 text-[14px] text-base-content/60">{app.pick.help}</div>
            </div>
          )}

          {(isWebhook ? [] : app.options).filter((o) => o !== "create_on_reply").map((o) => {
            const t = OPTION_TEXT[o](app.name);
            return (
              <div key={o} className="space-y-3">
                <Check on={!!options[o]} onChange={(v) => setOptions({ ...options, [o]: v, ...(o === "reply_notes" && !v ? { create_on_reply: false } : {}) })} title={t.title} body={t.body}
                  note={o === "auto_sync" && app.needsEmail ? "Leads wait for their email to be found (turn on automatic email enrichment in Workspace settings)." : undefined} />
                {o === "reply_notes" && app.options.includes("create_on_reply") && options.reply_notes && (
                  <Check nested on={!!options.create_on_reply} onChange={(v) => setOptions({ ...options, create_on_reply: v })} {...OPTION_TEXT.create_on_reply(app.name)} />
                )}
              </div>
            );
          })}
          {isWebhook && <Check on={!!options.auto_sync} onChange={(v) => setOptions({ ...options, auto_sync: v })} title="Automatically send webhooks for new contacts" body="When enabled, “On Lead Created” webhooks fire automatically for leads your agents qualify. Reply webhooks always fire." />}

          {installed && !enrichment && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[12px] bg-base-200/40 px-5 py-4 text-[15px]">
              <span><b className="tabular-nums">{state!.stats.synced}</b> synced</span>
              <span><b className="tabular-nums">{state!.stats.pending}</b> waiting</span>
              {state!.stats.failed > 0 && <span style={{ color: "#b42318" }}><b className="tabular-nums">{state!.stats.failed}</b> failed</span>}
              {state!.last_synced_at && <span className="text-base-content/60">Last sync {new Date(`${state!.last_synced_at.replace(" ", "T")}Z`).toLocaleString()}</span>}
              {!isWebhook && <button type="button" disabled={busy !== "" || state?.status !== "connected"} onClick={() => void syncNow()} className="ml-auto inline-flex h-10 items-center gap-2 rounded-[8px] border border-[var(--border-strong)] bg-base-100 px-3.5 font-medium hover:bg-base-200 disabled:opacity-50">
                {busy === "sync" ? <LuLoaderCircle size={16} className="animate-spin" /> : <LuRefreshCw size={16} />}Sync all qualified leads</button>}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-[var(--border-subtle)] px-7 py-4">
          {installed && <button type="button" disabled={busy !== ""} onClick={() => void remove()} className="inline-flex h-11 items-center gap-2 rounded-[8px] px-3 text-[15px] font-medium hover:bg-[#ef4444]/10" style={{ color: "#dc2626" }}><LuTrash2 size={17} />Disconnect</button>}
          <button type="button" onClick={onClose} className="ml-auto h-11 rounded-[8px] px-4 text-[16px] font-medium hover:bg-base-200">Cancel</button>
          <button type="button" disabled={!canSave || busy !== ""} onClick={() => void save()} className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-primary px-5 text-[16px] font-semibold text-primary-content hover:bg-[var(--primary-hover)] disabled:opacity-50">
            {busy === "save" && <LuLoaderCircle size={17} className="animate-spin" />}
            {installed ? "Save changes" : isWebhook ? "Save Webhooks" : app.oauth ? "Next" : `Connect ${app.name}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
