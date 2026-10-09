import { useState } from "react";
import { toast } from "sonner";
import { LuEye, LuEyeOff, LuLoaderCircle, LuShieldCheck } from "react-icons/lu";

/** Settings → Security: change your password (current password required). */

type Field = "current" | "next" | "confirm";
const LABEL: Record<Field, string> = { current: "Current Password", next: "New Password", confirm: "Confirm New Password" };
const PLACEHOLDER: Record<Field, string> = { current: "Enter your current password", next: "Enter your new password (min. 8 characters)", confirm: "Confirm your new password" };

/** Rough strength: length and character variety. */
function strength(p: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (!p) return { score: 0, label: "" };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  if (p.length < 8) return { score: 1, label: "Too short" };
  if (p.length >= 12 && kinds >= 3) return { score: 3, label: "Strong" };
  return kinds >= 2 ? { score: 2, label: "Good" } : { score: 1, label: "Weak — mix letters, numbers and symbols" };
}

export default function SecurityTab() {
  const [v, setV] = useState<Record<Field, string>>({ current: "", next: "", confirm: "" });
  const [touched, setTouched] = useState<Record<Field, boolean>>({ current: false, next: false, confirm: false });
  const [show, setShow] = useState<Record<Field, boolean>>({ current: false, next: false, confirm: false });
  const [busy, setBusy] = useState(false);

  const errors: Record<Field, string | null> = {
    current: !v.current ? "Current password is required" : null,
    next: !v.next ? "New password is required" : v.next.length < 8 ? "Use at least 8 characters" : v.next.length > 200 ? "Use 200 characters or fewer" : v.next === v.current ? "Choose a password different from your current one" : null,
    confirm: !v.confirm ? "Please confirm your new password" : v.confirm !== v.next ? "Passwords don't match" : null,
  };
  const valid = !errors.current && !errors.next && !errors.confirm;
  const s = strength(v.next);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ current: true, next: true, confirm: true });
    if (!valid) return;
    setBusy(true);
    try {
      const r = await fetch("/api/auth/change-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: v.current, newPassword: v.next }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Could not change the password");
      toast.success("Password changed");
      setV({ current: "", next: "", confirm: "" });
      setTouched({ current: false, next: false, confirm: false });
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not change the password"); }
    finally { setBusy(false); }
  }

  return (
    <section className="wizard-rise rounded-[16px] border border-[var(--border-subtle)] bg-base-100">
      <div className="border-b border-[var(--border-subtle)] px-8 py-6">
        <div role="heading" aria-level={2} className="text-[24px] font-semibold text-base-content">Account Security</div>
        <div className="mt-1.5 text-[17px] text-base-content/65">Update your password and security settings</div>
      </div>

      <form onSubmit={submit} noValidate>
        <div className="space-y-3 px-8 py-7">
          {(Object.keys(LABEL) as Field[]).map((f) => {
            const err = touched[f] ? errors[f] : null;
            return (
              <div key={f}>
                <label htmlFor={`pw-${f}`} className="mb-2.5 block text-[17px] font-medium text-base-content">{LABEL[f]} <span className="text-base-content/70">*</span></label>
                <div className="relative">
                  <input id={`pw-${f}`} type={show[f] ? "text" : "password"} value={v[f]} placeholder={PLACEHOLDER[f]} aria-invalid={!!err} aria-describedby={err ? `pw-${f}-err` : undefined}
                    autoComplete={f === "current" ? "current-password" : "new-password"} maxLength={200}
                    onChange={(e) => setV({ ...v, [f]: e.target.value })} onBlur={() => setTouched((t) => ({ ...t, [f]: true }))}
                    className={`h-[52px] w-full rounded-[8px] border bg-base-100 pl-4 pr-12 text-[17px] text-base-content outline-none transition placeholder:text-base-content/40 focus:ring-2 ${err ? "border-error focus:ring-error/20" : "border-[var(--border-strong)] focus:border-primary/60 focus:ring-[var(--ring)]"}`} />
                  <button type="button" onClick={() => setShow({ ...show, [f]: !show[f] })} aria-label={show[f] ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[8px] text-base-content/50 hover:bg-base-200 hover:text-base-content">
                    {show[f] ? <LuEyeOff size={19} /> : <LuEye size={19} />}
                  </button>
                </div>
                {/* Always takes its line, so an error appearing on blur never moves the button out from under the cursor. */}
                <div id={`pw-${f}-err`} role={err ? "alert" : undefined} className="mt-2 min-h-[24px] text-[16px] text-error">{err}</div>
                {f === "next" && !err && s.score > 0 && (
                  <div className="-mt-6 flex h-6 items-center gap-3">
                    <div className="flex w-40 gap-1">{[1, 2, 3].map((i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= s.score ? (s.score === 3 ? "bg-success" : s.score === 2 ? "bg-[#e8a55a]" : "bg-error") : "bg-base-200"}`} />)}</div>
                    <span className="text-[14px] text-base-content/60">{s.label}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border-subtle)] px-8 py-5">
          <span className="flex items-center gap-2 text-[14px] text-base-content/55"><LuShieldCheck size={17} className="text-success" />Passwords are stored hashed — nobody, including admins, can read them.</span>
          <button type="submit" disabled={busy}
            className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-primary px-6 text-[16px] font-semibold text-primary-content shadow-[0_6px_16px_-8px_var(--color-primary)] transition-colors hover:bg-[var(--primary-hover)] disabled:bg-base-200 disabled:text-base-content/35 disabled:shadow-none">
            {busy && <LuLoaderCircle size={17} className="animate-spin" />}Change Password
          </button>
        </div>
      </form>
    </section>
  );
}
