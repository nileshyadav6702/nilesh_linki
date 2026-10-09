import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { format, startOfMonth, subDays, subMonths } from "date-fns";
import {
  RiArrowRightSLine, RiChat3Line, RiChatSmile3Line, RiCheckboxCircleLine, RiErrorWarningLine, RiFireFill, RiFlashlightFill,
  RiPencilLine, RiUser3Fill, RiUserAddLine,
} from "react-icons/ri";
import TrendChart, { type ChartSeries } from "@/components/ui/TrendChart";
import { Flames } from "@/components/contacts/cells";
import { ago, PersonAvatar } from "@/components/inbox/kit";
import { Card, CountUp, DealSizeDialog, Tile, money } from "@/components/dashboard/kit";
import { requireSignedIn } from "@/lib/agents/page-auth";
import type { DashboardSummary } from "@/lib/dashboard/summary";

export const getServerSideProps = requireSignedIn;

type Range = "7d" | "30d" | "3m" | "month";
const RANGES: Array<{ id: Range; label: string; sub: string }> = [
  { id: "7d", label: "7 days", sub: "Last 7 days" }, { id: "30d", label: "30 days", sub: "Last 30 days" },
  { id: "3m", label: "3 months", sub: "Last 3 months" }, { id: "month", label: "This month", sub: "This month" },
];
const day = (d: Date) => format(d, "yyyy-MM-dd");
function periodOf(r: Range) {
  const now = new Date();
  const from = r === "7d" ? subDays(now, 6) : r === "30d" ? subDays(now, 29) : r === "3m" ? subMonths(now, 3) : startOfMonth(now);
  return { from: day(from), to: day(now) };
}

/** Link colour (inline: the global a { color: inherit } rule beats utility classes on links). */
const LINK = "#5b4fd6";

const SERIES: ChartSeries[] = [
  { key: "leads", label: "Leads created", color: "#2fb98b" },
  { key: "invitations", label: "Invitations sent", color: "#b65ce6" },
  { key: "messages", label: "Messages sent", color: "#ec4899" },
  { key: "emails", label: "Emails sent", color: "#5b8def" },
];

