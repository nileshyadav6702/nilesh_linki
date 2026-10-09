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

/** `accept` overrides the response format (messaging GraphQL needs "application/graphql"). */
export interface VoyagerGetOptions { normalized?: boolean; kind?: BudgetKind; accept?: string }

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
    let status = 0;
    page.on("response", (resp) => {
      if (resp.url().includes("linkedin.com/feed")) status = resp.status();
    });
    try {
      const nav = await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 25000 });
      status = nav?.status() || status;
    } catch (err) {
      await page.close().catch(() => {});
      if (status === 429 || status === 999 || status === 401 || status === 403) throw new VoyagerBlockedError(status);
      throw err;
    }
    if (status === 429 || status === 999 || status === 401 || status === 403) {
      await page.close().catch(() => {});
      throw new VoyagerBlockedError(status);
    }
    await page.waitForTimeout(1200);
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

  private async resetPage(): Promise<void> {
    if (this.page) { try { await this.page.close(); } catch { /* already closed */ } }
    this.page = null;
  }

  /** Read a same-origin Voyager path from the open LinkedIn page. A thrown fetch becomes status 0. */
  private async read(page: Page, path: string, accept: string): Promise<{ status: number; body: string }> {
    // A plain script string, not a function: tsx (worker:dev) wraps named functions in a
    // __name() helper that doesn't exist inside the page, which made every read fail there.
    const args = JSON.stringify({ path, csrf: this.csrf, accept });
    return page.evaluate(`(async () => {
      const a = ${args};
      const regs = (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) ? await navigator.serviceWorker.getRegistrations() : [];
      await Promise.all(regs.map((r) => r.unregister()));
      const headers = { accept: a.accept, "csrf-token": a.csrf, "x-restli-protocol-version": "2.0.0" };
      try {
        const r = await fetch(a.path, { headers, credentials: "include" });
        return { status: r.status, body: r.status === 200 ? await r.text() : "" };
      } catch (e) {
        return await new Promise((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open("GET", a.path, true);
          xhr.withCredentials = true;
          Object.keys(headers).forEach((k) => xhr.setRequestHeader(k, headers[k]));
          xhr.onload = () => resolve({ status: xhr.status, body: xhr.status === 200 ? xhr.responseText : "" });
          xhr.onerror = () => resolve({ status: 0, body: "" });
          xhr.send();
        });
      }
    })()`) as Promise<{ status: number; body: string }>;
  }

  /** GET a Voyager path (starting with /voyager/api/). Returns parsed JSON, or null on 404/400. */
  async get(path: string, opts: VoyagerGetOptions = {}): Promise<unknown | null> {
    const kind = opts.kind ?? "voyager_read";
    if (!consume(this.accountId, kind)) throw new VoyagerBudgetExceeded(kind);
    const accept = opts.accept ?? (opts.normalized ? "application/vnd.linkedin.normalized+json+2.1" : "application/json");
    let result = { status: 0, body: "" };
    for (let attempt = 0; attempt < 2; attempt++) {
      const page = await this.ensurePage();
      const wait = this.lastAt + MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS) - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.lastAt = Date.now();
      this.requests++;
      try {
        result = await this.read(page, path, accept);
      } catch {
        result = { status: 0, body: "" };
      }
      if (result.status !== 0) break;
      await this.resetPage();
    }
    if (result.status === 429 || result.status === 401 || result.status === 403 || result.status === 999) throw new VoyagerBlockedError(result.status);
    if (result.status === 0) throw new Error("LinkedIn did not answer. Preview the leads again in a moment.");
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
