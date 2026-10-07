import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { ingestSignal } from "@/lib/platform/signals";
import { saveIcp } from "@/lib/icp/store";
import { createAgent, addSource, getAgent, updateAgent } from "@/lib/agents/store";
import { buildContext, type RunStats } from "@/lib/signals/engine";
import { upsertLead } from "@/lib/signals/leads";
import { runAgentPass } from "@/lib/agents/loop";
import { decideDraft, autoApproveDue } from "@/lib/agents/approvals";
import { takeApprovedDraft, sequenceSteps } from "@/lib/agents/drafts";
import { regenerateDraft } from "@/lib/agents/copilot";
import { saveDraft, decideLead } from "@/lib/agents/approvals";
import { createDefaultCampaign } from "@/lib/agents/default-campaign";
import { runPreview, rejectPreviewLead } from "@/lib/agents/preview";
import { aiJson } from "@/lib/ai/client";
import { enrichTargetEmail, type Provider } from "@/lib/enrichment/waterfall";
import { signalFunnel } from "@/lib/agents/analytics";

const WS = "ws-ai-sdr";
const ACCOUNT = "acct-ai-sdr";
const WORKFLOW = "wf-ai-sdr";

function openRouterReply(content: unknown) {
  return new Response(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }], usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.0004 } }), { status: 200, headers: { "Content-Type": "application/json" } });
}

/** Fake OpenRouter: answers by which prompt it receives. */
function stubModel() {
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as { messages: Array<{ content: string }> };
    const user = body.messages[1].content;
    if (user.includes("Score how well")) {
      const leads = (JSON.parse(user).data.leads as Array<{ index: number; title: string | null }>);
      return openRouterReply({ leads: leads.map((l) => ({ index: l.index, fit_score: /vp sales/i.test(l.title ?? "") ? 85 : 20, verdict: /vp sales/i.test(l.title ?? "") ? "strong" : "poor", reason: "test" })) });
    }
    if (user.includes("Write the outreach sequence")) {
      const steps = JSON.parse(user).data.steps as Array<{ key: string; channel: string }>;
      return openRouterReply({ steps: steps.map((st, i) => ({ key: st.key, subject: st.channel === "email" ? "Quick question" : null, body: i === 0 ? "Hi Ada, saw your comment on Gojiberry's post about outbound. How are you handling it today?" : `Follow-up number ${i + 1} for Ada.` })) });
    }
    if (user.includes("current_draft")) return openRouterReply({ body: JSON.parse(user).data.user_instruction ? "Hi Ada, shorter version." : "Hi Ada, a fresh angle." });
    return openRouterReply({ subject: "Quick question", body: "Hello there, a short email body for testing." });
  }));
}

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, "AI SDR", "ai-sdr");
  db.prepare("INSERT INTO accounts (id, name, email, workspace_id, is_authenticated) VALUES (?, ?, ?, ?, 1)").run(ACCOUNT, "Me", "me@x.com", WS);
  db.prepare("INSERT INTO workflows (id, name, workspace_id) VALUES (?, ?, ?)").run(WORKFLOW, "Signal outreach", WS);
  db.prepare("INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, track) VALUES (?, ?, 1, 'connect', 'linkedin')").run("st-1", WORKFLOW);
  db.prepare("INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, track) VALUES (?, ?, 2, 'message', 'linkedin')").run("st-2", WORKFLOW);
  db.prepare("INSERT INTO integrations (workspace_id, key, api_key) VALUES (?, 'openrouter', 'sk-test')").run(WS);
  db.prepare("INSERT INTO workspace_ai_config (workspace_id, default_model) VALUES (?, 'test/model')").run(WS);
  saveIcp(WS, {
    company_name: "Linki", offer: "Signal-based outbound",
    personas: [{ name: "Sales leader", titles: ["VP Sales"], seniority: [], departments: ["Sales"], pains: [] }],
    competitors: [{ name: "Gojiberry" }],
  }, "https://linki.example", null);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("signals", () => {
  it("is idempotent on dedupe key, keeps unknown types as custom, and recomputes intent", () => {
    const db = getDb();
    const { targetId } = upsertLead(db, WS, null, { name: "Sig Nal", profileUrl: "https://www.linkedin.com/in/signal" });
    const a = ingestSignal({ workspaceId: WS, targetId, type: "competitor_engagement", title: "Commented", dedupeKey: "k1" }) as { id: string };
    const b = ingestSignal({ workspaceId: WS, targetId, type: "competitor_engagement", title: "Commented", dedupeKey: "k1" }) as { id: string };
    expect(b.id).toBe(a.id);
    const c = ingestSignal({ workspaceId: WS, targetId, type: "weird_type", title: "x" }) as { type: string; metadata_json: string };
    expect(c.type).toBe("custom");
    expect(JSON.parse(c.metadata_json).original_type).toBe("weird_type");
    const t = db.prepare("SELECT intent_score FROM targets WHERE id = ?").get(targetId) as { intent_score: number };
    expect(t.intent_score).toBe(40); // 30 (competitor) + 10 (custom), both fresh
  });

  it("matches an existing lead by member URN, then by profile URL", () => {
    const db = getDb();
    const first = upsertLead(db, WS, null, { name: "Dup One", memberUrn: "urn:li:fsd_profile:DUP", profileUrl: "https://www.linkedin.com/in/dup-one/" });
    expect(upsertLead(db, WS, null, { name: "Dup One", memberUrn: "urn:li:fsd_profile:DUP" }).targetId).toBe(first.targetId);
    expect(upsertLead(db, WS, null, { name: "Dup One", profileUrl: "https://linkedin.com/in/DUP-ONE" }).targetId).toBe(first.targetId);
  });
});

