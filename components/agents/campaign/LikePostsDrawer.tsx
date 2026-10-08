import { useState } from "react";
import { RiThumbUpLine } from "react-icons/ri";
import { primaryBtn } from "@/components/agents/ui";
import { SideDrawer, WaitSelect, type CampaignStep } from "@/components/agents/campaign/kit";
import type { StepSave } from "@/components/agents/campaign/StepDrawer";

/** Edit a Like Posts step: how many recent posts to like, and the wait before it. */
export default function LikePostsDrawer({ step, delayBefore, busy, onClose, onSave }: {
  step: CampaignStep; delayBefore: number | null; busy: boolean; onClose: () => void; onSave: (s: StepSave) => void;
}) {
  const [count, setCount] = useState(Math.min(3, Math.max(1, step.like_count ?? 1)));
  const [delay, setDelay] = useState(delayBefore ?? 0);

  function save() {
    const out: StepSave = { fields: { like_count: count } };
    if (delayBefore !== null && delay !== delayBefore) out.delaySeconds = delay;
    onSave(out);
  }

  return (
    <SideDrawer title="Edit Like Posts step" onClose={onClose} footer={<>
      <button type="button" className="px-3 text-sm font-medium text-base-content/70 hover:text-base-content" onClick={onClose}>Cancel</button>
      <button type="button" className={primaryBtn} disabled={busy} onClick={save}>Save Step</button>
    </>}>
      <div className="space-y-6 rounded-[12px] border border-[var(--border-subtle)] p-5">
        <div className="flex items-start gap-3 rounded-[10px] bg-primary/[0.07] px-4 py-3.5">
          <RiThumbUpLine size={18} className="mt-0.5 shrink-0 text-primary" />
          <div className="text-sm leading-relaxed">
            <div className="font-medium text-base-content">Warm up the conversation before reaching out</div>
            <p className="text-base-content/60">Your LinkedIn profile will like recent posts from this contact, helping you show up in their notifications and make the next touch feel more familiar.</p>
          </div>
        </div>

        <div>
          <div className="mb-2 text-[13px] text-base-content/55">Posts to like</div>
          <div className="grid grid-cols-3 overflow-hidden rounded-[8px] border border-[var(--border-subtle)]">
            {[1, 2, 3].map((n) => (
              <button key={n} type="button" onClick={() => setCount(n)} aria-pressed={count === n}
                className={`h-11 text-sm font-medium transition-colors ${n > 1 ? "border-l border-[var(--border-subtle)]" : ""} ${count === n ? "bg-primary text-primary-content" : "bg-base-100 text-base-content/75 hover:bg-base-200"}`}>
                {n} post{n === 1 ? "" : "s"}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-base-content/45">Posts already liked are skipped. If the contact has no recent posts, the step simply moves on.</p>
        </div>

        {delayBefore !== null && (
          <div>
            <div className="mb-2 text-[13px] text-base-content/55">Timing</div>
            <WaitSelect value={delay} onChange={setDelay} />
          </div>
        )}
      </div>
    </SideDrawer>
  );
}
