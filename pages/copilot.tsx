import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { RiBrainLine, RiCheckLine, RiCloseLine, RiInbox2Line, RiLoader4Line, RiRocket2Line } from "react-icons/ri";
import { SearchSelect } from "@/components/agents/sources/kit";
import { Avatar } from "@/components/agents/ui";
import LeadPanel from "@/components/copilot/LeadPanel";
import LeadDrawer from "@/components/agents/LeadDrawer";
import type { BoardItem, CopilotBoard } from "@/lib/agents/copilot-board";
import { requireSignedIn } from "@/lib/agents/page-auth";

export const getServerSideProps = requireSignedIn;

type Mode = "autopilot" | "copilot";
interface Account { id: string; name: string | null; email: string | null; is_authenticated: number }
const CLEAR = "__clear__";

function hoursUntil(iso: string | null): string {
  if (!iso) return "soon";
  const h = Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000);
  return h <= 0 ? "now" : h < 48 ? `in ${h} hour${h === 1 ? "" : "s"}` : `in ${Math.round(h / 24)} days`;
}

function Row({ item, on, rejected, onClick }: { item: BoardItem; on: boolean; rejected: boolean; onClick: () => void }) {
  const approved = item.pending === 0 && !rejected;
  return (
    <li>
      <button type="button" onClick={onClick} aria-current={on ? "true" : undefined}
        className={`flex w-full items-center gap-4 border-b border-[var(--border-subtle)] px-5 py-4 text-left transition-colors ${on ? "bg-primary/[0.09]" : "hover:bg-base-200/50"}`}>
        <Avatar name={item.full_name} src={item.profile_image_url} size={44} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] text-base-content">{item.full_name ?? "Unknown"}</span>
          <span className="block truncate text-[15px] text-base-content/60">{[item.title ?? item.headline, item.company].filter(Boolean).join(" · ")}</span>
        </span>
        {approved && <RiCheckLine size={22} className="shrink-0 text-success" aria-label="Approved" />}
        {rejected && <RiCloseLine size={22} className="shrink-0 text-base-content/40" aria-label="Rejected" />}
      </button>
    </li>
  );
}

