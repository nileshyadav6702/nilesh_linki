import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { RiAddLine, RiLoader4Line } from "react-icons/ri";
import { Avatar } from "@/components/agents/ui";
import { SearchSelect } from "@/components/agents/sources/kit";
import type { ListRow } from "@/components/agents/sources/SavedListPanel";

/** Fields shared by the LinkedIn import forms: labelled field, account picker, lead list picker. */

export interface AccountRow { id: string; name: string; email: string | null; is_authenticated: number }

export const textCls = "h-12 w-full rounded-[8px] border border-[var(--border-strong)] bg-base-100 px-4 text-[15px] text-base-content outline-none transition placeholder:text-base-content/40 focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[var(--ring)]";

export function FormField({ label, required, hint, error, children }: { label: string; required?: boolean; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[15px] font-medium text-base-content">{label}{required && <span className="text-error"> *</span>}</div>
      {children}
      {error ? <p role="alert" className="text-[14px] text-error">{error}</p> : hint && <p className="text-[14px] text-base-content/50">{hint}</p>}
    </div>
  );
}

export const accountConnected = (a: AccountRow | undefined) => !!a?.is_authenticated;

export function AccountField({ accounts, value, onChange, hint, loading }: { accounts: AccountRow[]; value: string; onChange: (id: string) => void; hint?: string; loading: boolean }) {
  const current = accounts.find((a) => a.id === value);
  const notConnected = <span className="rounded-full border border-error/30 bg-error/10 px-2 py-0.5 text-[12px] text-error">Not connected</span>;
  return (
    <FormField label="LinkedIn account" required hint={hint}
      error={current && !accountConnected(current) ? "This LinkedIn account is disconnected. Please select a connected LinkedIn account." : !loading && !accounts.length ? "No LinkedIn account yet. Connect one in Settings → LinkedIn accounts." : null}>
      <SearchSelect value={value} onChange={onChange} label="LinkedIn account" placeholder={loading ? "Loading accounts…" : "Choose an account…"} searchable={accounts.length > 6}
        invalid={!!current && !accountConnected(current)}
        options={accounts.map((a) => ({ value: a.id, label: a.name || a.email || "LinkedIn account", lead: <Avatar name={a.name} size={28} />, pill: accountConnected(a) ? undefined : notConnected }))} />
    </FormField>
  );
}

/** Lead list picker with an inline "+ New list". */
export function ListField({ lists, value, onChange, onCreated }: { lists: ListRow[]; value: string; onChange: (id: string) => void; onCreated: (list: ListRow) => void }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/lists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim().slice(0, 200) }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error ?? "Could not create the list"); return; }
      onCreated({ id: d.id, name: d.name, target_count: 0 });
      onChange(d.id);
      setCreating(false); setName("");
    } finally { setBusy(false); }
  }
  return (
    <FormField label="Lead list" required>
      <SearchSelect value={value} onChange={onChange} label="Lead list" placeholder="Choose a list…"
        options={lists.map((l) => ({ value: l.id, label: `${l.name} (${l.target_count} lead${l.target_count === 1 ? "" : "s"})` }))} />
      {creating ? (
        <div className="flex gap-2 pt-1">
          <input autoFocus className={textCls} value={name} placeholder="New list name" aria-label="New list name" maxLength={200}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void create(); } if (e.key === "Escape") { e.stopPropagation(); setCreating(false); } }} />
          <button type="button" disabled={!name.trim() || busy} onClick={create} className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded-[8px] bg-primary px-4 text-sm font-medium text-primary-content hover:bg-[var(--primary-hover)] disabled:bg-[#e6dfd8] disabled:text-[#8e8b82]">
            {busy ? <RiLoader4Line size={16} className="animate-spin" /> : "Create"}
          </button>
          <button type="button" onClick={() => setCreating(false)} className="h-12 shrink-0 rounded-[8px] px-3 text-sm text-base-content/70 hover:bg-base-200">Cancel</button>
        </div>
      ) : (
        <div className="flex justify-end">
          <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-sm text-base-content/80 hover:bg-base-200"><RiAddLine size={16} /> New list</button>
        </div>
      )}
    </FormField>
  );
}
