import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { format, formatDistanceToNowStrict } from "date-fns";
import { LuCheck, LuCircleCheck, LuCopy, LuInfo, LuKeyRound, LuLoaderCircle, LuLock, LuPlus, LuTrash2 } from "react-icons/lu";
import Confirm from "@/components/contacts/Confirm";
import ApiDocsDrawer from "@/components/settings/api/ApiDocsDrawer";

/** Settings → API: workspace API keys for the public /api/v1 API. Keys are shown once, stored hashed. */

interface KeyRow { id: string; name: string; key_prefix: string; scopes: string; last_used_at: string | null; expires_at: string | null; revoked_at: string | null; created_at: string }

const ALL = ["contacts:read", "contacts:write", "campaigns:read", "campaigns:write", "events:read", "events:write", "signals:write", "crm:read", "crm:write", "email:send"];
const READ_ONLY = ALL.filter((s) => s.endsWith(":read"));
const ACCESS = [
  { key: "full", label: "Full access", sub: "Read and write contacts, campaigns, signals, events and CRM, and send email.", scopes: ALL },
  { key: "read", label: "Read only", sub: "Read data only. Can't create, change or send anything.", scopes: READ_ONLY },
] as const;

const toDate = (s: string) => new Date(`${s.replace(" ", "T")}Z`);
const access = (scopes: string) => { const s = scopes.split(/\s+/).filter(Boolean); return s.length === ALL.length ? "Full access" : s.every((x) => x.endsWith(":read")) ? "Read only" : `${s.length} scopes`; };

