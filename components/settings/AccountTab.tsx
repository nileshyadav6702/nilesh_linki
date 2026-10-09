import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { LuCheck, LuChevronDown, LuLoaderCircle, LuSearch, LuX } from "react-icons/lu";
import Listbox, { useDismiss } from "@/components/agents/leads/Listbox";

/** Settings → Account: your name, the language AI writes your messages in, timezone, daily summary email. */

interface Profile { email: string; first_name: string | null; last_name: string | null; language: string | null; timezone: string | null; daily_digest: boolean }

const field = "h-[52px] w-full rounded-[8px] border border-[var(--border-strong)] bg-base-100 px-4 text-[17px] text-base-content outline-none transition placeholder:text-base-content/40 focus:border-primary/60 focus:ring-2 focus:ring-[var(--ring)]";
const timezones = (): string[] => { try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone"); } catch { return ["UTC"]; } };

/** Searchable timezone dropdown with "Clear selection", like a combobox. */
function TimezonePicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(open, [wrap], () => setOpen(false));
  const all = useMemo(() => timezones(), []);
  const shown = useMemo(() => { const s = q.trim().toLowerCase().replace(/\s+/g, "_"); return s ? all.filter((z) => z.toLowerCase().includes(s)) : all; }, [all, q]);
  const pick = (v: string | null) => { onChange(v); setOpen(false); setQ(""); };
  return (
    <div ref={wrap} className="relative w-full max-w-[460px]">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className={`flex h-[52px] w-full items-center justify-between gap-2 rounded-[8px] border bg-base-100 px-4 text-left text-[17px] transition ${open ? "border-primary/60 ring-2 ring-[var(--ring)]" : "border-[var(--border-strong)] hover:bg-base-200/40"}`}>
        <span className={value ? "text-base-content" : "text-base-content/45"}>{value ? value.replace(/_/g, " ") : "Select your timezone"}</span>
        <LuChevronDown size={20} className={`shrink-0 text-base-content/55 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="wizard-rise absolute bottom-full left-0 z-50 mb-2 w-full min-w-[320px] overflow-hidden rounded-[12px] border border-[var(--border-subtle)] bg-base-100 shadow-[var(--shadow-overlay)] sm:w-[640px]">
          <div className="relative border-b border-[var(--border-subtle)] p-2">
            <LuSearch size={18} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-base-content/45" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search timezones..." aria-label="Search timezones"
              onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); if (e.key === "Enter" && shown[0]) pick(shown[0]); }}
              className="h-12 w-full rounded-[8px] border border-primary/45 bg-base-100 pl-11 pr-3 text-[17px] outline-none ring-2 ring-[var(--ring)]" />
          </div>
          <ul role="listbox" aria-label="Timezones" className="max-h-[280px] overflow-y-auto py-1">
            {value && <li><button type="button" onClick={() => pick(null)} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[16px] text-base-content/70 hover:bg-base-200"><LuX size={17} />Clear selection</button></li>}
            {shown.slice(0, 400).map((z) => (
              <li key={z} role="option" aria-selected={z === value}>
                <button type="button" onClick={() => pick(z)} className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-[16px] hover:bg-base-200 ${z === value ? "bg-primary/10 text-primary" : "text-base-content"}`}>
                  {z.replace(/_/g, " ")}{z === value && <LuCheck size={17} />}
                </button>
              </li>
            ))}
            {!shown.length && <li className="px-4 py-3 text-[15px] text-base-content/50">No timezone matches “{q}”</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function AccountTab() {
  const { update } = useSession();
  const [saved, setSaved] = useState<Profile | null>(null);
  const [p, setP] = useState<Profile | null>(null);
  const [languages, setLanguages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings/account").then((r) => r.json()).then((d) => {
      const prof = d.profile as Profile;
      // First visit: suggest the browser's timezone (saved only when you click Save).
      const tz = prof.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
      setSaved(prof); setP({ ...prof, timezone: tz, language: prof.language ?? "English (US)" }); setLanguages(d.languages ?? []);
    }).catch(() => toast.error("Could not load your account"));
  }, []);

  const dirty = !!p && !!saved && (["first_name", "last_name", "language", "timezone", "daily_digest"] as const).some((k) => (p[k] ?? null) !== (saved[k] ?? null));
  async function save() {
    if (!p) return;
    setBusy(true);
    try {
      const r = await fetch("/api/settings/account", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ first_name: p.first_name ?? "", last_name: p.last_name ?? "", language: p.language, timezone: p.timezone, daily_digest: p.daily_digest }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not save");
      setSaved(d.profile); setP(d.profile);
      await update(); // refresh the session so the new name shows in the sidebar
      toast.success("Account settings saved");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not save"); }
    finally { setBusy(false); }
  }

  if (!p) return <div className="flex justify-center py-20"><LuLoaderCircle size={26} className="animate-spin text-primary" /></div>;
  const label = "mb-2.5 text-[17px] font-medium text-base-content";
  return (
    <section className="wizard-rise rounded-[16px] border border-[var(--border-subtle)] bg-base-100">
      <div className="border-b border-[var(--border-subtle)] px-8 py-6">
        <div role="heading" aria-level={2} className="text-[24px] font-semibold text-base-content">Account Settings</div>
        <div className="mt-1.5 text-[17px] text-base-content/65">Manage your personal account information and preferences</div>
      </div>

      <div className="space-y-8 px-8 py-7">
        <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
          <div><div className={label}>First Name</div><input className={field} value={p.first_name ?? ""} maxLength={80} onChange={(e) => setP({ ...p, first_name: e.target.value })} placeholder="First name" /></div>
          <div><div className={label}>Last Name</div><input className={field} value={p.last_name ?? ""} maxLength={80} onChange={(e) => setP({ ...p, last_name: e.target.value })} placeholder="Last name" /></div>
        </div>
        <div>
          <div className={label}>Email</div>
          <input className={`${field} max-w-[460px] bg-base-200/50 text-base-content/60`} value={p.email} disabled aria-label="Email" />
        </div>
        <div>
          <div className={label}>Preferred Language</div>
          <Listbox label="Preferred language" value={p.language ?? ""} onChange={(v) => setP({ ...p, language: v })} options={languages.map((l) => ({ value: l, label: l }))}
            className="w-full max-w-[460px] [&>button]:h-[52px] [&>button]:rounded-[8px] [&>button]:border-[var(--border-strong)] [&>button]:px-4 [&>button]:text-[17px]" />
          <div className="mt-2 text-[15px] text-base-content/55">AI messages you generate or rewrite (Copilot, the lead panel) are written in this language. Agents running on their own use the workspace language.</div>
        </div>
        <div>
          <div className={label}>Timezone</div>
          <TimezonePicker value={p.timezone} onChange={(v) => setP({ ...p, timezone: v })} />
          <div className="mt-2 text-[15px] text-base-content/55">Used for your daily summary email and the times shown to you.</div>
        </div>
        <div>
          <div className={label}>Email Notifications</div>
          <label className="flex cursor-pointer items-center gap-3.5">
            <input type="checkbox" className="peer sr-only" checked={p.daily_digest} onChange={(e) => setP({ ...p, daily_digest: e.target.checked })} />
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ring)] ${p.daily_digest ? "border-primary bg-primary text-primary-content" : "border-primary/40"}`}>{p.daily_digest && <LuCheck size={16} strokeWidth={3} />}</span>
            <span className="text-[17px] text-base-content">Receive a daily email summary of newly imported leads</span>
          </label>
          <div className="mt-2 pl-[38px] text-[15px] text-base-content/55">Sent after 8:00 in your timezone from your workspace&apos;s email account, on days with new leads.</div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-4 border-t border-[var(--border-subtle)] px-8 py-5">
        <span className="text-[14px] text-base-content/50">{dirty ? "Unsaved changes" : "All changes saved"}</span>
        <button type="button" onClick={() => void save()} disabled={!dirty || busy}
          className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-primary px-6 text-[16px] font-semibold text-primary-content shadow-[0_6px_16px_-8px_var(--color-primary)] transition-colors hover:bg-[var(--primary-hover)] disabled:opacity-50">
          {busy && <LuLoaderCircle size={17} className="animate-spin" />}Save Settings
        </button>
      </div>
    </section>
  );
}
