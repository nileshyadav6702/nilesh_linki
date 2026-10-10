import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { boardFromPage, careersUrls, discoverBoards } from "@/lib/signals/sources/careers";
import { fundingQueries } from "@/lib/signals/sources/funding";
import { tregFetchPages, tregNews } from "@/lib/treg/web";
import { tregPeopleAtCompany } from "@/lib/treg/people";
import { websiteSummary } from "@/lib/treg/enrich";
import { icpSchema } from "@/lib/icp/schema";

const WS = "ws-web-signals";
const json = (body: unknown, cost = 0) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", "X-Treg-Cost-Micro": String(cost) } });

beforeAll(() => {
  getDb().prepare("INSERT OR IGNORE INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("job boards from careers pages", () => {
  it("recognises Greenhouse, Lever and Ashby links and embeds", () => {
    expect(boardFromPage(["https://boards.greenhouse.io/acme/jobs/123"], "")).toEqual({ ats: "greenhouse", slug: "acme" });
    expect(boardFromPage([], `<script src="https://boards.greenhouse.io/embed/job_board/js?for=globex"></script>`)).toEqual({ ats: "greenhouse", slug: "globex" });
    expect(boardFromPage(["https://jobs.lever.co/initech/abc"], "")).toEqual({ ats: "lever", slug: "initech" });
    expect(boardFromPage(["https://jobs.ashbyhq.com/hooli"], "")).toEqual({ ats: "ashby", slug: "hooli" });
    expect(boardFromPage(["https://acme.com/about"], "We are hiring!")).toBeNull();
    expect(careersUrls("acme.com")).toEqual(["https://acme.com/careers", "https://acme.com/jobs", "https://acme.com/"]);
  });

  it("finds the boards of the agent's lead companies once, and remembers misses", async () => {
    vi.stubEnv("TREG_API_KEY", "");
    const db = getDb();
    db.prepare("INSERT INTO agents (id, workspace_id, name, status) VALUES ('ag-web', ?, 'Web', 'active')").run(WS);
    db.prepare("INSERT INTO companies (id, workspace_id, name, domain) VALUES ('co-acme', ?, 'Acme', 'acme.com'), ('co-none', ?, 'Nojobs', 'nojobs.io')").run(WS, WS);
    db.prepare("INSERT INTO targets (id, workspace_id, agent_id, full_name, company_id, agent_status) VALUES ('t-web1', ?, 'ag-web', 'A', 'co-acme', 'qualified'), ('t-web2', ?, 'ag-web', 'B', 'co-none', 'new')").run(WS, WS);
    const fetched: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      fetched.push(u);
      if (u === "https://acme.com/careers") return new Response(`<a href="https://jobs.lever.co/acme">Open roles</a>`, { status: 200 });
      return new Response("not found", { status: 404 });
    }));
    const cursor: Record<string, unknown> = {};
    expect(await discoverBoards(db, WS, "ag-web", cursor, 6)).toEqual([{ ats: "lever", slug: "acme", company: "Acme" }]);
    const before = fetched.length;
    // Checked within two weeks: no page is read again.
    expect(await discoverBoards(db, WS, "ag-web", cursor, 6)).toHaveLength(1);
    expect(fetched.length).toBe(before);
  });
});

describe("web pages and news through treg", () => {
  it("reads pages with the free fetch, marks missing pages, and only falls back for unreadable ones", async () => {
    vi.stubEnv("TREG_API_KEY", "k");
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: URL | string, init?: { body?: string }) => {
      const url = String(u);
      calls.push(url);
      if (url.includes("tinyfish.web.fetch")) {
        return json({ results: [{ url: "https://a.com/", final_url: "https://a.com/", title: "A", description: "We build CRMs", text: "Line one of the homepage text", links: ["https://a.com/x"] }],
          errors: [{ url: "https://gone.com/", error: "page_not_found", status: 404 }, { url: "https://js.com/", error: "timeout", status: null }] });
      }
      expect(JSON.parse(init?.body ?? "{}")).toEqual({ url: "https://js.com/", format: "md" });
      return json({ markdown: "Rendered with JavaScript", links: [] }, 150);
    }));
    const pages = await tregFetchPages(WS, ["https://a.com/", "https://gone.com/", "https://js.com/"], { fallback: true });
    expect(pages.get("https://a.com/")).toMatchObject({ title: "A", text: "Line one of the homepage text", links: ["https://a.com/x"] });
    expect(pages.get("https://gone.com/")).toBeNull();
    expect(pages.get("https://js.com/")?.text).toBe("Rendered with JavaScript");
    expect(calls.filter((c) => c.includes("crawl4ai"))).toHaveLength(1);
  });

  it("parses Exa news results", async () => {
    vi.stubEnv("TREG_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn(async () => json({ results: [{ title: "Acme raises $12M Series A", url: "https://news.example/acme", publishedDate: "2026-10-08T10:00:00Z" }, { title: "", url: "x" }] }, 7000)));
    expect(await tregNews(WS, "SaaS company raises funding round", "2026-10-01T00:00:00Z")).toEqual([
      { title: "Acme raises $12M Series A", url: "https://news.example/acme", publishedAt: "2026-10-08T10:00:00Z" },
    ]);
  });

  it("searches the ICP's roles at one company", async () => {
    vi.stubEnv("TREG_API_KEY", "k");
    let body: { query?: Record<string, unknown>; pagination?: { size: number } } = {};
    vi.stubGlobal("fetch", vi.fn(async (_u: unknown, init?: { body?: string }) => { body = JSON.parse(init?.body ?? "{}"); return json({ leads: [] }); }));
    const icp = icpSchema.parse({ company_name: "Kairo", personas: [{ name: "Sales", titles: ["VP Sales", "Head of Sales"] }], industries: ["Software Development"] });
    await tregPeopleAtCompany(WS, icp, { name: "Acme", domain: "acme.com" }, 3);
    expect(body.query).toEqual({ currentJobTitle: { include: ["VP Sales", "Head of Sales"] }, currentCompanyWebsite: { include: ["acme.com"] } });
    expect(body.pagination?.size).toBe(3);
  });
});

describe("funding news queries and homepage summaries", () => {
  it("builds queries from the ICP's industries and geography", () => {
    const icp = icpSchema.parse({ company_name: "K", industries: ["Fintech", "Software Development", "Retail"], geographies: ["United States"] });
    expect(fundingQueries(icp, 2)).toEqual(["Fintech company raises funding round United States", "Software Development company raises funding round United States"]);
    expect(fundingQueries(icpSchema.parse({ company_name: "K" }))).toEqual(["startup raises Series A funding round"]);
  });
  it("keeps the meaningful lines of a homepage", () => {
    const s = websiteSummary({ title: "Acme", description: "CRM for dentists", text: "# Menu\nLogin\nAcme helps dental clinics manage patients and bookings.\n[Docs](https://acme.com/docs)" });
    expect(s).toBe("Acme — CRM for dentists — Acme helps dental clinics manage patients and bookings.");
    expect(websiteSummary({ title: null, description: null, text: "Error. Page cannot be displayed. Please contact your service provider for more details." })).toBe("");
    expect(websiteSummary({ title: "Just a moment...", description: null, text: "Checking your browser" })).toBe("");
  });
});
