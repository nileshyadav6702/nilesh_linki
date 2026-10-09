import Head from "next/head";
import { useState, useImperativeHandle, useRef, type Ref } from "react";
import { useRouter } from "next/router";
import { GetServerSideProps } from "next";
import { getDb } from "@/lib/db";
import { getServerWorkspace, loginRedirect } from "@/lib/server-workspace";
import { toast } from "sonner";
import {
  RiAddLine, RiDeleteBinLine, RiEditLine, RiMailLine,
  RiShieldCheckLine, RiShieldKeyholeLine, RiSmartphoneLine, RiCheckLine, RiCloseLine,
  RiLockPasswordLine, RiPlugLine,
  RiLinkedinBoxLine, RiMessage2Line, RiSettings3Line, RiFileCopyLine, RiBuilding2Line, RiTeamLine, RiAccountCircleLine,
  RiLockLine, RiLockUnlockLine,
  RiPauseLine, RiPlayLine, RiBankCardLine, RiCodeSSlashLine, RiForbidLine,
} from "react-icons/ri";
import DateField from "@/components/ui/DateField";
import WorkspaceTab from "@/components/settings/WorkspaceTab";
import MembersTab from "@/components/settings/MembersTab";
import AccountTab from "@/components/settings/AccountTab";
import SendersTab from "@/components/settings/SendersTab";
import SecurityTab from "@/components/settings/SecurityTab";
import AiTemplatesTab from "@/components/settings/templates/AiTemplatesTab";
import BillingTab from "@/components/settings/billing/BillingTab";
import ApiTab from "@/components/settings/api/ApiTab";
import McpTab from "@/components/settings/McpTab";
import BlocklistTab from "@/components/settings/blocklist/BlocklistTab";
import { Bar, BarChart, Cell, ResponsiveContainer } from "recharts";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "workspace" | "members" | "account" | "senders" | "security" | "templates" | "billing" | "api" | "mcp" | "blocklist";

interface LiAccount {
  id: string; name: string; email: string;
  is_authenticated: number;
  daily_connection_limit: number; daily_message_limit: number; daily_inmail_limit: number; daily_visit_limit: number;
  active_hours_start: number; active_hours_end: number;
  created_at: string;
}

interface EmailAccount {
  id: string; name: string; from_email: string; from_name: string | null; reply_to: string | null;
  smtp_host: string; smtp_port: number; smtp_secure: number;
  imap_host: string | null; imap_port: number; username: string; imap_username: string | null;
  provider: string;
  daily_email_limit: number; active_hours_start: number; active_hours_end: number;
  timezone: string; working_days: string;
  is_verified: number; signature: string | null;
  ramp_up_enabled: number; ramp_start_date: string | null;
  paused_at: string | null; paused_reason: string | null;
  created_at: string;
  active_run_count: number;
}


// ─── Server-side data ─────────────────────────────────────────────────────────

export const getServerSideProps: GetServerSideProps = async ({ query, req, res }) => {
  const db = getDb();
  const workspace = await getServerWorkspace(req, res);
  if (!workspace) return loginRedirect(req);
  const { workspaceId } = workspace;
  const liAccounts = db
    .prepare(
      `SELECT id, name, email, is_authenticated, daily_connection_limit, daily_message_limit, daily_inmail_limit, daily_visit_limit,
              active_hours_start, active_hours_end, timezone, working_days, created_at
       FROM accounts WHERE workspace_id=? ORDER BY created_at DESC`
    )
    .all(workspaceId);
  const emailAccounts = db
    .prepare("SELECT id, name, from_email, from_name, reply_to, smtp_host, smtp_port, smtp_secure, imap_host, imap_port, username, daily_email_limit, active_hours_start, active_hours_end, timezone, working_days, is_verified, signature, ramp_up_enabled, ramp_start_date, provider, paused_at, paused_reason, created_at FROM email_accounts WHERE workspace_id=? ORDER BY created_at DESC")
    .all(workspaceId);
  // Integrations has its own page now.
  if (query.tab === "integrations") return { redirect: { destination: "/integrations", permanent: false } };
  const validTabs: Tab[] = ["workspace", "members", "account", "senders", "security", "templates", "billing", "api", "mcp", "blocklist"];
  // Old links to the LinkedIn / Email tabs open Sender accounts.
  const asked = query.tab === "linkedin" || query.tab === "email" ? "senders" : query.tab;
  const tab: Tab = validTabs.includes(asked as Tab) ? (asked as Tab) : "workspace";
  return { props: { liAccounts, emailAccounts, initialTab: tab } };
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "workspace", label: "Workspace", icon: RiBuilding2Line },
  { key: "members", label: "Members", icon: RiTeamLine },
  { key: "account", label: "Account", icon: RiAccountCircleLine },
  { key: "senders", label: "Sender accounts", icon: RiLinkedinBoxLine },
  { key: "security", label: "Security", icon: RiLockPasswordLine },
  { key: "templates", label: "AI Outreach Templates", icon: RiMessage2Line },
  { key: "billing", label: "Billing", icon: RiBankCardLine },
  { key: "api", label: "API", icon: RiCodeSSlashLine },
  { key: "mcp", label: "MCP", icon: RiPlugLine },
  { key: "blocklist", label: "Organization Blocklist", icon: RiForbidLine },
];

const PRESET_CONFIGS: Record<string, { smtp_host: string; smtp_port: number; smtp_secure: number; imap_host: string; imap_port: number }> = {
  gmail: { smtp_host: "smtp.gmail.com", smtp_port: 587, smtp_secure: 0, imap_host: "imap.gmail.com", imap_port: 993 },
  outlook: { smtp_host: "smtp-mail.outlook.com", smtp_port: 587, smtp_secure: 0, imap_host: "outlook.office365.com", imap_port: 993 },
  custom: { smtp_host: "", smtp_port: 587, smtp_secure: 0, imap_host: "", imap_port: 993 },
};

const BLANK_EMAIL_FORM = {
  preset: "custom", name: "", from_email: "", from_name: "", reply_to: "",
  smtp_host: "", smtp_port: 587, smtp_secure: 0,
  imap_host: "", imap_port: 993, username: "", password: "",
  imap_username: "", imap_password: "",
  daily_email_limit: 50, active_hours_start: 9, active_hours_end: 18,
  timezone: "Europe/Berlin", working_days: "1,2,3,4,5", signature: "",
  ramp_up_enabled: true,
  ramp_start_date: new Date().toISOString().slice(0, 10),
};

function blankGmailForm() {
  const browserTimezone = typeof Intl === "undefined" ? "UTC" : Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    email: "",
    app_password: "",
    from_name: "",
    name: "",
    daily_email_limit: 50,
    timezone: TIMEZONES.some((timezone) => timezone.value === browserTimezone) ? browserTimezone : "UTC",
  };
}

