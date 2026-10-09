import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { differenceInCalendarDays, format } from "date-fns";
import { LuCalendar, LuChevronDown, LuCoins, LuInfo, LuLoaderCircle, LuPlus, LuX } from "react-icons/lu";
import CreditsUsage, { type UsagePage } from "@/components/settings/billing/CreditsUsage";
import { BRAND } from "@/lib/brand";

/** Settings → Billing: plan, shared credit balance, add-ons and the credit log. */

interface Billing {
  plan: string; balance: number; used_this_cycle: number; cycle_start: string; next_refill_at: string; next_refill: number;
  credits_per_seat: number; seats: number; agents: number; invoice_email: string | null; can_edit: boolean;
  costs: { email_enrichment: number; lead_import_per: number; engager_import_per: number; agent_launch: number };
  usage: UsagePage;
}

const toDate = (s: string) => new Date(`${s.replace(" ", "T")}Z`);
const label = "text-[14px] font-medium tracking-[0.12em] text-base-content/50 [text-transform:uppercase]";

/** Hover tooltip with readable text (the shared one is sized for dense tables). */
function Tip({ text, children, align = "center" }: { text: string; children: ReactNode; align?: "center" | "right" }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span role="tooltip" className={`pointer-events-none absolute bottom-full z-50 mb-2 w-max max-w-[480px] rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-4 py-3 text-left text-[16px] font-normal leading-snug text-base-content opacity-0 shadow-[var(--shadow-overlay)] transition-opacity group-hover/tip:opacity-100 ${align === "right" ? "right-0" : "left-1/2 -translate-x-1/2"}`}>{text}</span>
    </span>
  );
}

