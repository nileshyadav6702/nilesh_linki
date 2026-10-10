import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { LuCopy, LuCrown, LuInfo, LuLink2, LuLoaderCircle, LuMail, LuRefreshCw, LuShieldCheck, LuTrash2, LuUsers, LuX } from "react-icons/lu";
import Listbox from "@/components/agents/leads/Listbox";
import Confirm from "@/components/contacts/Confirm";

/** Settings → Members: invite by email or a shareable link, pending invitations, members and roles. */

type Role = "owner" | "admin" | "manager" | "member" | "viewer";
interface Member { id: string; email: string; role: Role; joined_at: string; you: boolean }
interface Invitation { id: string; email: string; role: Role; created_at: string; expires_at: string }
interface LinkInfo { path: string; uses: number; max_uses: number }
interface Data { workspace: { name: string }; members: Member[]; invitations: Invitation[]; link: LinkInfo | null; role: Role; can_manage: boolean }

const ROLE_INFO: Record<Role, string> = {
  owner: "Everything, including other owners and deleting the workspace.",
  admin: "Manage members, invitations, accounts and workspace settings.",
  manager: "Create and run agents, edit the company profile and campaigns.",
  member: "Work leads, write and approve messages, use the inbox.",
  viewer: "Read-only access to agents, contacts, inbox and insights.",
};
const ROLE_LABEL = (r: Role) => r[0].toUpperCase() + r.slice(1);
const ROLE_BADGE: Record<Role, string> = {
  owner: "bg-[#fdf3c4] text-[#a16207]", admin: "bg-[#efe9ff] text-[#6d4ce0]", manager: "bg-[#dff5ef] text-[#17876b]",
  member: "bg-base-200 text-base-content/75", viewer: "bg-base-200 text-base-content/55",
};
const nameOf = (email: string) => email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const initials = (email: string) => nameOf(email).split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]).join("") || "?";
const when = (iso: string) => { const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`); return Number.isNaN(d.getTime()) ? "" : format(d, "MMM d, yyyy, h:mm a"); };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function MembersTab() {
  const [d, setD] = useState<Data | null>(null);
  const [mode, setMode] = useState<"email" | "link">("email");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [busy, setBusy] = useState<string | null>(null);
  const [manualLink, setManualLink] = useState<{ email: string; url: string } | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [cancelling, setCancelling] = useState<Invitation | null>(null);

  const load = useCallback(() => fetch("/api/settings/members").then((r) => r.json()).then(setD).catch(() => toast.error("Could not load members")), []);
  useEffect(() => { void load(); }, [load]);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const linkUrl = d?.link ? `${origin}${d.link.path}` : "";
  const roleOptions = (["admin", "manager", "member", "viewer", ...(d?.role === "owner" ? ["owner"] : [])] as Role[]).map((r) => ({ value: r, label: ROLE_LABEL(r) }));

  async function invite() {
    if (!EMAIL.test(email.trim())) { toast.error("Enter a valid email address"); return; }
    setBusy("invite");
    try {
      const r = await fetch("/api/platform/invitations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), role }) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "Could not send the invitation");
      if (b.email_sent) { toast.success(`Invitation sent to ${b.email}`); setManualLink(null); }
      else { toast.message(`Invitation created for ${b.email}`, { description: "No email sender is set up — copy the link below and share it." }); setManualLink({ email: b.email, url: b.invite_url }); }
      setEmail("");
      await load();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not send the invitation"); }
    finally { setBusy(null); }
  }

  async function revoke(inv: Invitation) {
    setBusy(`revoke:${inv.id}`);
    const r = await fetch(`/api/platform/invitations?id=${encodeURIComponent(inv.id)}`, { method: "DELETE" });
    setBusy(null);
    if (!r.ok) { toast.error("Could not cancel the invitation"); return; }
    toast.success(`Invitation for ${inv.email} removed`);
    setCancelling(null);
    await load();
  }

  async function regenerate() {
    setBusy("link");
    const r = await fetch("/api/settings/join-link", { method: "POST" });
    const b = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) { toast.error(b.error ?? "Could not create the link"); return; }
    toast.success(d?.link ? "New invite link generated — the old one no longer works" : "Invitation link generated");
    setD((cur) => (cur ? { ...cur, link: b } : cur));
  }

  async function changeRole(m: Member, next: Role) {
    if (next === m.role) return;
    const r = await fetch("/api/settings/members", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: m.id, role: next }) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(b.error ?? "Could not change the role"); return; }
    toast.success(`${nameOf(m.email)} is now ${ROLE_LABEL(next).toLowerCase()}`);
    await load();
  }

  async function remove(m: Member) {
    const r = await fetch(`/api/settings/members?user_id=${encodeURIComponent(m.id)}`, { method: "DELETE" });
    const b = r.status === 204 ? {} : await r.json().catch(() => ({}));
    if (!r.ok) { toast.error((b as { error?: string }).error ?? "Could not remove the member"); return; }
    toast.success(`${nameOf(m.email)} was removed`);
    setRemoving(null);
    await load();
  }

  const copy = (text: string, what = "Link") => navigator.clipboard.writeText(text).then(() => toast.success(`${what} copied`), () => toast.error("Could not copy"));

  if (!d) return <div className="flex justify-center py-20"><LuLoaderCircle size={26} className="animate-spin text-primary" /></div>;
  const seg = (on: boolean) => `inline-flex h-11 items-center gap-2 rounded-[10px] px-4 text-[16px] transition ${on ? "bg-base-100 font-medium text-base-content shadow-[0_1px_4px_rgba(20,20,19,0.12)]" : "text-base-content/60 hover:text-base-content"}`;

  return (
    <section className="wizard-rise rounded-[16px] border border-[var(--border-subtle)] bg-base-100">
      <div className="border-b border-[var(--border-subtle)] px-8 py-6">
        <div role="heading" aria-level={2} className="text-[24px] font-semibold text-base-content">{d.workspace.name} – Members</div>
        <div className="mt-1.5 text-[17px] text-base-content/65">Manage who has access to your workspace</div>
      </div>

      <div className="space-y-7 px-8 py-7">
        {d.can_manage && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="text-[18px] font-semibold text-base-content">Invite New Member</div>
              <div role="tablist" aria-label="Invite by" className="flex rounded-[12px] border border-[var(--border-subtle)] bg-base-200/60 p-1">
                <button type="button" role="tab" aria-selected={mode === "email"} onClick={() => setMode("email")} className={seg(mode === "email")}><LuMail size={19} />Email</button>
                <button type="button" role="tab" aria-selected={mode === "link"} onClick={() => setMode("link")} className={seg(mode === "link")}><LuLink2 size={19} />Invite link</button>
              </div>
            </div>

            {mode === "email" ? (
              <form className="flex flex-wrap items-stretch gap-3" onSubmit={(e) => { e.preventDefault(); void invite(); }}>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter email address" aria-label="Email address"
                  className="h-[52px] min-w-[260px] flex-1 rounded-[10px] border border-[var(--border-strong)] bg-base-100 px-4 text-[17px] outline-none transition placeholder:text-base-content/40 focus:border-primary/60 focus:ring-2 focus:ring-[var(--ring)]" />
                <Listbox label="Role" value={role} onChange={(v) => setRole(v as Role)} options={roleOptions}
                  className="w-[170px] [&>button]:h-[52px] [&>button]:rounded-[10px] [&>button]:border-[var(--border-strong)] [&>button]:px-4 [&>button]:text-[16px]" />
                <button type="submit" disabled={!EMAIL.test(email.trim()) || busy === "invite"}
                  className="inline-flex h-[52px] items-center gap-2 rounded-[10px] bg-primary px-7 text-[16px] font-semibold text-primary-content shadow-[0_6px_16px_-8px_var(--color-primary)] transition-colors hover:bg-[var(--primary-hover)] disabled:bg-base-200 disabled:text-base-content/35 disabled:shadow-none">
                  {busy === "invite" && <LuLoaderCircle size={18} className="animate-spin" />}Invite member
                </button>
              </form>
            ) : (
              <div className="rounded-[12px] border border-[var(--border-subtle)] bg-base-200/40 p-4">
                <div className="flex flex-wrap items-stretch gap-3">
                  <input readOnly value={linkUrl} placeholder="Click the button at the end of the line to generate a link. Regenerate to invalidate the previous link." aria-label="Invite link"
                    onFocus={(e) => e.currentTarget.select()} className="h-[52px] min-w-[260px] flex-1 truncate rounded-[10px] border border-[var(--border-strong)] bg-base-100 px-4 text-[16px] text-base-content outline-none placeholder:text-base-content/50" />
                  <button type="button" onClick={() => void regenerate()} disabled={busy === "link"} aria-label={d.link ? "Regenerate link" : "Generate link"} title={d.link ? "Regenerate (the old link stops working)" : "Generate link"}
                    className="flex h-[52px] w-[52px] items-center justify-center rounded-[10px] border border-[var(--border-strong)] bg-base-100 text-base-content/70 transition-colors hover:bg-base-200 hover:text-base-content">
                    <LuRefreshCw size={20} className={busy === "link" ? "animate-spin" : ""} />
                  </button>
                  <button type="button" onClick={() => void copy(linkUrl)} disabled={!d.link}
                    className="inline-flex h-[52px] items-center gap-2 rounded-[10px] bg-primary px-6 text-[16px] font-semibold text-primary-content shadow-[0_6px_16px_-8px_var(--color-primary)] transition-colors hover:bg-[var(--primary-hover)] disabled:bg-base-200 disabled:text-base-content/35 disabled:shadow-none">
                    <LuCopy size={18} />Copy link
                  </button>
                </div>
                <div className="mt-3 text-[16px] text-base-content/75">Anyone with this link can join your workspace as a member. Regenerate to invalidate the previous link.</div>
                <div className="mt-1 text-[14px] text-base-content/50">{d.link ? d.link.uses : 0}/{d.link?.max_uses ?? 30} invitations used for this link.</div>
              </div>
            )}

            {manualLink && (
              <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-warning/30 bg-warning/[0.08] px-5 py-3.5">
                <div className="min-w-0 flex-1 text-[15px] text-base-content/80">No email sender is set up, so share this link with <strong className="font-medium">{manualLink.email}</strong> yourself (valid for 7 days).</div>
                <button type="button" onClick={() => void copy(manualLink.url, "Invitation link")} className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[var(--border-strong)] bg-base-100 px-4 text-[15px] hover:bg-base-200"><LuCopy size={16} />Copy invitation link</button>
              </div>
            )}
          </div>
        )}

        <div className="flex items-start gap-4 rounded-[12px] bg-primary/[0.06] px-6 py-4">
          <LuInfo size={22} className="mt-0.5 shrink-0" style={{ color: "#4f46e5" }} />
          <div>
            <div className="text-[17px] font-semibold" style={{ color: "#4f46e5" }}>Members share this workspace</div>
            <div className="mt-0.5 text-[15px]" style={{ color: "#4f46e5cc" }}>Everyone here works on the same agents, contacts, inbox and insights. Their role decides what they can change.</div>
          </div>
        </div>

        <div className="rounded-[14px] border border-[var(--border-subtle)] px-6 py-5">
          <div className="flex items-center gap-3 text-[18px] font-semibold"><LuShieldCheck size={22} className="text-primary" />What each role can do</div>
          <dl className="mt-4 grid gap-x-8 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
            {(Object.keys(ROLE_INFO) as Role[]).map((r) => (
              <div key={r} className="flex items-start gap-3">
                <dt className={`mt-0.5 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[14px] font-medium ${ROLE_BADGE[r]}`}>{r === "owner" && <LuCrown size={14} />}{ROLE_LABEL(r)}</dt>
                <dd className="text-[15px] leading-snug text-base-content/70">{ROLE_INFO[r]}</dd>
              </div>
            ))}
          </dl>
        </div>

        {d.can_manage && d.invitations.length > 0 && (
          <div>
            <div className="text-[18px] font-semibold text-base-content">Pending Invitations</div>
            <div className="mt-3 flex flex-wrap gap-2.5">
              {d.invitations.map((inv) => (
                <span key={inv.id} title={`Invited as ${inv.role} · expires ${when(inv.expires_at)}`} className="inline-flex h-10 items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.07] pl-4 pr-1.5 text-[15px] text-primary">
                  <LuMail size={16} />{inv.email}<span className="text-primary/60">· {inv.role}</span>
                  <button type="button" onClick={() => setCancelling(inv)} disabled={busy === `revoke:${inv.id}`} aria-label={`Cancel invitation for ${inv.email}`}
                    className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-primary/15">{busy === `revoke:${inv.id}` ? <LuLoaderCircle size={15} className="animate-spin" /> : <LuX size={16} />}</button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="overflow-x-auto rounded-[14px] border border-[var(--border-subtle)]">
          <table className="w-full min-w-[760px]">
            <thead className="bg-base-200/40">
              <tr className="text-left text-[14px] font-semibold text-base-content/60 [text-transform:uppercase] tracking-[0.04em]">
                <th className="px-7 py-4">Member</th><th className="px-6 py-4">Role</th><th className="px-6 py-4">Joined</th><th className="px-7 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {d.members.map((m) => (
                <tr key={m.id} className="border-t border-[var(--border-subtle)] transition-colors hover:bg-base-200/30">
                  <td className="px-7 py-5">
                    <div className="flex items-center gap-4">
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/12 text-[16px] font-semibold text-primary">{initials(m.email)}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[17px] font-medium text-base-content">{nameOf(m.email)}{m.you && <span className="rounded-full bg-base-200 px-2 py-0.5 text-[12px] font-medium text-base-content/60">You</span>}</div>
                        <div className="truncate text-[15px] text-base-content/60">{m.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6">
                    {d.can_manage && !m.you && (m.role !== "owner" || d.role === "owner") ? (
                      <Listbox label={`Role for ${m.email}`} value={m.role} onChange={(v) => void changeRole(m, v as Role)}
                        options={(["owner", "admin", "manager", "member", "viewer"] as Role[]).filter((r) => r !== "owner" || d.role === "owner").map((r) => ({ value: r, label: ROLE_LABEL(r) }))}
                        className="w-[150px] [&>button]:h-10 [&>button]:text-[15px]" />
                    ) : (
                      <span className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[15px] font-medium ${ROLE_BADGE[m.role]}`}>{m.role === "owner" && <LuCrown size={15} />}{ROLE_LABEL(m.role)}</span>
                    )}
                  </td>
                  <td className="px-6 text-[16px] text-base-content/75">{when(m.joined_at)}</td>
                  <td className="px-7 text-right">
                    {d.can_manage && !m.you && (m.role !== "owner" || d.role === "owner") ? (
                      <button type="button" onClick={() => setRemoving(m)} style={{ color: "#ef4444" }}
                        className="inline-flex h-10 items-center gap-2 rounded-[8px] px-3 text-[15px] transition-colors hover:bg-[#ef4444]/10"><LuTrash2 size={17} />Remove</button>
                    ) : <span className="text-[15px] text-base-content/35">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-2 text-[14px] text-base-content/50"><LuUsers size={16} />{d.members.length} member{d.members.length === 1 ? "" : "s"}{d.invitations.length ? ` · ${d.invitations.length} pending` : ""}</div>
      </div>

      {cancelling && (
        <Confirm title="Remove Invitation" action="Remove Invitation" onCancel={() => setCancelling(null)} onConfirm={() => revoke(cancelling)}
          text={<>Are you sure you want to remove the invitation for <strong>{cancelling.email}</strong>? Their link stops working right away.</>} />
      )}
      {removing && (
        <Confirm title={`Remove ${nameOf(removing.email)}?`} action="Remove member" onCancel={() => setRemoving(null)} onConfirm={() => remove(removing)}
          text={<>They lose access to <strong>{d.workspace.name}</strong> right away. Their agents, contacts and messages stay in the workspace.</>} />
      )}
    </section>
  );
}