describe("agent flow (copilot)", () => {
  it("discovers, filters, scores, drafts, and enrolls on approval", async () => {
    const db = getDb();
    const agent = createAgent(WS, { name: "Competitor radar", mode: "copilot", min_score: 55, fit_weight: 0.6, workflow_id: WORKFLOW, linkedin_account_id: ACCOUNT, autopilot_delay_minutes: 60, daily_lead_cap: 25, enrich_emails: false });
    expect(agent.list_id).toBeTruthy();
    const source = addSource(agent.id, WS, "competitor_engagement", { urls: ["https://www.linkedin.com/company/gojiberry"] });
    const stats: RunStats = { candidates: 0, ingested: 0, filtered: 0, duplicates: 0 };
    const ctx = buildContext(db, agent, source, "run-1", stats, {});
    const signal = (key: string) => ({ type: "competitor_engagement" as const, title: "Commented on Gojiberry's post", snippet: "We need this", dedupeKey: key });

    expect(ctx.emitLead({ name: "Ada Lovelace", headline: "VP Sales at Acme", profileUrl: "https://www.linkedin.com/in/ada" }, signal("p1:ada"))).toBe("ingested");
    expect(ctx.emitLead({ name: "Ada Lovelace", headline: "VP Sales at Acme", profileUrl: "https://www.linkedin.com/in/ada" }, signal("p1:ada"))).toBe("duplicate");
    expect(ctx.emitLead({ name: "Rival Rep", headline: "AE at Gojiberry", profileUrl: "https://www.linkedin.com/in/rival" }, signal("p1:rival"))).toBe("filtered");
    expect(ctx.emitLead({ name: "Dee Signer", headline: "Designer at Foo", profileUrl: "https://www.linkedin.com/in/dee" }, signal("p1:dee"))).toBe("ingested");
    expect(stats).toMatchObject({ ingested: 2, filtered: 1, duplicates: 1 });

    const ada = db.prepare("SELECT * FROM targets WHERE linkedin_url = ? AND workspace_id = ?").get("https://www.linkedin.com/in/ada", WS) as { id: string; agent_status: string; title: string; company: string };
    expect(ada).toMatchObject({ agent_status: "new", title: "VP Sales", company: "Acme" });
    expect(db.prepare("SELECT 1 FROM list_targets WHERE list_id = ? AND target_id = ?").get(agent.list_id, ada.id)).toBeTruthy();

    stubModel();
    const pass = await runAgentPass(getAgent(agent.id, WS)!);
    expect(pass.scored).toBe(2);
    expect(pass.drafted).toBe(1);

    const scored = db.prepare("SELECT agent_status, fit_verdict, lead_score FROM targets WHERE id = ?").get(ada.id) as { agent_status: string; fit_verdict: string; lead_score: number };
    expect(scored.agent_status).toBe("drafted");
    expect(scored.fit_verdict).toBe("strong");
    expect(scored.lead_score).toBeGreaterThan(55);
    expect((db.prepare("SELECT agent_status FROM targets WHERE linkedin_url = ? AND workspace_id = ?").get("https://www.linkedin.com/in/dee", WS) as { agent_status: string }).agent_status).toBe("disqualified");

    const draft = db.prepare("SELECT * FROM approval_queue WHERE target_id = ?").get(ada.id) as { id: string; channel: string; status: string; auto_approve_at: string | null; step_id: string; position: number };
    expect(draft).toMatchObject({ channel: "linkedin_message", status: "pending", auto_approve_at: null, step_id: "st-2", position: 1 });

    // Copilot: refine with an instruction, then save an edit, before approving.
    expect((await regenerateDraft(db, WS, draft.id, "make it shorter")).body).toBe("Hi Ada, shorter version.");
    expect(saveDraft(db, WS, draft.id, { body: "Hi Ada, saved edit." }).ok).toBe(true);

    const decided = decideDraft(db, WS, draft.id, "approve", null, { body: "Hi Ada, edited by a human." });
    expect(decided).toMatchObject({ ok: true, enrolled: true });
    const run = db.prepare("SELECT id, status, account_id FROM runs WHERE workflow_id = ? AND list_id = ?").get(WORKFLOW, agent.list_id) as { id: string; status: string; account_id: string };
    expect(run).toMatchObject({ status: "pending", account_id: ACCOUNT }); // agent still draft → run waits
    const tracks = db.prepare("SELECT rpt.track FROM run_profile_tracks rpt JOIN run_profiles rp ON rp.id = rpt.run_profile_id WHERE rp.run_id = ? AND rp.target_id = ?").all(run.id, ada.id) as Array<{ track: string }>;
    expect(tracks.map((t) => t.track)).toEqual(["linkedin"]);

    expect(takeApprovedDraft(db, ada.id, "linkedin_message", "st-other", false)).toBeNull();
    expect(takeApprovedDraft(db, ada.id, "linkedin_message", "st-2")?.body).toBe("Hi Ada, edited by a human.");
    expect(takeApprovedDraft(db, ada.id, "linkedin_message", "st-2")).toBeNull();

    const funnel = signalFunnel(db, WS, agent.id);
    expect(funnel.find((f) => f.signal_type === "competitor_engagement")).toMatchObject({ detected: 2, qualified: 1 });
  });

  it("auto-approves due drafts in autopilot", () => {
    const db = getDb();
    const agent = createAgent(WS, { name: "Autopilot", mode: "autopilot", min_score: 10, fit_weight: 0.6, workflow_id: WORKFLOW, linkedin_account_id: ACCOUNT, autopilot_delay_minutes: 0, daily_lead_cap: 25, enrich_emails: false });
    updateAgent(agent.id, WS, { status: "active", outreach_enabled: true });
    const { targetId } = upsertLead(db, WS, agent.id, { name: "Auto Lead", profileUrl: "https://www.linkedin.com/in/auto" });
    db.prepare("UPDATE targets SET agent_status = 'drafted' WHERE id = ?").run(targetId);
    db.prepare("INSERT INTO approval_queue (id, workspace_id, agent_id, target_id, channel, body, auto_approve_at) VALUES ('aq-auto', ?, ?, ?, 'linkedin_message', 'Hello', ?)")
      .run(WS, agent.id, targetId, new Date(Date.now() - 1000).toISOString());
    expect(autoApproveDue(db, getAgent(agent.id, WS)!)).toBe(1);
    expect((db.prepare("SELECT agent_status FROM targets WHERE id = ?").get(targetId) as { agent_status: string }).agent_status).toBe("enrolled");
    const run = db.prepare("SELECT status FROM runs WHERE list_id = ?").get(agent.list_id) as { status: string };
    expect(run.status).toBe("running");
  });
});

