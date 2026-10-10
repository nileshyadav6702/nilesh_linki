import { afterEach, describe, expect, it, vi } from "vitest";
import { decisionMakerTitles, newDecisionMakerRunner } from "@/lib/signals/sources/icp-people";
import { hiringSurgeRunner } from "@/lib/signals/sources/hiring";
import { icpSchema } from "@/lib/icp/schema";
import type { EmittedSignal, SourceRunContext } from "@/lib/signals/sources/types";
import type { LeadCandidate } from "@/lib/signals/leads";
import { getDb } from "@/lib/db";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const icp = icpSchema.parse({
  company_name: "Kairo", industries: ["Software Development"],
  personas: [{ name: "Sales", titles: ["VP Sales", "Head of Sales", "Account Executive"] }],
});

/** A runner context that records emitted leads and the people-search request it made. */
function harness(rows: Array<Record<string, unknown>>) {
  const bodies: Array<{ query: Record<string, unknown>; pagination: { size: number } }> = [];
  vi.stubEnv("TREG_API_KEY", "k");
  vi.stubGlobal("fetch", vi.fn(async (_u: unknown, init?: { body?: string }) => {
    // Only data-provider calls count (the app's update check may also fetch).
    if (String(_u).includes("treg.to")) bodies.push(JSON.parse(init?.body ?? "{}"));
    return new Response(JSON.stringify({ leads: rows, pagination: { token: "next" } }), { status: 200, headers: { "X-Treg-Cost-Micro": String(rows.length * 380) } });
  }));
  const emitted: Array<{ lead: LeadCandidate; signal: EmittedSignal }> = [];
  const ctx = {
    db: getDb(), workspaceId: "ws-people-filters", agent: { id: "ag-pf" }, icp, cursor: {}, config: { boards: [] },
    isFull: () => false, emitLead: (lead: LeadCandidate, signal: EmittedSignal) => { emitted.push({ lead, signal }); return "ingested"; },
  } as unknown as SourceRunContext;
  return { ctx, bodies, emitted };
}

const row = (name: string, title: string, company: string) => ({ name, lastJobTitle: title, lastCompanyName: company, url: `https://www.linkedin.com/in/${name.toLowerCase().replace(/\s+/g, "-")}` });

describe("new decision-makers", () => {
  it("keeps the ICP's senior titles (all titles when none are senior)", () => {
    expect(decisionMakerTitles(icp)).toEqual(["VP Sales", "Head of Sales"]);
    expect(decisionMakerTitles(icpSchema.parse({ company_name: "K", personas: [{ name: "AE", titles: ["Account Executive"] }] }))).toEqual(["Account Executive"]);
  });

  it("asks the search for senior roles joined in the last 3 months, and emits the rows without reading profiles", async () => {
    const { ctx, bodies, emitted } = harness([row("Jane Doe", "VP Sales", "Acme")]);
    await newDecisionMakerRunner(ctx);
    expect(bodies).toHaveLength(1); // no extra profile reads
    expect(bodies[0].query).toMatchObject({ timeInCurrentCompany: { "<=": 3 }, currentJobTitle: { include: ["VP Sales", "Head of Sales"] } });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].signal).toMatchObject({ type: "new_decision_maker", title: "New decision-maker: VP Sales at Acme" });
    expect(ctx.cursor.dm_token).toBe("next");
  });
});

describe("hiring surge from headcount growth", () => {
  it("finds the ICP's roles at companies that grew 20%+ in six months, with no job boards", async () => {
    const { ctx, bodies, emitted } = harness([row("Sam Lee", "Head of Sales", "Globex")]);
    await hiringSurgeRunner(ctx);
    expect(bodies[0].query).toMatchObject({ "currentCompany.headcountGrowth": { min: 20, timespan: "6months" } });
    expect(emitted[0].signal).toMatchObject({ type: "hiring_surge", title: "Globex is growing fast: headcount up 20%+ in 6 months" });
  });
});