function inHours(iso: string | null) {
  if (!iso) return null;
  const h = (Date.parse(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`) - Date.now()) / 3_600_000;
  if (h <= 0.5) return "now";
  return h < 1 ? "in < 1 hour" : h < 48 ? `in ${Math.round(h)} hour${Math.round(h) === 1 ? "" : "s"}` : `in ${Math.round(h / 24)} days`;
}

function Pill({ href, ok, children }: { href: string; ok: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={`group inline-flex h-12 items-center gap-2.5 rounded-[10px] border px-4 text-[16px] font-medium transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_18px_-10px_rgba(20,20,19,0.35)] ${ok ? "border-[var(--border-strong)] bg-base-200/70 text-base-content" : "border-[#f3c98b] bg-[#fff4e0] text-[#a65a00]"}`}>
      {ok ? <RiCheckboxCircleLine size={20} className="text-[#22a06b]" /> : <RiErrorWarningLine size={20} />}{children}
      <RiArrowRightSLine size={18} className="-ml-1 opacity-0 transition-all group-hover:ml-0 group-hover:opacity-60" />
    </Link>
  );
}

function Metric({ label, value, sub, period, first }: { label: string; value: number; sub?: string; period: string; first?: boolean }) {
  return (
    <div className={`px-7 py-7 ${first ? "" : "border-t border-dashed border-[var(--border-subtle)] md:border-l md:border-t-0"}`}>
      <div className="text-[15px] text-base-content/60">{label}</div>
      <div className="mt-2 text-[44px] font-bold leading-none tracking-tight text-base-content"><CountUp value={value} /></div>
      <div className="mt-4 text-[14px] leading-snug text-base-content/55">{sub && <div>{sub}</div>}<div>{period}</div></div>
    </div>
  );
}

/** Home: what needs doing, the period's headline numbers, activity, hot leads and replies. */
export default function Dashboard() {
  const { data: session } = useSession();
  const [range, setRange] = useState<Range>("30d");
  const period = useMemo(() => periodOf(range), [range]);
  const want = JSON.stringify(period);
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [editDeal, setEditDeal] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const loading = loadedFor !== want;

  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/dashboard/home?${new URLSearchParams(period)}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Could not load the dashboard"))))
      .then((d: DashboardSummary) => { setData(d); setLoadedFor(want); })
      .catch((err) => { if (!ctl.signal.aborted) { setLoadedFor(want); toast.error(err instanceof Error ? err.message : "Could not load the dashboard"); } });
    return () => ctl.abort();
  }, [period, want]);

  async function saveDeal(v: number | null) {
    const r = await fetch("/api/dashboard/home", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deal_size: v }) });
    if (!r.ok) { toast.error((await r.json().catch(() => ({}))).error ?? "Could not save the deal size"); return; }
    setData((d) => (d ? { ...d, dealSize: v } : d));
    setEditDeal(false);
    toast.success(v ? `Average deal size set to ${money(v)}` : "Deal size cleared");
  }

  const name = session?.user?.name?.split(" ")[0] || (session?.user?.email ?? "").split("@")[0].replace(/^\w/, (c) => c.toUpperCase());
  const sub = RANGES.find((r) => r.id === range)!.sub;
  const d = data;
  const pipeline = d?.dealSize ? d.dealSize * d.replies : null;
  const series = SERIES.filter((s) => !hidden.has(s.key));
  const nextIn = inHours(d?.next.nextAt ?? null);

  return (
    <>
      <Head><title>Dashboard — Linki</title></Head>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="insights-rise flex items-center gap-3 pt-2">
          <div role="heading" aria-level={1} className="text-[36px] font-semibold tracking-tight text-base-content">Welcome{name ? ` ${name}` : ""}</div>
          <span aria-hidden className="dash-float inline-block text-[34px] leading-none">🚀</span>
        </div>
        <div className="flex flex-col items-end gap-4">
          <div className="flex flex-wrap justify-end gap-3">
            <Pill href="/agents" ok={!!d?.activeSignals}>{d?.activeSignals ?? 0} Active Signal{d?.activeSignals === 1 ? "" : "s"}</Pill>
            <Pill href="/settings" ok={!!d?.linkedinAccounts}>{d?.linkedinAccounts ? `${d.linkedinAccounts} LinkedIn Account${d.linkedinAccounts === 1 ? "" : "s"}` : "Connect LinkedIn"}</Pill>
          </div>
          <div role="group" aria-label="Period" className="flex flex-wrap justify-end gap-2">
            {RANGES.map((r) => (
              <button key={r.id} type="button" aria-pressed={range === r.id} onClick={() => setRange(r.id)} style={range === r.id ? { background: "#2b2b33", color: "#fff" } : undefined}
                className={`h-10 rounded-[10px] px-4 text-[16px] transition-all ${range === r.id ? "font-medium shadow-[0_4px_12px_-4px_rgba(20,20,19,0.5)]" : "bg-base-200/70 text-base-content/75 hover:bg-base-200 hover:text-base-content"}`}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={`mt-8 space-y-6 transition-opacity duration-200 ${loading && d ? "opacity-60" : ""}`} aria-busy={loading}>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.55fr)_minmax(0,1fr)]">
          <Card className="flex flex-col gap-5 p-6">
            <div className="flex items-start gap-4">
              <Tile icon={<RiFlashlightFill size={28} />} />
              <div className="min-w-0 flex-1">
                <div className="whitespace-nowrap text-[19px] font-semibold leading-tight">Next actions</div>
                <div className="mt-1 flex items-center gap-1.5 whitespace-nowrap text-[14px] text-base-content/60">Pending tasks{!!d?.next.total && <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />}</div>
              </div>
              <div className="text-[40px] font-bold leading-none"><CountUp value={d?.next.total ?? 0} /></div>
            </div>
            {nextIn && <div className="-mt-3 text-right text-[14px] font-medium text-primary">Next launch {nextIn === "now" ? "due now" : `~ ${nextIn}`}</div>}
            <div className="mt-auto flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-4 text-[16px]">
              <span className="inline-flex items-center gap-2"><RiUserAddLine size={20} className="text-[#5b6cf0]" /><CountUp value={d?.next.invitations ?? 0} /> Invitations</span>
              <span className="inline-flex items-center gap-2"><RiChat3Line size={20} className="text-[#22a06b]" /><CountUp value={d?.next.messages ?? 0} /> Messages</span>
            </div>
          </Card>

          <Card delay={60} className="grid md:grid-cols-3">
            <Metric first label="Hot opportunities" value={d?.hot ?? 0} period={sub} />
            <Metric label="Leads engaged" value={d?.invitations ?? 0} sub="Invitations sent" period={sub} />
            <Metric label="Conversations" value={d?.messages ?? 0} sub="Messages sent" period={sub} />
          </Card>

          <Card delay={120} className="relative p-7">
            <div className="flex items-start justify-between">
              <div className="text-[15px] text-base-content/60">Pipeline generated</div>
              <button type="button" onClick={() => setEditDeal(true)} className="inline-flex items-center gap-1 text-[14px] font-medium text-primary hover:underline"><RiPencilLine size={14} />Edit</button>
            </div>
            {pipeline !== null ? (
              <>
                <div className="mt-2 text-[44px] font-bold leading-none tracking-tight"><CountUp value={pipeline} format={money} /></div>
                <div className="mt-4 text-[14px] text-base-content/55">{d!.replies} repl{d!.replies === 1 ? "y" : "ies"} × {money(d!.dealSize!)} · {sub}</div>
              </>
            ) : (
              <>
                <div className="mt-2 text-[44px] font-bold leading-none text-base-content/80">—</div>
                <button type="button" onClick={() => setEditDeal(true)} className="mt-4 text-left text-[14px] text-base-content/55 hover:text-primary">Set deal size to see pipeline generated</button>
              </>
            )}
          </Card>
        </div>

        <Card delay={180} className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[22px] font-semibold">Activity overview</div>
              <div className="mt-1 text-[15px] text-base-content/60">Track your lead generation &amp; outreach performance</div>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {SERIES.map((s) => {
                const off = hidden.has(s.key);
                return (
                  <button key={s.key} type="button" aria-pressed={!off} title={off ? `Show ${s.label.toLowerCase()}` : `Hide ${s.label.toLowerCase()}`}
                    onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(s.key)) n.delete(s.key); else if (n.size < SERIES.length - 1) n.add(s.key); return n; })}
                    className={`inline-flex items-center gap-2 text-[16px] transition-opacity ${off ? "opacity-40" : ""}`}>
                    <span className="h-3 w-3 rounded-full" style={{ background: s.color }} />{s.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-6">{d ? <TrendChart key={want + series.map((s) => s.key).join()} data={d.series} series={series} height={320} /> : <div className="h-[320px] animate-pulse rounded-[12px] bg-base-200/50" />}</div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card delay={240} className="overflow-hidden">
            <div className="flex items-center gap-4 p-6">
              <Tile icon={<RiUser3Fill size={28} />} />
              <div className="min-w-0 flex-1"><div className="text-[22px] font-semibold">Latest hot leads</div><div className="text-[15px] text-base-content/60">Your most promising prospects</div></div>
              <Link href="/contacts" style={{ color: LINK }} className="group inline-flex items-center gap-1 text-[16px] font-medium">View more<RiArrowRightSLine size={22} className="transition-transform group-hover:translate-x-0.5" /></Link>
            </div>
            {d?.hotLeads.length ? (
              <ul>
                {d.hotLeads.map((l) => (
                  <li key={l.id} className="border-t border-[var(--border-subtle)]">
                    <Link href={`/contacts/${l.id}`} className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-base-200/50">
                      <PersonAvatar name={l.full_name} photo={l.profile_image_url} size={48} />
                      <span className="min-w-0 flex-1">
                        <span style={{ color: LINK }} className="block truncate text-[17px] font-medium">{l.full_name ?? "Unknown"}</span>
                        <span className="block truncate text-[15px] text-base-content/70">{l.title ?? l.headline ?? ""}{l.company && <><span className="mx-1 text-base-content/35">@</span>{l.company}</>}</span>
                      </span>
                      <Flames score={l.score} size={22} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <Empty icon={<RiFireFill size={40} />} text={d ? "No hot leads yet" : "Loading…"} sub={d ? "Leads scoring 70+ show up here." : undefined} />}
          </Card>

          <Card delay={300} className="overflow-hidden">
            <div className="flex items-center gap-4 p-6">
              <Tile icon={<RiChatSmile3Line size={28} />} tone="violet" />
              <div className="min-w-0 flex-1"><div className="text-[22px] font-semibold">Latest replies</div><div className="text-[15px] text-base-content/60">Recent conversation responses</div></div>
              {!!d?.latestReplies.length && <Link href="/inbox" style={{ color: LINK }} className="group inline-flex items-center gap-1 text-[16px] font-medium">Open inbox<RiArrowRightSLine size={22} className="transition-transform group-hover:translate-x-0.5" /></Link>}
            </div>
            {d?.latestReplies.length ? (
              <ul>
                {d.latestReplies.map((r) => (
                  <li key={r.id} className="border-t border-[var(--border-subtle)]">
                    <Link href="/inbox" className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-base-200/50">
                      <PersonAvatar name={r.name} photo={r.photo} channel={r.channel === "email" ? "email" : "linkedin"} size={48} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2"><span className="truncate text-[17px] font-medium">{r.name ?? "Unknown"}</span>{!!r.interested && <RiFireFill size={15} className="shrink-0 text-primary" />}</span>
                        <span className="block truncate text-[15px] text-base-content/65">{r.snippet}</span>
                      </span>
                      <span className="shrink-0 text-[13px] text-base-content/45">{ago(r.at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <Empty icon={<RiChat3Line size={40} />} text={d ? "No replies yet" : "Loading…"} sub={d ? "Replies from LinkedIn and email land here." : undefined} />}
          </Card>
        </div>
      </div>

      {editDeal && <DealSizeDialog value={d?.dealSize ?? null} onCancel={() => setEditDeal(false)} onSave={saveDeal} />}
    </>
  );
}

function Empty({ icon, text, sub }: { icon: React.ReactNode; text: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 border-t border-[var(--border-subtle)] px-6 py-16 text-center">
      <span className="text-base-content/25">{icon}</span>
      <div className="text-[17px] text-base-content/65">{text}</div>
      {sub && <div className="text-[14px] text-base-content/45">{sub}</div>}
    </div>
  );
}
