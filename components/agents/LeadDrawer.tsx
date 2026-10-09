import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  RiArrowDownSLine, RiArrowLeftSLine, RiArrowRightSLine, RiArrowRightDoubleLine, RiAtLine, RiBriefcase4Line, RiBuilding2Line, RiChat3Line, RiCheckLine,
  RiCloseLine, RiCodeSSlashLine, RiEditBoxLine, RiExternalLinkLine, RiFileList3Line, RiFlashlightLine, RiGlobalLine, RiGroupLine, RiHistoryLine,
  RiLinkedinBoxFill, RiListCheck2, RiMoneyDollarCircleLine, RiPhoneLine, RiPulseLine, RiRadarLine, RiSave3Line, RiSparkling2Line, RiStickyNoteLine,
  RiUserAddLine, RiUserStarLine,
} from "react-icons/ri";
import SequenceEditor, { type Draft, type Step } from "@/components/agents/SequenceEditor";
import { InlineEdit, PencilButton } from "@/components/agents/InlineEdit";
import { signalLine } from "@/components/agents/signal-line";
import { Avatar, Flames, IconTile, primaryBtn, ScoreBadge, secondaryBtn, StatusDot, textareaCls, timeAgo, type Tone } from "@/components/agents/ui";

export interface LeadDetail {
  contact: Record<string, string | number | null>;
  company: Record<string, string | number | null> | null;
  signals: Array<{ id: string; type: string; title: string; snippet: string | null; source_url: string | null; occurred_at: string; metadata_json?: string | null }>;
  agent: { id: string; name: string; workflow_name: string | null; mode: string } | null;
  sequence: Step[];
  outreach: Array<{ track: string; state: string; current_step: number; next_step_at: string | null }>;
  activity?: Array<{ at: string; kind: string; text: string }>;
}

const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));

