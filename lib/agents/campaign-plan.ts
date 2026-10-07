// Pure step plans for agent campaigns. No Node imports: the wizard renders these in the browser.

const DAY = 86_400;

export interface StepSpec {
  track: "linkedin" | "email"; type: "visit" | "connect" | "message" | "delay" | "email";
  delay?: number; body?: string; subject?: string; position?: number; ai?: string;
}

export type CampaignChannel = "linkedin" | "multi" | "email";

/** The step plan for a channel choice. LinkedIn and email run as parallel tracks. */
export function campaignPlan(channel: CampaignChannel): StepSpec[] {
  const linkedin: StepSpec[] = [
    { track: "linkedin", type: "connect" },
    { track: "linkedin", type: "delay", delay: 1 * DAY },
    { track: "linkedin", type: "message", position: 1, body: "Hi {{first_name}}, thanks for connecting — curious how you're approaching this at {{company}}?", ai: "AI icebreaker: open on the lead's signal; one question." },
    { track: "linkedin", type: "delay", delay: 3 * DAY },
    { track: "linkedin", type: "visit" },
    { track: "linkedin", type: "message", position: 2, body: "Hi {{first_name}}, just bumping this in case it got buried.", ai: "AI follow-up: a short follow-up with one new angle; no pressure." },
    { track: "linkedin", type: "delay", delay: 4 * DAY },
    { track: "linkedin", type: "message", position: 3, body: "Hi {{first_name}}, I'll leave it here — happy to reconnect whenever it's useful.", ai: "AI closing: a polite last note that makes it easy to say no." },
  ];
  const email: StepSpec[] = [
    { track: "email", type: "delay", delay: (channel === "multi" ? 2 : 0) * DAY },
    { track: "email", type: "email", position: 1, subject: "Quick question, {{first_name}}", body: "Hi {{first_name}},\n\nCurious how {{company}} is handling this today — worth a quick chat?", ai: "AI icebreaker email: open on the lead's signal." },
    { track: "email", type: "delay", delay: 3 * DAY },
    { track: "email", type: "email", position: 2, subject: "Re: Quick question, {{first_name}}", body: "Hi {{first_name}}, following up on my note below.", ai: "AI follow-up email: one new, concrete reason to talk." },
  ];
  return channel === "linkedin" ? linkedin : channel === "email" ? email.filter((s, i) => i > 0) : [...linkedin, ...email];
}
