import type { BrowserContext, Page } from "playwright";
import { consume, type BudgetKind } from "@/lib/linkedin/budget";

/**
 * Read-only Voyager client for discovery. Requests run inside a real LinkedIn page via
 * fetch(), so they carry the session's cookies and the pinned browser fingerprint — the
 * same technique as profile-scrape.ts. Every request is charged to the account's daily
 * discovery budget BEFORE it is sent, and paced with human-like jitter.
 */

export class VoyagerBudgetExceeded extends Error {
  constructor(kind: BudgetKind) { super(`Daily LinkedIn discovery budget reached (${kind})`); this.name = "VoyagerBudgetExceeded"; }
}

export class VoyagerBlockedError extends Error {
  readonly status: number;
  constructor(status: number) { super(`LinkedIn refused the request (HTTP ${status})`); this.name = "VoyagerBlockedError"; this.status = status; }
}

export interface VoyagerGetOptions { normalized?: boolean; kind?: BudgetKind }

const MIN_GAP_MS = 4000;
const MAX_GAP_MS = 11000;

export class VoyagerClient {
  private page: Page | null = null;
  private csrf = "";
  private lastAt = 0;
  requests = 0;

  constructor(private readonly ctx: BrowserContext, private readonly accountId: string, private readonly sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {}

  private async ensurePage(): Promise<Page> {
    if (this.page) return this.page;
    const page = await this.ctx.newPage();
    await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 25000 });
    if (/\/(login|checkpoint|authwall)/.test(page.url())) {
      await page.close();
      throw new VoyagerBlockedError(401);
    }
    const cookies = await this.ctx.cookies();
    this.csrf = (cookies.find((c) => c.name === "JSESSIONID")?.value || "").replace(/"/g, "");
    if (!this.csrf) { await page.close(); throw new VoyagerBlockedError(401); }
    this.page = page;
    return page;
  }

  /** GET a Voyager path (starting with /voyager/api/). Returns parsed JSON, or null on 404/400. */
  async get(path: string, opts: VoyagerGetOptions = {}): Promise<unknown | null> {
    const kind = opts.kind ?? "voyager_read";
    if (!consume(this.accountId, kind)) throw new VoyagerBudgetExceeded(kind);
    const page = await this.ensurePage();
    const wait = this.lastAt + MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS) - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.lastAt = Date.now();
    this.requests++;
    const result = await page.evaluate(
      async ({ url, csrf, accept }: { url: string; csrf: string; accept: string }) => {
        const r = await fetch(url, { headers: { accept, "csrf-token": csrf, "x-restli-protocol-version": "2.0.0" }, credentials: "include" });
        return { status: r.status, body: r.status === 200 ? await r.text() : "" };
      },
      { url: `https://www.linkedin.com${path}`, csrf: this.csrf, accept: opts.normalized ? "application/vnd.linkedin.normalized+json+2.1" : "application/json" },
    );
    if (result.status === 429 || result.status === 401 || result.status === 403 || result.status === 999) throw new VoyagerBlockedError(result.status);
    if (result.status !== 200 || !result.body) return null;
    try { return JSON.parse(result.body); } catch { return null; }
  }

  /**
   * Open a LinkedIn page the way a person would and collect the bodies of responses whose
   * URL matches `match` (the page's own data stream). For views LinkedIn now renders
   * server-side, such as content search, where the old JSON endpoints come back empty.
   */
  async capturePage(url: string, opts: { match: RegExp; scrolls?: number; kind?: BudgetKind }): Promise<string[]> {
    const kind = opts.kind ?? "voyager_read";
    if (!consume(this.accountId, kind)) throw new VoyagerBudgetExceeded(kind);
    const wait = this.lastAt + MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS) - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.lastAt = Date.now();
    this.requests++;
    const page = await this.ctx.newPage();
    const bodies: string[] = [];
    const pending: Array<Promise<void>> = [];
    page.on("response", (resp) => {
      if (!opts.match.test(resp.url()) || resp.status() !== 200) return;
      pending.push(resp.text().then((t) => { bodies.push(t); }, () => {}));
    });
    try {
      const nav = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      if (/\/(login|checkpoint|authwall)/.test(page.url())) throw new VoyagerBlockedError(401);
      if (nav && [429, 999].includes(nav.status())) throw new VoyagerBlockedError(nav.status());
      await page.waitForTimeout(5000 + Math.random() * 2000);
      for (let i = 0; i < (opts.scrolls ?? 1); i++) {
        await page.mouse.wheel(0, 2500 + Math.random() * 800);
        await page.waitForTimeout(2500 + Math.random() * 1500);
      }
      await Promise.all(pending);
      return bodies;
    } finally {
      await page.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    if (this.page) { try { await this.page.close(); } catch { /* already closed */ } }
    this.page = null;
  }
}