const TIMEZONES = [
  { value: "Pacific/Midway",      label: "UTC−11 — Midway Island" },
  { value: "Pacific/Honolulu",    label: "UTC−10 — Hawaii" },
  { value: "America/Anchorage",   label: "UTC−9  — Alaska" },
  { value: "America/Los_Angeles", label: "UTC−8  — Pacific Time (US)" },
  { value: "America/Denver",      label: "UTC−7  — Mountain Time (US)" },
  { value: "America/Chicago",     label: "UTC−6  — Central Time (US)" },
  { value: "America/New_York",    label: "UTC−5  — Eastern Time (US)" },
  { value: "America/Caracas",     label: "UTC−4  — Caracas, La Paz" },
  { value: "America/Sao_Paulo",   label: "UTC−3  — São Paulo, Buenos Aires" },
  { value: "America/Noronha",     label: "UTC−2  — Mid-Atlantic" },
  { value: "Atlantic/Azores",     label: "UTC−1  — Azores" },
  { value: "UTC",                 label: "UTC+0  — London (no DST)" },
  { value: "Europe/London",       label: "UTC+0/+1 — London (BST)" },
  { value: "Europe/Paris",        label: "UTC+1/+2 — Paris, Berlin, Amsterdam" },
  { value: "Europe/Helsinki",     label: "UTC+2/+3 — Helsinki, Kyiv, Tallinn" },
  { value: "Europe/Moscow",       label: "UTC+3  — Moscow, Istanbul" },
  { value: "Asia/Dubai",          label: "UTC+4  — Dubai, Abu Dhabi" },
  { value: "Asia/Karachi",        label: "UTC+5  — Karachi, Islamabad" },
  { value: "Asia/Kolkata",        label: "UTC+5:30 — India" },
  { value: "Asia/Dhaka",          label: "UTC+6  — Dhaka, Almaty" },
  { value: "Asia/Bangkok",        label: "UTC+7  — Bangkok, Jakarta, Hanoi" },
  { value: "Asia/Shanghai",       label: "UTC+8  — Beijing, Singapore, HK" },
  { value: "Asia/Tokyo",          label: "UTC+9  — Tokyo, Seoul" },
  { value: "Australia/Sydney",    label: "UTC+10/+11 — Sydney" },
  { value: "Pacific/Auckland",    label: "UTC+12/+13 — Auckland" },
];