/** Copilot: leads waiting on outreach, from agents in autopilot (scheduled) or review mode. */
export default function Copilot() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("autopilot");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [account, setAccount] = useState("");
  const [board, setBoard] = useState<CopilotBoard | null>(null);
  const [selected, setSelected] = useState<string | null>(typeof router.query.contact === "string" ? router.query.contact : null);
  /** Rejected this session: they stay listed (marked) until the next load, so the reason can still be given. */
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    fetch("/api/accounts").then((r) => r.json()).then((a: Account[]) => {
      const list = Array.isArray(a) ? a : [];
      setAccounts(list);
      setAccount((cur) => cur || list.find((x) => x.is_authenticated)?.id || "");
    }).catch(() => {});
  }, []);

  const load = useCallback(async (m: Mode, acc: string) => {
    setBoard(null);
    const q = new URLSearchParams({ mode: m, ...(acc ? { account_id: acc } : {}) });
    const b = await fetch(`/api/copilot?${q}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) as CopilotBoard | null;
    setBoard(b ?? { items: [], active: 0, activeInMode: 0, nextLaunch: null });
    setSelected((cur) => (b?.items.some((i) => i.id === cur) ? cur : b?.items[0]?.id ?? null));
  }, []);
  useEffect(() => {
    // Fetch-on-change: the board is external data for the chosen tab and sender.
    void (async () => { await load(mode, account); })();
  }, [load, mode, account]);

  function decided(targetId: string, decision: "approve" | "reject") {
    if (decision === "reject") { setRejected((cur) => new Set(cur).add(targetId)); return; }
    setBoard((b) => b && { ...b, items: b.items.map((i) => (i.id === targetId ? { ...i, pending: 0, approved: i.approved + i.pending } : i)) });
  }

  const sender = accounts.find((a) => a.id === account);
  const items = board?.items ?? [];
  const emptyText = !board ? "" : board.active === 0
    ? "No contacts here because no campaign have been started yet"
    : board.activeInMode === 0
      ? `No contacts here because no campaigns are currently in ${mode === "autopilot" ? "Autopilot" : "Review"} mode`
      : "No contacts waiting right now. New leads appear here as your agents find and qualify them.";

  return (
    <>
      <Head><title>Copilot — Kairo</title></Head>
      <div className="-mt-2 mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border-subtle)] pb-5">
        <div>
          <div className="flex items-center gap-3"><RiBrainLine size={22} className="text-primary" /><div role="heading" aria-level={1} className="text-[24px] font-medium text-base-content">Copilot</div></div>
          <p className="mt-1 pl-1 text-[16px] text-base-content/65">Review and act on AI-recommended leads</p>
        </div>
        <div className="w-full sm:w-[330px]">
          <SearchSelect label="LinkedIn account" value={account} placeholder="All LinkedIn accounts" searchable
            onChange={(v) => setAccount(v === CLEAR ? "" : v)}
            options={[
              { value: CLEAR, label: "Clear selection", lead: <RiCloseLine size={18} className="text-base-content/55" /> },
              ...accounts.map((a) => ({ value: a.id, label: a.name ?? a.email ?? "LinkedIn account", lead: <Avatar name={a.name ?? a.email} size={24} /> })),
            ]} />
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:-mb-10 lg:h-[calc(100vh-150px)] lg:min-h-[560px] lg:flex-row">
        <section className="flex min-h-[420px] flex-col overflow-hidden rounded-[16px] border border-[var(--border-subtle)] bg-base-100 lg:w-[460px] lg:shrink-0">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
            <div role="heading" aria-level={2} className="text-[20px] font-medium text-base-content">{mode === "autopilot" ? "Scheduled actions" : "Today's priority"}</div>
            <div role="tablist" aria-label="Agent mode" className="flex rounded-full bg-base-200 p-1">
              {(["autopilot", "copilot"] as const).map((m) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                  className={`h-9 rounded-full px-5 text-[15px] transition-colors duration-200 ${mode === m ? "bg-primary text-primary-content shadow-sm" : "text-base-content/75 hover:text-base-content"}`}>
                  {m === "autopilot" ? "Autopilot" : "Review"}
                </button>
              ))}
            </div>
          </div>
          {board && items.length > 0 && (
            <div className="border-b border-[var(--border-subtle)] bg-primary/[0.03] px-5 py-2.5 text-center text-[15px] text-base-content/65">
              {mode === "autopilot" ? `Automatic launch ~ ${hoursUntil(board.nextLaunch)} (${items.length} contact${items.length === 1 ? "" : "s"})` : "Approve to start outreach"}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!board ? <div className="flex justify-center py-16"><RiLoader4Line size={26} className="animate-spin text-primary" /></div>
              : items.length ? <ul>{items.map((i) => <Row key={i.id} item={i} on={i.id === selected} rejected={rejected.has(i.id)} onClick={() => setSelected(i.id)} />)}</ul>
              : (
                <div className="flex flex-col items-center gap-3 px-8 py-16 text-center">
                  <RiInbox2Line size={44} className="text-base-content/35" />
                  <p className="text-[15px] italic text-base-content/50">{emptyText}</p>
                </div>
              )}
          </div>
        </section>

        <section className="flex min-h-[560px] min-w-0 flex-1 flex-col overflow-hidden rounded-[16px] border border-[var(--border-subtle)] bg-base-100">
          {selected && items.some((i) => i.id === selected) ? (
            <LeadPanel key={selected} targetId={selected} mode={mode} firstLaunch={items.find((i) => i.id === selected)?.auto_approve_at ?? board?.nextLaunch ?? null}
              sender={{ name: sender?.name ?? "You", photo: null }} onDecided={decided} onOpenLead={setDrawer} reloadKey={reloadKey} />
          ) : board ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
              <RiRocket2Line size={56} className="text-base-content/30" />
              <div className="text-[22px] text-base-content">{board.active === 0 ? "Start your first campaign to see contacts popping up here" : "Nothing to review right now"}</div>
              <div className="text-[17px] text-base-content/60">{board.active === 0 ? "No contacts here because no campaign have been started yet" : emptyText}</div>
              <Link href="/agents" className="mt-1 text-[17px] text-[#5b4fd6] hover:underline">Edit my campaigns</Link>
            </div>
          ) : null}
        </section>
      </div>

      <LeadDrawer targetId={drawer} onClose={() => setDrawer(null)} onChanged={() => setReloadKey((k) => k + 1)}
        siblings={items.map((i) => i.id)} onOpen={(id) => { setDrawer(id); setSelected(id); }} />
    </>
  );
}
