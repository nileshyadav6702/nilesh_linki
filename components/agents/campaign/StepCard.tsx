import { useState, type ReactNode } from "react";
import {
  RiArrowRightDoubleLine, RiCheckLine, RiDeleteBinLine, RiEyeLine, RiGroupLine, RiInformationLine, RiLinkedinBoxFill, RiMailLine,
  RiMailSendLine, RiMicLine, RiPencilLine, RiSparkling2Line, RiThumbUpLine, RiUserAddLine,
} from "react-icons/ri";
import { IconTile, type Tone } from "@/components/agents/ui";
import { STEP_TITLE, Tip, voiceUrl } from "@/components/agents/campaign/kit";
import type { Item } from "@/components/agents/campaign/sequence";
import VoicePlayer from "@/components/agents/campaign/VoicePlayer";

export interface StepStat { id: string; contacts: number; invited?: number; accepted?: number }

export const STEP_ICON: Record<string, { icon: ReactNode; tone: Tone }> = {
  connect: { icon: <RiUserAddLine size={18} />, tone: "linkedin" },
  message: { icon: <RiLinkedinBoxFill size={18} />, tone: "linkedin" },
  sales_inmail: { icon: <RiMailSendLine size={18} />, tone: "linkedin" },
  visit: { icon: <RiEyeLine size={18} />, tone: "amber" },
  email: { icon: <RiMailLine size={18} />, tone: "coral" },
  like_posts: { icon: <RiThumbUpLine size={18} />, tone: "coral" },
  voice: { icon: <RiMicLine size={18} />, tone: "success" },
};

/** "Skip after N days" on an invitation: hover explains it, click edits the number in place. */
function SkipPill({ days, disabled, onSave }: { days: number; disabled: boolean; onSave: (days: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(days));
  const commit = () => {
    setEditing(false);
    const n = Math.max(0, Math.min(60, Math.round(Number(value))));
    if (Number.isFinite(n) && n !== days) onSave(n); else setValue(String(days));
  };
  if (editing) {
    return (
      <span className="inline-flex items-center gap-2 text-[14.5px] text-base-content/55">
        <input autoFocus type="number" min={0} max={60} value={value} aria-label="Skip after days"
          onChange={(e) => setValue(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setValue(String(days)); setEditing(false); } }}
          className="h-9 w-[72px] rounded-[8px] border border-[#0a66c2]/50 bg-base-100 px-3 text-[15px] text-base-content outline-none focus:ring-2 focus:ring-[#0a66c2]/20" />
        day(s)
      </span>
    );
  }
  const text = days > 0
    ? `If the contact hasn't accepted the invitation after ${days} day${days === 1 ? "" : "s"}, we skip the invitation & LinkedIn messages and send emails directly.`
    : "LinkedIn steps wait for the invitation to be accepted, however long it takes. Set a number of days to switch to email instead.";
  return (
    <Tip text={text} side="bottom">
      <button type="button" disabled={disabled} onClick={() => { setValue(String(days)); setEditing(true); }}
        className="inline-flex items-center gap-1.5 rounded-[8px] border-2 border-dotted border-[#0a66c2]/30 bg-[#0a66c2]/[0.06] px-3 py-1 text-[14.5px] font-medium text-[#0a66c2] enabled:hover:bg-[#0a66c2]/10">
        <RiArrowRightDoubleLine size={15} />{days > 0 ? `Skip after ${days} day${days === 1 ? "" : "s"}` : "Never skip"}
      </button>
    </Tip>
  );
}

