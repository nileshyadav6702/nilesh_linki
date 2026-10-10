import { useState, type ReactNode } from "react";
import {
  RiArrowRightDoubleLine, RiCheckLine, RiDeleteBinLine, RiEyeLine, RiGroupLine, RiInformationLine, RiLinkedinBoxFill, RiMailLine,
  RiEditBoxLine, RiMailSendLine, RiMicLine, RiSparkling2Line, RiThumbUpLine, RiUserAddLine,
} from "react-icons/ri";
import { IconTile, type Tone } from "@/components/agents/ui";
import { STEP_TITLE, Tip, voiceUrl } from "@/components/agents/campaign/kit";
import type { Item } from "@/components/agents/campaign/sequence";
import VoicePlayer from "@/components/agents/campaign/VoicePlayer";

export interface StepStat { id: string; contacts: number; invited?: number; accepted?: number }

export const STEP_ICON: Record<string, { icon: ReactNode; tone: Tone }> = {
  connect: { icon: <RiUserAddLine size={23} />, tone: "linkedin" },
  message: { icon: <RiLinkedinBoxFill size={23} />, tone: "linkedin" },
  sales_inmail: { icon: <RiMailSendLine size={23} />, tone: "linkedin" },
  visit: { icon: <RiEyeLine size={23} />, tone: "amber" },
  email: { icon: <RiMailLine size={23} />, tone: "coral" },
  like_posts: { icon: <RiThumbUpLine size={23} />, tone: "coral" },
  voice: { icon: <RiMicLine size={23} />, tone: "success" },
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
        className="inline-flex items-center gap-2 rounded-[8px] border-2 border-dotted border-[#0a66c2]/35 bg-[#0a66c2]/[0.07] px-3.5 py-1.5 text-[16.5px] text-[#0a66c2] enabled:hover:bg-[#0a66c2]/12">
        <RiArrowRightDoubleLine size={19} />{days > 0 ? `Skip after ${days} day${days === 1 ? "" : "s"}` : "Never skip"}
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
    <div className="wizard-rise rounded-[18px] border border-[var(--border-subtle)] bg-base-100 px-7 py-6 shadow-[0_4px_18px_-12px_rgba(20,20,19,0.18)] transition-shadow hover:shadow-[0_12px_30px_-16px_rgba(20,20,19,0.26)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-4">
          <IconTile icon={look.icon} tone={look.tone} size={48} />
          <div className="min-w-0">
            <div className="text-[19.5px] font-medium text-base-content">{STEP_TITLE[s.step_type] ?? s.step_type}</div>
            <div className="text-[16px] text-base-content/55">Step {n} · {s.track === "email" ? "Email" : "LinkedIn"}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {s.step_type === "connect" && !isNew && <SkipPill days={s.skip_after_days ?? 7} disabled={editing || busy} onSave={onSaveSkip} />}
          {editing && <button type="button" className="flex h-10 w-10 items-center justify-center rounded-[8px] text-base-content/35 hover:bg-error/10 hover:text-error" aria-label="Remove step" onClick={onRemove}><RiDeleteBinLine size={21} /></button>}
        </div>
      </div>

      {s.step_type === "visit" && <p className="mt-4 rounded-[12px] bg-base-200/70 px-5 py-3.5 text-[16.5px] text-base-content/65">Automatically visits the contact&apos;s LinkedIn profile</p>}
      {s.step_type === "like_posts" && <p className="mt-4 rounded-[12px] bg-base-200/70 px-5 py-3.5 text-[16.5px] text-base-content/65">Likes {likes} recent LinkedIn post{likes === 1 ? "" : "s"}</p>}
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
        <div className="mt-4 space-y-2 text-[16.5px] italic text-base-content/55">
          <p>{s.connect_note ? <>Invitation with note: <span className="not-italic text-base-content/75">“{s.connect_note}”</span></> : "Invitation without note"}</p>
          {withdraw > 0 && <p>Automatically withdrawn after {withdraw} days to avoid too many open invitations.</p>}
          {item.visitBefore && <p className="not-italic text-[14.5px] text-base-content/50"><RiEyeLine size={13} className="mr-1 inline" />Visits the profile first</p>}
        </div>
      )}
      {writes && (s.send_mode === "fixed" && fixedText ? (
        <div className="mt-4 rounded-[12px] bg-base-200/70 px-5 py-4 text-[16.5px] text-base-content/75">
          {s.step_type === "email" && s.email_subject && <div className="mb-1 font-medium text-base-content">{s.email_subject}</div>}
          <p className="line-clamp-3 whitespace-pre-wrap">{fixedText}</p>
          <div className="mt-2 text-[12.5px] text-base-content/45">Same message for everyone</div>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-4 rounded-[12px] border border-[#c04ad6]/15 bg-[#c04ad6]/[0.05] px-5 py-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-[#c04ad6]/12 text-[#b02ac6]"><RiSparkling2Line size={21} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[17.5px] text-base-content">{aiLabel}</div>
            <div className="text-[15.5px] text-base-content/55">Personalized for each contact</div>
          </div>
          <Tip text="A personalized message is automatically generated for each contact, tailored to your value proposition."><RiInformationLine size={16} className="text-base-content/35" /></Tip>
        </div>
      ))}

      {!isNew && (
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[var(--border-subtle)] pt-4 text-[16.5px]">
          {s.step_type === "connect" && (
            <span className="inline-flex items-center gap-1.5">
              <Tip text={`Invitation has been sent to ${stat?.invited ?? 0} contact${stat?.invited === 1 ? "" : "s"} (${stat?.accepted ?? 0} accepted)`}>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success/12 px-3.5 py-1 text-[#2f8a4c]"><RiCheckLine size={17} />{stat?.accepted ?? 0} accepted</span>
              </Tip>
              <Tip text={withdraw > 0
                ? `Invitations that aren't accepted within ${withdraw} days are automatically withdrawn. This helps maintain the health of your LinkedIn account.`
                : "Pending invitations are never withdrawn automatically."}><RiInformationLine size={19} className="text-base-content/35" /></Tip>
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">
            <Tip text={s.step_type === "connect"
              ? `${stat?.contacts ?? 0} contact${stat?.contacts === 1 ? " was" : "s were"} invited: waiting for them to accept, or accepted and waiting for the next step.`
              : `${stat?.contacts ?? 0} contact${stat?.contacts === 1 ? " has" : "s have"} completed this step and haven't moved to the next one yet.`}>
              <button type="button" onClick={onContacts}
                className="inline-flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 tabular-nums text-base-content/60 hover:bg-primary/10 hover:text-base-content"><RiGroupLine size={19} /> {stat?.contacts ?? 0} contacts</button>
            </Tip>
            {s.step_type !== "visit" && !editing && (
              <button type="button" onClick={onEdit} className="inline-flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-base-content/60 hover:bg-base-200 hover:text-base-content"><RiEditBoxLine size={19} /> Edit</button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