describe("AI client", () => {
  it("retries once on invalid output and logs usage", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => openRouterReply(++calls === 1 ? "not json" : { value: 7 })));
    const out = await aiJson({ workspaceId: WS, purpose: "fit_score", instructions: ["x"], data: {}, outputShape: `{"value":0}`, schema: z.object({ value: z.number() }) });
    expect(out.value).toBe(7);
    expect(calls).toBe(2);
    const usage = getDb().prepare("SELECT ok FROM ai_usage WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 2").all(WS) as Array<{ ok: number }>;
    expect(usage.map((u) => u.ok).sort()).toEqual([0, 1]);
  });
});

describe("email waterfall", () => {
  it("stops at the first provider with a hit and caches misses", async () => {
    const db = getDb();
    const { targetId } = upsertLead(db, WS, null, { name: "Wat Erfall", firstName: "Wat", lastName: "Erfall", profileUrl: "https://www.linkedin.com/in/waterfall" });
    const miss = vi.fn(async () => null);
    const hit = vi.fn(async () => ({ email: "Wat@Acme.com", verified: true }));
    const providers: Provider[] = [
      { key: "apollo", label: "A", needsKey: false, find: miss },
      { key: "hunter", label: "H", needsKey: false, find: hit },
      { key: "prospeo", label: "P", needsKey: false, find: miss },
    ];
    const r = await enrichTargetEmail(db, WS, targetId, providers);
    expect(r).toEqual({ email: "wat@acme.com", verified: true, provider: "hunter" });
    expect(miss).toHaveBeenCalledTimes(1);
    const t = db.prepare("SELECT email, email_status FROM targets WHERE id = ?").get(targetId) as { email: string; email_status: string };
    expect(t.email).toBe("wat@acme.com");
    // Already has an email → no provider is asked again.
    expect(await enrichTargetEmail(db, WS, targetId, providers)).toBeNull();
    expect(hit).toHaveBeenCalledTimes(1);
  });
});

