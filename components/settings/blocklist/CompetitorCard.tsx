import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { toast } from "sonner";
import { format } from "date-fns";
import { LuChevronRight, LuCoins, LuLoaderCircle, LuSearch, LuShield, LuShieldCheck } from "react-icons/lu";
import { SideDrawer } from "@/components/agents/campaign/kit";
import { failToast } from "@/components/settings/billing/credits-toast";

/** AI Competitor Filtering: on/off (prorated credits), and the companies it has kept out. */

interface Filtered { company_key: string; company_name: string | null; domain: string | null; reason: string | null; checked_at: string; leads: number }
interface State {
  enabled: boolean; seats: number; balance: number; can_edit: boolean; filtered: Filtered[];
  price: { now: number; monthly: number; days_left: number; renews_at: string };
}

const toDate = (s: string) => new Date(`${s.replace(" ", "T")}Z`);

function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label="AI Competitor Filtering" disabled={disabled} onClick={onClick}
      className={`relative h-8 w-14 shrink-0 rounded-full border-2 transition-colors disabled:opacity-60 ${on ? "border-primary bg-primary" : "border-[var(--border-strong)] bg-base-200"}`}>
      <span className={`absolute left-1 top-1/2 h-5 w-5 -translate-y-1/2 rounded-[6px] transition-[translate,background-color] duration-200 ease-out ${on ? "translate-x-[22px] bg-white" : "bg-base-content/35"}`} />
    </button>
  );
}