function Overlay({ children, onClose, label }: { children: React.ReactNode; onClose: () => void; label: string }) {
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button type="button" tabIndex={-1} aria-label="Close" onClick={onClose} className="absolute inset-0 bg-[#141413]/45" />
      <div role="dialog" aria-modal="true" aria-label={label} className="wizard-rise relative w-full max-w-[660px] overflow-hidden rounded-[14px] bg-base-100 shadow-[var(--shadow-overlay)]">{children}</div>
    </div>,
    document.body,
  );
}

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (key: string) => void }) {
  const [name, setName] = useState(() => `API Key #${Math.floor(1000 + Math.random() * 9000)}`);
  const [level, setLevel] = useState<(typeof ACCESS)[number]["key"]>("full");
  const [busy, setBusy] = useState(false);
  const valid = name.trim().length > 0 && name.trim().length <= 80;
  async function create() {
    if (!valid || busy) return;
    setBusy(true);
    const r = await fetch("/api/platform/api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), scopes: ACCESS.find((a) => a.key === level)!.scopes }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { toast.error(r.status === 403 ? "Only workspace admins can create API keys" : d.error ?? "Could not create the key"); return; }
    onCreated(d.key);
  }
  return (
    <Overlay onClose={() => !busy && onClose()} label="Create API key">
      <div className="px-8 py-7">
        <div className="text-[22px] font-medium">Create API key</div>
        <label className="mt-5 block">
          <span className="text-[16px] font-medium">Name</span>
          <input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void create(); if (e.key === "Escape") onClose(); }}
            className="mt-2 h-12 w-full rounded-[10px] border border-[var(--border-strong)] bg-base-100 px-4 text-[17px] outline-none focus:border-primary/60 focus:ring-2 focus:ring-[var(--ring)]" />
        </label>
        <div className="mt-5 text-[16px] font-medium">Access</div>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {ACCESS.map((a) => (
            <button key={a.key} type="button" onClick={() => setLevel(a.key)} aria-pressed={level === a.key}
              className={`rounded-[12px] border px-4 py-3.5 text-left transition-colors ${level === a.key ? "border-primary/60 bg-primary/[0.05]" : "border-[var(--border-subtle)] hover:bg-base-200/40"}`}>
              <div className="flex items-center gap-2 text-[16px] font-medium">
                <span className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 ${level === a.key ? "border-primary" : "border-base-content/25"}`}>{level === a.key && <span className="h-2 w-2 rounded-full bg-primary" />}</span>{a.label}
              </div>
              <div className="mt-1 text-[14px] leading-snug text-base-content/65">{a.sub}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-3 bg-primary/[0.06] px-8 py-4">
        <button type="button" disabled={busy} onClick={onClose} className="h-11 rounded-[8px] px-4 text-[15px] font-medium hover:bg-base-200">Cancel</button>
        <button type="button" disabled={busy || !valid} onClick={() => void create()} className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-primary px-5 text-[15px] font-semibold text-primary-content hover:bg-[var(--primary-hover)] disabled:opacity-60">
          {busy && <LuLoaderCircle size={16} className="animate-spin" />}Create API key
        </button>
      </div>
    </Overlay>
  );
}

function CreatedDialog({ value, onClose }: { value: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard.writeText(value).then(() => { setCopied(true); toast.success("API key copied"); }, () => toast.error("Could not copy. Select the key and copy it manually."));
  return (
    <Overlay onClose={onClose} label="API key created">
      <div className="flex items-start gap-5 px-8 py-7">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-success/15" style={{ color: "#1f8a4c" }}><LuCircleCheck size={26} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[20px] font-medium">API key created successfully!</div>
          <div className="mt-1.5 text-[16px] text-base-content/75">Copy it now and store it somewhere safe.</div>
          <div className="relative mt-4 rounded-[10px] border border-[var(--border-subtle)] bg-base-200/50 py-3.5 pl-4 pr-12">
            <div className="select-all break-all font-mono text-[15px] leading-relaxed">{value}</div>
            <button type="button" onClick={() => void copy()} aria-label="Copy API key" className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-[6px] text-base-content/60 hover:bg-base-200 hover:text-base-content">{copied ? <LuCheck size={17} /> : <LuCopy size={17} />}</button>
          </div>
          <div className="mt-2 text-[14px] text-base-content/60">You won&apos;t be able to see this key again.</div>
        </div>
      </div>
      <div className="flex justify-end gap-3 bg-primary/[0.06] px-8 py-4">
        {!copied && <button type="button" onClick={() => void copy()} className="inline-flex h-11 items-center gap-2 rounded-[8px] px-4 text-[15px] font-medium hover:bg-base-200"><LuCopy size={16} />Copy</button>}
        <button type="button" autoFocus onClick={onClose} className="h-11 rounded-[8px] bg-primary px-6 text-[15px] font-semibold text-primary-content hover:bg-[var(--primary-hover)]">Done</button>
      </div>
    </Overlay>
  );
}

export default function ApiTab() {
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [removing, setRemoving] = useState<KeyRow | null>(null);
  const [docs, setDocs] = useState(false);

  const load = useCallback(() => fetch("/api/platform/api-keys").then((r) => r.json()).then((rows: KeyRow[]) => setKeys(rows.filter((k) => !k.revoked_at))).catch(() => toast.error("Could not load API keys")), []);
  useEffect(() => { void load(); }, [load]);

  async function remove() {
    if (!removing) return;
    const r = await fetch(`/api/platform/api-keys?id=${encodeURIComponent(removing.id)}`, { method: "DELETE" });
    if (!r.ok) { toast.error(r.status === 403 ? "Only workspace admins can delete API keys" : "Could not delete the key"); return; }
    toast.success(`${removing.name} deleted`);
    setRemoving(null);
    await load();
  }

  return (
    <div className="wizard-rise rounded-[16px] border border-[var(--border-subtle)] bg-base-100">
      <div className="border-b border-[var(--border-subtle)] px-8 py-6">
        <div role="heading" aria-level={2} className="text-[24px] font-medium">API Settings</div>
        <div className="mt-1 text-[17px] text-base-content/70">Manage your API keys and external integrations</div>
      </div>
      <div className="px-8 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[20px] font-medium">API Keys</div>
            <div className="mt-1 text-[17px] text-base-content/70">Use these keys to authenticate with our external API</div>
            <div className="mt-1 text-[15px] text-base-content/60">For security, a key is only visible once, right after you create it. If you&apos;ve lost a key, delete it and create a new one.</div>
          </div>
          <button type="button" onClick={() => setCreating(true)} className="inline-flex h-12 items-center gap-2 rounded-[10px] bg-primary px-5 text-[17px] font-semibold text-primary-content shadow-[0_6px_16px_-8px_var(--color-primary)] hover:bg-[var(--primary-hover)]"><LuPlus size={20} />Create API Key</button>
        </div>

        <div className="mt-6 space-y-4">
          {!keys && <div className="flex justify-center py-10"><LuLoaderCircle size={24} className="animate-spin text-primary" /></div>}
          {keys?.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-[var(--border-strong)] px-6 py-12 text-center">
              <LuKeyRound size={36} className="text-base-content/45" />
              <div className="text-[18px] font-medium">No API keys yet</div>
              <div className="text-[16px] text-base-content/65">Create a key to connect your CRM, data warehouse or scripts.</div>
            </div>
          )}
          {keys?.map((k) => (
            <div key={k.id} className="rounded-[14px] border border-[var(--border-subtle)] bg-base-200/25 px-6 py-5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <LuKeyRound size={21} style={{ color: "#e5603b" }} />
                <span className="text-[18px] font-medium">{k.name}</span>
                <span className="text-[15px] text-base-content/60">Created {format(toDate(k.created_at), "MMM d, yyyy, hh:mm a")}</span>
                <span className="rounded-full border border-[var(--border-subtle)] bg-base-100 px-2.5 py-0.5 text-[13px] text-base-content/70" title={k.scopes.split(/\s+/).join(", ")}>{access(k.scopes)}</span>
                <span className="ml-auto text-[14px] text-base-content/55">{k.last_used_at ? `Last used ${formatDistanceToNowStrict(toDate(k.last_used_at), { addSuffix: true })}` : "Never used"}</span>
              </div>
              <div className="mt-3 flex items-center gap-4">
                <div className="group/tip relative flex h-12 min-w-0 flex-1 items-center gap-3 rounded-[10px] border border-[var(--border-subtle)] bg-base-200/60 px-4">
                  <LuLock size={19} className="shrink-0 text-base-content/50" />
                  <span className="truncate font-mono text-[15px] text-base-content/70">{k.key_prefix}<span className="tracking-[0.2em] text-base-content/45">{"•".repeat(40)}</span></span>
                  <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/3 z-50 mb-2 w-max max-w-[460px] rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-4 py-3 text-[16px] leading-snug opacity-0 shadow-[var(--shadow-overlay)] transition-opacity group-hover/tip:opacity-100">For security, this key was only shown once, when it was created. It can&apos;t be viewed or copied again. If you&apos;ve lost it, delete this key and create a new one.</span>
                </div>
                <button type="button" onClick={() => setRemoving(k)} aria-label={`Delete ${k.name}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] hover:bg-[#ef4444]/10" style={{ color: "#dc2626" }}><LuTrash2 size={21} /></button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-start gap-4 rounded-[12px] border border-[#c9c2f5] bg-[#f3f0ff] px-6 py-5">
          <LuInfo size={24} className="mt-0.5 shrink-0" style={{ color: "#5b3fd6" }} />
          <div className="text-[17px]" style={{ color: "#3b2a99" }}>
            Need help getting started? Check out our comprehensive{" "}
            <button type="button" onClick={() => setDocs(true)} className="font-medium underline underline-offset-2" style={{ color: "#4f2fd0" }}>API documentation</button>{" "}
            for detailed guides and examples.
          </div>
        </div>
      </div>

      {creating && <CreateDialog onClose={() => setCreating(false)} onCreated={(key) => { setCreating(false); setCreated(key); void load(); }} />}
      {created && <CreatedDialog value={created} onClose={() => setCreated(null)} />}
      {removing && createPortal(<Confirm title="Delete API Key" action="Delete API Key" onCancel={() => setRemoving(null)} onConfirm={remove}
        text={<>Are you sure you want to delete <b>{removing.name}</b>? Anything using it stops working right away. This action cannot be undone.</>} />, document.body)}
      {docs && createPortal(<ApiDocsDrawer onClose={() => setDocs(false)} />, document.body)}
    </div>
  );
}
