import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Papa from "papaparse";
import { toast } from "sonner";
import {
  RiArrowLeftSLine, RiArrowRightDoubleLine, RiArrowRightSLine, RiBriefcase4Line, RiCheckLine, RiCloseLine, RiFocus2Line, RiGlobalLine, RiHistoryLine,
  RiLinkedinBoxFill, RiListUnordered, RiMap2Line, RiPencilLine, RiPhoneLine, RiSave3Line, RiSparkling2Line, RiStickyNoteLine, RiUser3Line,
} from "react-icons/ri";
import { InlineEdit, PencilButton } from "@/components/agents/InlineEdit";
import { ActivityLog, CrunchbaseIcon, ExportMenu, LINK, Rows, Section, SignalList, TipLink, type SignalRow } from "@/components/agents/LeadDrawerParts";
import { Avatar, Flames, StatusDot } from "@/components/agents/ui";
import StepItem, { type Step } from "@/components/copilot/StepItem";
import { failToast } from "@/components/settings/billing/credits-toast";

export interface LeadDetail {
  contact: Record<string, string | number | null>;
  company: Record<string, string | number | null> | null;
  signals: SignalRow[];
  agent: { id: string; name: string; workflow_name: string | null; mode: string } | null;
  sequence: Step[];
  thread_id?: string | null;
  outreach: Array<{ track: string; state: string; current_step: number; next_step_at: string | null }>;
  activity?: Array<{ at: string; kind: string; text: string }>;
}

const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));

/** "Seed · $2.9M · January 2024" from the company's cached funding lookup. */
function fundingLine(json: string | null): string | null {
  if (!json) return null;
  try {
    const r = JSON.parse(json) as { stage?: string | null; amountUsd?: number | null; announcedOn?: string };
    const amt = r.amountUsd ? (r.amountUsd >= 1e6 ? `$${(r.amountUsd / 1e6).toFixed(1)}M` : `$${Math.round(r.amountUsd / 1e3)}K`) : null;
    const when = r.announcedOn ? new Date(r.announcedOn).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : null;
    return [r.stage, amt, when].filter(Boolean).join(" · ") || null;
  } catch { return null; }
}