function ReviewDrawer({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Filtered[] | null>(null);
  const load = useCallback((query: string) => fetch(`/api/settings/competitor-filter?q=${encodeURIComponent(query)}`).then((r) => r.json()).then((d: State) => setRows(d.filtered)).catch(() => toast.error("Could not load filtered companies")), []);
  useEffect(() => { const t = setTimeout(() => void load(q), 200); return () => clearTimeout(t); }, [q, load]);
  async function allow(f: Filtered) {
    const r = await fetch("/api/settings/competitor-filter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allow: f.company_key }) });
    if (!r.ok) { toast.error("Could not update"); return; }
    toast.success(`${f.company_name ?? f.domain} will be allowed from now on`);
    await load(q);
  }
  return createPortal(
    <SideDrawer title="AI Competitors Filtered" onClose={onClose} width={720}>
      <div className="space-y-5 pb-4">
        <div className="text-[16px] text-base-content/70">Competitors kept out of your campaigns automatically. Disagree with one? Mark it and we&apos;ll allow it from now on.</div>
        <label className="relative block">
          <LuSearch size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base-content/45" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search filtered companies…" aria-label="Search filtered companies"
            className="h-12 w-full rounded-[10px] border border-[var(--border-strong)] bg-base-100 pl-11 pr-4 text-[16px] outline-none focus:border-primary/60 focus:ring-2 focus:ring-[var(--ring)]" />
        </label>
        {!rows && <div className="flex justify-center py-10"><LuLoaderCircle size={24} className="animate-spin text-primary" /></div>}
        {rows?.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-[var(--border-strong)] px-6 py-12 text-center">
            <LuShield size={36} className="text-base-content/45" />
            <div className="text-[18px] font-medium">No competitor filtered in the last 30 days</div>
            <div className="text-[15px] text-base-content/65">Companies blocked by AI Competitor Filtering will show up here.</div>
          </div>
        )}
        {rows?.map((f) => (
          <div key={f.company_key} className="flex items-start gap-4 rounded-[12px] border border-[var(--border-subtle)] px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="text-[17px] font-medium">{f.company_name ?? f.domain}{f.domain && f.company_name && <span className="ml-2 text-[14px] font-normal text-base-content/55">{f.domain}</span>}</div>
              {f.reason && <div className="mt-0.5 text-[15px] text-base-content/70">{f.reason}</div>}
              <div className="mt-1 text-[13px] text-base-content/50">Filtered {format(toDate(f.checked_at), "MMM d")}{f.leads ? ` · ${f.leads} lead${f.leads === 1 ? "" : "s"} skipped` : ""}</div>
            </div>
            <button type="button" onClick={() => void allow(f)} className="h-10 shrink-0 rounded-[8px] border border-[var(--border-strong)] px-3.5 text-[15px] font-medium hover:bg-base-200">Not a competitor</button>
          </div>
        ))}
      </div>
    </SideDrawer>,
    document.body,
  );
}

export default function CompetitorCard() {
  const [s, setS] = useState<State | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const load = useCallback(() => fetch("/api/settings/competitor-filter").then((r) => r.json()).then(setS).catch(() => {}), []);
  useEffect(() => { void load(); }, [load]);

  async function set(enabled: boolean) {
    setBusy(true);
    const r = await fetch("/api/settings/competitor-filter", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { failToast(d, "Could not update"); return; }
    setConfirming(false);
    toast.success(enabled ? `AI Competitor Filtering is on${d.charged ? ` · ${d.charged} credits used` : ""}` : "AI Competitor Filtering is off");
    await load();
  }

  const on = !!s?.enabled;
  const short = s ? s.balance < s.price.now : false;
  return (
    <div className="rounded-[14px] border border-[var(--border-subtle)] bg-base-200/25 px-7 py-6">
      <div className="flex items-start gap-5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] border border-[#f6c4b4] bg-[#fdf0ea]" style={{ color: "#e5603b" }}>{on ? <LuShieldCheck size={24} /> : <LuShield size={24} />}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[20px] font-medium">AI Competitor Filtering</span>
            <span className="rounded-[6px] border border-[#f6a98f] px-2.5 py-0.5 text-[14px]" style={{ color: "#e5603b" }}>50 credits/user/month</span>
          </div>
          <div className="mt-1 text-[17px] text-base-content/75">Automatically block direct competitors and functional substitutes, with no competitor list to build. Your manual entries below stay exactly as they are.</div>
        </div>
        <div className="flex flex-col items-center gap-1">
          <Toggle on={on || confirming} disabled={!s || busy || !s.can_edit} onClick={() => (on ? void set(false) : setConfirming((c) => !c))} />
          <span className="text-[14px] text-base-content/60">{on ? "On" : confirming ? "Confirm" : "Off"}</span>
        </div>
      </div>

      {confirming && s && !on && (
        <div className="wizard-rise mt-5 rounded-[12px] border border-[var(--border-subtle)] bg-base-100 px-6 py-5">
          <ul className="list-disc space-y-1.5 pl-5 text-[16px] text-base-content/80">
            <li>50 credits / user / month: {s.seats} workspace member{s.seats === 1 ? "" : "s"}, {s.price.monthly} credits per month.</li>
            <li>Charged now: <b>{s.price.now} credits</b> for the {s.price.days_left} day{s.price.days_left === 1 ? "" : "s"} left in this cycle (prorated), then {s.price.monthly} credits on {format(toDate(s.price.renews_at), "MMM d")}.</li>
            <li>Checks the company of every lead your agents are about to contact; competitors are skipped.</li>
            <li>Your manual blocklist stays unchanged.</li>
          </ul>
          {short && (
            <div className="mt-4 rounded-[10px] border border-[#f3b4a8] bg-[#fdecea] px-4 py-3 text-[15px]" style={{ color: "#b42318" }}>
              <div className="font-medium">You have {s.balance} credits. AI Competitor Filtering needs {s.price.now} now.</div>
              <div className="mt-0.5">Top up your workspace balance to switch it on.</div>
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {short
              ? <Link href="/settings?tab=billing" className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-primary px-5 text-[16px] font-semibold text-primary-content hover:bg-[var(--primary-hover)]"><LuCoins size={18} />Buy credits</Link>
              : <button type="button" disabled={busy} onClick={() => void set(true)} className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-primary px-5 text-[16px] font-semibold text-primary-content hover:bg-[var(--primary-hover)] disabled:opacity-60">{busy && <LuLoaderCircle size={17} className="animate-spin" />}Turn on for {s.price.now} credits</button>}
            <button type="button" onClick={() => setConfirming(false)} className="h-11 rounded-[8px] px-4 text-[16px] font-medium hover:bg-base-200">Cancel</button>
            <span className="text-[15px] text-base-content/60">You can turn it off at any time.</span>
          </div>
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <button type="button" onClick={() => setReview(true)} className="inline-flex items-center gap-1 text-[15px] font-medium text-base-content/75 hover:text-base-content">Review previously filtered companies<LuChevronRight size={17} /></button>
      </div>
      {review && <ReviewDrawer onClose={() => setReview(false)} />}
    </div>
  );
}