function whenSends(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  const m = Math.round((t - Date.now()) / 60_000);
  if (Number.isNaN(m)) return null;
  return m <= 0 ? "any moment" : m < 60 ? `in ${m} min` : `in ${Math.round(m / 60)} h`;
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const SIGNAL_ICON: Record<string, { icon: ReactNode; tone: Tone }> = {
  competitor_engagement: { icon: <RiFlashlightLine size={15} />, tone: "coral" },
  keyword_engagement: { icon: <RiFlashlightLine size={15} />, tone: "coral" },
  influencer_engagement: { icon: <RiUserStarLine size={15} />, tone: "amber" },
  own_content_engagement: { icon: <RiChat3Line size={15} />, tone: "coral" },
  job_change: { icon: <RiBriefcase4Line size={15} />, tone: "amber" },
  hiring: { icon: <RiUserAddLine size={15} />, tone: "teal" },
  funding: { icon: <RiMoneyDollarCircleLine size={15} />, tone: "success" },
  website_visit: { icon: <RiGlobalLine size={15} />, tone: "teal" },
  lookalike: { icon: <RiGroupLine size={15} />, tone: "ink" },
  existing_list: { icon: <RiFileList3Line size={15} />, tone: "ink" },
  linkedin_import: { icon: <RiLinkedinBoxFill size={15} />, tone: "linkedin" },
  technology: { icon: <RiCodeSSlashLine size={15} />, tone: "ink" },
  product_intent: { icon: <RiPulseLine size={15} />, tone: "error" },
};

/** One collapsible section of the drawer. */
function Section({ icon, title, extra, sub, open, onToggle, children }: { icon: ReactNode; title: ReactNode; extra?: ReactNode; sub?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="border-b border-[var(--border-subtle)]">
      <div className="flex items-center gap-3 px-6 py-4">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-start gap-3 text-left">
          <span className="mt-0.5 shrink-0 text-base-content/70">{icon}</span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold text-base-content">{title}</span>
            {sub && <span className="mt-0.5 block truncate text-[13px]">{sub}</span>}
          </span>
        </button>
        {extra && <span className="flex shrink-0 items-center gap-2">{extra}</span>}
        <button type="button" onClick={onToggle} aria-label={open ? "Collapse" : "Expand"} className="shrink-0 text-base-content/45 hover:text-base-content">
          <RiArrowDownSLine size={18} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {open && <div className="px-6 pb-5">{children}</div>}
    </section>
  );
}

function KeyValues({ rows }: { rows: Array<[string, unknown]> }) {
  const shown = rows.filter(([, v]) => str(v));
  if (!shown.length) return null;
  return (
    <dl className="space-y-2.5 text-sm">
      {shown.map(([k, v]) => (
        <div key={k} className="flex items-start justify-between gap-4"><dt className="shrink-0 text-base-content/50">{k}</dt><dd className="text-right text-base-content">{String(v)}</dd></div>
      ))}
    </dl>
  );
}

type SectionKey = "signals" | "company" | "sequence" | "other" | "notes" | "activity";

/**
 * Side panel with everything about a lead: signals, company, sequence, notes and activity.
 * Opens from any list; `siblings` + `onOpen` enable the previous/next arrows.
 */
export default function LeadDrawer({ targetId, onClose, onChanged, siblings, onOpen }: { targetId: string | null; onClose: () => void; onChanged?: () => void; siblings?: string[]; onOpen?: (id: string) => void }) {
  const [d, setD] = useState<LeadDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({ signals: true, company: false, sequence: true, other: false, notes: false, activity: false });
  const [editing, setEditing] = useState({ name: false, role: false, contact: false });
  const edit = (k: keyof typeof editing, on: boolean) => setEditing((e) => ({ ...e, [k]: on }));
  const [step, setStep] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [moreAbout, setMoreAbout] = useState(false);
  const toggle = (k: SectionKey) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  const show = useCallback((x: LeadDetail | null) => {
    setD(x);
    setNotes(str(x?.contact.notes) ?? "");
    if (x?.sequence.some((s) => s.draft?.status === "pending")) setOpen((o) => ({ ...o, sequence: true }));
  }, []);
  const load = useCallback(() => {
    if (!targetId) return Promise.resolve();
    return fetch(`/api/leads/${targetId}`).then((r) => r.ok ? r.json() : null).then(show);
  }, [targetId, show]);
  useEffect(() => {
    let alive = true;
    if (targetId) fetch(`/api/leads/${targetId}`).then((r) => r.ok ? r.json() : null).then((x) => { if (alive) { setStep(null); setMoreAbout(false); setEditing({ name: false, role: false, contact: false }); show(x); } });
    return () => { alive = false; };
  }, [targetId, show]);

  const idx = targetId && siblings ? siblings.indexOf(targetId) : -1;
  const prevId = idx > 0 ? siblings![idx - 1] : null;
  const nextId = idx >= 0 && idx < siblings!.length - 1 ? siblings![idx + 1] : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (!typing && e.key === "ArrowLeft" && prevId) onOpen?.(prevId);
      if (!typing && e.key === "ArrowRight" && nextId) onOpen?.(nextId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onOpen, prevId, nextId]);

  async function act(action: string, reason?: string) {
    const r = await fetch(`/api/leads/${targetId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason }) });
    const x = await r.json();
    if (!r.ok) return toast.error(x.error ?? "Failed");
    if (action === "find_email") toast[x.found ? "success" : "message"](x.found ? `Found ${x.email}` : "No email found");
    else toast.success(action === "skip" ? "Lead skipped" : "Done");
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

  const onDraftChange = (draft: Draft) => setD((cur) => cur ? { ...cur, sequence: cur.sequence.map((s) => s.draft?.id === draft.id ? { ...s, draft: { ...s.draft, ...draft } } : s) } : cur);

  if (!targetId) return null;
  const c = d?.contact;
  const co = d?.company;
  const pending = d?.sequence.some((s) => s.draft?.status === "pending");
  const sendsAt = d?.sequence.find((s) => s.draft?.status === "pending" && s.draft.auto_approve_at)?.draft?.auto_approve_at ?? null;
  const companyName = str(co?.name) ?? str(c?.company);
  const logo = str(co?.logo_url) ?? str(c?.company_logo_url);
  const website = str(co?.website) ?? (str(co?.domain) ? `https://${co!.domain}` : null);
  const companyLinkedin = str(co?.linkedin_url) ?? str(c?.company_linkedin_url);
  const about = str(co?.description) ?? str(c?.company_description);
  const size = str(co?.employee_range) ?? str(co?.employee_count) ?? str(c?.company_size);
  const picked = d?.sequence.find((s) => s.id === step) ?? null;
  const navBtn = "flex h-9 w-9 items-center justify-center rounded-[8px] border border-[var(--border-subtle)] bg-base-100 text-base-content/70 hover:bg-base-200 disabled:opacity-35";

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Lead details">
      <button className="absolute inset-0 bg-[#141413]/25" onClick={onClose} aria-label="Close" />
      <aside className="relative flex h-full w-full max-w-[580px] flex-col bg-base-100 shadow-[var(--shadow-popover)]">
        <div className="flex items-center justify-between px-6 pt-5">
          <div className="flex gap-2">
            {siblings && <button type="button" className={navBtn} disabled={!prevId} onClick={() => prevId && onOpen?.(prevId)} aria-label="Previous lead"><RiArrowLeftSLine size={18} /></button>}
            {siblings && <button type="button" className={navBtn} disabled={!nextId} onClick={() => nextId && onOpen?.(nextId)} aria-label="Next lead"><RiArrowRightSLine size={18} /></button>}
          </div>
          <button type="button" className="flex h-9 w-9 items-center justify-center rounded-[8px] text-base-content/45 hover:bg-base-200 hover:text-base-content" onClick={onClose} aria-label="Close"><RiCloseLine size={20} /></button>
        </div>

        {!d || !c ? <p className="p-6 text-sm text-base-content/40">Loading…</p> : (
          <>
            <header className="flex items-start gap-4 border-b border-[var(--border-subtle)] px-6 pb-5 pt-3">
              <div className="relative shrink-0">
                <Avatar name={str(c.full_name)} src={str(c.profile_image_url)} size={64} />
                {logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt="" className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-base-100 object-cover ring-2 ring-base-100" />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                {editing.name ? (
                  <InlineEdit onCancel={() => edit("name", false)} onSave={saveFields} fields={[
                    { key: "first_name", label: "First name", value: str(c.first_name) ?? str(c.full_name)?.split(" ")[0] ?? "" },
                    { key: "last_name", label: "Last name", value: str(c.last_name) ?? str(c.full_name)?.split(" ").slice(1).join(" ") ?? "" },
                  ]} />
                ) : (
                  <div className="group/n flex items-center gap-2">
                    <h2 className="truncate font-display text-[26px] leading-tight text-base-content">{str(c.full_name) ?? "Unknown"}</h2>
                    {str(c.linkedin_url) && <a href={String(c.linkedin_url)} target="_blank" rel="noreferrer" className="shrink-0 text-[#0a66c2] hover:opacity-80" aria-label="LinkedIn profile"><RiLinkedinBoxFill size={22} /></a>}
                    <PencilButton label="Edit name" onClick={() => edit("name", true)} />
                  </div>
                )}
                {editing.role ? (
                  <InlineEdit onCancel={() => edit("role", false)} onSave={saveFields} fields={[
                    { key: "title", label: "Job title", value: str(c.title) ?? "" },
                    { key: "company", label: "Company", value: str(c.company) ?? companyName ?? "" },
                  ]} />
                ) : (
                  <div className="flex items-start gap-1">
                    <p className="min-w-0 pt-1 text-sm text-base-content/60">{str(c.title) || companyName ? [str(c.title), companyName].filter(Boolean).join(" @ ") : str(c.headline) ?? "Add a job title and company"}</p>
                    <PencilButton label="Edit title and company" onClick={() => edit("role", true)} />
                  </div>
                )}
                {editing.contact ? (
                  <InlineEdit onCancel={() => edit("contact", false)} onSave={saveFields} fields={[
                    { key: "email", label: "Email", value: str(c.email) ?? "", type: "email", placeholder: "name@company.com" },
                    { key: "phone", label: "Phone", value: str(c.phone) ?? "", type: "tel", placeholder: "+1 555 123 4567" },
                  ]} />
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    {str(c.email)
                      ? <a href={`mailto:${c.email}`} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-success/12 px-3 text-[13px] font-medium text-[#3a8c4f]"><RiAtLine size={14} />{String(c.email)}</a>
                      : <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-full bg-base-200 px-3 text-[13px] font-medium text-base-content/75 hover:bg-base-300" onClick={() => act("find_email")}><RiAtLine size={14} /> Find email</button>}
                    {str(c.phone) && <a href={`tel:${c.phone}`} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-base-200 px-3 text-[13px] font-medium text-base-content/75"><RiPhoneLine size={14} />{String(c.phone)}</a>}
                    <PencilButton label="Edit email and phone" onClick={() => edit("contact", true)} />
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <StatusDot status={str(c.agent_status)} />
                  <Flames score={c.lead_score as number | null} />
                </div>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto">
              <Section icon={<RiRadarLine size={18} />} title={`${d.signals.length} Signal${d.signals.length === 1 ? "" : "s"}`} open={open.signals} onToggle={() => toggle("signals")}>
                {d.signals.length === 0 ? <p className="text-sm text-base-content/45">No signals recorded yet.</p> : (
                  <ol>
                    {d.signals.map((s, i) => {
                      const m = SIGNAL_ICON[s.type] ?? { icon: <RiPulseLine size={15} />, tone: "error" as Tone };
                      const line = signalLine(s);
                      const last = i === d.signals.length - 1;
                      return (
                        <li key={s.id} className="flex items-stretch gap-3">
                          <div className="flex w-8 shrink-0 flex-col items-center">
                            <IconTile icon={m.icon} tone={m.tone} size={32} />
                            {!last && <span className="my-1 w-px flex-1 border-l border-dashed border-[var(--border-subtle)]" />}
                          </div>
                          <div className={`min-w-0 flex-1 pt-1 ${last ? "" : "pb-4"}`}>
                            <div className="flex items-start justify-between gap-3">
                              <span className="text-[15px] leading-snug text-base-content">
                                {line.lead}
                                {line.link && (line.href
                                  ? <a href={line.href} target="_blank" rel="noreferrer" className="text-primary hover:underline" title={s.snippet ?? undefined}>{line.link}</a>
                                  : <span className="text-primary">{line.link}</span>)}
                                {line.tail}
                              </span>
                              <span className="shrink-0 pt-0.5 text-[13px] text-base-content/45">{shortDate(s.occurred_at)}</span>
                            </div>
                            {line.sub && <p className="mt-0.5 truncate text-[13px] text-base-content/55">{line.sub}</p>}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Section>

              {companyName && (
                <Section icon={<RiBuilding2Line size={18} />} title={companyName} open={open.company} onToggle={() => toggle("company")}
                  extra={<>
                    {website && <a href={website} target="_blank" rel="noreferrer" className="text-base-content/45 hover:text-base-content" aria-label="Company website"><RiGlobalLine size={18} /></a>}
                    {companyLinkedin && <a href={companyLinkedin} target="_blank" rel="noreferrer" className="text-[#0a66c2] hover:opacity-80" aria-label="Company LinkedIn page"><RiLinkedinBoxFill size={19} /></a>}
                  </>}>
                  {about && (
                    <div className="mb-4 border-b border-dashed border-[var(--border-subtle)] pb-4">
                      <p className={`text-sm leading-relaxed text-base-content/65 ${moreAbout ? "" : "line-clamp-2"}`}>{about}</p>
                      {about.length > 140 && <button type="button" className="mt-1.5 text-sm font-medium text-primary" onClick={() => setMoreAbout((v) => !v)}>{moreAbout ? "See less" : "See more"}</button>}
                    </div>
                  )}
                  <KeyValues rows={[
                    ["Industry", co?.industry ?? c.company_industry],
                    ["Company size", size ? (/^\d+$/.test(size) ? `${size} employees` : size) : null],
                    ["Location", co?.location ?? c.company_location],
                    ["Domain", co?.domain],
                  ]} />
                  {!about && !str(co?.industry ?? c.company_industry) && !size && <p className="text-sm text-base-content/45">No company details yet — they fill in when the profile is enriched.</p>}
                </Section>
              )}

              {d.agent && (
                <Section icon={<RiListCheck2 size={18} />} title="Campaign Sequence" open={open.sequence} onToggle={() => toggle("sequence")}
                  sub={<Link href={`/agents/${d.agent.id}`} className="inline-flex items-center gap-1 text-primary hover:underline">{d.agent.name}<RiArrowRightDoubleLine size={14} /></Link>}>
                  {d.sequence.length === 0 ? <p className="text-sm text-base-content/45">This agent has no campaign yet.</p> : (
                    <>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {d.sequence.map((s, i) => {
                          const on = s.id === step;
                          const sent = s.draft?.status === "sent" || s.draft?.status === "approved";
                          return (
                            <span key={s.id} className="inline-flex items-center gap-1.5">
                              {i > 0 && <RiArrowRightSLine size={14} className="text-base-content/30" />}
                              <button type="button" onClick={() => setStep(on ? null : s.id)}
                                className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors ${on ? "border-primary/50 bg-primary/10 text-primary" : "border-[var(--border-subtle)] bg-base-200/60 text-base-content/75 hover:bg-base-200"}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${sent ? "bg-success" : s.draft?.status === "pending" ? "bg-warning" : "bg-base-content/30"}`} />
                                {s.label}
                                {s.draft && <RiSparkling2Line size={13} className="text-primary" />}
                              </button>
                            </span>
                          );
                        })}
                      </div>
                      {picked ? <div className="mt-4"><SequenceEditor steps={[picked]} onDraftChange={onDraftChange} /></div>
                        : <p className="mt-3 text-center text-[13px] text-base-content/45">Click a step to see message details</p>}
                    </>
                  )}
                </Section>
              )}

              <Section icon={<RiStickyNoteLine size={18} />} title="Other information" open={open.other} onToggle={() => toggle("other")}>
                {(str(c.summary) || str(c.headline)) && (
                  <div className="mb-4">
                    <div className="text-[13px] text-base-content/50">Profile baseline</div>
                    <p className="mt-1 whitespace-pre-line text-sm text-base-content/80 line-clamp-6">{str(c.summary) ?? str(c.headline)}</p>
                  </div>
                )}
                <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
                  <ScoreBadge score={c.lead_score as number | null} verdict={str(c.fit_verdict)} />
                  <span className="text-base-content/50">fit {c.fit_score ?? "—"} · intent {Math.round(Number(c.intent_score ?? 0))}</span>
                </div>
                {str(c.fit_reason) && <p className="mb-4 text-sm text-base-content/70">{String(c.fit_reason)}</p>}
                {str(c.skip_reason) && <p className="mb-4 text-xs text-base-content/45">Skipped: {String(c.skip_reason)}</p>}
                <KeyValues rows={[
                  ["Title", c.title], ["Location", c.location],
                  ["In role", c.tenure_months ? `${Math.floor(Number(c.tenure_months) / 12) ? `${Math.floor(Number(c.tenure_months) / 12)} yr ` : ""}${Number(c.tenure_months) % 12} mo` : null],
                  ["Connection", c.degree ? `${c.degree}°` : null], ["Source", str(c.lead_source)?.replace(/_/g, " ")], ["Added", c.created_at ? timeAgo(String(c.created_at)) : null],
                ]} />
              </Section>

              <Section icon={<RiEditBoxLine size={18} />} title="Internal Notes" open={open.notes} onToggle={() => toggle("notes")}>
                <div className="text-[13px] text-base-content/50">Your notes</div>
                <div className="relative mt-1.5">
                  <textarea className={`${textareaCls} min-h-[110px] pb-12`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add your personal notes about this contact…" />
                  <button type="button" disabled={notes === (str(c.notes) ?? "")} onClick={saveNotes}
                    className="absolute bottom-2.5 right-2.5 inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-primary/10 px-3 text-[13px] font-medium text-primary hover:bg-primary/15 disabled:opacity-40"><RiSave3Line size={14} /> Save</button>
                </div>
              </Section>

              <Section icon={<RiHistoryLine size={18} />} title={<>Activity Logs <span className="font-normal text-base-content/45">({d.activity?.length ?? 0})</span></>} open={open.activity} onToggle={() => toggle("activity")}>
                {!d.activity?.length ? <p className="text-sm text-base-content/45">No activity yet.</p> : (
                  <ol className="space-y-3">
                    {d.activity.map((a, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ring-2 ${a.kind === "outreach" ? "bg-success ring-success/20" : a.kind === "team" ? "bg-primary ring-primary/20" : "bg-base-content/30 ring-base-content/10"}`} />
                        <div className="min-w-0"><p className="text-sm text-base-content/80">{a.text}</p><p className="text-xs text-base-content/45">{timeAgo(a.at)}</p></div>
                      </li>
                    ))}
                  </ol>
                )}
              </Section>
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-6 py-3.5">
              <span className="flex items-center gap-3">
                {pending && <button className={secondaryBtn} disabled={busy} onClick={() => decide("reject")}><RiCloseLine size={16} /> Reject</button>}
                {!pending && c.agent_status !== "skipped" && c.agent_status !== "enrolled" && c.agent_id && <button className={secondaryBtn} disabled={busy} onClick={() => act("skip", "Rejected from the lead")}>Reject</button>}
                <span className="text-xs text-base-content/45">{pending ? (whenSends(sendsAt) ? `Autopilot sends ${whenSends(sendsAt)} unless you reject` : "Waiting for your approval") : ""}</span>
              </span>
              <span className="flex gap-2">
                <Link href={`/contacts/${targetId}`} className={secondaryBtn}><RiExternalLinkLine size={15} /> Full profile</Link>
                {pending && <button className={primaryBtn} disabled={busy} onClick={() => decide("approve")}><RiCheckLine size={16} /> Approve</button>}
              </span>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}
