import { useCallback, useRef, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  RiAddLine, RiArrowDownLine, RiCheckLine, RiCheckboxCircleLine, RiCloseLine, RiFilter3Line, RiFocus3Line, RiEditBoxLine, RiSettings3Line, RiTimeLine,
} from "react-icons/ri";
import { IconTile, Panel, primaryBtn } from "@/components/agents/ui";
import { aiName, DELAY_OPTIONS, delayLabel, STEP_TITLE, voiceUrl, type CampaignStep } from "@/components/agents/campaign/kit";
import { addRules, blankStep, restructure, timeline, withPositions } from "@/components/agents/campaign/sequence";
import StepDrawer, { type PendingVoice, type StepSave } from "@/components/agents/campaign/StepDrawer";
import StepContactsModal from "@/components/agents/campaign/StepContactsModal";
import CampaignSettings, { type CampaignSettingsInitial } from "@/components/agents/campaign/CampaignSettings";
import AddStepMenu from "@/components/agents/campaign/AddStepMenu";
import StepCard, { type StepStat } from "@/components/agents/campaign/StepCard";
import LikePostsDrawer from "@/components/agents/campaign/LikePostsDrawer";
import VoiceDrawer from "@/components/agents/campaign/VoiceDrawer";

export type { StepStat };

/** Hairline-colored dot grid behind the timeline. */
const DOTS = { backgroundImage: "radial-gradient(var(--border-subtle) 1px, transparent 1px)", backgroundSize: "16px 16px" };