const WEEKDAYS = [
  { iso: 1, short: "Mon" },
  { iso: 2, short: "Tue" },
  { iso: 3, short: "Wed" },
  { iso: 4, short: "Thu" },
  { iso: 5, short: "Fri" },
  { iso: 6, short: "Sat" },
  { iso: 7, short: "Sun" },
];

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function fmtHour(h: number) {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SettingsPage({
  liAccounts: initialLi,
  emailAccounts: initialEmail,
  initialTab,
}: {
  liAccounts: LiAccount[];
  emailAccounts: EmailAccount[];
  initialTab: Tab;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const liHost = useRef<LinkedInHost>(null);
  const mailHost = useRef<EmailHost>(null);
  const [sendersKey, setSendersKey] = useState(0);

  const visibleTabs = TABS;

  function switchTab(t: Tab) {
    setTab(t);
    router.replace(`/settings?tab=${t}`, undefined, { shallow: true });
  }

  return (
    <>
      <Head>
        <title>Settings — Kairo</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div>
        <div className="-mx-4 -mt-6 border-b border-[var(--border-subtle)] px-4 pt-6 md:-mx-10 md:-mt-9 md:px-10 md:pt-8">
          <div className="flex items-center gap-3"><RiSettings3Line size={24} className="text-primary" /><div role="heading" aria-level={1} className="text-[24px] font-semibold text-base-content">Account Settings</div></div>
          <div className="mt-1.5 pl-[36px] text-[16px] text-base-content/65">Manage your company information and workspace settings</div>
          {/* Tabs */}
          <div className="mt-6 flex items-center gap-8 overflow-x-auto">
            {visibleTabs.map(({ key, label }) => (
              <button key={key} data-tour={`settings-tab-${key}`} onClick={() => switchTab(key)} aria-current={tab === key ? "page" : undefined}
                className={`relative whitespace-nowrap pb-4 pt-1 transition-colors ${tab === key ? "text-base-content" : "text-base-content/50 hover:text-base-content/80"}`}>
                <span className="text-[17px]">{label}</span>
                {tab === key && <span className="absolute inset-x-0 bottom-0 h-[2.5px] rounded-full bg-base-content" />}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-7">
        {/* Tab content */}
        {tab === "workspace" && <WorkspaceTab />}
        {tab === "members" && <MembersTab />}
        {tab === "account" && <AccountTab />}
        <div>
        {tab === "security" && <SecurityTab />}
        {tab === "senders" && <>
          <SendersTab reloadKey={sendersKey} onAddLinkedIn={() => liHost.current?.openAdd()} onAuthLinkedIn={(a) => liHost.current?.openAuth(a as unknown as LiAccount)}
            onGmail={() => mailHost.current?.openGmail()} onSmtp={() => mailHost.current?.openSmtp()} onEditCredentials={(m) => mailHost.current?.openEdit(m as unknown as EmailAccount)} />
          {/* The add / sign-in / connect dialogs live in the original tabs; their lists are hidden. */}
          <LinkedInTab initialAccounts={initialLi} hideList host={liHost} onChanged={() => setSendersKey((k) => k + 1)} />
          <EmailTab initialAccounts={initialEmail} hideList host={mailHost} onChanged={() => setSendersKey((k) => k + 1)} />
        </>}
        {tab === "templates" && <AiTemplatesTab />}
        {tab === "billing" && <BillingTab />}
        {tab === "api" && <ApiTab />}
        {tab === "mcp" && <McpTab />}
        {tab === "blocklist" && <BlocklistTab />}
        </div>
        </div>
      </div>
    </>
  );
}

// ─── LinkedIn Tab ─────────────────────────────────────────────────────────────

/** Dialogs the Sender accounts tab opens on the LinkedIn host (add an account, sign it in). */
export interface LinkedInHost { openAdd(): void; openAuth(a: LiAccount): void }

function LinkedInTab({ initialAccounts, hideList = false, host, onChanged }: { initialAccounts: LiAccount[]; hideList?: boolean; host?: Ref<LinkedInHost>; onChanged?: () => void }) {
  const [accounts, setAccounts] = useState<LiAccount[]>(initialAccounts);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", daily_connection_limit: 20, daily_message_limit: 50, daily_inmail_limit: 15, daily_visit_limit: 150 });
  const [loading, setLoading] = useState(false);
  const [authModal, setAuthModal] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "cookies">("login");
  const [authForm, setAuthForm] = useState({ li_at: "", document_cookie: "" });
  const [loginForm, setLoginForm] = useState({ email: "", password: "", code: "" });
  const [loginStage, setLoginStage] = useState<"creds" | "code" | "approve">("creds");
  const [challengeMsg, setChallengeMsg] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  function openAuthModal(account: LiAccount) {
    setAuthModal(account.id);
    setAuthMode("login");
    setLoginStage("creds");
    setChallengeMsg("");
    setLoginForm({ email: account.email ?? "", password: "", code: "" });
    setAuthForm({ li_at: "", document_cookie: "" });
  }

  function closeAuthModal() {
    setAuthModal(null);
    setLoginStage("creds");
    setChallengeMsg("");
    setLoginForm({ email: "", password: "", code: "" });
    setAuthForm({ li_at: "", document_cookie: "" });
  }

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!authModal) return;
    setAuthLoading(true);
    const body =
      loginStage === "creds"
        ? { step: "start", email: loginForm.email, password: loginForm.password }
        : loginStage === "approve"
          ? { step: "await" }
          : { step: "verify", code: loginForm.code };
    const res = await fetch(`/api/accounts/${authModal}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setAuthLoading(false);
    if (!res.ok) { toast.error(data.error ?? "Login failed"); return; }
    if (data.status === "authenticated") {
      toast.success("Logged in successfully");
      closeAuthModal();
      refresh();
    } else if (data.status === "challenge" && data.kind === "captcha") {
      toast.error(data.message);
      setAuthMode("cookies");
    } else if (data.status === "challenge") {
      setChallengeMsg(data.message ?? "");
      if (data.kind === "app") {
        if (loginStage === "approve") toast.error("Still waiting — approve the request in your LinkedIn app, then click Continue.");
        setLoginStage("approve");
      } else {
        setLoginStage("code");
        setLoginForm((f) => ({ ...f, code: "" }));
      }
    } else {
      toast.error(data.message ?? "Login failed");
    }
  }

  async function refresh() {
    const res = await fetch("/api/accounts");
    setAccounts(await res.json());
    onChanged?.();
  }

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed"); return; }
    toast.success("Account created");
    setShowModal(false);
    setForm({ name: "", email: "", daily_connection_limit: 20, daily_message_limit: 50, daily_inmail_limit: 15, daily_visit_limit: 150 });
    refresh();
  }

  async function submitAuth(e: React.FormEvent) {
    e.preventDefault();
    if (!authModal) return;
    setAuthLoading(true);
    const res = await fetch(`/api/accounts/${authModal}/authenticate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authForm),
    });
    setAuthLoading(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Authentication failed"); return; }
    toast.success("Account authenticated");
    closeAuthModal();
    refresh();
  }

  /** Sign the account out but keep it — reversible via Authenticate. */
  async function disconnectAccount(a: LiAccount) {
    if (!confirm(`Disconnect ${a.name}?\n\nThe stored LinkedIn session is cleared and campaigns stop using this account. Its settings and history are kept, and you can reconnect any time.`)) return;
    const res = await fetch(`/api/accounts/${a.id}/disconnect`, { method: "POST" });
    if (!res.ok) { toast.error((await res.json()).error ?? "Disconnect failed"); return; }
    toast.success(`${a.name} disconnected`);
    refresh();
  }

  async function deleteLinkedinAccount(a: LiAccount) {
    // Typed confirmation: unlike Disconnect this also removes the account's campaign runs,
    // and there is no undo.
    const typed = prompt(`Delete ${a.name} permanently?\n\nThis removes the account and its campaign run history. Type the account name to confirm.`);
    if (typed === null) return;
    if (typed.trim() !== a.name) { toast.error("Name did not match — nothing was deleted"); return; }

    const res = await fetch(`/api/accounts/${a.id}`, { method: "DELETE" });
    if (res.status === 409) {
      // Active campaigns block deletion; name them so the user knows what to pause.
      const data = await res.json() as { message?: string; campaigns?: Array<{ name: string }> };
      const names = (data.campaigns ?? []).map((c) => c.name).join(", ");
      toast.error(names ? `${data.message} (${names})` : data.message ?? "Account is in use");
      return;
    }
    if (!res.ok) { toast.error((await res.json().catch(() => ({}))).error ?? "Delete failed"); return; }
    toast.success(`${a.name} deleted`);
    refresh();
  }

  useImperativeHandle(host, () => ({ openAdd: () => setShowModal(true), openAuth: (a: LiAccount) => openAuthModal(a) }));

  return (
    <div>
      {!hideList && (<>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-base-content/50">LinkedIn accounts used for browser automation</p>
        <button
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors"
          onClick={() => setShowModal(true)}
        >
          <RiAddLine size={14} /> Add Account
        </button>
      </div>

      {accounts.length === 0 ? (
        <div className="text-center py-12 text-base-content/30 text-sm border border-dashed border-[var(--border)] rounded-2xl">
          No LinkedIn accounts yet.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {accounts.map((a) => (
            <div key={a.id} className="flex items-center gap-4 px-4 py-3 bg-base-100 border border-[var(--border-subtle)] rounded-2xl shadow-[var(--shadow-raised)] hover:border-[var(--border)] transition-colors">
              <div className="w-9 h-9 rounded-lg bg-base-200 flex items-center justify-center text-sm font-bold text-base-content/60 shrink-0">
                {a.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{a.name}</p>
                <p className="text-xs text-base-content/40">{a.email} · {a.daily_connection_limit} conn/day · {a.daily_message_limit} msg/day · {a.daily_inmail_limit} inmail/day · {a.daily_visit_limit} visits/day</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${a.is_authenticated ? "bg-success/15 text-success" : "bg-base-200 text-base-content/50"}`}>
                  {a.is_authenticated ? <><RiCheckLine size={10} /> Auth</> : "Unauth"}
                </span>
                <button
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
                  onClick={() => openAuthModal(a)}
                >
                  <RiShieldKeyholeLine size={12} /> {a.is_authenticated ? "Reconnect" : "Authenticate"}
                </button>
                {/* Only meaningful while a session exists — hidden once signed out. */}
                {Boolean(a.is_authenticated) && (
                  <button
                    className="inline-flex items-center px-2.5 py-1.5 rounded-lg text-xs font-medium text-base-content/50 hover:text-base-content hover:bg-base-200 transition-colors"
                    onClick={() => disconnectAccount(a)}
                  >
                    Disconnect
                  </button>
                )}
                <button
                  className="inline-flex items-center px-2.5 py-1.5 rounded-lg text-xs font-medium text-base-content/40 hover:text-error hover:bg-error/10 transition-colors"
                  onClick={() => deleteLinkedinAccount(a)}
                  title="Remove this account and its campaign history"
                >
                  <RiDeleteBinLine size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      </>)}

      {/* Add modal */}
      {showModal && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-100 border border-[var(--border-subtle)] rounded-2xl shadow-[var(--shadow-modal)] max-w-md">
            <h3 className="font-semibold text-base mb-4">Add LinkedIn Account</h3>
            <form onSubmit={createAccount} className="flex flex-col gap-3">
              <div>
                <label className="label text-xs text-base-content/50 pb-1">Display name</label>
                <input className="input input-bordered input-sm w-full" placeholder="e.g. Mohammad LinkedIn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div>
                <label className="label text-xs text-base-content/50 pb-1">Email</label>
                <input type="email" className="input input-bordered input-sm w-full" placeholder="you@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Connections/day</label>
                  <input type="number" className="input input-bordered input-sm w-full" value={form.daily_connection_limit} onChange={(e) => setForm({ ...form, daily_connection_limit: Number(e.target.value) })} min={1} max={100} />
                </div>
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Messages/day</label>
                  <input type="number" className="input input-bordered input-sm w-full" value={form.daily_message_limit} onChange={(e) => setForm({ ...form, daily_message_limit: Number(e.target.value) })} min={1} max={200} />
                </div>
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">InMail/day</label>
                  <input type="number" className="input input-bordered input-sm w-full" value={form.daily_inmail_limit} onChange={(e) => setForm({ ...form, daily_inmail_limit: Number(e.target.value) })} min={1} max={100} />
                </div>
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Profile visits/day</label>
                  <input type="number" className="input input-bordered input-sm w-full" value={form.daily_visit_limit} onChange={(e) => setForm({ ...form, daily_visit_limit: Math.min(150, Number(e.target.value)) })} min={1} max={150} />
                </div>
              </div>
              <div className="modal-action mt-2">
                <button type="button" className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-200 transition-colors" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50" disabled={loading}>
                  {loading ? <span className="loading loading-spinner loading-xs" /> : "Add Account"}
                </button>
              </div>
            </form>
          </div>
          <div className="modal-backdrop" onClick={() => setShowModal(false)} />
        </div>
      )}

      {/* Auth modal */}
      {authModal && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-100 border border-[var(--border-subtle)] rounded-2xl shadow-[var(--shadow-modal)] max-w-lg">
            <h3 className="font-semibold text-base mb-1">Authenticate LinkedIn Account</h3>

            {/* Mode toggle */}
            <div className="inline-flex rounded-[10px] bg-base-200 p-1 mb-4 mt-2">
              <button
                type="button"
                onClick={() => { setAuthMode("login"); setLoginStage("creds"); }}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${authMode === "login" ? "bg-primary text-primary-content" : "text-base-content/60 hover:text-base-content"}`}
              >
                Server login
              </button>
              <button
                type="button"
                onClick={() => setAuthMode("cookies")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${authMode === "cookies" ? "bg-primary text-primary-content" : "text-base-content/60 hover:text-base-content"}`}
              >
                Paste cookies
              </button>
            </div>

            {authMode === "login" ? (
              <form onSubmit={submitLogin} className="flex flex-col gap-3">
                <p className="text-xs text-base-content/50 -mt-1">
                  Logs in on the server under the runner&apos;s exact browser fingerprint and captures all cookies. LinkedIn may ask for a code or a device approval.
                </p>
                {loginStage === "creds" ? (
                  <>
                    <div>
                      <label className="label text-xs text-base-content/50 pb-1">Email <span className="text-error">*</span></label>
                      <input type="email" autoComplete="off" className="input input-bordered input-sm w-full" placeholder="you@example.com" value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} required />
                    </div>
                    <div>
                      <label className="label text-xs text-base-content/50 pb-1">Password <span className="text-error">*</span></label>
                      <input type="password" autoComplete="off" className="input input-bordered input-sm w-full" placeholder="••••••••" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} required />
                    </div>
                  </>
                ) : loginStage === "approve" ? (
                  <div className="bg-base-200 text-base-content/70 text-xs rounded-lg p-3 flex items-start gap-2">
                    <RiSmartphoneLine size={16} className="shrink-0 mt-0.5" />
                    <span>{challengeMsg || "Approve the sign-in request in your LinkedIn mobile app, then click Continue."}</span>
                  </div>
                ) : (
                  <div>
                    <div className="bg-base-200 text-base-content/70 text-xs rounded-lg p-3 mb-2">{challengeMsg}</div>
                    <label className="label text-xs text-base-content/50 pb-1">Verification code <span className="text-error">*</span></label>
                    <input inputMode="numeric" autoComplete="one-time-code" className="input input-bordered input-sm w-full font-mono tracking-widest" placeholder="123456" value={loginForm.code} onChange={(e) => setLoginForm({ ...loginForm, code: e.target.value })} required />
                  </div>
                )}
                <div className="modal-action mt-1">
                  <button type="button" className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-200 transition-colors" onClick={closeAuthModal}>Cancel</button>
                  <button type="submit" className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50" disabled={authLoading}>
                    {authLoading ? <span className="loading loading-spinner loading-xs" /> : loginStage === "creds" ? "Log in" : loginStage === "approve" ? "I approved — Continue" : "Verify code"}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="bg-base-200 border border-[var(--border-subtle)] rounded-[10px] p-3 text-xs text-base-content/60 mb-4 space-y-1.5">
                  <p className="font-medium text-base-content/80">How to get your cookies:</p>
                  <p>1. Open <strong>linkedin.com</strong> in Chrome and make sure you are logged in</p>
                  <p>2. Open DevTools → <strong>Application</strong> → <strong>Cookies</strong> → <strong>https://www.linkedin.com</strong></p>
                  <p>3. Find <strong>li_at</strong> → double-click the Value cell → copy it → paste below</p>
                  <p>4. Open the DevTools <strong>Console</strong> tab → run <code className="bg-base-200 px-1 rounded">document.cookie</code> → copy the output → paste below</p>
                </div>
                <form onSubmit={submitAuth} className="flex flex-col gap-3">
                  <div>
                    <label className="label text-xs text-base-content/50 pb-1">li_at cookie value <span className="text-error">*</span></label>
                    <input className="input input-bordered input-sm w-full font-mono text-xs" placeholder="AQEDATxxxxxx..." value={authForm.li_at} onChange={(e) => setAuthForm({ ...authForm, li_at: e.target.value })} required />
                  </div>
                  <div>
                    <label className="label text-xs text-base-content/50 pb-1">document.cookie output (optional)</label>
                    <textarea className="textarea textarea-bordered w-full font-mono text-xs h-24 resize-none" placeholder={'bcookie="v=2&..."; JSESSIONID="ajax:..."; ...'} value={authForm.document_cookie} onChange={(e) => setAuthForm({ ...authForm, document_cookie: e.target.value })} />
                  </div>
                  <div className="modal-action mt-1">
                    <button type="button" className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-200 transition-colors" onClick={closeAuthModal}>Cancel</button>
                    <button type="submit" className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50" disabled={authLoading}>
                      {authLoading ? <span className="loading loading-spinner loading-xs" /> : "Save Cookies"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
          <div className="modal-backdrop" onClick={closeAuthModal} />
        </div>
      )}
    </div>
  );
}

// ─── Ramp Diagram ─────────────────────────────────────────────────────────────

function RampDiagram({ startDate, target }: { startDate: string; target: number }) {
  const daysToFull = Math.ceil(target / 2);
  const today = new Date();
  const start = startDate ? parseISO(startDate) : today;
  const daysActive = Math.max(0, differenceInCalendarDays(today, start));
  const currentLimit = Math.min(target, Math.max(2, (daysActive + 1) * 2));
  const fullDate = addDays(start, daysToFull - 1);

  // 7 sample points for the bar chart (day 1, day 4, day 7, ... up to full)
  const points: { day: number; val: number }[] = [];
  const step = Math.max(1, Math.floor(daysToFull / 6));
  for (let d = 1; d <= daysToFull; d += step) {
    points.push({ day: d, val: Math.min(target, d * 2) });
  }
  if (points[points.length - 1].day !== daysToFull) {
    points.push({ day: daysToFull, val: target });
  }

  const BAR_MAX_PX = 56;

  return (
    <div className="rounded-[10px] bg-base-200 border border-[var(--border-subtle)] p-3">
      <div className="mb-2" style={{ height: BAR_MAX_PX }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barCategoryGap={4}>
            <Bar dataKey="val" radius={[2, 2, 0, 0]} minPointSize={3} animationDuration={500}>
              {points.map(({ day }) => <Cell key={day} fill={daysActive + 1 >= day ? "var(--color-primary)" : "color-mix(in oklab, var(--color-base-content) 12%, transparent)"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center justify-between text-[10px] text-base-content/40">
        <span>Day 1 — 2/day</span>
        <span>Day {daysToFull} — {target}/day</span>
      </div>
      <div className="mt-2 pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between text-xs">
        <span className="text-base-content/50">
          Today: <span className="text-base-content font-medium">{currentLimit}/day</span>
        </span>
        <span className="text-base-content/40">
          Full volume: {format(fullDate, "d MMM")}
        </span>
      </div>
    </div>
  );
}

// ─── Email Tab ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

/** Dialogs the Sender accounts tab opens on the email host (connect Gmail / SMTP, edit credentials). */
export interface EmailHost { openGmail(): void; openSmtp(): void; openEdit(a: EmailAccount): void }

function EmailTab({ initialAccounts, hideList = false, host, onChanged }: { initialAccounts: EmailAccount[]; hideList?: boolean; host?: Ref<EmailHost>; onChanged?: () => void }) {
  const [accounts, setAccounts] = useState<EmailAccount[]>(initialAccounts);
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [showGmailModal, setShowGmailModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<EmailAccount | null>(null);
  const [form, setForm] = useState(BLANK_EMAIL_FORM);
  const [gmailForm, setGmailForm] = useState(blankGmailForm);
  const [loading, setLoading] = useState(false);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  // Separate unlock states for SMTP and IMAP credential sections
  const [smtpUnlocked, setSmtpUnlocked] = useState(false);
  const [imapUnlocked, setImapUnlocked] = useState(false);

  const totalPages = Math.max(1, Math.ceil(accounts.length / PAGE_SIZE));
  const pageAccounts = accounts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function refresh() {
    const res = await fetch("/api/email-accounts");
    const data = await res.json();
    setAccounts(data);
    setPage((p) => Math.min(p, Math.max(1, Math.ceil(data.length / PAGE_SIZE))));
    onChanged?.();
  }

  function openCreate() {
    setEditingAccount(null);
    setForm(BLANK_EMAIL_FORM);
    setSmtpUnlocked(true);
    setImapUnlocked(true);
    setShowModal(true);
  }

  function openGmailConnect() {
    setGmailForm(blankGmailForm());
    setShowGmailModal(true);
  }

  function openDuplicate(a: EmailAccount) {
    setSmtpUnlocked(false);
    setImapUnlocked(false);
    setEditingAccount(null);
    setForm({
      preset: "custom",
      name: `${a.name} (copy)`,
      from_email: a.from_email,
      from_name: a.from_name ?? "",
      reply_to: a.reply_to ?? "",
      smtp_host: a.smtp_host,
      smtp_port: a.smtp_port,
      smtp_secure: a.smtp_secure,
      imap_host: a.imap_host ?? "",
      imap_port: a.imap_port,
      username: a.username,
      password: "",
      imap_username: a.imap_username ?? "",
      imap_password: "",
      daily_email_limit: a.daily_email_limit,
      active_hours_start: a.active_hours_start,
      active_hours_end: a.active_hours_end,
      timezone: a.timezone ?? "UTC",
      working_days: a.working_days ?? "1,2,3,4,5",
      signature: a.signature ?? "",
      ramp_up_enabled: a.ramp_up_enabled === 1,
      ramp_start_date: new Date().toISOString().slice(0, 10),
    });
    setShowModal(true);
  }

  function openEdit(a: EmailAccount) {
    setSmtpUnlocked(false);
    setImapUnlocked(false);
    setEditingAccount(a);
    setForm({
      preset: "custom",
      name: a.name,
      from_email: a.from_email,
      from_name: a.from_name ?? "",
      reply_to: a.reply_to ?? "",
      smtp_host: a.smtp_host,
      smtp_port: a.smtp_port,
      smtp_secure: a.smtp_secure,
      imap_host: a.imap_host ?? "",
      imap_port: a.imap_port,
      username: a.username,
      password: "",
      imap_username: a.imap_username ?? "",
      imap_password: "",
      daily_email_limit: a.daily_email_limit,
      active_hours_start: a.active_hours_start,
      active_hours_end: a.active_hours_end,
      timezone: a.timezone ?? "UTC",
      working_days: a.working_days ?? "1,2,3,4,5",
      signature: a.signature ?? "",
      ramp_up_enabled: a.ramp_up_enabled === 1,
      ramp_start_date: a.ramp_start_date ?? new Date().toISOString().slice(0, 10),
    });
    setShowModal(true);
  }

  function applyPreset(preset: string) {
    const cfg = PRESET_CONFIGS[preset] ?? PRESET_CONFIGS.custom;
    setForm((f) => ({ ...f, preset, ...cfg }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();

    // Uniqueness check for from_email
    const duplicate = accounts.find(
      (a) => a.from_email.toLowerCase() === form.from_email.toLowerCase() &&
             a.id !== editingAccount?.id
    );
    if (duplicate) {
      toast.error(`An account with email ${form.from_email} already exists`);
      return;
    }

    setLoading(true);

    const body: Record<string, unknown> = {
      name: form.name,
      from_email: form.from_email,
      from_name: form.from_name || null,
      reply_to: form.reply_to || null,
      smtp_host: form.smtp_host,
      smtp_port: form.smtp_port,
      smtp_secure: form.smtp_secure,
      imap_host: form.imap_host || null,
      imap_port: form.imap_port,
      username: form.username,
      imap_username: form.imap_username.trim() || null,
      daily_email_limit: form.daily_email_limit,
      active_hours_start: form.active_hours_start,
      active_hours_end: form.active_hours_end,
      timezone: form.timezone,
      working_days: form.working_days,
      signature: form.signature.trim() || null,
      ramp_up_enabled: form.ramp_up_enabled ? 1 : 0,
      ramp_start_date: form.ramp_start_date || new Date().toISOString().slice(0, 10),
    };
    // Only include password if provided (edit mode: leave blank to keep existing)
    if (form.password) body.password = form.password;
    if (form.imap_password) body.imap_password = form.imap_password;

    let res: Response;
    if (editingAccount) {
      res = await fetch(`/api/email-accounts/${editingAccount.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      if (!form.password) { toast.error("SMTP password is required"); setLoading(false); return; }
      res = await fetch("/api/email-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, password: form.password }),
      });
    }

    setLoading(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed"); return; }
    toast.success(editingAccount ? "Account updated" : "Account added");
    setShowModal(false);
    setEditingAccount(null);
    refresh();
  }

  async function connectGmail(e: React.FormEvent) {
    e.preventDefault();
    setGmailLoading(true);
    try {
      const res = await fetch("/api/email-accounts/gmail-app-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gmailForm),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not connect Gmail");
        return;
      }
      toast.success("Gmail connected and verified");
      setShowGmailModal(false);
      setGmailForm(blankGmailForm());
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not connect Gmail");
    } finally {
      setGmailLoading(false);
    }
  }

  async function testConnection(id: string) {
    setTestingId(id);
    const res = await fetch(`/api/email-accounts/${id}/test`, { method: "POST" });
    setTestingId(null);
    const data = await res.json();
    if (data.smtp?.ok === false) {
      toast.error(`SMTP failed: ${data.smtp.error}`);
    } else {
      toast.success("SMTP verified");
    }
    if (data.imap !== null && data.imap !== undefined) {
      if (data.imap?.ok === false) {
        toast.error(`IMAP failed: ${data.imap.error}`);
      } else {
        toast.success("IMAP verified");
      }
    }
    if (data.ok) refresh();
  }

  async function deleteAccount(id: string) {
    if (!confirm("Delete this email account?")) return;
    await fetch(`/api/email-accounts/${id}`, { method: "DELETE" });
    toast.success("Deleted");
    setAccounts((prev) => {
      const next = prev.filter((a) => a.id !== id);
      setPage((p) => Math.min(p, Math.max(1, Math.ceil(next.length / PAGE_SIZE))));
      return next;
    });
  }

  async function togglePause(a: EmailAccount) {
    const paused = !a.paused_at;
    const res = await fetch(`/api/email-accounts/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused }),
    });
    if (!res.ok) { toast.error("Could not update account"); return; }
    setAccounts((prev) => prev.map((x) => x.id === a.id ? { ...x, paused_at: paused ? new Date().toISOString() : null, paused_reason: paused ? "Manually paused" : null } : x));
    toast.success(paused ? "Sender deactivated — it won't send until reactivated" : "Sender reactivated");
  }

  useImperativeHandle(host, () => ({ openGmail: () => openGmailConnect(), openSmtp: () => openCreate(), openEdit: (a: EmailAccount) => openEdit(a) }));

  return (
    <div>
      {!hideList && (<>
      <div className="bg-base-200 border border-[var(--border-subtle)] rounded-2xl p-4 mb-5 text-xs text-base-content/60 leading-relaxed">
        <span className="font-medium text-base-content/80">Gmail app-password connection</span>{" "}
        verifies sending and inbox access before saving. Google requires 2-Step Verification before you can create an app password.
      </div>

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-base-content/50">Email accounts for outreach and inbox sync</p>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-[var(--border)] bg-base-100 text-base-content/70 hover:bg-base-200 transition-colors"
            onClick={openCreate}
          >
            <RiAddLine size={14} /> Other SMTP
          </button>
          <button
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors"
            onClick={openGmailConnect}
          >
            <RiShieldKeyholeLine size={14} /> Connect Gmail
          </button>
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="text-center py-12 text-base-content/30 text-sm border border-dashed border-[var(--border)] rounded-2xl">
          No email accounts yet. Add one to start sending emails.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {pageAccounts.map((a) => (
            <div key={a.id} className="flex items-center gap-4 px-4 py-3 bg-base-100 border border-[var(--border-subtle)] rounded-2xl shadow-[var(--shadow-raised)] hover:border-[var(--border)] transition-colors">
              <div className="w-9 h-9 rounded-lg bg-base-200 flex items-center justify-center text-sm font-bold text-base-content/60 shrink-0">
                {a.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{a.name}</p>
                <p className="text-xs text-base-content/40 truncate">
                  {a.from_email} · {a.provider === "gmail_app_password" ? "Gmail app password" : `${a.smtp_host}:${a.smtp_port}`} · {a.daily_email_limit}/day
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {a.provider === "gmail_app_password" && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-primary/10 text-primary">
                    Gmail
                  </span>
                )}
                {a.is_verified ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-success/15 text-success">
                    <RiCheckLine size={10} /> Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-base-200 text-base-content/50">
                    <RiCloseLine size={10} /> Unverified
                  </span>
                )}
                {a.paused_at ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-base-content/10 text-base-content/60" title={a.paused_reason ?? "Deactivated"}>
                    <RiPauseLine size={10} /> Deactivated
                  </span>
                ) : a.active_run_count > 0 ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-warning/15 text-warning">
                    <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" /> In use
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-base-200 text-base-content/40">
                    Free
                  </span>
                )}
                <button
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${a.paused_at ? "bg-success/10 text-success border-success/20 hover:bg-success/20" : "border-[var(--border)] text-base-content/60 hover:bg-base-200"}`}
                  onClick={() => togglePause(a)}
                  title={a.paused_at ? "Reactivate — allow this sender to send again" : "Deactivate — stop this sender from sending (stays connected)"}
                >
                  {a.paused_at ? <><RiPlayLine size={12} /> Activate</> : <><RiPauseLine size={12} /> Deactivate</>}
                </button>
                <button
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors disabled:opacity-50"
                  onClick={() => testConnection(a.id)}
                  disabled={testingId === a.id}
                >
                  {testingId === a.id ? <span className="loading loading-spinner loading-xs" /> : <RiShieldCheckLine size={12} />}
                  Test
                </button>
                <button
                  className="inline-flex items-center p-1.5 rounded-lg text-base-content/40 hover:text-base-content hover:bg-base-200 transition-colors"
                  onClick={() => openDuplicate(a)}
                  title="Duplicate"
                >
                  <RiFileCopyLine size={14} />
                </button>
                <button
                  className="inline-flex items-center p-1.5 rounded-lg text-base-content/40 hover:text-base-content hover:bg-base-200 transition-colors"
                  onClick={() => openEdit(a)}
                >
                  <RiEditLine size={14} />
                </button>
                <button
                  className="inline-flex items-center p-1.5 rounded-lg bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors"
                  onClick={() => deleteAccount(a.id)}
                >
                  <RiDeleteBinLine size={13} />
                </button>
              </div>
            </div>
          ))}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 mt-1 border-t border-[var(--border-subtle)]">
              <span className="text-xs text-base-content/40">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, accounts.length)} of {accounts.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-2.5 py-1 rounded-md text-xs text-base-content/50 hover:text-base-content hover:bg-base-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ←
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    className={`w-6 h-6 rounded-md text-xs font-medium transition-colors ${n === page ? "bg-primary text-primary-content" : "text-base-content/40 hover:text-base-content hover:bg-base-200"}`}
                  >
                    {n}
                  </button>
                ))}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-2.5 py-1 rounded-md text-xs text-base-content/50 hover:text-base-content hover:bg-base-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      </>)}
      {showGmailModal && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-100 border border-[var(--border-subtle)] rounded-2xl shadow-[var(--shadow-modal)] max-w-lg">
            <div className="flex items-start gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <RiShieldKeyholeLine size={20} />
              </div>
              <div>
                <h3 className="font-semibold text-base">Connect Gmail with an app password</h3>
                <p className="text-xs text-base-content/50 mt-1">Kairo will verify Gmail sending and inbox access before storing the encrypted credential.</p>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border-subtle)] bg-base-200 p-3 mb-4 text-xs text-base-content/60 leading-relaxed">
              <ol className="list-decimal ml-4 space-y-1">
                <li>Turn on 2-Step Verification for your Google account.</li>
                <li>
                  Open{" "}
                  <a className="text-primary hover:underline" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">
                    Google App Passwords
                  </a>
                  {" "}and create one for Kairo.
                </li>
                <li>Paste the 16-character password below. Spaces are accepted.</li>
              </ol>
            </div>

            <form onSubmit={connectGmail} className="flex flex-col gap-3">
              <div>
                <label className="label text-xs text-base-content/50 pb-1">Google account email</label>
                <input
                  type="email"
                  autoComplete="username"
                  className="input input-bordered input-sm w-full"
                  placeholder="you@gmail.com"
                  value={gmailForm.email}
                  onChange={(e) => setGmailForm({ ...gmailForm, email: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label text-xs text-base-content/50 pb-1">16-character app password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  className="input input-bordered input-sm w-full font-mono tracking-wider"
                  placeholder="xxxx xxxx xxxx xxxx"
                  value={gmailForm.app_password}
                  onChange={(e) => setGmailForm({ ...gmailForm, app_password: e.target.value })}
                  required
                />
                <p className="text-[11px] text-base-content/35 mt-1">Use the generated app password, not your regular Google password.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Sender name <span className="text-base-content/30">(optional)</span></label>
                  <input
                    className="input input-bordered input-sm w-full"
                    placeholder="Your Name"
                    value={gmailForm.from_name}
                    onChange={(e) => setGmailForm({ ...gmailForm, from_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Connection name <span className="text-base-content/30">(optional)</span></label>
                  <input
                    className="input input-bordered input-sm w-full"
                    placeholder="Gmail outreach"
                    value={gmailForm.name}
                    onChange={(e) => setGmailForm({ ...gmailForm, name: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Emails / day</label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    className="input input-bordered input-sm w-full"
                    value={gmailForm.daily_email_limit}
                    onChange={(e) => setGmailForm({ ...gmailForm, daily_email_limit: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Timezone</label>
                  <select
                    className="select select-sm w-full"
                    value={gmailForm.timezone}
                    onChange={(e) => setGmailForm({ ...gmailForm, timezone: e.target.value })}
                  >
                    {TIMEZONES.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="modal-action mt-3">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowGmailModal(false)} disabled={gmailLoading}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={gmailLoading}>
                  {gmailLoading ? <span className="loading loading-spinner loading-xs" /> : <RiShieldCheckLine size={14} />}
                  {gmailLoading ? "Verifying Gmail…" : "Connect and verify"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create / Edit modal */}
      {showModal && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-100 border border-[var(--border-subtle)] rounded-2xl shadow-[var(--shadow-modal)] max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-base mb-4">{editingAccount ? "Edit Email Account" : "Add Email Account"}</h3>
            <form onSubmit={save} className="flex flex-col gap-3">

              {/* Preset — only for create */}
              {!editingAccount && (
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Provider preset</label>
                  <div className="flex gap-2">
                    {[["outlook", "Outlook / Hotmail"], ["custom", "Custom SMTP"]].map(([key, label]) => (
                      <button key={key} type="button" onClick={() => applyPreset(key)}
                        className={`px-3 py-1.5 rounded-[10px] text-xs font-medium border transition-colors ${form.preset === key ? "bg-primary/10 text-primary border-primary/30" : "bg-base-100 text-base-content/60 border-[var(--border)] hover:bg-base-200"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Display name</label>
                  <input className="input input-bordered input-sm w-full" placeholder="My Gmail" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                </div>
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">From name (optional)</label>
                  <input className="input input-bordered input-sm w-full" placeholder="Your Name" value={form.from_name} onChange={(e) => setForm({ ...form, from_name: e.target.value })} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">From email address</label>
                  <input type="email" className="input input-bordered input-sm w-full" placeholder="you@gmail.com" value={form.from_email} onChange={(e) => setForm({ ...form, from_email: e.target.value })} required />
                </div>
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Reply-To (optional)</label>
                  <input type="email" className="input input-bordered input-sm w-full" placeholder="you@example.com" value={form.reply_to} onChange={(e) => setForm({ ...form, reply_to: e.target.value })} />
                </div>
              </div>

              <div className="border-t border-[var(--border-subtle)] pt-3">
                <p className="text-xs font-medium text-base-content/50 mb-2 uppercase tracking-wide">SMTP (sending)</p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="label text-xs text-base-content/50 pb-1">Host</label>
                    <input className="input input-bordered input-sm w-full font-mono text-xs" placeholder="smtp.gmail.com" value={form.smtp_host} onChange={(e) => setForm({ ...form, smtp_host: e.target.value })} required />
                  </div>
                  <div>
                    <label className="label text-xs text-base-content/50 pb-1">Port</label>
                    <input type="number" className="input input-bordered input-sm w-full" value={form.smtp_port} onChange={(e) => setForm({ ...form, smtp_port: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2 mb-3">
                  <input type="checkbox" className="checkbox checkbox-xs" checked={form.smtp_secure === 1} onChange={(e) => setForm({ ...form, smtp_secure: e.target.checked ? 1 : 0 })} id="smtp_secure" />
                  <label htmlFor="smtp_secure" className="text-xs text-base-content/60">Use SSL (port 465). Leave unchecked for STARTTLS (port 587).</label>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-base-content/50 uppercase tracking-wide">Credentials</p>
                  <button
                    type="button"
                    onClick={() => setSmtpUnlocked((v) => !v)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-base-content/40 hover:text-base-content hover:bg-base-200 transition-colors"
                  >
                    {smtpUnlocked ? <RiLockUnlockLine size={12} /> : <RiLockLine size={12} />}
                    {smtpUnlocked ? "Lock" : "Unlock to edit"}
                  </button>
                </div>
                {!smtpUnlocked ? (
                  <div className="px-3 py-2.5 rounded-lg bg-base-200 border border-[var(--border-subtle)] text-xs text-base-content/40">
                    {form.username
                      ? <span><span className="text-base-content/60 font-mono">{form.username}</span> · password kept</span>
                      : "Unlock to set username and password"}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="label text-xs text-base-content/50 pb-1">Username / Email</label>
                      <input
                        autoComplete="new-password"
                        className="input input-bordered input-sm w-full"
                        placeholder="you@gmail.com"
                        value={form.username}
                        onChange={(e) => setForm({ ...form, username: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <label className="label text-xs text-base-content/50 pb-1">
                        {editingAccount ? "New password (blank = keep)" : "App password"}
                      </label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        className="input input-bordered input-sm w-full"
                        placeholder={editingAccount ? "•••••••• (unchanged)" : "xxxx xxxx xxxx xxxx"}
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        required={!editingAccount}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-[var(--border-subtle)] pt-3">
                <p className="text-xs font-medium text-base-content/50 mb-2 uppercase tracking-wide">IMAP (inbox reading — optional)</p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="label text-xs text-base-content/50 pb-1">Host</label>
                    <input className="input input-bordered input-sm w-full font-mono text-xs" placeholder="imap.gmail.com" value={form.imap_host} onChange={(e) => setForm({ ...form, imap_host: e.target.value })} />
                  </div>
                  <div>
                    <label className="label text-xs text-base-content/50 pb-1">Port</label>
                    <input type="number" className="input input-bordered input-sm w-full" value={form.imap_port} onChange={(e) => setForm({ ...form, imap_port: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="flex items-center justify-between mb-2 mt-3">
                  <p className="text-xs font-medium text-base-content/50 uppercase tracking-wide">Credentials</p>
                  <button
                    type="button"
                    onClick={() => setImapUnlocked((v) => !v)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-base-content/40 hover:text-base-content hover:bg-base-200 transition-colors"
                  >
                    {imapUnlocked ? <RiLockUnlockLine size={12} /> : <RiLockLine size={12} />}
                    {imapUnlocked ? "Lock" : "Unlock to edit"}
                  </button>
                </div>
                {!imapUnlocked ? (
                  <div className="px-3 py-2.5 rounded-lg bg-base-200 border border-[var(--border-subtle)] text-xs text-base-content/40">
                    {form.imap_username
                      ? <span><span className="text-base-content/60 font-mono">{form.imap_username}</span> · password kept</span>
                      : <span>Uses SMTP credentials · password kept</span>}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="label text-xs text-base-content/50 pb-1">IMAP username <span className="text-base-content/30">(blank = same as SMTP)</span></label>
                      <input
                        autoComplete="new-password"
                        className="input input-bordered input-sm w-full font-mono text-xs"
                        placeholder="IMAP username"
                        value={form.imap_username}
                        onChange={(e) => setForm({ ...form, imap_username: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label text-xs text-base-content/50 pb-1">IMAP password <span className="text-base-content/30">(blank = keep)</span></label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        className="input input-bordered input-sm w-full"
                        placeholder="•••••••• (unchanged)"
                        value={form.imap_password}
                        onChange={(e) => setForm({ ...form, imap_password: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-[var(--border-subtle)] pt-3 flex flex-col gap-3">
                <p className="text-xs font-medium text-base-content/50 uppercase tracking-wide">Limits &amp; Schedule</p>
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Emails / day</label>
                  <input type="number" className="input input-bordered input-sm w-full" value={form.daily_email_limit} onChange={(e) => setForm({ ...form, daily_email_limit: Number(e.target.value) })} min={1} max={500} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label text-xs text-base-content/50 pb-1">Start</label>
                    <select className="select select-sm w-full" value={form.active_hours_start} onChange={(e) => setForm({ ...form, active_hours_start: Number(e.target.value) })}>
                      {HOURS.map(h => <option key={h} value={h}>{fmtHour(h)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label text-xs text-base-content/50 pb-1">End</label>
                    <select className="select select-sm w-full" value={form.active_hours_end} onChange={(e) => setForm({ ...form, active_hours_end: Number(e.target.value) })}>
                      {HOURS.map(h => <option key={h} value={h}>{fmtHour(h)}</option>)}
                    </select>
                  </div>
                </div>
                {form.active_hours_start >= form.active_hours_end
                  ? <p className="text-xs text-error">Start must be before end</p>
                  : <p className="text-xs text-base-content/40">{fmtHour(form.active_hours_start)} – {fmtHour(form.active_hours_end)} ({form.active_hours_end - form.active_hours_start}h window)</p>
                }
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Timezone</label>
                  <select className="select select-sm w-full" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
                    {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label text-xs text-base-content/50 pb-1">Working days</label>
                  <div className="flex gap-1.5">
                    {WEEKDAYS.map(day => {
                      const active = form.working_days.split(",").map(Number).includes(day.iso);
                      return (
                        <button
                          key={day.iso}
                          type="button"
                          onClick={() => {
                            const days = active
                              ? form.working_days.split(",").map(Number).filter(d => d !== day.iso)
                              : [...form.working_days.split(",").map(Number), day.iso].sort((a, b) => a - b);
                            setForm({ ...form, working_days: days.join(",") });
                          }}
                          className={`flex-1 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                            active
                              ? "bg-primary/15 text-primary border-primary/40"
                              : "bg-base-100 text-base-content/50 border-[var(--border)] hover:bg-base-200"
                          }`}
                        >
                          {day.short}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="border-t border-[var(--border-subtle)] pt-3 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-base-content/50 uppercase tracking-wide">Sending ramp-up</p>
                    <p className="text-xs text-base-content/35 mt-0.5">Start low, increase +2/day until target volume</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, ramp_up_enabled: !f.ramp_up_enabled }))}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.ramp_up_enabled ? "bg-primary" : "bg-base-300"} border border-[var(--border-subtle)]`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${form.ramp_up_enabled ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>
                </div>

                {form.ramp_up_enabled && (
                  <>
                    <div>
                      <label className="label text-xs text-base-content/50 pb-1">Ramp start date</label>
                      <DateField value={form.ramp_start_date} onChange={(v) => setForm(f => ({ ...f, ramp_start_date: v }))} label="Ramp start date" clearable={false} />
                    </div>
                    <RampDiagram startDate={form.ramp_start_date} target={form.daily_email_limit} />
                  </>
                )}
              </div>

              <div className="border-t border-[var(--border-subtle)] pt-3">
                <p className="text-xs font-medium text-base-content/50 mb-1 uppercase tracking-wide">Signature</p>
                <p className="text-xs text-base-content/35 mb-2">
                  Appended to outgoing emails. If empty, nothing is added — no separator line, nothing.
                </p>
                <textarea
                  className="textarea textarea-bordered w-full text-sm h-24 resize-none font-mono"
                  placeholder={"John Smith\nHead of Sales · Acme Corp\njohn@acme.com"}
                  value={form.signature}
                  onChange={(e) => setForm({ ...form, signature: e.target.value })}
                />
              </div>

              <div className="modal-action mt-1">
                <button type="button" className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-200 transition-colors" onClick={() => { setShowModal(false); setEditingAccount(null); setSmtpUnlocked(false); setImapUnlocked(false); }}>
                  Cancel
                </button>
                <button type="submit" className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50" disabled={loading}>
                  {loading ? <span className="loading loading-spinner loading-xs" /> : editingAccount ? "Save changes" : <><RiMailLine size={14} /> Add Account</>}
                </button>
              </div>
            </form>
          </div>
          <div className="modal-backdrop" onClick={() => { setShowModal(false); setEditingAccount(null); setSmtpUnlocked(false); setImapUnlocked(false); }} />
        </div>
      )}
    </div>
  );
}

// ─── Integrations Tab ─────────────────────────────────────────────────────────
