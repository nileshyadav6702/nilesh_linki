import { beforeAll, describe, expect, it } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import agentHandler from "@/pages/api/agents/[id]/index";
import { createAgent } from "@/lib/agents/store";
import { createDefaultCampaign } from "@/lib/agents/default-campaign";

const WS = "ws-agent-settings";
const USER = "user-agent-settings";

function mockRes() {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.end = () => res;
  res.setHeader = () => res;
  return res as unknown as NextApiResponse & { statusCode: number; body: Record<string, unknown> };
}

let agentId = "";
let workflowId = "";
beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'as@x.io', 'x')").run(USER);
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'admin')").run(WS, USER);
  workflowId = createDefaultCampaign(db, WS, "Settings", "linkedin");
  agentId = createAgent(WS, { name: "Settings agent", workflow_id: workflowId, mode: "copilot", min_score: 55, fit_weight: 0.6, autopilot_delay_minutes: 60, daily_lead_cap: 25, enrich_emails: false }).id;
});

async function patch(body: Record<string, unknown>) {
  const res = mockRes();
  await agentHandler({ method: "PATCH", query: { id: agentId }, body, headers: { "x-workspace-id": WS, "x-user-id": USER, "x-workspace-role": "admin" } } as unknown as NextApiRequest, res);
  return res;
}
const fallbackDays = () => (getDb().prepare("SELECT skip_after_days d FROM workflow_steps WHERE workflow_id = ? AND step_type = 'connect'").get(workflowId) as { d: number }).d;
const goal = () => (getDb().prepare("SELECT goal FROM agents WHERE id = ?").get(agentId) as { goal: string | null }).goal;

describe("saving campaign settings", () => {
  it("saves the settings and the email fallback together", async () => {
    expect((await patch({ goal: "meetings", connect_skip_after_days: 12 })).statusCode).toBe(200);
    expect(goal()).toBe("meetings");
    expect(fallbackDays()).toBe(12);
  });

  it("an invalid fallback saves nothing", async () => {
    expect((await patch({ goal: "conversations", connect_skip_after_days: 99 })).statusCode).toBe(400);
    expect(goal()).toBe("meetings");
    expect(fallbackDays()).toBe(12);
  });
});