/** The agent's sequence: lead sources, then every step in run order, editable in place. */
export default function AgentCampaign({ agentId, workflowId, stats, leadCount, sources, settings, hasEmailSender = false, onChanged, onCreate, onEditSources }: {
  agentId: string; workflowId: string | null; stats: StepStat[]; leadCount: number; sources: { count: number; leads: number };
  settings: CampaignSettingsInitial; hasEmailSender?: boolean;
  onChanged: () => void; onCreate: () => Promise<void>; onEditSources: () => void;
}) {
  const [steps, setSteps] = useState<CampaignStep[] | null>(null);
  const [draft, setDraft] = useState<CampaignStep[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [editStep, setEditStep] = useState<string | null>(null);
  const [contactsOf, setContactsOf] = useState<{ id: string; title: string; invite: boolean; accepted?: boolean } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [delayMenu, setDelayMenu] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [sample, setSample] = useState<{ id: string; name: string | null } | null>(null);
  const [pendingVoice, setPendingVoice] = useState<Record<string, PendingVoice>>({});

  /** Save the edited sequence, then upload recordings made for its new voice steps. */
  async function saveDraft() {
    if (!draft || !workflowId) return;
    // Rows keep their order per track on the server, so a new step is found by its position.
    const places = Object.entries(pendingVoice).map(([id, v]) => {
      const s = draft.find((x) => x.id === id);
      return s ? { v, track: s.track, idx: draft.filter((x) => x.track === s.track).indexOf(s) } : null;
    }).filter((x): x is { v: PendingVoice; track: "linkedin" | "email"; idx: number } => !!x);
    if (!(await putAll(draft, "Sequence saved"))) return;
    if (places.length) {
      const rows = await fetch(`/api/workflows/${workflowId}/steps`).then((r) => r.json()).catch(() => []) as CampaignStep[];
      let failed = 0;
      for (const p of places) {
        const row = rows.filter((x) => x.track === p.track).sort((a, b) => a.step_order - b.step_order)[p.idx];
        if (!row || row.step_type !== "voice") { failed++; continue; }
        const audio = await new Promise<string>((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result).split(",")[1] ?? ""); fr.readAsDataURL(p.v.data); });
        const r = await fetch(voiceUrl(workflowId, row.id), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio_base64: audio, mime: p.v.data.type || "audio/webm", duration_ms: p.v.ms }) });
        if (!r.ok) failed++;
      }
      Object.values(pendingVoice).forEach((v) => URL.revokeObjectURL(v.url));
      setPendingVoice({});
      if (failed) toast.error("A voice recording couldn't be saved. Open the step and record it again.");
      await load();
    }
    setDraft(null);
  }
  // Edit mode scrolls down to "Add a step", where new steps go (once the edit view has rendered).
  const addRef = useRef<HTMLLIElement>(null);
  const scrollToAdd = useRef(false);
  useEffect(() => {
    if (!scrollToAdd.current || !addRef.current) return;
    scrollToAdd.current = false;
    addRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [draft]);
  const startEditing = () => { scrollToAdd.current = true; setDraft(steps); };

  const load = useCallback(() => {
    if (!workflowId) return Promise.resolve();
    return fetch(`/api/workflows/${workflowId}/steps`).then((r) => r.json()).then((rows: CampaignStep[]) => setSteps(rows)).catch(() => setSteps([]));
  }, [workflowId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    fetch(`/api/leads?agent_id=${agentId}&limit=1&offset=0`).then((r) => r.json())
      .then((x) => { const l = x?.leads?.[0]; if (l) setSample({ id: l.id, name: l.full_name ?? null }); }).catch(() => {});
  }, [agentId]);

  const shown = useMemo(() => draft ?? steps ?? [], [draft, steps]);
  const items = useMemo(() => timeline(shown), [shown]);
  const stat = useMemo(() => new Map(stats.map((s) => [s.id, s])), [stats]);
  const countOn = (type: "message" | "email") => shown.filter((s) => (type === "email" ? s.step_type === "email" : s.step_type === "message" || s.step_type === "sales_inmail")).length;

  async function putAll(next: CampaignStep[], ok: string) {
    setBusy(true);
    const r = await fetch(`/api/workflows/${workflowId}/steps`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ steps: withPositions(next) }) });
    setBusy(false);
    if (!r.ok) { toast.error("Could not update the sequence"); return false; }
    toast.success(ok);
    await load();
    onChanged();
    return true;
  }

  async function saveStep(step: CampaignStep, s: StepSave) {
    // While editing the sequence, changes stay in the draft (new steps have no server id yet);
    // a recording for a new step is kept and uploaded when the sequence is saved.
    if (draft) {
      setDraft(restructure(draft, step.id, { fields: s.fields, delaySeconds: s.delaySeconds, visitBefore: s.visitBefore, likeBefore: s.likeBefore }));
      if (s.voice) setPendingVoice((cur) => ({ ...cur, [step.id]: s.voice! }));
      setEditStep(null);
      return;
    }
    if (s.delaySeconds === undefined && s.visitBefore === undefined && s.likeBefore === undefined) {
      setBusy(true);
      const r = await fetch(`/api/workflows/${workflowId}/steps/${step.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s.fields) });
      setBusy(false);
      if (!r.ok) return toast.error("Could not save this step");
      toast.success("Step saved");
      setEditStep(null);
      await load();
      return onChanged();
    }
    if (await putAll(restructure(steps ?? [], step.id, { fields: s.fields, delaySeconds: s.delaySeconds, visitBefore: s.visitBefore, likeBefore: s.likeBefore }), "Step saved")) setEditStep(null);
  }

  async function saveSkip(step: CampaignStep, days: number) {
    const r = await fetch(`/api/workflows/${workflowId}/steps/${step.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skip_after_days: days }) });
    if (!r.ok) return toast.error("Could not save this step");
    toast.success(days > 0 ? `Skips to email after ${days} day${days === 1 ? "" : "s"}` : "Never skips to email");
    await load();
  }

  function addStep(type: string) {
    setAdding(false);
    const track = type === "email" ? "email" : "linkedin";
    const base = draft ?? steps ?? [];
    const hasTrackSteps = base.some((s) => s.track === track);
    setDraft([...base, ...(hasTrackSteps ? [blankStep(track, "delay")] : []), blankStep(track, type)]);
  }

  function removeStep(id: string) {
    const base = draft ?? [];
    const target = base.find((s) => s.id === id);
    if (!target) return;
    const track = base.filter((s) => s.track === target.track);
    let i = track.findIndex((s) => s.id === id);
    let from = i;
    if (from > 0 && track[from - 1].step_type === "visit" && target.step_type === "connect") from--;
    while (from > 0 && track[from - 1].step_type === "delay") from--;
    if (from === 0) while (i + 1 < track.length && track[i + 1].step_type === "delay") i++;
    setDraft([...base.filter((s) => s.track !== target.track), ...track.slice(0, from), ...track.slice(i + 1)]);
  }

  if (!workflowId) {
    return (
      <Panel className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <IconTile icon={<RiFocus3Line size={22} />} size={48} />
        <div className="font-medium text-[22px] leading-tight">This agent has no sequence yet</div>
        <p className="max-w-md text-[15px] text-base-content/55">Create the LinkedIn and email steps this agent will send. You can change every step here.</p>
        <button className={primaryBtn} disabled={busy} onClick={async () => { setBusy(true); await onCreate(); setBusy(false); }}><RiAddLine size={16} /> Create the sequence</button>
      </Panel>
    );
  }

  const editing = draft !== null;
  const editingItem = items.find((it) => it.step.id === editStep) ?? null;

  return (
    <Panel className="relative">
      <div className="pointer-events-none absolute inset-0 rounded-[12px] opacity-70" style={DOTS} aria-hidden="true" />
      <div className="sticky top-3 z-30 flex justify-end gap-3 px-4 pt-6 sm:px-10">
        {editing ? (
          <>
            <button className="inline-flex h-12 items-center gap-2 rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-5 text-[16.5px] text-base-content shadow-[0_4px_14px_-8px_rgba(20,20,19,0.25)] hover:bg-base-200 disabled:opacity-50" disabled={busy} onClick={() => { Object.values(pendingVoice).forEach((v) => URL.revokeObjectURL(v.url)); setPendingVoice({}); setDraft(null); }}><RiCloseLine size={20} /> Cancel</button>
            <button className="inline-flex h-12 items-center gap-2 rounded-[8px] bg-[#f4876b] px-5 text-[16.5px] font-semibold text-white shadow-[0_6px_16px_-6px_rgba(232,112,82,0.7)] hover:bg-[#ee7357] disabled:opacity-60" disabled={busy} onClick={() => void saveDraft()}><RiCheckLine size={20} /> Save changes</button>
          </>
        ) : (
          <>
            <button className="inline-flex h-12 items-center gap-2 rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-5 text-[16.5px] text-base-content shadow-[0_4px_14px_-8px_rgba(20,20,19,0.25)] hover:bg-base-200 disabled:opacity-50" disabled={!steps} onClick={startEditing}><RiEditBoxLine size={19} /> Edit</button>
            <button className="inline-flex h-12 items-center gap-2 rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-5 text-[16.5px] text-base-content shadow-[0_4px_14px_-8px_rgba(20,20,19,0.25)] hover:bg-base-200 disabled:opacity-50" onClick={() => setSettingsOpen(true)}><RiSettings3Line size={19} /> Campaign settings</button>
          </>
        )}
      </div>

      <div className="relative mx-auto max-w-[1000px] space-y-7 px-4 pb-14 pt-2 sm:px-8">
        <div className="flex flex-wrap gap-3">
          <span className="inline-flex h-11 items-center gap-2.5 rounded-full border border-[var(--border-subtle)] bg-base-100 px-5 text-[16.5px] shadow-[0_2px_8px_-6px_rgba(20,20,19,0.3)]"><span className="h-2.5 w-2.5 rounded-full bg-[#5b5bd6]" />{items.length} steps</span>
          <span className="inline-flex h-11 items-center gap-2.5 rounded-full border border-[var(--border-subtle)] bg-base-100 px-5 text-[16.5px] shadow-[0_2px_8px_-6px_rgba(20,20,19,0.3)]"><span className="h-2.5 w-2.5 rounded-full bg-base-content/35" />{leadCount} leads</span>
        </div>

        <div className="rounded-[18px] border border-[var(--border-subtle)] bg-base-100 px-7 py-6 shadow-[0_4px_18px_-12px_rgba(20,20,19,0.18)]">
          <div className="flex flex-wrap items-start gap-4">
            <IconTile icon={<RiFilter3Line size={23} />} tone="success" size={48} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[19.5px] font-medium text-base-content">Lead sources</span>
                <span className="text-[16.5px] text-base-content/60">{sources.count} source{sources.count === 1 ? "" : "s"} <span className="text-base-content/30">•</span> <span className="font-medium text-success">{sources.leads}</span> total leads found</span>
              </div>
              <p className="mt-1 text-[16.5px] text-base-content/60">This agent continuously finds qualified leads and adds them to the campaign.</p>
              <div className="mt-4 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 rounded-[8px] bg-base-200 px-3.5 py-1.5 text-[17.5px] text-base-content/80"><RiFocus3Line size={19} className="text-[#b02ac6]" /> High-intent signals</span>
                <button type="button" onClick={onEditSources} className="inline-flex items-center gap-2 text-[16.5px] text-base-content/70 hover:text-base-content"><RiEditBoxLine size={18} /> Edit</button>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-center text-[16px] text-base-content/50">Qualified leads enter campaign<RiArrowDownLine size={20} className="mt-1" /></div>

        {steps === null ? <p className="text-center text-[15px] text-base-content/40">Loading…</p> : (
          <ol className="relative space-y-6">
            {items.length > 0 && <span className="absolute bottom-6 left-[21px] top-5 w-[2px] bg-[var(--border-subtle)]" aria-hidden="true" />}
            {items.map((it, idx) => {
              const s = it.step; const n = idx + 1;
              return (
                <li key={s.id} className="relative pl-[68px]">
                  <span className="absolute left-0 top-0 flex h-11 w-11 items-center justify-center rounded-full bg-[#ec6f55] text-[16px] font-semibold text-white shadow-[0_4px_12px_-4px_rgba(236,111,85,0.7)] ring-4 ring-base-100">{n}</span>
                  {it.delayBefore !== null && (
                    <div className="relative mb-4 flex h-11 items-center">
                      <button type="button" disabled={editing || busy} onClick={() => setDelayMenu(delayMenu === s.id ? null : s.id)}
                        className="inline-flex items-center gap-2 rounded-full border-2 border-dotted border-[#f2c14e] bg-[#fdf6e3] px-4 py-1.5 text-[16.5px] text-[#c27a10] enabled:hover:bg-[#fbeec8]">
                        <RiTimeLine size={19} /> {delayLabel(it.delayBefore)} after
                      </button>
                      {delayMenu === s.id && (
                        <div className="absolute left-0 top-full z-40 mt-1 max-h-72 w-44 overflow-y-auto rounded-[10px] border border-[var(--border-subtle)] bg-base-100 py-1 shadow-[var(--shadow-overlay)]">
                          {Array.from(new Set([...DELAY_OPTIONS, it.delayBefore])).sort((a, b) => a - b).map((sec) => (
                            <button key={sec} type="button" className={`flex w-full items-center justify-between px-3.5 py-2 text-left text-[15px] hover:bg-base-200 ${sec === it.delayBefore ? "bg-primary/10 text-primary" : ""}`}
                              onClick={() => { setDelayMenu(null); if (sec !== it.delayBefore) void putAll(restructure(steps, s.id, { delaySeconds: sec }), "Wait updated"); }}>
                              {delayLabel(sec)}{sec === it.delayBefore && <RiCheckLine size={15} />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <StepCard item={it} n={n} stat={stat.get(s.id)} editing={editing} busy={busy} workflowId={workflowId} localVoice={pendingVoice[s.id] ?? null}
                    aiLabel={aiName(s, countOn(s.step_type === "email" ? "email" : "message"))}
                    onRemove={() => removeStep(s.id)} onEdit={() => setEditStep(s.id)} onRecord={() => setEditStep(s.id)}
                    onContacts={() => setContactsOf({ id: s.id, title: `Step ${n} — ${STEP_TITLE[s.step_type] ?? s.step_type}`, invite: s.step_type === "connect" })}
                    onAccepted={() => setContactsOf({ id: s.id, title: `Step ${n} — ${STEP_TITLE[s.step_type] ?? s.step_type}`, invite: true, accepted: true })}
                    onSaveSkip={(days) => void saveSkip(s, days)} />
                </li>
              );
            })}

            {editing && (
              <li ref={addRef} className="relative pl-[68px]">
                <span className="absolute left-0 top-5 flex h-11 w-11 items-center justify-center rounded-full bg-base-200 text-base-content/55 ring-4 ring-base-100"><RiAddLine size={22} /></span>
                <button type="button" onClick={() => setAdding(!adding)} className="flex w-full items-center gap-4 rounded-[18px] border-2 border-dashed border-base-content/15 bg-base-100/70 px-7 py-7 text-left hover:border-primary/40">
                  <span className="flex h-12 w-12 items-center justify-center rounded-[10px] bg-base-200 text-base-content/55"><RiAddLine size={26} /></span>
                  <span><span className="block text-[19px] text-base-content/75">Add a step</span><span className="text-[16px] text-base-content/45">Message, invitation, profile visit…</span></span>
                </button>
                {adding && <AddStepMenu rules={addRules(shown, { includesConnections: !settings.exclude_first_degree })} onPick={addStep} onClose={() => setAdding(false)} />}
              </li>
            )}

            <li className="relative pl-[68px]">
              <span className="absolute left-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-success text-white ring-4 ring-base-100"><RiCheckLine size={22} /></span>
              <div className="flex items-center gap-4 rounded-[18px] border border-[var(--border-subtle)] bg-base-100 px-7 py-5">
                <IconTile icon={<RiCheckboxCircleLine size={23} />} tone="success" size={48} />
                <div><div className="text-[18.5px] text-base-content">Campaign complete</div><div className="text-[16px] text-base-content/55">Leads finish here once every step has run.</div></div>
              </div>
            </li>
          </ol>
        )}
      </div>

      {editingItem && workflowId && editingItem.step.step_type === "like_posts" && (
        <LikePostsDrawer step={editingItem.step} delayBefore={editingItem.delayBefore} busy={busy} onClose={() => setEditStep(null)} onSave={(s) => saveStep(editingItem.step, s)} />
      )}
      {editingItem && workflowId && editingItem.step.step_type === "voice" && (
        <VoiceDrawer step={editingItem.step} workflowId={workflowId} delayBefore={editingItem.delayBefore} busy={busy} pending={pendingVoice[editingItem.step.id] ?? null} onClose={() => setEditStep(null)} onSave={(s) => saveStep(editingItem.step, s)} />
      )}
      {editingItem && workflowId && !["like_posts", "voice"].includes(editingItem.step.step_type) && (
        <StepDrawer step={editingItem.step} stepNumber={items.indexOf(editingItem) + 1} delayBefore={editingItem.delayBefore} visitBefore={editingItem.visitBefore}
          likeBefore={editingItem.likeBefore} agentId={agentId} language={settings.language ?? null}
          channelMessageCount={countOn(editingItem.step.step_type === "email" ? "email" : "message")} workflowId={workflowId}
          sampleTargetId={sample?.id ?? null} sampleTargetName={sample?.name ?? null} busy={busy}
          onClose={() => setEditStep(null)} onSave={(s) => saveStep(editingItem.step, s)} />
      )}
      {contactsOf && <StepContactsModal agentId={agentId} stepId={contactsOf.id} title={contactsOf.title} invite={contactsOf.invite} accepted={contactsOf.accepted} onClose={() => setContactsOf(null)} onChanged={onChanged} />}
      {settingsOpen && <CampaignSettings agentId={agentId} initial={settings} hasEmailSender={hasEmailSender}
        connectStep={(steps ?? []).find((s) => s.step_type === "connect") ?? null}
        onClose={() => setSettingsOpen(false)} onSaved={() => { void load(); onChanged(); }} />}
    </Panel>
  );
}
