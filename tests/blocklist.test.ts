import { beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { upsertLead } from "@/lib/signals/leads";
import { addEntries, blockedReason, counts, entriesCsv, listEntries, normalizeEntry, removeEntries } from "@/lib/blocklist/store";
import { findTargetSuppression } from "@/lib/platform/suppression";
import { balance, ensureBilling } from "@/lib/credits/ledger";
import type { Icp } from "@/lib/icp/schema";

const aiJson = vi.fn();
vi.mock("@/lib/ai/client", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/client")>()), aiJson: (...a: unknown[]) => aiJson(...a) }));
const { allowCompany, competitorReason, filteredCompanies, setCompetitorFilter } = await import("@/lib/blocklist/competitors");

const WS = "ws-blocklist";
let n = 0;
function lead(company: string, domain: string | null) {
  n++;
  const db = getDb();
  const cid = `bl-co-${n}`;
  db.prepare("INSERT INTO companies (id, workspace_id, name, domain) VALUES (?, ?, ?, ?)").run(cid, WS, company, domain);
  const id = upsertLead(db, WS, null, { name: `Block Lead${n}`, firstName: "Block", lastName: `Lead${n}`, profileUrl: `https://www.linkedin.com/in/block-${n}` }).targetId;
  db.prepare("UPDATE targets SET company_id = ?, company = ? WHERE id = ?").run(cid, company, id);
  return id;
}
const icp = { company_name: "Kairo", company_industry: "Sales software", offer: "AI SDR", value_props: [], competitors: [{ name: "RivalCo", linkedin_url: null, website: "rival.co" }] } as unknown as Icp;

beforeAll(() => {
  getDb().prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
});

describe("organization blocklist", () => {
  it("normalizes domains and LinkedIn profiles, rejecting anything else", () => {
    expect(normalizeEntry("company", "https://www.Acme.com/about")).toBe("acme.com");
    expect(normalizeEntry("company", "not a domain")).toBeNull();
    expect(normalizeEntry("person", "https://www.linkedin.com/in/Jane-Doe/")).toBe("linkedin.com/in/jane-doe");
    expect(normalizeEntry("person", "https://www.linkedin.com/company/acme")).toBeNull();
  });

  it("adds, dedups, lists, searches, exports and removes", () => {
    const db = getDb();
    const r = addEntries(db, WS, "company", [{ value: "acme.com", label: "Acme Inc" }, { value: "www.acme.com" }, { value: "nope" }, { value: "beta.io" }], null);
    expect(r).toEqual({ added: 2, existing: 0, invalid: ["nope"] });
    expect(addEntries(db, WS, "company", [{ value: "acme.com" }], null).existing).toBe(1);
    expect(listEntries(db, WS, "company", "acme", 1, 20).rows.map((x) => [x.value, x.label])).toEqual([["acme.com", "Acme Inc"]]);
    expect(entriesCsv(db, WS, "company")).toContain("acme.com,Acme Inc");
    const beta = listEntries(db, WS, "company", "beta", 1, 20).rows[0];
    expect(removeEntries(db, WS, "company", [beta.id])).toBe(1);
    expect(counts(db, WS).company).toBe(1);
  });

  it("blocks a lead by company domain or LinkedIn profile, before drafting and at send time", () => {
    const db = getDb();
    const byCompany = lead("Acme Inc", "acme.com");
    expect(blockedReason(db, WS, byCompany)).toBe("Acme Inc is on your blocklist");
    expect(findTargetSuppression(WS, byCompany)?.kind).toBe("domain");
    const person = lead("Other", "other.com");
    expect(blockedReason(db, WS, person)).toBeNull();
    addEntries(db, WS, "person", [{ value: `https://www.linkedin.com/in/block-${n}` }], null);
    expect(blockedReason(db, WS, person)).toBe("This person is on your blocklist");
  });
});

describe("AI competitor filtering", () => {
  it("does nothing while off, charges a prorated price to switch on", async () => {
    const db = getDb();
    expect(await competitorReason(db, WS, icp, { id: lead("RivalCo", "rival.co"), company: "RivalCo" })).toBeNull();
    ensureBilling(db, WS);
    const before = balance(db, WS);
    const charged = setCompetitorFilter(db, WS, true, null);
    expect(charged).toBeGreaterThan(0);
    expect(charged).toBeLessThanOrEqual(50);
    expect(balance(db, WS)).toBe(before - charged);
    expect(setCompetitorFilter(db, WS, true, null)).toBe(0); // already on: no double charge
  });

  it("matches known competitors for free, asks the AI once per company, and honours 'allow'", async () => {
    const db = getDb();
    aiJson.mockReset();
    expect(await competitorReason(db, WS, icp, { id: lead("RivalCo", "rival.co"), company: "RivalCo" })).toMatch(/Listed as a competitor/);
    expect(aiJson).not.toHaveBeenCalled();
    aiJson.mockResolvedValue({ is_competitor: true, reason: "Sells an AI SDR too" });
    const a = lead("SimilarAI", "similar.ai");
    expect(await competitorReason(db, WS, icp, { id: a, company: "SimilarAI" })).toBe("Sells an AI SDR too");
    await competitorReason(db, WS, icp, { id: lead("SimilarAI", "similar.ai"), company: "SimilarAI" });
    expect(aiJson).toHaveBeenCalledTimes(1); // cached per company
    aiJson.mockResolvedValue({ is_competitor: false, reason: "A buyer" });
    expect(await competitorReason(db, WS, icp, { id: lead("Buyer", "buyer.com"), company: "Buyer" })).toBeNull();
    aiJson.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await competitorReason(db, WS, icp, { id: lead("Flaky", "flaky.com"), company: "Flaky" })).toBeNull(); // failure isn't a verdict
    expect(filteredCompanies(db, WS).map((f) => f.domain).sort()).toEqual(["rival.co", "similar.ai"]);
    expect(allowCompany(db, WS, "similar.ai")).toBe(true);
    expect(await competitorReason(db, WS, icp, { id: a, company: "SimilarAI" })).toBeNull();
  });
});