function Fold({ title, sub, side, open, onToggle, children }: { title: string; sub: string; side?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="border-t border-[var(--border-subtle)] first:border-t-0">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-4 px-8 py-5 text-left hover:bg-base-200/30">
        <div className="min-w-0 flex-1"><div className="text-[18px] font-medium">{title}</div><div className="mt-0.5 text-[15px] text-base-content/65">{sub}</div></div>
        {side}
        <LuChevronDown size={24} className={`shrink-0 text-base-content/50 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && children}
    </div>
  );
}

function CostsDialog({ costs, onClose }: { costs: Billing["costs"]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Portal: the tab card animates with a transform, which would trap a fixed overlay inside it.
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button type="button" tabIndex={-1} aria-label="Close" onClick={onClose} className="absolute inset-0 bg-[#141413]/45" />
      <div role="dialog" aria-modal="true" aria-labelledby="buy-title" className="wizard-rise relative w-full max-w-[620px] rounded-[16px] bg-base-100 p-8 shadow-[var(--shadow-overlay)]">
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-[8px] text-base-content/60 hover:bg-base-200"><LuX size={20} /></button>
        <div id="buy-title" className="text-[22px] font-medium">Buy credits</div>
        <div className="mt-3 rounded-[10px] bg-[#fdf3c4]/70 px-4 py-3 text-[16px] leading-relaxed text-[#7a4a06]">
          Online checkout isn&apos;t available yet. Ask your {BRAND.name} administrator to add credits; they show up in your balance right away.
        </div>
        <div className="mt-6 text-[17px] font-medium">What uses credits</div>
        <CostList costs={costs} />
      </div>
    </div>,
    document.body,
  );
}

function CostList({ costs }: { costs: Billing["costs"] }) {
  const rows: Array<[string, string]> = [
    ["Find a professional email", `${costs.email_enrichment} credit per email found (refunded when none is found)`],
    ["Import Sales Navigator leads", `1 credit per ${costs.lead_import_per} new leads`],
    ["Import LinkedIn post engagers", `1 credit per ${costs.engager_import_per} new leads`],
    ["Launch an agent now", `${costs.agent_launch} credits (scheduled runs are free)`],
  ];
  return (
    <div className="mt-3 divide-y divide-[var(--border-subtle)] rounded-[12px] border border-[var(--border-subtle)]">
      {rows.map(([what, cost]) => (
        <div key={what} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-3.5 text-[16px]"><span className="font-medium">{what}</span><span className="text-base-content/70">{cost}</span></div>
      ))}
      <div className="px-5 py-3.5 text-[15px] leading-relaxed text-base-content/65">Included without credits: lead discovery, signal monitoring, scoring, AI-written messages, LinkedIn and email sending, scheduled agent runs, contacts and inbox.</div>
    </div>
  );
}

export default function BillingTab() {
  const [data, setData] = useState<Billing | null>(null);
  const [page, setPage] = useState(1);
  const [loadedPage, setLoadedPage] = useState(0);
  const [email, setEmail] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<{ invoices: boolean; usage: boolean }>({ invoices: false, usage: false });
  const [buying, setBuying] = useState(false);

  const load = useCallback((p: number) => fetch(`/api/settings/billing?page=${p}`).then((r) => r.json()).then((d: Billing) => { setData(d); setLoadedPage(p); }).catch(() => toast.error("Could not load billing")), []);
  useEffect(() => { void load(page); }, [load, page]);

  if (!data) return <div className="flex justify-center py-20"><LuLoaderCircle size={26} className="animate-spin text-primary" /></div>;

  const next = toDate(data.next_refill_at);
  const days = Math.max(0, differenceInCalendarDays(next, new Date()));
  const total = data.balance + data.used_this_cycle;
  const usedPct = total > 0 ? Math.min(100, (data.used_this_cycle / total) * 100) : 0;
  const invoiceEmail = email ?? data.invoice_email ?? "";
  const emailValid = invoiceEmail === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invoiceEmail.trim());
  const low = data.balance < data.costs.agent_launch;

  async function saveEmail() {
    if (!emailValid) return;
    setSaving(true);
    const r = await fetch("/api/settings/billing", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoice_email: invoiceEmail.trim() }) });
    setSaving(false);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(body.error ?? "Could not save"); return; }
    toast.success(invoiceEmail.trim() ? "Invoice recipient saved" : "Invoice recipient removed");
    setEmail(null);
    await load(page);
  }

  return (
    <div className="wizard-rise rounded-[16px] border border-[var(--border-subtle)] bg-base-100">
      <div className="border-b border-[var(--border-subtle)] px-8 py-6">
        <div role="heading" aria-level={2} className="text-[24px] font-medium">Workspace Billing</div>
        <div className="mt-1 text-[17px] text-base-content/70">Manage your workspace plan, credits and billing details</div>
      </div>

      <div className="space-y-12 px-8 py-8">
        {/* Current subscription */}
        <section>
          <div className="text-[20px] font-medium">Current subscription</div>
          <div className="mt-1 text-[17px] text-base-content/65">Your plan, billing cycle and credit balance.</div>

          <div className="mt-5 flex items-start gap-4 rounded-[12px] border border-[#c9c2f5] bg-[#f3f0ff] px-6 py-4">
            <LuInfo size={26} className="mt-0.5 shrink-0" style={{ color: "#5b3fd6" }} />
            <div>
              <div className="text-[17px] font-medium" style={{ color: "#3b2a99" }}>{data.plan === "trial" ? "Trial period active" : "Plan active"}</div>
              <div className="mt-0.5 text-[17px]" style={{ color: "#5b3fd6" }}>Credits refill every month and unused credits roll over. Paid plans and online checkout aren&apos;t available yet.</div>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-[14px] border border-[var(--border-subtle)]">
            <div className="flex flex-wrap items-center gap-4 bg-base-200/30 px-8 py-5">
              <span className="flex h-12 w-12 items-center justify-center rounded-[10px] border border-[var(--border-subtle)] bg-base-100"><LuCalendar size={24} /></span>
              <div className="flex-1 text-[20px] font-medium">{data.plan === "trial" ? "Trial" : data.plan} Plan (Monthly)</div>
              <span className="inline-flex h-9 items-center gap-2 rounded-full border border-success/25 bg-success/10 px-4 text-[15px]" style={{ color: "#1f7a3d" }}><span className="h-2 w-2 rounded-full bg-[#1f8a4c]" />Refills {format(next, "MMM d, yyyy")}</span>
            </div>
            <div className="grid gap-6 border-t border-[var(--border-subtle)] px-8 py-6 sm:grid-cols-3">
              <div><div className={label}>Billing period</div><div className="mt-2 text-[18px] font-medium">Monthly</div></div>
              <div><div className={label}>Cycle started</div><div className="mt-2 text-[18px] font-medium">{format(toDate(data.cycle_start), "MMM d, yyyy")}</div></div>
              <div><div className={label}>Credits per member</div><div className="mt-2 text-[18px] font-medium tabular-nums">{data.credits_per_seat} / month</div></div>
            </div>
            <div className="border-t border-[var(--border-subtle)] px-8 py-6">
              <div className="flex flex-wrap items-start gap-6">
                <div className="grid flex-1 gap-6 sm:grid-cols-3">
                  <div><div className={label}>Credits remaining</div><div className="mt-2 text-[32px] font-medium tabular-nums" style={{ color: low ? "#c2410c" : undefined }}>{data.balance.toLocaleString()}</div></div>
                  <div><div className={label}>Used this cycle</div><div className="mt-2 text-[32px] font-medium tabular-nums text-base-content/45">{data.used_this_cycle.toLocaleString()}</div></div>
                  <div>
                    <div className={label}>Next refill</div>
                    <Tip text={`${data.credits_per_seat} credits × ${data.seats} member${data.seats === 1 ? "" : "s"} added to the shared balance. Unused credits roll over, so you will have about ${(data.balance + data.next_refill).toLocaleString()} credits after the refill.`}>
                      <div className="mt-2 cursor-default text-[32px] font-medium tabular-nums">+{data.next_refill.toLocaleString()}</div>
                    </Tip>
                    <div className="text-[15px] text-base-content/60">{format(next, "MMMM d")} · {days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}</div>
                  </div>
                </div>
                <Tip align="right" text="One-time credit packs for email enrichment, lead imports and instant agent launches. Credits are shared by everyone in your workspace.">
                  <button type="button" onClick={() => setBuying(true)} className="inline-flex h-12 items-center gap-2 rounded-[10px] border border-[#c9c2f5] bg-[#f3f0ff] px-5 text-[17px] font-medium hover:bg-[#e9e4ff]" style={{ color: "#4f2fd0" }}><LuPlus size={20} />Buy credits</button>
                </Tip>
              </div>
              <div className="mt-6 h-2 overflow-hidden rounded-full bg-base-200" role="progressbar" aria-label="Credits used this cycle" aria-valuenow={Math.round(usedPct)} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-[#e5484d]/70 transition-[width] duration-500" style={{ width: `${usedPct}%` }} />
              </div>
              {low && <div className="mt-3 text-[15px]" style={{ color: "#c2410c" }}>Low balance: email lookups, imports and instant launches pause until the refill or until credits are added.</div>}
            </div>
            <div className="flex flex-wrap items-center gap-4 border-t border-[var(--border-subtle)] px-8 py-5">
              <div className="flex-1">
                <div className="flex items-center gap-3"><span className="text-[18px] font-medium">Automatic top-up</span><span className="rounded-full bg-base-200 px-2.5 py-0.5 text-[14px] text-base-content/65">Off</span></div>
                <div className="mt-0.5 text-[15px] text-base-content/65">Adds credits to the workspace balance automatically when it runs low.</div>
              </div>
              <Tip align="right" text="Available once online checkout is connected.">
                <button type="button" disabled className="h-12 cursor-not-allowed rounded-[10px] border border-[var(--border-subtle)] px-5 text-[17px] text-base-content/45">Set up</button>
              </Tip>
            </div>
          </div>
        </section>

        {/* What uses credits */}
        <section>
          <div className="flex items-center gap-2.5 text-[20px] font-medium"><LuCoins size={22} className="text-base-content/60" />How credits are used</div>
          <div className="mt-1 text-[17px] text-base-content/65">Only these actions use credits. Everything else is included.</div>
          <CostList costs={data.costs} />
        </section>

        {/* Add-ons */}
        <section>
          <div className="text-[20px] font-medium">Add-ons</div>
          <div className="mt-1 text-[17px] text-base-content/65">Extend your workspace with more agents and members. Included while you&apos;re on the trial.</div>
          <div className="mt-5 divide-y divide-[var(--border-subtle)] rounded-[14px] border border-[var(--border-subtle)]">
            <div className="flex flex-wrap items-center gap-5 px-8 py-5">
              <div className="min-w-0 flex-1"><div className="text-[18px] font-medium">AI Outreach Agents</div><div className="mt-0.5 text-[15px] text-base-content/65">Each agent has its own audience, lead sources, campaign, LinkedIn sender and mailbox.</div></div>
              <div className="text-right">
                <div className="flex items-center justify-end gap-2 text-[16px]"><span className="h-2.5 w-2.5 rounded-full bg-[#1f8a4c]" /><span className="font-semibold tabular-nums">{data.agents}</span> in use</div>
                <div className="text-[15px] text-base-content/60">Included in trial</div>
              </div>
              <Link href="/agents/new" className="inline-flex h-12 items-center gap-2 rounded-[10px] border border-[#f6c4b4] bg-[#fdf0ea] px-5 text-[17px] font-medium" style={{ color: "#c2410c" }}><LuPlus size={20} />Add</Link>
            </div>
            <div className="flex flex-wrap items-center gap-5 px-8 py-5">
              <div className="min-w-0 flex-1"><div className="text-[18px] font-medium">Additional User</div><div className="mt-0.5 text-[15px] text-base-content/65">Another member in this workspace. Each member adds {data.credits_per_seat} credits to the monthly refill.</div></div>
              <div className="text-right">
                <Tip text="Members in this workspace (including you)"><div className="flex cursor-default items-center justify-end gap-2 text-[16px]"><LuInfo size={17} className="text-base-content/50" /><span className="font-semibold tabular-nums">{data.seats}</span> member{data.seats === 1 ? "" : "s"}</div></Tip>
                <div className="text-[15px] text-base-content/60">Included in trial</div>
              </div>
              <Link href="/settings?tab=members" className="inline-flex h-12 items-center gap-2 rounded-[10px] border border-[#f6c4b4] bg-[#fdf0ea] px-5 text-[17px] font-medium" style={{ color: "#c2410c" }}><LuPlus size={20} />Add</Link>
            </div>
          </div>
        </section>

        {/* Billing history */}
        <section>
          <div className="text-[20px] font-medium">Billing history</div>
          <div className="mt-1 text-[17px] text-base-content/65">Invoices, receipts and a detailed log of how credits were spent.</div>
          <div className="mt-5 overflow-hidden rounded-[14px] border border-[var(--border-subtle)]">
            <div className="flex flex-wrap items-center gap-4 px-8 py-5">
              <div className="min-w-0 flex-1"><div className="text-[18px] font-medium">Invoice recipient</div><div className="mt-0.5 text-[15px] text-base-content/65">Send a copy of every invoice to this address.</div></div>
              <div>
                <input type="email" value={invoiceEmail} disabled={!data.can_edit} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void saveEmail(); }}
                  placeholder="billing@yourcompany.com" aria-label="Invoice recipient email" aria-invalid={!emailValid}
                  className={`h-12 w-[320px] max-w-full rounded-[10px] border bg-base-100 px-4 text-[17px] outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:bg-base-200/50 ${emailValid ? "border-[var(--border-strong)]" : "border-error"}`} />
              </div>
              <button type="button" onClick={() => void saveEmail()} disabled={!data.can_edit || saving || !emailValid || email === null}
                title={data.can_edit ? undefined : "Only workspace admins can change this"}
                className="inline-flex h-12 items-center gap-2 rounded-[10px] border border-[var(--border-strong)] px-5 text-[17px] font-medium hover:bg-base-200 disabled:cursor-default disabled:opacity-50">
                {saving && <LuLoaderCircle size={17} className="animate-spin" />}Save
              </button>
            </div>
            <Fold title="Invoices" sub="View and download your invoices." side={<span className="text-[15px] text-base-content/55">0 invoices</span>}
              open={open.invoices} onToggle={() => setOpen((o) => ({ ...o, invoices: !o.invoices }))}>
              <div className="px-8 pb-6 text-[16px] text-base-content/60">No invoices yet. Invoices appear here once paid plans are available.</div>
            </Fold>
            <Fold title="Credits usage" sub="See how your credits were spent." open={open.usage} onToggle={() => setOpen((o) => ({ ...o, usage: !o.usage }))}>
              <CreditsUsage usage={data.usage} loading={loadedPage !== page} onPage={setPage} />
            </Fold>
          </div>
        </section>
      </div>

      {buying && <CostsDialog costs={data.costs} onClose={() => setBuying(false)} />}
    </div>
  );
}
