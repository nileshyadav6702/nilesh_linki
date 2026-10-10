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
      <button type="button" className="px-3 text-[15px] font-medium text-base-content/70 hover:text-base-content" onClick={onClose}>Cancel</button>
      <button type="button" className={primaryBtn} disabled={busy} onClick={save}>Save Step</button>
    </>}>
      <div className="space-y-7 rounded-[14px] border border-[var(--border-subtle)] p-8">
        <div className="flex items-center gap-5 rounded-[12px] border border-[var(--border-subtle)] bg-base-content/[0.035] px-6 py-6">
          <RiThumbUpLine size={26} className="shrink-0 text-base-content/80" />
          <div className="text-[16.5px] leading-relaxed">
            <div className="font-medium text-base-content">Warm up the conversation before reaching out</div>
            <p className="text-base-content/55">Your LinkedIn profile will like recent posts from this contact, helping you show up in their notifications and make the next touch feel more familiar.</p>
          </div>
        </div>

        <div>
          <div className="mb-3 text-[16.5px] text-base-content/55">Posts to like</div>
          <div role="radiogroup" aria-label="Posts to like" className="grid grid-cols-3">
            {[1, 2, 3].map((n) => (
              <button key={n} type="button" role="radio" onClick={() => setCount(n)} aria-checked={count === n}
                className={`h-[50px] border text-[17px] font-medium transition-colors first:rounded-l-[6px] last:rounded-r-[6px] ${n > 1 ? "-ml-px" : ""} ${count === n
                  ? "relative z-10 border-primary bg-primary text-primary-content shadow-[0_4px_12px_-4px_rgba(204,120,92,0.6)]"
                  : "border-base-content/70 bg-base-100 text-base-content/85 hover:bg-base-200/60"}`}>
                {n} post{n === 1 ? "" : "s"}
              </button>
            ))}
          </div>
        </div>

        {delayBefore !== null && (
          <div>
            <div className="mb-3 text-[16.5px] text-base-content/55">Timing</div>
            <WaitSelect value={delay} onChange={setDelay} />
          </div>
        )}
      </div>
    </SideDrawer>
  );
}
