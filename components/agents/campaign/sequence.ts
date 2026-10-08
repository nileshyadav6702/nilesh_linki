import type { CampaignStep } from "@/components/agents/campaign/kit";

/**
 * The Campaign tab's view of a workflow: both tracks merged into one run order, and the
 * structural edits (wait before a step, visit before an invitation) applied to the flat step list.
 */

export interface Item { step: CampaignStep; at: number; delayBefore: number | null; visitBefore: boolean }

/** The action steps of both tracks in run order, each with the wait in front of it on its own track. */
export function timeline(steps: CampaignStep[]): Item[] {
  const out: Item[] = [];
  for (const track of ["linkedin", "email"] as const) {
    let at = 0; let wait = 0; let seenAction = false; let prevVisit = false;
    for (const s of steps.filter((x) => x.track === track)) {
      if (s.step_type === "delay") { wait += s.delay_seconds || 0; at += s.delay_seconds || 0; continue; }
      // A visit right before an invitation is the invitation's "visit profile first" option.
      if (s.step_type === "visit") {
        const next = steps.filter((x) => x.track === track)[steps.filter((x) => x.track === track).indexOf(s) + 1];
        if (next?.step_type === "connect") { prevVisit = true; continue; }
      }
      out.push({ step: s, at, delayBefore: seenAction || wait > 0 ? wait : null, visitBefore: s.step_type === "connect" && prevVisit });
      seenAction = true; wait = 0; prevVisit = false;
    }
  }
  return out.sort((a, b) => a.at - b.at || (a.step.track === b.step.track ? a.step.step_order - b.step.step_order : a.step.track === "linkedin" ? -1 : 1));
}

export const blankStep = (track: "linkedin" | "email", type: string): CampaignStep => ({
  id: `new-${Math.random().toString(36).slice(2)}`, track, step_type: type, step_order: 0, delay_seconds: type === "delay" ? 86_400 : 0,
  connect_note: null, message_body: null, email_subject: null, email_body: null, ai_enabled: 0, send_mode: "ai", message_position: 1, email_position: 1,
  ...(type === "like_posts" ? { like_count: 1 } : {}), ...(type === "connect" ? { skip_after_days: 7, withdraw_after_days: 30 } : {}),
});

/** Rewrite a track: set the wait before `stepId` and (for invitations) the visit-first step. */
export function restructure(steps: CampaignStep[], stepId: string, change: { delaySeconds?: number; visitBefore?: boolean; fields?: Partial<CampaignStep> }): CampaignStep[] {
  const target = steps.find((s) => s.id === stepId);
  if (!target) return steps;
  const track = steps.filter((s) => s.track === target.track);
  const others = steps.filter((s) => s.track !== target.track);
  let i = track.findIndex((s) => s.id === stepId);
  const next = [...track];
  next[i] = { ...next[i], ...(change.fields ?? {}) };
  if (change.visitBefore !== undefined) {
    const hasVisit = i > 0 && next[i - 1].step_type === "visit";
    if (change.visitBefore && !hasVisit) { next.splice(i, 0, blankStep(target.track, "visit")); i++; }
    if (!change.visitBefore && hasVisit) { next.splice(i - 1, 1); i--; }
  }
  if (change.delaySeconds !== undefined) {
    const start = i - (i > 0 && next[i - 1].step_type === "visit" ? 1 : 0);
    let first = start;
    while (first > 0 && next[first - 1].step_type === "delay") first--;
    next.splice(first, start - first, { ...blankStep(target.track, "delay"), ...(start > first ? { id: next[first].id } : {}), delay_seconds: change.delaySeconds });
  }
  return [...others, ...next];
}

/** Number each track's messages and emails 1..n in order (1 = icebreaker), as the sender expects. */
export function withPositions(steps: CampaignStep[]): CampaignStep[] {
  const pos = { message: { linkedin: 0, email: 0 }, email: { linkedin: 0, email: 0 } };
  return steps.map((s) => {
    if (s.step_type === "message" || s.step_type === "sales_inmail") return { ...s, message_position: ++pos.message[s.track] };
    if (s.step_type === "email") return { ...s, email_position: ++pos.email[s.track] };
    return s;
  });
}