/** One action step of the Campaign timeline. */
export default function StepCard({ item, n, stat, editing, busy, aiLabel, workflowId, onRemove, onEdit, onContacts, onRecord, onSaveSkip }: {
  item: Item; n: number; stat: StepStat | undefined; editing: boolean; busy: boolean; aiLabel: string; workflowId: string;
  onRemove: () => void; onEdit: () => void; onContacts: () => void; onRecord: () => void; onSaveSkip: (days: number) => void;
}) {
  const s = item.step;
  const look = STEP_ICON[s.step_type] ?? STEP_ICON.message;
  const writes = s.step_type === "message" || s.step_type === "sales_inmail" || s.step_type === "email";
  const fixedText = s.step_type === "email" ? s.email_body : s.message_body;
  const isNew = s.id.startsWith("new-");
  const withdraw = s.withdraw_after_days ?? 30;
  const likes = Math.max(1, s.like_count ?? 1);

  return (
    <div className="wizard-rise rounded-[16px] border border-[var(--border-subtle)] bg-base-100 p-6 transition-shadow hover:shadow-[0_10px_28px_-16px_rgba(20,20,19,0.22)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <IconTile icon={look.icon} tone={look.tone} />
          <div className="min-w-0">
            <div className="text-[17px] font-semibold text-base-content">{STEP_TITLE[s.step_type] ?? s.step_type}</div>
            <div className="text-[14px] text-base-content/55">Step {n} · {s.track === "email" ? "Email" : "LinkedIn"}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {s.step_type === "connect" && !isNew && <SkipPill days={s.skip_after_days ?? 7} disabled={editing || busy} onSave={onSaveSkip} />}
          {editing && <button type="button" className="flex h-8 w-8 items-center justify-center rounded-[8px] text-base-content/40 hover:bg-error/10 hover:text-error" aria-label="Remove step" onClick={onRemove}><RiDeleteBinLine size={16} /></button>}
        </div>
      </div>

      {s.step_type === "visit" && <p className="mt-4 rounded-[10px] bg-base-200/70 px-4 py-3 text-[15px] text-base-content/60">Automatically visits the contact&apos;s LinkedIn profile</p>}
      {s.step_type === "like_posts" && <p className="mt-4 rounded-[10px] bg-base-200/70 px-4 py-3 text-[15px] text-base-content/60">Likes {likes} recent LinkedIn post{likes === 1 ? "" : "s"}</p>}
      {s.step_type === "voice" && (
        <div className="mt-4">
          {s.voice_duration_ms && !isNew
            ? <VoicePlayer key={`${s.id}:${s.voice_duration_ms}`} src={voiceUrl(workflowId, s.id)} durationMs={s.voice_duration_ms} />
            : editing || isNew
              ? <p className="flex items-center gap-2 rounded-[10px] bg-error/[0.06] px-4 py-3 text-[15px] text-error/80"><RiMicLine size={16} /> Save changes, then record your message</p>
              : <button type="button" onClick={onRecord} className="flex w-full items-center gap-2 rounded-[10px] border border-error/20 bg-error/[0.06] px-4 py-3 text-left text-[15px] text-error hover:bg-error/10"><RiMicLine size={16} /> Click to record a voice message</button>}
        </div>
      )}
      {s.step_type === "connect" && (
        <div className="mt-3 space-y-1 text-[15px] italic text-base-content/55">
          <p>{s.connect_note ? <>Invitation with note: <span className="not-italic text-base-content/75">“{s.connect_note}”</span></> : "Invitation without note"}</p>
          {withdraw > 0 && <p>Automatically withdrawn after {withdraw} days to avoid too many open invitations.</p>}
          {item.visitBefore && <p className="not-italic text-[14.5px] text-base-content/50"><RiEyeLine size={13} className="mr-1 inline" />Visits the profile first</p>}
        </div>
      )}
      {writes && (s.send_mode === "fixed" && fixedText ? (
        <div className="mt-4 rounded-[10px] bg-base-200/70 px-4 py-3 text-[15px] text-base-content/70">
          {s.step_type === "email" && s.email_subject && <div className="mb-1 font-medium text-base-content">{s.email_subject}</div>}
          <p className="line-clamp-3 whitespace-pre-wrap">{fixedText}</p>
          <div className="mt-2 text-[12.5px] text-base-content/45">Same message for everyone</div>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-3 rounded-[10px] border border-primary/15 bg-primary/[0.06] px-4 py-3">
          <IconTile icon={<RiSparkling2Line size={16} />} size={36} />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium text-base-content">{aiLabel}</div>
            <div className="text-[13.5px] text-base-content/50">Personalized for each contact</div>
          </div>
          <Tip text="A personalized message is automatically generated for each contact, tailored to your value proposition."><RiInformationLine size={16} className="text-base-content/35" /></Tip>
        </div>
      ))}

      {!isNew && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[var(--border-subtle)] pt-3 text-[14.5px]">
          {s.step_type === "connect" && (
            <span className="inline-flex items-center gap-1.5">
              <Tip text={`Invitation has been sent to ${stat?.invited ?? 0} contact${stat?.invited === 1 ? "" : "s"} (${stat?.accepted ?? 0} accepted)`}>
                <span className="inline-flex items-center gap-1 rounded-full bg-success/12 px-2.5 py-0.5 font-medium text-[#3a8c4f]"><RiCheckLine size={13} />{stat?.accepted ?? 0} accepted</span>
              </Tip>
              <Tip text={withdraw > 0
                ? `Invitations that aren't accepted within ${withdraw} days are automatically withdrawn. This helps maintain the health of your LinkedIn account.`
                : "Pending invitations are never withdrawn automatically."}><RiInformationLine size={15} className="text-base-content/35" /></Tip>
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">
            <Tip text={s.step_type === "connect"
              ? `${stat?.contacts ?? 0} contact${stat?.contacts === 1 ? " was" : "s were"} invited: waiting for them to accept, or accepted and waiting for the next step.`
              : `${stat?.contacts ?? 0} contact${stat?.contacts === 1 ? " has" : "s have"} completed this step and haven't moved to the next one yet.`}>
              <button type="button" onClick={onContacts}
                className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1 tabular-nums text-base-content/55 hover:bg-primary/10 hover:text-base-content"><RiGroupLine size={14} /> {stat?.contacts ?? 0} contacts</button>
            </Tip>
            {s.step_type !== "visit" && !editing && (
              <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-base-content/55 hover:bg-base-200 hover:text-base-content"><RiPencilLine size={14} /> Edit</button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
