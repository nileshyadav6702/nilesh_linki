import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RiChat3Line, RiCloseLine, RiFireLine, RiInbox2Line, RiInboxLine, RiLoader4Line, RiMailLine, RiPencilLine, RiRefreshLine, RiSearchLine } from "react-icons/ri";
import AccountSwitcher from "@/components/inbox/AccountSwitcher";
import Compose from "@/components/inbox/Compose";
import ThreadView from "@/components/inbox/ThreadView";
import { ago, PersonAvatar, type AccountsInfo, type ThreadRow } from "@/components/inbox/kit";
import { requireSignedIn } from "@/lib/agents/page-auth";

export const getServerSideProps = requireSignedIn;

type Filter = "received" | "interested" | "unread" | "all";
const FILTERS: Array<{ id: Filter; label: string; icon?: React.ReactNode }> = [
  { id: "received", label: "Received", icon: <RiInboxLine size={16} /> }, { id: "interested", label: "Interested", icon: <RiFireLine size={16} /> },
  { id: "unread", label: "Unread", icon: <RiMailLine size={16} /> }, { id: "all", label: "All" },
];

function Row({ t, on, onClick }: { t: ThreadRow; on: boolean; onClick: () => void }) {
  const email = t.channel === "email";
  const unread = !!t.unread;
  return (
    <li>
      <button type="button" onClick={onClick} aria-current={on ? "true" : undefined}
        className={`relative flex w-full gap-3.5 border-b border-[var(--border-subtle)] px-5 py-4 text-left transition-colors ${on ? "bg-primary/[0.08] before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary" : "hover:bg-base-200/50"}`}>
        <PersonAvatar name={t.participant_name ?? t.participant_email} photo={t.participant_photo} channel={t.channel} size={42} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={`min-w-0 flex-1 truncate text-[16px] ${unread ? "font-semibold text-base-content" : "text-base-content"}`}>{t.participant_name ?? t.participant_email ?? "Unknown"}</span>
            {!!t.interested && <RiFireLine size={15} className="shrink-0 text-primary" aria-label="Interested" />}
            {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
            <span className="shrink-0 text-[13px] text-base-content/50">{ago(t.last_message_at)}</span>
          </span>
          {email && t.subject && <span className={`block truncate text-[14px] ${unread ? "font-medium text-base-content/85" : "text-base-content/75"}`}>{t.subject}</span>}
          <span className="block truncate text-[14px] text-base-content/55">{t.snippet}</span>
        </span>
      </button>
    </li>
  );
}

/** One inbox for every connected LinkedIn account and mailbox. */
export default function Inbox() {
  const [scope, setScope] = useState("all");
  const [filter, setFilter] = useState<Filter>("received");
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [info, setInfo] = useState<AccountsInfo | null>(null);
  const [threads, setThreads] = useState<ThreadRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadInfo = useCallback(() => fetch("/api/inbox/accounts").then((r) => r.json()).then(setInfo).catch(() => {}), []);
  const loadThreads = useCallback(async () => {
    const d = await fetch(`/api/inbox/threads?${new URLSearchParams({ scope, filter, q: q.trim(), limit: "100" })}`).then((r) => r.json()).catch(() => null);
    setThreads(d?.threads ?? []); setTotal(d?.total ?? 0);
    setSelected((cur) => (d?.threads?.some((t: ThreadRow) => t.id === cur) ? cur : d?.threads?.[0]?.id ?? null));
  }, [scope, filter, q]);
  useEffect(() => { void loadInfo(); }, [loadInfo]);
  useEffect(() => { const t = setTimeout(() => void loadThreads(), q ? 250 : 0); return () => clearTimeout(t); }, [loadThreads, q]);
  // While a sync is running, refresh as conversations arrive.
  const anyRunning = !!info?.sync.some((s) => s.running) || syncing;
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => { void loadInfo(); void loadThreads(); }, 5000);
    return () => clearInterval(t);
  }, [anyRunning, loadInfo, loadThreads]);

  async function syncNow() {
    setSyncing(true);
    try {
      const d = await fetch("/api/inbox/accounts", { method: "POST" }).then((r) => r.json());
      toast.success(d.started ? `Syncing ${d.started} account${d.started === 1 ? "" : "s"}…` : "No connected accounts to sync");
      setTimeout(() => { setSyncing(false); void loadInfo(); void loadThreads(); }, 8000);
    } catch { setSyncing(false); toast.error("Could not start the sync"); }
  }

  const linkedinAccount = (() => {
    const [ch, id] = scope.split(":");
    if (ch === "linkedin" && id) return info?.linkedin.accounts.find((a) => a.id === id) ?? null;
    return info?.linkedin.accounts.length === 1 || ch === "linkedin" || ch === "all" ? info?.linkedin.accounts[0] ?? null : null;
  })();
  const lastSync = info?.sync.map((s) => s.synced_at).filter((x): x is string => !!x).sort().pop() ?? null;
  const syncError = info?.sync.find((s) => s.error)?.error ?? null;
  const noAccounts = info && !info.linkedin.accounts.length && !info.email.accounts.length;

  return (
    <>
      <Head><title>Inbox — Kairo</title></Head>
      <div className="-mt-2 mb-5 border-b border-[var(--border-subtle)] pb-4">
        <div className="flex items-center gap-3"><RiInbox2Line size={22} className="text-primary" /><div role="heading" aria-level={1} className="text-[24px] font-medium">Inbox</div></div>
        <p className="mt-1 pl-1 text-[16px] text-base-content/65">One unified inbox for all your LinkedIn and email conversations</p>
      </div>

      <div className="flex flex-col gap-5 lg:-mb-10 lg:h-[calc(100vh-170px)] lg:min-h-[560px] lg:flex-row">
        <section className="flex min-h-[420px] flex-col overflow-hidden rounded-[16px] border border-[var(--border-subtle)] bg-base-100 lg:w-[440px] lg:shrink-0">
          <div className="space-y-3 border-b border-[var(--border-subtle)] px-5 pb-4 pt-5">
            {searching ? (
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <RiSearchLine size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base-content/45" />
                  <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search conversations..." aria-label="Search conversations"
                    className="h-11 w-full rounded-[10px] border border-primary/50 bg-base-100 pl-9 pr-3 text-[15px] outline-none ring-2 ring-[var(--ring)]" />
                </div>
                <button type="button" onClick={() => { setSearching(false); setQ(""); }} aria-label="Close search" className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-base-200 text-base-content/70 hover:bg-base-300"><RiCloseLine size={20} /></button>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[20px] font-medium">Conversations</div>
                  <div className="text-[14px] text-base-content/55">{total.toLocaleString()} conversation{total === 1 ? "" : "s"}</div>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => void syncNow()} disabled={anyRunning} title={lastSync ? `Last synced ${ago(lastSync)}` : "Sync now"} aria-label="Sync now"
                    className="flex h-10 w-10 items-center justify-center rounded-[10px] text-base-content/60 hover:bg-base-200 hover:text-base-content disabled:opacity-70">
                    <RiRefreshLine size={19} className={anyRunning ? "animate-spin" : ""} />
                  </button>
                  <button type="button" onClick={() => setSearching(true)} aria-label="Search" className="flex h-10 w-10 items-center justify-center rounded-[10px] text-base-content/60 hover:bg-base-200 hover:text-base-content"><RiSearchLine size={20} /></button>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <AccountSwitcher scope={scope} setScope={(s) => { setScope(s); setComposing(false); }} info={info} />
              {linkedinAccount && (
                <button type="button" onClick={() => setComposing(true)} title="Send a new message" aria-label="Send a new message"
                  className={`flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${composing ? "border-primary bg-primary/10 text-primary" : "border-primary/40 text-primary hover:bg-primary/10"}`}><RiPencilLine size={18} /></button>
              )}
            </div>
            <div role="tablist" aria-label="Filter conversations" className="flex flex-wrap gap-2">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[14px] transition-colors ${filter === f.id ? "border-primary/50 bg-primary/10 text-primary" : "border-[var(--border-subtle)] text-base-content/75 hover:bg-base-200"}`}>
                  {f.icon}{f.label}
                </button>
              ))}
            </div>
            {syncError && <div className="rounded-[8px] bg-error/8 px-3 py-2 text-[13px] text-error">Last sync failed: {syncError}</div>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {threads === null ? <div className="flex justify-center py-12"><RiLoader4Line size={24} className="animate-spin text-primary" /></div>
              : threads.length ? <ul>{threads.map((t) => <Row key={t.id} t={t} on={!composing && t.id === selected} onClick={() => { setComposing(false); setSelected(t.id); setThreads((cur) => cur?.map((x) => (x.id === t.id ? { ...x, unread: 0 } : x)) ?? null); }} />)}</ul>
              : (
                <div className="flex flex-col items-center gap-2 px-8 py-14 text-center">
                  <RiChat3Line size={40} className="text-base-content/30" />
                  <div className="text-[15px] text-base-content/60">{noAccounts ? "Connect a LinkedIn account or mailbox to see your conversations here." : anyRunning ? "Syncing your conversations…" : q ? "No conversations match your search." : "No conversations here yet."}</div>
                  {noAccounts && <Link href="/settings" className="text-[15px] text-[#5b4fd6] hover:underline">Connect an account</Link>}
                </div>
              )}
          </div>
        </section>

        <section className="flex min-h-[560px] min-w-0 flex-1 flex-col overflow-hidden rounded-[16px] border border-[var(--border-subtle)] bg-base-100">
          {composing && linkedinAccount ? <Compose account={linkedinAccount} onClose={() => setComposing(false)} />
            : selected ? <ThreadView key={selected} id={selected}
                onChanged={(p) => setThreads((cur) => cur?.map((x) => (x.id === selected ? { ...x, ...p } : x)) ?? null)}
                onRemoved={() => { void loadThreads(); void loadInfo(); }} />
            : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                <RiInbox2Line size={48} className="text-base-content/25" />
                <div className="text-[18px]">Select a conversation</div>
                <div className="text-[15px] text-base-content/55">Your LinkedIn and email conversations appear here.</div>
              </div>
            )}
        </section>
      </div>
    </>
  );
}
