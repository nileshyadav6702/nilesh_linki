import { beforeAll, describe, expect, it, vi } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { addDays, addMonths } from "date-fns";
import { getDb } from "@/lib/db";
import { upsertLead } from "@/lib/signals/leads";
import { balance, billingSummary, debit, ensureBilling, grant, InsufficientCreditsError, usagePage } from "@/lib/credits/ledger";
import { chargeImport, findEmailCharged, leadsAffordable } from "@/lib/credits/charge";
import type { Provider } from "@/lib/enrichment/waterfall";
import billingApi from "@/pages/api/settings/billing";
import leadApi from "@/pages/api/leads/[id]";

const WS = "ws-credits";
const WS2 = "ws-credits-empty";
const USER = "u-credits";
let n = 0;
const lead = (ws = WS) => { n++; return upsertLead(getDb(), ws, null, { name: `Cred It${n}`, firstName: "Cred", lastName: `It${n}`, profileUrl: `https://www.linkedin.com/in/credits-${n}` }).targetId; };
const provider = (find: Provider["find"]): Provider => ({ key: "apollo", label: "apollo", needsKey: false, find });

function call(handler: (req: NextApiRequest, res: NextApiResponse) => unknown, req: { method: string; query?: Record<string, string>; body?: unknown }, ws = WS) {
  let status = 200; let body: unknown;
  const res = { status(s: number) { status = s; return res; }, json(b: unknown) { body = b; return res; }, setHeader() { return res; }, end() { return res; } } as unknown as NextApiResponse;
  const r = { query: {}, headers: { "x-workspace-id": ws, "x-user-id": USER, "x-workspace-role": "owner" }, ...req } as unknown as NextApiRequest;
  return Promise.resolve(handler(r, res)).then(() => ({ status, body: body as Record<string, unknown> }));
}

beforeAll(() => {
  const db = getDb();
  for (const w of [WS, WS2]) db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(w, w, w);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'credits@example.com', 'x')").run(USER);
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')").run(WS, USER);
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')").run(WS2, USER);
});

describe("credit ledger", () => {
  it("starts with a month of credits per member and refills each missed month", () => {
    const db = getDb();
    const now = new Date();
    ensureBilling(db, WS, now);
    expect(balance(db, WS)).toBe(200);
    ensureBilling(db, WS, addDays(addMonths(now, 2), 1));
    expect(balance(db, WS)).toBe(600); // two refills, unused credits roll over
    expect(billingSummary(db, WS).next_refill_at > billingSummary(db, WS).cycle_start).toBe(true);
  });

  it("debits atomically, refuses to overdraw, and partial takes what is left", () => {
    const db = getDb();
    ensureBilling(db, WS2);
    debit(db, WS2, { type: "agent_launch", credits: 195 });
    expect(() => debit(db, WS2, { type: "agent_launch", credits: 10 })).toThrow(InsufficientCreditsError);
    expect(debit(db, WS2, { type: "lead_import", credits: 10, partial: true })).toBe(5);
    expect(balance(db, WS2)).toBe(0);
    expect(billingSummary(db, WS2).used_this_cycle).toBe(200);
    grant(db, WS2, 50, "admin_grant", "test");
    expect(balance(db, WS2)).toBe(50);
    expect(billingSummary(db, WS2).used_this_cycle).toBe(200); // grants aren't usage
  });

  it("charges an email lookup only when an email is found", async () => {
    const db = getDb();
    const before = balance(db, WS);
    expect(await findEmailCharged(db, WS, lead(), USER, [provider(async () => null)])).toBeNull();
    expect(balance(db, WS)).toBe(before); // debited, then refunded
    const id = lead();
    expect((await findEmailCharged(db, WS, id, USER, [provider(async () => ({ email: "c@acme.com", verified: true }))]))?.email).toBe("c@acme.com");
    expect(balance(db, WS)).toBe(before - 1);
    expect(await findEmailCharged(db, WS, id, USER, [provider(async () => ({ email: "x@acme.com", verified: true }))])).toBeNull(); // has one: free
    expect(balance(db, WS)).toBe(before - 1);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(findEmailCharged(db, WS, lead(), USER, [provider(async () => { throw new Error("boom"); })])).resolves.toBeNull();
    expect(balance(db, WS)).toBe(before - 1);
    const types = usagePage(db, WS, 1, 50).rows.map((r) => r.type);
    expect(types.filter((t) => t === "email_enrichment_refund").length).toBe(2);
  });

  it("prices imports per lead, rounded up", () => {
    const db = getDb();
    const before = balance(db, WS);
    expect(chargeImport(db, WS, "lead_import", 25, "list")).toBe(13);
    expect(chargeImport(db, WS, "engager_import", 31, "list")).toBe(2);
    expect(chargeImport(db, WS, "lead_import", 0, "list")).toBe(0);
    expect(balance(db, WS)).toBe(before - 15);
    expect(leadsAffordable(db, WS, "lead_import")).toBe((before - 15) * 2);
  });
});

describe("billing API", () => {
  it("returns the summary and a page of usage, and saves the invoice recipient", async () => {
    const r = await call(billingApi, { method: "GET", query: { page: "1" } });
    expect(r.status).toBe(200);
    expect(r.body.balance).toBe(balance(getDb(), WS));
    expect((r.body.usage as { rows: unknown[] }).rows.length).toBe(10);
    expect((await call(billingApi, { method: "PUT", body: { invoice_email: "nope" } })).status).toBe(400);
    expect((await call(billingApi, { method: "PUT", body: { invoice_email: "Billing@Acme.com" } })).status).toBe(200);
    expect((await call(billingApi, { method: "GET" })).body.invoice_email).toBe("billing@acme.com");
  });

  it("refuses an email lookup with 402 when the workspace is out of credits", async () => {
    const db = getDb();
    debit(db, WS2, { type: "agent_launch", credits: balance(db, WS2) });
    const r = await call(leadApi, { method: "PATCH", query: { id: lead(WS2) }, body: { action: "find_email" } }, WS2);
    expect(r.status).toBe(402);
    expect(r.body.code).toBe("insufficient_credits");
  });
});
