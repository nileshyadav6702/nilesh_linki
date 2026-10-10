import type { CampaignStep } from "@/components/agents/campaign/kit";

/**
 * The Campaign tab's view of a workflow: both tracks merged into one run order, and the
 * structural edits (wait before a step, visit before an invitation) applied to the flat step list.
 */

export interface Item { step: CampaignStep; at: number; delayBefore: number | null; visitBefore: boolean; likeBefore: boolean }

/** Steps that, placed right before an invitation, are its "visit profile / like posts first" options. */
const WARMUP = new Set(["visit", "like_posts"]);

/** The action steps of both tracks in run order, each with the wait in front of it on its own track. */
export function timeline(steps: CampaignStep[]): Item[] {
  const out: Item[] = [];
  for (const track of ["linkedin", "email"] as const) {
    let at = 0; let wait = 0; let seenAction = false; let prevVisit = false; let prevLike = false;
    const list = steps.filter((x) => x.track === track);
    list.forEach((s, idx) => {
      if (s.step_type === "delay") { wait += s.delay_seconds || 0; at += s.delay_seconds || 0; return; }
      // Visits / likes directly in front of an invitation are its warm-up options, not steps of their own.
      if (WARMUP.has(s.step_type)) {
        let j = idx + 1;
        while (j < list.length && WARMUP.has(list[j].step_type)) j++;
        if (list[j]?.step_type === "connect") { if (s.step_type === "visit") prevVisit = true; else prevLike = true; return; }
      }
      const connect = s.step_type === "connect";
      out.push({ step: s, at, delayBefore: seenAction || wait > 0 ? wait : null, visitBefore: connect && prevVisit, likeBefore: connect && prevLike });
      seenAction = true; wait = 0; prevVisit = false; prevLike = false;
    });
  }
  return out.sort((a, b) => a.at - b.at || (a.step.track === b.step.track ? a.step.step_order - b.step.step_order : a.step.track === "linkedin" ? -1 : 1));
}

export const blankStep = (track: "linkedin" | "email", type: string): CampaignStep => ({
  id: `new-${Math.random().toString(36).slice(2)}`, track, step_type: type, step_order: 0, delay_seconds: type === "delay" ? 86_400 : 0,
  connect_note: null, message_body: null, email_subject: null, email_body: null, ai_enabled: 0, send_mode: "ai", message_position: 1, email_position: 1,
  ...(type === "like_posts" ? { like_count: 1 } : {}), ...(type === "connect" ? { skip_after_days: 7, withdraw_after_days: 30 } : {}),
});

/** Rewrite a track: set the wait before `stepId` and (for invitations) the visit / like-posts warm-up steps. */
export function restructure(steps: CampaignStep[], stepId: string, change: { delaySeconds?: number; visitBefore?: boolean; likeBefore?: boolean; fields?: Partial<CampaignStep> }): CampaignStep[] {
  const target = steps.find((s) => s.id === stepId);
  if (!target) return steps;
  const track = steps.filter((s) => s.track === target.track);
  const others = steps.filter((s) => s.track !== target.track);
  let i = track.findIndex((s) => s.id === stepId);
  const next = [...track];
  next[i] = { ...next[i], ...(change.fields ?? {}) };
  if (change.visitBefore !== undefined || change.likeBefore !== undefined) {
    // The warm-up block right before the step: visit first, then like posts, keeping existing step ids.
    let from = i;
    while (from > 0 && WARMUP.has(next[from - 1].step_type)) from--;
    const current = next.slice(from, i);
    const has = (t: string) => current.some((x) => x.step_type === t);
    const want = { visit: change.visitBefore ?? has("visit"), like_posts: change.likeBefore ?? has("like_posts") };
    const block = (["visit", "like_posts"] as const).filter((t) => want[t]).map((t) => current.find((x) => x.step_type === t) ?? blankStep(target.track, t));
    next.splice(from, i - from, ...block);
    i = from + block.length;
  }
  if (change.delaySeconds !== undefined) {
    let start = i;
    while (start > 0 && WARMUP.has(next[start - 1].step_type)) start--;
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

/** Most action steps a sequence can hold. */
export const MAX_ACTIONS = 15;

export interface AddRule { disabled: boolean; reason?: string }

/**
 * Which steps can be added next, and why not. One invitation per person; LinkedIn messages and
 * voice notes only reach connections, so they need an invitation earlier in the sequence (unless
 * the campaign also targets existing connections); and a sequence has a length limit.
 */
export function addRules(steps: CampaignStep[], opts: { includesConnections: boolean }): Record<string, AddRule> {
  const actions = steps.filter((s) => s.step_type !== "delay");
  const has = (t: string) => actions.some((s) => s.step_type === t);
  const full = actions.length >= MAX_ACTIONS;
  const rule = (blocked: false | string): AddRule => (full ? { disabled: true, reason: `A sequence can have at most ${MAX_ACTIONS} steps` } : blocked ? { disabled: true, reason: blocked } : { disabled: false });
  const needsInvite = !has("connect") && !opts.includesConnections ? "Add a Send Connection Request first: LinkedIn messages only reach your connections" : false;
  return {
    connect: rule(has("connect") ? "Already in your sequence: a person can only be invited once" : false),
    message: rule(needsInvite),
    voice: rule(needsInvite),
    visit: rule(false),
    like_posts: rule(false),
    email: rule(false),
  };
}
