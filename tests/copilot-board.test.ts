import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { createAgent, updateAgent } from "@/lib/agents/store";
import { queueDraft } from "@/lib/agents/drafts";
import { copilotBoard } from "@/lib/agents/copilot-board";
import { upsertLead } from "@/lib/signals/leads";

const WS = "ws-copilot-board";
const base = { min_score: 55, fit_weight: 0.6, autopilot_delay_minutes: 60, daily_lead_cap: 25, enrich_emails: false, goal: "conversations", tone: "professional", channel: "linkedin", exclude_first_degree: true } as const;

beforeAll(() => {
  getDb().prepare("INSERT OR IGNORE INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
});

describe("copilotBoard", () => {
  it("splits leads by agent mode, counts active agents and orders pending first", () => {
    const db = getDb();
    expect(copilotBoard(db, WS, "autopilot", null)).toMatchObject({ items: [], active: 0, activeInMode: 0, nextLaunch: null });

    const auto = createAgent(WS, { ...base, name: "Auto", mode: "autopilot" });
    const review = createAgent(WS, { ...base, name: "Review", mode: "copilot" });
    updateAgent(auto.id, WS, { status: "active" });
    updateAgent(review.id, WS, { status: "active" });

    const lead = (name: string, agentId: string) => upsertLead(db, WS, agentId, { name, profileUrl: `https://www.linkedin.com/in/${name.toLowerCase()}` }).targetId;
    const a1 = lead("Alpha", auto.id), a2 = lead("Beta", auto.id), r1 = lead("Gamma", review.id);
    const d1 = queueDraft(db, { ...auto, mode: "autopilot" }, a1, "linkedin_message", { subject: null, body: "Hi Alpha" }, null);
    queueDraft(db, { ...auto, mode: "autopilot" }, a2, "linkedin_message", { subject: null, body: "Hi Beta" }, null);
    queueDraft(db, { ...review, mode: "copilot" }, r1, "linkedin_message", { subject: null, body: "Hi Gamma" }, null);
    db.prepare("UPDATE approval_queue SET status = 'approved' WHERE id = ?").run(d1);

    const autoBoard = copilotBoard(db, WS, "autopilot", null);
    expect(autoBoard.items.map((i) => [i.full_name, i.pending])).toEqual([["Beta", 1], ["Alpha", 0]]);
    expect(autoBoard.active).toBe(2);
    expect(autoBoard.activeInMode).toBe(1);
    expect(autoBoard.nextLaunch).not.toBeNull();

    const reviewBoard = copilotBoard(db, WS, "copilot", null);
    expect(reviewBoard.items.map((i) => i.full_name)).toEqual(["Gamma"]);
    expect(reviewBoard.nextLaunch).toBeNull();

    expect(copilotBoard(db, WS, "autopilot", "some-other-account").items).toEqual([]);
  });
});
