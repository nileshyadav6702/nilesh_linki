import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { LuBell, LuMessageSquare, LuUserCheck } from "react-icons/lu";
import { useDismiss } from "@/components/agents/leads/Listbox";
import { ago, PersonAvatar } from "@/components/inbox/kit";
import type { NotificationItem } from "@/pages/api/notifications";

/** Sidebar bell: unread replies and leads waiting for review, refreshed every minute. Opens beside the sidebar. */
export default function Notifications({ sidebarWidth }: { sidebarWidth: number }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ items: NotificationItem[]; unread: number } | null>(null);
  const [top, setTop] = useState(16);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useDismiss(open, [btn, panel], () => setOpen(false));

  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/notifications").then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d) setData(d); }).catch(() => {});
    void load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  function toggle() {
    if (!open && btn.current) setTop(Math.max(12, btn.current.getBoundingClientRect().top - 8));
    setOpen((v) => !v);
  }

  const n = data?.unread ?? 0;
  return (
    <>
      <button ref={btn} type="button" onClick={toggle} aria-label={n ? `Notifications, ${n} new` : "Notifications"} aria-expanded={open}
        className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] transition-colors ${open ? "bg-base-200 text-base-content" : "text-base-content/55 hover:bg-base-200 hover:text-base-content"}`}>
        <LuBell size={22} />
        {n > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary ring-2 ring-base-100" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div ref={panel} role="dialog" aria-label="Notifications"
            initial={{ opacity: 0, x: -8, scale: 0.98 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: -8, scale: 0.98 }} transition={{ duration: 0.16 }}
            style={{ left: sidebarWidth + 10, top }}
            className="fixed z-[60] w-[380px] max-w-[calc(100vw-24px)] overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-base-100 shadow-[var(--shadow-overlay)]">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
              <div className="text-[16px] font-semibold">Notifications</div>
              {n > 0 && <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[12px] font-medium text-primary">{n} new</span>}
            </div>
            {data?.items.length ? (
              <ul className="max-h-[420px] overflow-y-auto py-1">
                {data.items.map((it) => (
                  <li key={it.id}>
                    <Link href={it.href} onClick={() => setOpen(false)} className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-base-200/60">
                      {it.kind === "reply"
                        ? <PersonAvatar name={it.title.replace(/ replied$/, "")} photo={it.photo} size={36} />
                        : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><LuUserCheck size={17} /></span>}
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-medium text-base-content">{it.title}</span>
                        {it.text && <span className="block truncate text-[13px] text-base-content/60">{it.text}</span>}
                      </span>
                      {it.at && <span className="shrink-0 pt-0.5 text-[12px] text-base-content/45">{ago(it.at)}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-base-200 text-base-content/45"><LuMessageSquare size={20} /></span>
                <div className="text-[14px] text-base-content/70">You&apos;re all caught up</div>
                <div className="text-[13px] text-base-content/45">New replies and leads to review show up here.</div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
