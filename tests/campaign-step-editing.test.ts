import { describe, expect, it } from "vitest";
import { restructure, timeline } from "@/components/agents/campaign/sequence";
import type { CampaignStep } from "@/components/agents/campaign/kit";
import { getDb } from "@/lib/db";
import { loadTargetCustomValues } from "@/lib/outreach/custom-values";
import { renderOutreachTemplate } from "@/lib/outreach/render";

const step = (id: string, step_type: string, extra: Partial<CampaignStep> = {}): CampaignStep => ({
  id, track: "linkedin", step_type, step_order: 0, delay_seconds: 0, connect_note: null, message_body: null, email_subject: null, email_body: null,
  ai_enabled: 0, send_mode: "ai", message_position: 1, email_position: 1, ...extra,
});

describe("invitation warm-up steps", () => {
  it("adds visit and like-posts before the invitation, and reads them back as options", () => {
    const base = [step("c", "connect"), step("d", "delay", { delay_seconds: 86400 }), step("m", "message")];
    const both = restructure(base, "c", { visitBefore: true, likeBefore: true });
    expect(both.map((s) => s.step_type)).toEqual(["visit", "like_posts", "connect", "delay", "message"]);
    const t = timeline(both);
    expect(t.map((i) => i.step.step_type)).toEqual(["connect", "message"]);
    expect(t[0]).toMatchObject({ visitBefore: true, likeBefore: true });
    const likeOnly = restructure(both, "c", { visitBefore: false });
    expect(likeOnly.map((s) => s.step_type)).toEqual(["like_posts", "connect", "delay", "message"]);
    expect(likeOnly[0].id).toBe(both[1].id);
  });
});

describe("sender variables", () => {
  it("render the agent's sender name and company", () => {
    const db = getDb();
    db.prepare("INSERT INTO workspaces (id, name, slug) VALUES ('ws-sender', 'Acme', 'ws-sender')").run();
    db.prepare("INSERT INTO accounts (id, workspace_id, name, email, is_authenticated) VALUES ('acc-sender', 'ws-sender', 'Nilesh Yadav', 'n@x.io', 1)").run();
    db.prepare("INSERT INTO icps (id, workspace_id, version, data_json) VALUES ('icp-sender', 'ws-sender', 1, ?)").run(JSON.stringify({ company_name: "Kairo" }));
    db.prepare("INSERT INTO agents (id, workspace_id, name, linkedin_account_id, icp_id) VALUES ('ag-sender', 'ws-sender', 'A', 'acc-sender', 'icp-sender')").run();
    db.prepare("INSERT INTO targets (id, workspace_id, agent_id, full_name, first_name, company) VALUES ('t-sender', 'ws-sender', 'ag-sender', 'Ada Lovelace', 'Ada', 'Engines')").run();
    const custom = loadTargetCustomValues(db, "ws-sender", "t-sender");
    expect(renderOutreachTemplate("Hi {{first_name}}, {{sender_first_name}} from {{sender_company}} here. {{title|your team}}", { first_name: "Ada", company: "Engines" }, custom))
      .toBe("Hi Ada, Nilesh from Kairo here. your team");
  });
});
