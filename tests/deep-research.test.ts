import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/icp/site", () => ({
  fetchSiteText: vi.fn(async (url: string) => {
    if (url.includes("down")) throw new Error("offline");
    return { url, pages: [{ url, text: `Website of ${url}` }] };
  }),
}));
vi.mock("@/lib/ai/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/client")>()),
  isAiConfigured: () => true,
  aiJson: vi.fn(async (req: { data: { company?: string; criterion?: string } }) => {
    if (req.data.criterion !== undefined) return req.data.criterion.includes("good") ? { ok: false, message: "Name what makes it good." } : { ok: true, message: null };
    return req.data.company === "Acme" ? { results: [{ verdict: "yes", evidence: "Sells to sales teams." }] } : { results: [{ verdict: "no", evidence: "Sells to schools." }] };
  }),
}));

import { getDb } from "@/lib/db";
import { checkCriterion, listCompanies, researchState, startResearch } from "@/lib/lists/deep-research";

const WS = "ws-deep-research";
const LIST = "dr-list";

beforeAll(() => {
  const db = getDb();
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
  db.prepare("INSERT INTO lists (id, workspace_id, name) VALUES (?, ?, ?)").run(LIST, WS, "Research me");
  db.prepare("INSERT INTO companies (id, workspace_id, name, domain) VALUES (?, ?, ?, ?)").run("dr-c1", WS, "Acme", "acme.test");
  db.prepare("INSERT INTO companies (id, workspace_id, name, website) VALUES (?, ?, ?, ?)").run("dr-c2", WS, "Globex", "https://globex.test");
  const t = db.prepare("INSERT INTO targets (id, workspace_id, full_name, company, company_id) VALUES (?, ?, ?, ?, ?)");
  t.run("dr-a1", WS, "A One", "Acme", "dr-c1");
  t.run("dr-a2", WS, "A Two", "acme", "dr-c1");
  t.run("dr-g1", WS, "G One", "Globex", "dr-c2");
  t.run("dr-n1", WS, "No Site", "Nowhere Inc", null);
  for (const id of ["dr-a1", "dr-a2", "dr-g1", "dr-n1"]) db.prepare("INSERT INTO list_targets (list_id, target_id) VALUES (?, ?)").run(LIST, id);
});

describe("deep research", () => {
  it("groups the list's contacts by company with a website", () => {
    const groups = listCompanies(LIST, WS).sort((a, b) => a.name.localeCompare(b.name));
    expect(groups.map((g) => [g.name, g.website, g.targetIds.length])).toEqual([["Acme", "https://acme.test", 2], ["Globex", "https://globex.test", 1], ["Nowhere Inc", null, 1]]);
  });

  it("flags vague criteria", async () => {
    expect(await checkCriterion(WS, "is a good company")).toEqual({ ok: false, message: "Name what makes it good." });
    expect(await checkCriterion(WS, "Sells to sales teams")).toEqual({ ok: true, message: null });
    expect((await checkCriterion(WS, "ab")).ok).toBe(false);
  });

  it("researches every company and marks each contact", async () => {
    startResearch(WS, LIST, ["Sells to sales teams"]);
    expect(() => startResearch(WS, LIST, ["again"])).toThrow(/already in progress/);
    await vi.waitFor(() => expect(researchState(LIST, WS).run?.status).toBe("done"));
    const { run, results } = researchState(LIST, WS);
    expect(run).toMatchObject({ total: 3, done_count: 3, criteria: ["Sells to sales teams"] });
    expect(results["dr-a1"].verdict).toBe("match");
    expect(results["dr-a2"].verdict).toBe("match");
    expect(results["dr-g1"]).toMatchObject({ verdict: "no_match", summary: "Sells to sales teams: Sells to schools." });
    expect(results["dr-n1"]).toMatchObject({ verdict: "unknown", summary: "No company website on file to research." });
  });
});
