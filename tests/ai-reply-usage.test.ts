import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { getDb } from "@/lib/db";
import { classifyAndDispatch } from "@/lib/community-replies";
import { aiRetryPolicy } from "@/lib/ai/client";

const WS = "ws-ai-reply-usage";

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, "ai-reply-usage");
  db.prepare("INSERT INTO integrations (workspace_id, key, api_key) VALUES (?, 'openrouter', 'sk-test')").run(WS);
  db.prepare("INSERT INTO workspace_ai_config (workspace_id, default_model) VALUES (?, 'test/model')").run(WS);
  aiRetryPolicy.baseDelayMs = 0;
});
afterEach(() => { vi.unstubAllGlobals(); });

let seq = 0;
function seedReply(body: string): string {
  const db = getDb();
  const n = ++seq;
  db.prepare("INSERT INTO targets (id, workspace_id, full_name, email) VALUES (?, ?, ?, ?)").run(`aru-t-${n}`, WS, `C ${n}`, `c${n}@aru.test`);
  db.prepare(`INSERT INTO email_replies (id, workspace_id, target_id, from_email, subject, body_text, received_at)
    VALUES (?, ?, ?, ?, 'Re: hi', ?, datetime('now'))`).run(`aru-r-${n}`, WS, `aru-t-${n}`, `c${n}@aru.test`, body);
  return `aru-r-${n}`;
}
const usage = () => getDb().prepare("SELECT purpose, model, input_tokens, output_tokens, cost_usd, ok FROM ai_usage WHERE workspace_id = ? ORDER BY rowid").all(WS) as Array<Record<string, unknown>>;

describe("reply classification usage", () => {
  it("records tokens and cost in ai_usage so it counts toward the spend cap", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ kind: "human_review", confidence: 0.6, summary: "Unclear", suggested_action: "review" }) } }],
      usage: { prompt_tokens: 120, completion_tokens: 30, cost: 0.0042 },
    }), { status: 200 })));
    await classifyAndDispatch(seedReply("Hmm, maybe."));
    expect(usage().at(-1)).toMatchObject({ purpose: "reply_classify", model: "test/model", input_tokens: 120, output_tokens: 30, cost_usd: 0.0042, ok: 1 });
  });

  it("records a failed classifier call as not ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 })));
    await classifyAndDispatch(seedReply("Hmm, perhaps."));
    expect(usage().at(-1)).toMatchObject({ purpose: "reply_classify", ok: 0 });
  });
});
