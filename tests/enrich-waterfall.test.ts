import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { getDb } from "@/lib/db";
import { upsertLead } from "@/lib/signals/leads";
import { enrichTargetEmail, PROVIDERS, ProviderError, type Provider } from "@/lib/enrichment/waterfall";

const WS = "ws-waterfall";
let n = 0;

function lead() {
  n++;
  return upsertLead(getDb(), WS, null, { name: `Wat Erfall${n}`, firstName: "Wat", lastName: `Erfall${n}`, profileUrl: `https://www.linkedin.com/in/wf-${n}` }).targetId;
}
const cacheRow = (targetId: string, provider: string) => {
  const t = getDb().prepare("SELECT linkedin_url FROM targets WHERE id = ?").get(targetId) as { linkedin_url: string };
  return getDb().prepare("SELECT email, verified FROM enrichment_cache WHERE identity_key = ? AND provider = ?").get(t.linkedin_url.toLowerCase(), provider);
};
const provider = (key: string, find: Provider["find"]): Provider => ({ key, label: key, needsKey: false, find });

beforeAll(() => {
  getDb().prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, "Waterfall", "waterfall");
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("email waterfall: errors vs misses", () => {
  it("does not cache a provider error and moves on to the next provider", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = lead();
    const failing = vi.fn(async () => { throw new ProviderError("apollo", "request failed (429)", 429); });
    const hit = vi.fn(async () => ({ email: "wat@acme.com", verified: true }));
    const r = await enrichTargetEmail(getDb(), WS, id, [provider("apollo", failing), provider("hunter", hit)]);
    expect(r).toEqual({ email: "wat@acme.com", verified: true, provider: "hunter" });
    expect(cacheRow(id, "apollo")).toBeUndefined();
    expect(cacheRow(id, "hunter")).toEqual({ email: "wat@acme.com", verified: 1 });
  });

  it("caches a genuine miss so the provider is not asked again", async () => {
    const id = lead();
    const miss = vi.fn(async () => null);
    expect(await enrichTargetEmail(getDb(), WS, id, [provider("apollo", miss)])).toBeNull();
    expect(cacheRow(id, "apollo")).toEqual({ email: null, verified: 0 });
    await enrichTargetEmail(getDb(), WS, id, [provider("apollo", miss)]);
    expect(miss).toHaveBeenCalledTimes(1);
  });

  it("keeps going past an unverified hit and prefers a later verified one", async () => {
    const id = lead();
    const unverified = vi.fn(async () => ({ email: "guess@acme.com", verified: false }));
    const verified = vi.fn(async () => ({ email: "real@acme.com", verified: true }));
    const r = await enrichTargetEmail(getDb(), WS, id, [provider("apollo", unverified), provider("hunter", verified)]);
    expect(r).toEqual({ email: "real@acme.com", verified: true, provider: "hunter" });
    expect(getDb().prepare("SELECT email, email_status FROM targets WHERE id = ?").get(id)).toMatchObject({ email: "real@acme.com" });
  });

  it("falls back to the first unverified hit when nothing verified turns up", async () => {
    const id = lead();
    const r = await enrichTargetEmail(getDb(), WS, id, [
      provider("apollo", async () => ({ email: "Guess@Acme.com", verified: false })),
      provider("hunter", async () => null),
      provider("prospeo", async () => ({ email: "other@acme.com", verified: false })),
    ]);
    expect(r).toEqual({ email: "guess@acme.com", verified: false, provider: "apollo" });
    expect(getDb().prepare("SELECT email, email_status FROM targets WHERE id = ?").get(id)).toEqual({ email: "guess@acme.com", email_status: "unverified" });
  });
});

describe("HTTP providers", () => {
  const q = { firstName: "Wat", lastName: "Erfall", fullName: "Wat Erfall", company: "Acme", domain: "acme.com", linkedinUrl: "https://www.linkedin.com/in/x" };
  const find = (key: string) => PROVIDERS.find((p) => p.key === key)!.find;
  const respond = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })));

  it("throws ProviderError on 429/402/5xx and returns null on a 404 or empty result", async () => {
    respond(429, { error: "rate limited" });
    await expect(find("hunter")(q, "k")).rejects.toBeInstanceOf(ProviderError);
    respond(402, {});
    await expect(find("findymail")(q, "k")).rejects.toBeInstanceOf(ProviderError);
    respond(503, {});
    await expect(find("apollo")(q, "k")).rejects.toBeInstanceOf(ProviderError);
    respond(404, {});
    await expect(find("findymail")(q, "k")).resolves.toBeNull();
    respond(200, { data: { email: null } });
    await expect(find("hunter")(q, "k")).resolves.toBeNull();
  });

  it("treats Prospeo NO_RESULT as a miss but other error bodies as failures", async () => {
    respond(400, { error: true, message: "NO_RESULT" });
    await expect(find("prospeo")(q, "k")).resolves.toBeNull();
    respond(200, { error: true, message: "INSUFFICIENT_CREDITS" });
    await expect(find("prospeo")(q, "k")).rejects.toBeInstanceOf(ProviderError);
  });

  it("surfaces network failures as errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(find("hunter")(q, "k")).rejects.toThrow("fetch failed");
  });
});
