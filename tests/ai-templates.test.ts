import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import {
  createTemplate, kindForStep, listTemplates, setMode, templateFor, templateInput, templateUsage, tokensForPrompt, updateTemplate, visibleLength,
} from "@/lib/ai-templates/store";
import { EXAMPLES } from "@/lib/ai-templates/examples";

const WS = "ws-ai-templates";

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO workflows (id, workspace_id, name) VALUES ('tpl-wf', ?, 'Campaign')").run(WS);
  const step = db.prepare("INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, track) VALUES (?, 'tpl-wf', ?, ?, ?)");
  step.run("tpl-s1", 1, "connect", "linkedin"); step.run("tpl-s2", 2, "message", "linkedin"); step.run("tpl-s3", 3, "message", "linkedin");
  db.prepare("INSERT INTO agents (id, workspace_id, name, workflow_id) VALUES ('tpl-a', ?, 'A', 'tpl-wf')").run(WS);
});

describe("AI outreach templates", () => {
  it("validates: name, body, email subject, length and known variables", () => {
    expect(templateInput.safeParse({ name: "", channel: "linkedin", kind: "icebreaker", body: "Hi" }).success).toBe(false);
    expect(templateInput.safeParse({ name: "x", channel: "email", kind: "icebreaker", body: "<p>Hi</p>", subject: "" }).success).toBe(false);
    expect(templateInput.safeParse({ name: "x", channel: "linkedin", kind: "icebreaker", body: "Hi {{Nope}}" }).success).toBe(false);
    expect(templateInput.safeParse({ name: "x", channel: "linkedin", kind: "icebreaker", body: "a".repeat(701) }).success).toBe(false);
    expect(templateInput.safeParse({ name: "x", channel: "linkedin", kind: "icebreaker", body: "Hi {{FirstName}}, {{AI:Reference their role}}" }).success).toBe(true);
    expect(visibleLength("<p>Hi {{FirstName}}</p>")).toBe("Hi FirstName".length);
  });

  it("every example is a valid template", () => {
    for (const ch of ["linkedin", "email"] as const) for (const k of ["icebreaker", "followup", "closing"] as const) {
      for (const e of EXAMPLES[ch][k]) expect(templateInput.safeParse({ name: e.title, channel: ch, kind: k, subject: e.subject ?? null, body: e.body, ai_instructions: e.instructions }).success).toBe(true);
    }
  });

  it("maps steps to icebreaker / follow-up / closing", () => {
    expect([kindForStep(1, 3), kindForStep(2, 3), kindForStep(3, 3), kindForStep(2, 2)]).toEqual(["icebreaker", "followup", "closing", "followup"]);
  });

  it("only drives the writer in custom mode, newest template wins, and counts agents using it", () => {
    const db = getDb();
    const a = createTemplate(db, WS, { name: "Opener", channel: "linkedin", kind: "icebreaker", body: "Hi {{FirstName}} — {{Intent}}" });
    expect(templateFor(db, WS, "linkedin", "icebreaker")).toBeNull();
    setMode(db, WS, "custom");
    expect(templateFor(db, WS, "linkedin", "icebreaker")?.id).toBe(a.id);
    const b = createTemplate(db, WS, { name: "Closer", channel: "linkedin", kind: "closing", body: "Last one, {{FirstName}}" });
    expect(templateUsage(db, WS)).toEqual({ [a.id]: 1 }); // the agent has 2 LinkedIn messages: icebreaker + follow-up, no closing
    expect(updateTemplate(db, WS, b.id, { name: "Closer 2", channel: "linkedin", kind: "followup", body: "Hey {{FirstName}}" })?.kind).toBe("followup");
    expect(templateUsage(db, WS)).toEqual({ [a.id]: 1, [b.id]: 1 });
    expect(listTemplates(db, WS).map((t) => t.name)).toEqual(["Closer 2", "Opener"]);
  });

  it("turns tokens into readable placeholders for the model", () => {
    expect(tokensForPrompt("<p>Hi {{FirstName}},</p><p>{{AI:Reference their role}} {{CTA}}</p>")).toBe("Hi [FirstName],\n[AI block: Reference their role] [CTA]");
  });
});