describe("campaign sequence", () => {
  it("lays out a multichannel campaign as a timeline with per-track positions", () => {
    const db = getDb();
    const wf = createDefaultCampaign(db, WS, "Timeline", "multi");
    const steps = sequenceSteps(db, wf);
    const li = steps.filter((st) => st.track === "linkedin");
    expect(li.map((st) => st.step_type)).toEqual(["connect", "message", "visit", "message", "message"]);
    expect(li.filter((st) => st.channel).map((st) => [st.position, st.day])).toEqual([[1, 1], [2, 4], [3, 8]]);
    expect(steps.filter((st) => st.channel === "email").map((st) => [st.position, st.day])).toEqual([[1, 2], [2, 5]]);
    // Only follow-ups fall back to the AI writer; first touches come from Copilot.
    const ai = db.prepare("SELECT message_position, email_position, step_type, ai_enabled FROM workflow_steps WHERE workflow_id = ? AND step_type IN ('message','email') ORDER BY track, step_order").all(wf) as Array<{ step_type: string; message_position: number; email_position: number; ai_enabled: number }>;
    expect(ai.map((r) => r.ai_enabled)).toEqual([0, 1, 0, 1, 1]);
    expect(sequenceSteps(db, createDefaultCampaign(db, WS, "Email only", "email")).every((st) => st.track === "email")).toBe(true);
  });
});

describe("copilot decisions and preview", () => {
  it("rejects every pending step of a contact at once and skips the lead", () => {
    const db = getDb();
    const agent = createAgent(WS, { name: "Reject all", mode: "copilot", min_score: 10, fit_weight: 0.6, workflow_id: WORKFLOW, linkedin_account_id: ACCOUNT, autopilot_delay_minutes: 60, daily_lead_cap: 25, enrich_emails: false, goal: "conversations", tone: "direct", channel: "linkedin", exclude_first_degree: true });
    const { targetId } = upsertLead(db, WS, agent.id, { name: "Two Steps", profileUrl: "https://www.linkedin.com/in/two-steps" });
    for (const [i, step] of ["st-a", "st-b"].entries()) db.prepare("INSERT INTO approval_queue (id, workspace_id, agent_id, target_id, channel, body, step_id, position) VALUES (?, ?, ?, ?, 'linkedin_message', 'x', ?, ?)").run(`aq-two-${i}`, WS, agent.id, targetId, step, i + 1);
    expect(decideLead(db, WS, targetId, "reject", null, "Wrong persona").ok).toBe(true);
    expect(db.prepare("SELECT COUNT(*) n FROM approval_queue WHERE target_id = ? AND status = 'rejected'").get(targetId)).toEqual({ n: 2 });
    expect(db.prepare("SELECT agent_status, skip_reason FROM targets WHERE id = ?").get(targetId)).toEqual({ agent_status: "skipped", skip_reason: "Wrong persona" });
  });

  it("previews leads from an existing list and replaces rejected ones", async () => {
    const db = getDb();
    db.prepare("INSERT INTO lists (id, workspace_id, name) VALUES ('list-prev', ?, 'Old list')").run(WS);
    const ids = ["VP Sales", "VP Sales", "Designer"].map((title, i) => {
      const { targetId } = upsertLead(db, WS, null, { name: `Prev ${i}`, title, profileUrl: `https://www.linkedin.com/in/prev-${i}` });
      db.prepare("INSERT INTO list_targets (list_id, target_id) VALUES ('list-prev', ?)").run(targetId);
      return targetId;
    });
    const agent = createAgent(WS, { name: "Preview", mode: "copilot", min_score: 50, fit_weight: 0.6, workflow_id: WORKFLOW, linkedin_account_id: ACCOUNT, autopilot_delay_minutes: 60, daily_lead_cap: 25, enrich_emails: false, goal: "conversations", tone: "professional", channel: "linkedin", exclude_first_degree: true });
    addSource(agent.id, WS, "existing_list", { list_ids: ["list-prev"] });
    stubModel();
    const r = await runPreview(agent, 10_000);
    expect(r.ran).toEqual(["existing_list"]);
    expect(r.leads.map((l) => l.id).sort()).toEqual([ids[0], ids[1]].sort()); // the designer is disqualified
    expect(rejectPreviewLead(db, agent, ids[0], "Too junior").map((l) => l.id)).toEqual([ids[1]]);
  });
});