function whenSends(iso: string | null): string | null {
  if (!iso) return null;
  const m = Math.round((Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`) - Date.now()) / 60_000);
  if (Number.isNaN(m)) return null;
  return m <= 0 ? "any moment" : m < 60 ? `in ${m} min` : `in ${Math.round(m / 60)} h`;
}

type Fold = "basic" | "other" | "notes" | "activity";
const EMPTY_EDIT = { name: false, role: false, contact: false };

/**
 * Side panel with everything about a lead: signals, company, campaign sequence, details, notes
 * and activity, with inline edits in the header. Opens from any list; `siblings` + `onOpen`
 * enable the previous / next arrows (and ← → keys).
 */
export default function LeadDrawer({ targetId, onClose, onChanged, siblings, onOpen, onViewThread }: {
  targetId: string | null; onClose: () => void; onChanged?: () => void; siblings?: string[]; onOpen?: (id: string) => void;
  /** "View thread" on a sent step; defaults to opening the conversation in the inbox. */
  onViewThread?: (threadId: string) => void;
}) {
  const { data: session } = useSession();
  // Closing plays the slide-out first, then tells the parent (which unmounts the panel).
  const [closing, setClosing] = useState(false);
  const close = useCallback(() => {
    if (closing) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { onClose(); return; }
    setClosing(true);
    setTimeout(() => { setClosing(false); onClose(); }, 230);
  }, [closing, onClose]);
  const router = useRouter();
  const [d, setD] = useState<LeadDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [fold, setFold] = useState<Record<Fold, boolean>>({ basic: true, other: false, notes: false, activity: false });
  const [step, setStep] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [moreAbout, setMoreAbout] = useState(false);
  const [editing, setEditing] = useState(EMPTY_EDIT);
  const edit = (k: keyof typeof EMPTY_EDIT, on: boolean) => setEditing((e) => ({ ...e, [k]: on }));
  const toggle = (k: Fold) => setFold((o) => ({ ...o, [k]: !o[k] }));

  const show = useCallback((x: LeadDetail | null) => { setD(x); setNotes(str(x?.contact.notes) ?? ""); }, []);
  const load = useCallback(() => {
    if (!targetId) return Promise.resolve();
    return fetch(`/api/leads/${targetId}`).then((r) => r.ok ? r.json() : null).then(show);
  }, [targetId, show]);
  useEffect(() => {
    let alive = true;
    if (targetId) fetch(`/api/leads/${targetId}`).then((r) => r.ok ? r.json() : null).then((x) => { if (alive) { setStep(null); setMoreAbout(false); setEditing(EMPTY_EDIT); show(x); } });
    return () => { alive = false; };
  }, [targetId, show]);

  const idx = targetId && siblings ? siblings.indexOf(targetId) : -1;
  const prevId = idx > 0 ? siblings![idx - 1] : null;
  const nextId = idx >= 0 && idx < siblings!.length - 1 ? siblings![idx + 1] : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (!typing && e.key === "ArrowLeft" && prevId) onOpen?.(prevId);
      if (!typing && e.key === "ArrowRight" && nextId) onOpen?.(nextId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, onOpen, prevId, nextId]);

  async function act(action: string, reason?: string) {
    const r = await fetch(`/api/leads/${targetId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason }) });
    const x = await r.json();
    if (!r.ok) return failToast(x, "Failed");
    if (action === "find_email") toast[x.found ? "success" : "message"](x.found ? `Found ${x.email}` : "No email found");
    else toast.success(action === "skip" ? "Lead rejected" : "Done");
    await load();
    onChanged?.();
  }

  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    const r = await fetch(`/api/copilot/${targetId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, reason: decision === "reject" ? "Rejected from the lead" : undefined }) });
    const x = await r.json();
    setBusy(false);
    if (!r.ok) return toast.error(x.error ?? "Could not update this lead");
    toast.success(decision === "approve" ? (x.enrolled ? "Approved — added to the sequence" : "Approved") : "Rejected");
    await load();
    onChanged?.();
  }

  /** Header edits (name, title / company, email / phone): one PATCH, then reload. */
  async function saveFields(values: Record<string, string>): Promise<boolean> {
    const r = await fetch(`/api/targets/${targetId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    if (!r.ok) { toast.error((await r.json().catch(() => ({}))).error ?? "Could not save"); return false; }
    toast.success("Contact updated");
    await load();
    onChanged?.();
    return true;
  }

  async function saveNotes() {
    const r = await fetch(`/api/targets/${targetId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes }) });
    if (!r.ok) return toast.error((await r.json().catch(() => ({}))).error ?? "Could not save notes");
    toast.success("Notes saved");
    await load();
  }

  if (!targetId) return null;
  const c = d?.contact;
  const co = d?.company;
  const companyName = str(co?.name) ?? str(c?.company);
  const logo = str(co?.logo_url) ?? str(c?.company_logo_url);
  const website = str(co?.website) ?? (str(co?.domain) ? `https://${co!.domain}` : null);
  const companyLinkedin = str(co?.linkedin_url) ?? str(c?.company_linkedin_url);
  const about = str(co?.description) ?? str(c?.company_description);
  const size = str(co?.employee_range) ?? str(co?.employee_count) ?? str(c?.company_size);
  const location = str(c?.location) ?? str(co?.location) ?? str(c?.company_location);
  const pending = d?.sequence.some((s) => s.draft?.status === "pending");
  const sendsAt = d?.sequence.find((s) => s.draft?.status === "pending" && s.draft.auto_approve_at)?.draft?.auto_approve_at ?? null;
  const picked = d?.sequence.findIndex((s) => s.id === step) ?? -1;
  const sender = { name: session?.user?.name ?? session?.user?.email ?? "You", photo: session?.user?.image ?? null };

  const fields = c ? {
    name: str(c.full_name), title: str(c.title), company: companyName, email: str(c.email), phone: str(c.phone),
    linkedin: str(c.linkedin_url), location, industry: str(co?.industry ?? c.company_industry), company_size: size, website,
  } : null;
  function csv() {
    if (!fields) return;
    const url = URL.createObjectURL(new Blob([Papa.unparse([fields])], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${(fields.name ?? "lead").replace(/[^\w-]+/g, "-").toLowerCase()}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function copy() {
    if (!fields) return;
    const text = Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join("\n");
    navigator.clipboard.writeText(text).then(() => toast.success("Lead details copied"), () => toast.error("Could not copy"));
  }

  const navBtn = "flex h-8 w-8 items-center justify-center rounded-[8px] text-base-content/55 hover:bg-base-200 hover:text-base-content disabled:opacity-30";
  const rejectBtn = "inline-flex h-10 items-center rounded-[8px] border border-[var(--border-strong)] bg-base-100 px-5 text-[16px] text-base-content/80 hover:bg-base-200 disabled:opacity-60";

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Lead details">
      <button className={`absolute inset-0 bg-[#141413]/30 backdrop-blur-[1px] ${closing ? "backdrop-out" : "backdrop-in"}`} onClick={close} aria-label="Close" />
      <aside className={`${closing ? "drawer-out" : "drawer-in"} relative flex h-full w-full max-w-[680px] flex-col bg-base-100 shadow-[var(--shadow-popover)]`}>
        {!d || !c ? (
          <div className="flex items-center justify-between px-8 py-7">
            <div className="flex items-center gap-4"><span className="h-[72px] w-[72px] animate-pulse rounded-full bg-base-200" /><span className="h-6 w-48 animate-pulse rounded bg-base-200" /></div>
            <button type="button" onClick={close} aria-label="Close" className="text-base-content/50 hover:text-base-content"><RiCloseLine size={26} /></button>
          </div>
        ) : (
          <>
            <header className="relative flex items-start gap-5 border-b border-[var(--border-subtle)] px-8 pb-6 pt-7">
              <div className="relative shrink-0">
                <Avatar name={str(c.full_name)} src={str(c.profile_image_url)} size={72} />
                {logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt="" className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-base-100 object-cover ring-2 ring-base-100" />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2 pr-16">
                {editing.name ? (
                  <InlineEdit onCancel={() => edit("name", false)} onSave={saveFields} fields={[
                    { key: "first_name", label: "First name", value: str(c.first_name) ?? str(c.full_name)?.split(" ")[0] ?? "" },
                    { key: "last_name", label: "Last name", value: str(c.last_name) ?? str(c.full_name)?.split(" ").slice(1).join(" ") ?? "" },
                  ]} />
                ) : (
                  <div className="flex items-center gap-2.5">
                    <div role="heading" aria-level={2} className="truncate text-[26px] font-semibold leading-tight tracking-tight text-base-content">{str(c.full_name) ?? "Unknown"}</div>
                    {str(c.linkedin_url) && <a href={String(c.linkedin_url)} target="_blank" rel="noreferrer" style={{ color: "#3f2bd1" }} className="shrink-0 hover:opacity-80" aria-label="LinkedIn profile"><RiLinkedinBoxFill size={26} /></a>}
                    <PencilButton label="Edit name" onClick={() => edit("name", true)} />
                  </div>
                )}
                {editing.role ? (
                  <InlineEdit onCancel={() => edit("role", false)} onSave={saveFields} fields={[
                    { key: "title", label: "Job title", value: str(c.title) ?? "" },
                    { key: "company", label: "Company", value: str(c.company) ?? companyName ?? "" },
                  ]} />
                ) : (
                  <div className="flex items-center gap-1.5">
                    <p className="min-w-0 truncate text-[17px] text-base-content/65">{str(c.title) || companyName ? [str(c.title), companyName].filter(Boolean).join(" @ ") : str(c.headline) ?? "Add a job title and company"}</p>
                    <PencilButton label="Edit title and company" onClick={() => edit("role", true)} />
                  </div>
                )}
                {editing.contact ? (
                  <InlineEdit onCancel={() => edit("contact", false)} onSave={saveFields} fields={[
                    { key: "email", label: "Email", value: str(c.email) ?? "", type: "email", placeholder: "name@company.com" },
                    { key: "phone", label: "Phone", value: str(c.phone) ?? "", type: "tel", placeholder: "+1 555 123 4567" },
                  ]} />
                ) : (
                  <div className="flex flex-wrap items-center gap-2.5">
                    {str(c.email)
                      ? <a href={`mailto:${c.email}`} style={{ color: "#d98200" }} className="text-[16px] hover:underline">{String(c.email)}</a>
                      : <button type="button" onClick={() => act("find_email")} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-base-200 px-3.5 text-[15px] text-base-content/80 hover:bg-base-300">@ Find email</button>}
                    {str(c.phone)
                      ? <a href={`tel:${c.phone}`} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-base-200 px-3.5 text-[15px] text-base-content/80"><RiPhoneLine size={16} />{String(c.phone)}</a>
                      : <button type="button" onClick={() => edit("contact", true)} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-base-200 px-3.5 text-[15px] text-base-content/80 hover:bg-base-300"><RiPhoneLine size={16} />Add phone</button>}
                    <PencilButton label="Edit email and phone" onClick={() => edit("contact", true)} />
                  </div>
                )}
                <div className="flex items-center gap-3 pt-0.5"><StatusDot status={str(c.agent_status)} /><Flames score={c.lead_score as number | null} /></div>
              </div>
              <div className="absolute right-6 top-6 flex items-center gap-1">
                {siblings && <button type="button" className={navBtn} disabled={!prevId} onClick={() => prevId && onOpen?.(prevId)} aria-label="Previous lead" title="Previous (←)"><RiArrowLeftSLine size={20} /></button>}
                {siblings && <button type="button" className={navBtn} disabled={!nextId} onClick={() => nextId && onOpen?.(nextId)} aria-label="Next lead" title="Next (→)"><RiArrowRightSLine size={20} /></button>}
                <button type="button" onClick={close} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-[8px] text-base-content/55 hover:bg-base-200 hover:text-base-content"><RiCloseLine size={26} /></button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto">
              <Section icon={<RiFocus2Line size={22} />} title={`${d.signals.length} Signal${d.signals.length === 1 ? "" : "s"}`}>
                <SignalList signals={d.signals} />
              </Section>

              {companyName && (
                <Section icon={<RiBriefcase4Line size={22} />} title="Company" right={<>
                  {website && <TipLink href={website} tip={website} label="Company website"><RiGlobalLine size={21} className="text-base-content/55" /></TipLink>}
                  {companyLinkedin && <TipLink href={companyLinkedin} tip="Company LinkedIn" label="Company LinkedIn page"><RiLinkedinBoxFill size={22} style={{ color: "#3f2bd1" }} /></TipLink>}
                  <TipLink href={`https://www.crunchbase.com/textsearch?q=${encodeURIComponent(companyName)}`} tip="Crunchbase" label="Search the company on Crunchbase"><CrunchbaseIcon /></TipLink>
                </>}>
                  {about ? (
                    <div>
                      <div className="relative">
                        <p className={`text-[16px] leading-relaxed text-base-content/70 ${moreAbout ? "" : "line-clamp-2"}`}>{about}</p>
                        {!moreAbout && about.length > 140 && <span className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-base-100 to-transparent" />}
                      </div>
                      {about.length > 140 && <button type="button" style={{ color: LINK }} className="mt-2 text-[16px] hover:underline" onClick={() => setMoreAbout((v) => !v)}>{moreAbout ? "See less" : "See more"}</button>}
                    </div>
                  ) : <p className="text-[15px] text-base-content/50">{companyName} — details fill in when the company is enriched.</p>}
                </Section>
              )}

              {d.agent && (
                <Section icon={<RiListUnordered size={22} />} title="Campaign Sequence"
                  sub={<Link href={`/agents/${d.agent.id}`} style={{ color: "#e0482f" }} className="inline-flex max-w-full items-center gap-1 text-[15px] hover:underline"><span className="truncate">{d.agent.name}</span><RiArrowRightDoubleLine size={18} className="shrink-0" /></Link>}>
                  {d.sequence.length === 0 ? <p className="text-[15px] text-base-content/50">This agent has no campaign yet.</p> : (
                    <>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-2.5">
                        {d.sequence.map((s, i) => {
                          const on = s.id === step;
                          const ai = (s.step_type === "message" || s.step_type === "email" || s.step_type === "sales_inmail") && !s.fixed;
                          const dot = s.executed_at || s.draft?.status === "sent" || s.draft?.status === "consumed" || s.draft?.status === "approved" ? "bg-success" : s.draft?.status === "pending" ? "bg-warning" : "bg-base-content/35";
                          return (
                            <span key={s.id} className="inline-flex items-center gap-2">
                              <button type="button" onClick={() => setStep(on ? null : s.id)} aria-pressed={on}
                                className={`inline-flex h-10 items-center gap-2 rounded-full border px-4 text-[15px] transition-all ${on ? "border-primary/45 bg-primary/10 text-base-content shadow-[0_2px_8px_-4px_var(--color-primary)]" : "border-[var(--border-subtle)] bg-[#fdf4ee] text-base-content/80 hover:border-primary/30"}`}>
                                <span className={`h-2 w-2 rounded-full ${dot}`} />{s.label}
                                {ai && <RiSparkling2Line size={17} className="text-[#c04ad6]" />}
                              </button>
                              {i < d.sequence.length - 1 && <RiArrowRightSLine size={18} className="text-base-content/35" />}
                            </span>
                          );
                        })}
                      </div>
                      {picked >= 0 ? (
                        <ol className="mt-5">
                          <StepItem key={d.sequence[picked].id} n={picked + 1} step={d.sequence[picked]} targetId={targetId} firstLaunch={null} sender={sender}
                            onThread={d.thread_id ? () => (onViewThread ? onViewThread(d.thread_id!) : void router.push(`/inbox?thread=${d.thread_id}`)) : undefined}
                            onDraft={(id, draft) => setD((cur) => cur ? { ...cur, sequence: cur.sequence.map((s) => s.id === id ? { ...s, draft } : s) } : cur)} />
                        </ol>
                      ) : <p className="mt-4 text-center text-[15px] text-base-content/45">Click a step to see message details</p>}
                    </>
                  )}
                </Section>
              )}

              <Section icon={<RiUser3Line size={22} />} title="Basic Information" open={fold.basic} onToggle={() => toggle("basic")}>
                <Rows rows={[
                  ["Industry", str(co?.industry ?? c.company_industry)],
                  ["Company Size", size ? (/^\d+$/.test(size) ? `${size} employees` : size) : null],
                  ["Founded", str(co?.founded_year)],
                  ["Company Type", str(co?.org_type)],
                  ["Latest Funding", fundingLine(str(co?.last_funding_json))],
                  ["Specialties", str(co?.specialties)],
                  ["Location", location ? <span className="inline-flex items-center gap-1.5"><RiMap2Line size={17} className="text-base-content/50" />{location}</span> : null],
                ]} />
              </Section>

              <Section icon={<RiStickyNoteLine size={22} />} title="Other information" open={fold.other} onToggle={() => toggle("other")}>
                <div className="space-y-5">
                  {(str(c.headline) || str(c.summary)) && (
                    <div><div className="text-[15px] text-base-content/55">Profile Baseline</div><p className="mt-1.5 whitespace-pre-line text-[16px] text-base-content line-clamp-6">{str(c.headline) ?? str(c.summary)}</p></div>
                  )}
                  {str(c.fit_reason) && <div><div className="text-[15px] text-base-content/55">Why this score</div><p className="mt-1.5 text-[16px] text-base-content/80">{String(c.fit_reason)}</p></div>}
                  <Rows rows={[
                    ["Score", c.lead_score !== null && c.lead_score !== undefined ? `${c.lead_score} · fit ${c.fit_score ?? "—"} · intent ${Math.round(Number(c.intent_score ?? 0))}` : null],
                    ["In role", c.tenure_months ? `${Math.floor(Number(c.tenure_months) / 12) ? `${Math.floor(Number(c.tenure_months) / 12)} yr ` : ""}${Number(c.tenure_months) % 12} mo` : null],
                    ["Connection", c.degree ? `${c.degree}°` : null], ["Source", str(c.lead_source)?.replace(/_/g, " ") ?? null],
                    ["Skipped", str(c.skip_reason)],
                  ]} />
                </div>
              </Section>

              <Section icon={<RiPencilLine size={22} />} title="Internal Notes" open={fold.notes} onToggle={() => toggle("notes")}>
                <div className="text-[15px] text-base-content/55">Your Notes</div>
                <div className="relative mt-2">
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add your personal notes about this contact..." aria-label="Your notes"
                    className="min-h-[120px] w-full resize-y rounded-[10px] border border-[var(--border-strong)] bg-base-100 px-4 pb-14 pt-3 text-[16px] outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-[var(--ring)]" />
                  <button type="button" disabled={notes === (str(c.notes) ?? "")} onClick={saveNotes} style={{ color: LINK }}
                    className="absolute bottom-3 right-3 inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#efeafd] px-3.5 text-[15px] hover:bg-[#e5defb] disabled:opacity-50"><RiSave3Line size={16} /> Save</button>
                </div>
              </Section>

              <Section tint small icon={<RiHistoryLine size={20} />} title={<>Activity Logs <span className="text-base-content/45">({d.activity?.length ?? 0})</span></>} open={fold.activity} onToggle={() => toggle("activity")}>
                <ActivityLog items={d.activity ?? []} />
              </Section>
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-8 py-4">
              <span className="flex min-w-0 items-center gap-3">
                {pending && <button type="button" className={rejectBtn} disabled={busy} onClick={() => decide("reject")}>Reject</button>}
                {!pending && c.agent_status !== "skipped" && c.agent_status !== "enrolled" && c.agent_id && <button type="button" className={rejectBtn} disabled={busy} onClick={() => act("skip", "Rejected from the lead")}>Reject</button>}
                {pending && <span className="truncate text-[14.5px] text-base-content/50">{whenSends(sendsAt) ? `Autopilot sends ${whenSends(sendsAt)} unless you reject` : "Waiting for your approval"}</span>}
              </span>
              <span className="flex items-center gap-2">
                {pending && <button type="button" disabled={busy} onClick={() => decide("approve")} className="inline-flex h-12 items-center gap-2 rounded-[10px] bg-primary px-5 text-[16px] font-medium text-primary-content hover:bg-[var(--primary-hover)] disabled:opacity-60"><RiCheckLine size={18} /> Approve</button>}
                <ExportMenu onCsv={csv} onCopy={copy} profileHref={`/contacts/${targetId}`} />
              </span>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}
