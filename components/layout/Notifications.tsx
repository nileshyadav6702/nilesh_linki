import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { LuBell, LuCircleAlert, LuCircleCheck } from "react-icons/lu";
import { useDismiss } from "@/components/agents/leads/Listbox";
import type { NotificationItem } from "@/pages/api/notifications";

/** "10/10/26, 3:51 AM", in the viewer's own time. */
function stamp(at: string | null): string {
  if (!at) return "";
  const t = Date.parse(at);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleString("en-US", { month: "numeric", day: "numeric", year: "2-digit", hour: "numeric", minute: "2-digit" });
}

/**
 * Sidebar bell. "Needs attention" (pinned, until resolved): disconnected senders, paused mailboxes,
 * LinkedIn's weekly limit, credits, leads on hold, failing sources, leads to review. Then what
 * happened: daily outreach, replies, acceptances, new leads, meetings, finished campaigns,
 * failures, bounces, unsubscribes. Unread ones are highlighted until "Mark all read".
 */
export default function Notifications({ sidebarWidth }: { sidebarWidth: number }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ alerts: NotificationItem[]; items: NotificationItem[]; unread: number } | null>(null);
  const [top, setTop] = useState(16);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useDismiss(open, [btn, panel], () => setOpen(false));

  const load = useCallback(() => fetch("/api/notifications").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setData(d); }).catch(() => {}), []);
  useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  function toggle() {
    if (!open && btn.current) setTop(Math.max(12, btn.current.getBoundingClientRect().top - 8));
    setOpen((v) => !v);
  }

  async function markAllRead() {
    setData((d) => (d ? { alerts: d.alerts.map((i) => ({ ...i, unread: false })), items: d.items.map((i) => ({ ...i, unread: false })), unread: 0 } : d));
    await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "read_all" }) }).catch(() => {});
    void load();
  }

  const n = data?.unread ?? 0;
  return (
    <>
      <button ref={btn} type="button" onClick={toggle} aria-label={n ? `Notifications, ${n} new` : "Notifications"} aria-expanded={open}
        className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors ${open ? "border-base-content/25 bg-base-200 text-base-content" : "border-[var(--border-subtle)] text-base-content/60 hover:bg-base-200 hover:text-base-content"}`}>
        <LuBell size={21} />
        {n > 0 && <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-[#e5484d] ring-2 ring-base-100" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div ref={panel} role="dialog" aria-label="Notifications"
            initial={{ opacity: 0, x: -8, scale: 0.98 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: -8, scale: 0.98 }} transition={{ duration: 0.16 }}
            style={{ left: sidebarWidth + 10, top }}
            className="fixed z-[60] flex max-h-[min(680px,calc(100vh-24px))] w-[610px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-base-100 shadow-[var(--shadow-overlay)]">
            <header className="flex items-center gap-3 border-b border-[var(--border-subtle)] bg-[#2f6fed]/[0.07] px-6 py-5">
              <LuBell size={20} className="text-[#2f6fed]" />
              <h2 className="text-[21px] font-semibold text-base-content">Notifications</h2>
              {n > 0 && <span className="rounded-full bg-[#2f6fed]/12 px-3 py-0.5 text-[14.5px] font-medium text-[#2f6fed]">{n} new</span>}
              {n > 0 && (
                <button type="button" onClick={() => void markAllRead()} className="ml-auto text-[16.5px] font-medium text-[#2f6fed] hover:underline">
                  Mark all read
                </button>
              )}
            </header>

            {data && (data.alerts.length || data.items.length) ? (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {data.alerts.length > 0 && (
                    <section aria-label="Needs attention" className="border-b-[6px] border-base-200">
                      <div className="flex items-center gap-2 px-6 pb-1 pt-4 text-[14px] font-semibold uppercase tracking-wide text-[#b45309]">
                        <LuCircleAlert size={17} /> Needs attention
                      </div>
                      <ul>{data.alerts.map((it) => <Row key={it.id} it={it} onOpen={() => setOpen(false)} />)}</ul>
                    </section>
                  )}
                  <ul>{data.items.map((it) => <Row key={it.id} it={it} onOpen={() => setOpen(false)} />)}</ul>
                </div>
                <footer className="flex justify-center border-t border-[var(--border-subtle)] bg-base-200/40 px-6 py-4">
                  <span className="inline-flex items-center gap-2 rounded-[10px] bg-base-200 px-5 py-2.5 text-[16.5px] text-base-content/65">
                    <LuCircleCheck size={19} className="text-base-content/45" /> All notifications loaded
                  </span>
                </footer>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-base-200 text-base-content/45"><LuBell size={21} /></span>
                <div className="text-[17px] text-base-content/75">You&apos;re all caught up</div>
                <div className="text-[15.5px] text-base-content/50">Campaign results, replies, accepted invitations, new leads and anything that needs you show up here.</div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** One notification: bold title, one line of detail, time on the right; unread ones highlighted. */
function Row({ it, onOpen }: { it: NotificationItem; onOpen: () => void }) {
  const accent = it.tone === "alert" ? "text-[#b45309]" : it.tone === "good" ? "text-[#16803f]" : "text-base-content";
  return (
    <li className="border-b border-[var(--border-subtle)] last:border-b-0">
      <Link href={it.href} onClick={onOpen}
        className={`relative flex items-start gap-4 border-l-[4px] px-6 py-4 transition-colors ${it.unread ? "border-l-[#2f6fed] bg-[#2f6fed]/[0.07] hover:bg-[#2f6fed]/[0.1]" : "border-l-transparent hover:bg-base-200/60"}`}>
        {it.unread && <span className="absolute left-5 top-[22px] h-2.5 w-2.5 rounded-full bg-[#2f6fed]/70" aria-hidden />}
        <span className="min-w-0 flex-1 pl-4">
          <span className={`block text-[18px] font-semibold ${accent}`}>{it.title}</span>
          {it.text && <span className="mt-0.5 line-clamp-2 block text-[15.5px] text-base-content/65">{it.text}</span>}
        </span>
        {it.at && <span className="shrink-0 pt-1 text-[15px] text-base-content/55">{stamp(it.at)}</span>}
      </Link>
    </li>
  );
}
