import type { Channel, Kind } from "@/lib/ai-templates/store";

/** Starter templates for the ✨ menu: three per channel and sequence step. Picking one replaces the text. */

export interface Example { title: string; desc: string; subject?: string; body: string; instructions: string }

const ROLE = "## Role\nWrite as {{SenderFullName}} from {{SenderCompany}} to {{FirstName}}, {{JobTitle}} at {{Company}}.";
const NEVER = "- Never invent numbers, customers, goals or events.\n- No flattery, hype or emojis.\n- Plain, human, concise.";

const li = (s: string) => s; // LinkedIn bodies are plain text
const html = (paras: string[]) => paras.map((p) => `<p>${p}</p>`).join("");

export const EXAMPLES: Record<Channel, Record<Kind, Example[]>> = {
  linkedin: {
    icebreaker: [
      { title: "Signal opener", desc: "Opens on the signal that triggered the outreach",
        body: li("Hi {{FirstName}},\n\n{{Intent}}\n\n{{AI:Reference their role}}\n\n{{CTA}}"),
        instructions: `${ROLE}\n\n## Goal\nStart a conversation by connecting what {{FirstName}} just did to one problem we solve.\n\n## Instructions\n- Lead with the signal in one sentence.\n- One question at the end.\n${NEVER}` },
      { title: "Role-based hook", desc: "Starts from what their role usually cares about",
        body: li("Hi {{FirstName}}, {{AI:Reference their role}}\n\nCurious how you handle this at {{Company}} today?"),
        instructions: `${ROLE}\n\n## Goal\nShow you understand the role's day-to-day before mentioning anything you sell.\n\n## Instructions\n- Keep it under 300 characters.\n- No pitch in the first message.\n${NEVER}` },
      { title: "Company context", desc: "Ties the message to something about their company",
        body: li("Hi {{FirstName}},\n\n{{AI:Personalize with company context}}\n\n{{CTA}}"),
        instructions: `${ROLE}\n\n## Goal\nMake the first message feel specific to {{Company}}.\n\n## Instructions\n- Mention one concrete thing about the company from the data.\n- End with an easy, open question.\n${NEVER}` },
    ],
    followup: [
      { title: "New angle", desc: "Adds one fresh point instead of bumping",
        body: li("Hi {{FirstName}}, one more thought —\n\n{{AI:Personalize with company context}}\n\n{{CTA}}"),
        instructions: `${ROLE}\n\n## Goal\nGive {{FirstName}} a new reason to reply.\n\n## Instructions\n- Don't repeat the first message.\n- One idea only.\n${NEVER}` },
      { title: "Recent activity", desc: "Picks up on what they posted or engaged with",
        body: li("Hi {{FirstName}},\n\n{{AI:Mention Recent Activity}}\n\nDoes that match what you're seeing at {{Company}}?"),
        instructions: `${ROLE}\n\n## Goal\nContinue the thread using their recent activity.\n\n## Instructions\n- Reference the activity naturally, never say you were watching.\n${NEVER}` },
      { title: "Quick question", desc: "Short, low-effort question to restart the thread",
        body: li("Hi {{FirstName}}, quick question — {{CTA}}"),
        instructions: `${ROLE}\n\n## Goal\nGet any reply, even a no.\n\n## Instructions\n- Under 200 characters.\n${NEVER}` },
    ],
    closing: [
      { title: "Close the signal loop", desc: "Ties back to the trigger you reached out about",
        body: li("Hi {{FirstName}},\n\nComing back to why I reached out: {{Intent}}\n\n{{AI:Personalize with company context}}"),
        instructions: `${ROLE}\n\n## Goal\nLast message: return to the original reason and leave the door open.\n\n## Instructions\n- Make it easy to say no.\n${NEVER}` },
      { title: "Revisit the problem later", desc: "Leaves the door open on a timeline",
        body: li("Hi {{FirstName}}, I'll leave it here for now.\n\n{{AI:Reference their role}}\n\nIf it becomes a priority later, happy to pick this up."),
        instructions: `${ROLE}\n\n## Goal\nEnd politely and suggest revisiting later.\n${NEVER}` },
      { title: "Future outcome", desc: "Paints the after state, no ask",
        body: li("Hi {{FirstName}},\n\n{{AI:Personalize with company context}}\n\nNo need to reply — just wanted to leave that with you."),
        instructions: `${ROLE}\n\n## Goal\nDescribe one realistic better outcome for {{Company}} without asking for anything.\n${NEVER}` },
    ],
  },
  email: {
    icebreaker: [
      { title: "Signal opener", desc: "Opens on the signal that triggered the outreach", subject: "{{Intent}}",
        body: html(["Hi {{FirstName}},", "{{Intent}}", "{{AI:Reference their role}}", "{{CTA}}"]),
        instructions: `${ROLE}\n\n## Goal\nOpen a conversation from the signal and one relevant problem.\n\n## Instructions\n- Subject: at most 6 words.\n- 50–110 words.\n${NEVER}` },
      { title: "Role-based hook", desc: "Starts from what their role usually cares about", subject: "Question about {{Company}}",
        body: html(["Hi {{FirstName}},", "{{AI:Reference their role}}", "How are you handling this at {{Company}} today?"]),
        instructions: `${ROLE}\n\n## Goal\nShow you understand the role before pitching.\n\n## Instructions\n- No pitch in the first email.\n${NEVER}` },
      { title: "Company context", desc: "Ties the email to something about their company", subject: "Idea for {{Company}}",
        body: html(["Hi {{FirstName}},", "{{AI:Personalize with company context}}", "{{CTA}}"]),
        instructions: `${ROLE}\n\n## Goal\nMake it feel written for {{Company}}.\n${NEVER}` },
    ],
    followup: [
      { title: "New angle", desc: "Adds one fresh point instead of bumping", subject: "Re: {{Company}}",
        body: html(["Hi {{FirstName}},", "One more angle that might be relevant:", "{{AI:Personalize with company context}}", "{{CTA}}"]),
        instructions: `${ROLE}\n\n## Goal\nGive a new reason to reply; build on the thread.\n${NEVER}` },
      { title: "Recent activity", desc: "Picks up on what they posted or engaged with", subject: "Re: {{Company}}",
        body: html(["Hi {{FirstName}},", "{{AI:Mention Recent Activity}}", "Is that on your radar at {{Company}}?"]),
        instructions: `${ROLE}\n\n## Goal\nContinue the thread using their recent activity.\n${NEVER}` },
      { title: "Short nudge", desc: "Two lines, one question", subject: "Re: {{Company}}",
        body: html(["Hi {{FirstName}},", "{{CTA}}"]),
        instructions: `${ROLE}\n\n## Goal\nA two-line follow-up that is easy to answer.\n${NEVER}` },
    ],
    closing: [
      { title: "Close the signal loop", desc: "Ties back to the trigger you reached out about", subject: "On {{Intent}}",
        body: html(["Hi {{FirstName}},", "Coming back to why I reached out:", "{{AI:Personalize with company context}}"]),
        instructions: `${ROLE}\n\n## Goal\nFinal email: return to the original reason and keep the conversation open.\n\n## Instructions\n- Invite an easy reaction, including disagreement.\n${NEVER}` },
      { title: "Revisit the problem later", desc: "Leaves the door open on a timeline", subject: "Maybe one for later at {{Company}}",
        body: html(["Hi {{FirstName}},", "I'll leave this with you for now.", "{{AI:Reference their role}}", "{{Intent}}"]),
        instructions: `${ROLE}\n\n## Goal\nEnd politely and suggest revisiting when timing is better.\n${NEVER}` },
      { title: "Future outcome", desc: "Paints the after state, no ask", subject: "Something to keep in mind for {{Company}}",
        body: html(["Hi {{FirstName}},", "I'll leave it there after this.", "{{AI:Personalize with company context}}", "{{Intent}}"]),
        instructions: `## Role\nContinue the conversation as {{SenderFullName}} from {{SenderCompany}}. This is the final scheduled email, but the conversation should remain open if the outcome matters to {{FirstName}}.\n\n## Goal\nReturn to one realistic better outcome and invite {{FirstName}} to react to whether it matters in their situation.\n\n## Instructions\n- Build on the existing thread rather than restating it.\n- Do not use language that permanently closes the conversation.\n${NEVER}` },
    ],
  },
};
