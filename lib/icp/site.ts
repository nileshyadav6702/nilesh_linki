import { lookup } from "dns/promises";
import net from "net";

/**
 * Fetches a company website as plain text for ICP extraction: the homepage plus up to
 * MAX_SUBPAGES same-origin pages whose path looks informative (pricing, about, product...).
 *
 * The URL comes from a user, so every fetch is guarded against SSRF: http(s) only, no
 * credentials in the URL, and the hostname must resolve to a public address.
 */

const MAX_SUBPAGES = 10;
const MAX_CHARS_PER_PAGE = 6000;
const MAX_TOTAL_CHARS = 30000;
const FETCH_TIMEOUT_MS = 12000;
const INTERESTING = /(pricing|about|product|platform|solution|feature|customer|case-stud|use-case|industr|why|integration|security|enterprise|team|company)/i;

export class UnsafeUrlError extends Error {}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

export function normalizeWebsiteUrl(input: string): URL {
  const raw = input.trim();
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!["http:", "https:"].includes(url.protocol)) throw new UnsafeUrlError("Only http(s) URLs are allowed");
  if (url.username || url.password) throw new UnsafeUrlError("URLs with credentials are not allowed");
  url.hash = "";
  return url;
}

async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new UnsafeUrlError("Private hosts are not allowed");
  const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new UnsafeUrlError("The website must resolve to a public address");
}

async function fetchHtml(url: URL): Promise<{ html: string; finalUrl: URL } | null> {
  await assertPublicHost(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Redirects are followed manually so every hop is re-checked against the SSRF guard.
    let current = url;
    for (let hop = 0; hop < 4; hop++) {
      const res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; LinkiICPBot/1.0)", Accept: "text/html" },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        current = new URL(res.headers.get("location")!, current);
        if (!["http:", "https:"].includes(current.protocol)) return null;
        await assertPublicHost(current);
        continue;
      }
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
      return { html: (await res.text()).slice(0, 800_000), finalUrl: current };
    }
    return null;
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw err;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&nbsp;": " ", "&rsquo;": "'", "&ndash;": "-", "&mdash;": "-" };

export function htmlToText(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? "";
  const body = html
    .replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|p|div|li|h[1-6]|section|article|tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return [title.trim(), description.trim(), body].filter(Boolean).join("\n");
}

export function extractInterestingLinks(html: string, base: URL, limit = MAX_SUBPAGES): URL[] {
  const out = new Map<string, URL>();
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
    let u: URL;
    try { u = new URL(m[1], base); } catch { continue; }
    if (u.origin !== base.origin) continue;
    if (!INTERESTING.test(u.pathname)) continue;
    if (/\.(pdf|png|jpe?g|gif|svg|zip|mp4)$/i.test(u.pathname)) continue;
    u.search = "";
    u.hash = "";
    if (u.pathname.split("/").filter(Boolean).length > 3) continue;
    out.set(u.href, u);
    if (out.size >= limit) break;
  }
  return [...out.values()];
}

export interface SiteText { url: string; pages: Array<{ url: string; text: string }> }

export async function fetchSiteText(input: string): Promise<SiteText> {
  const start = normalizeWebsiteUrl(input);
  const home = await fetchHtml(start);
  if (!home) throw new Error("Could not load the website. Check the URL and try again.");
  const pages: SiteText["pages"] = [{ url: home.finalUrl.href, text: htmlToText(home.html).slice(0, MAX_CHARS_PER_PAGE) }];
  let total = pages[0].text.length;
  for (const link of extractInterestingLinks(home.html, home.finalUrl)) {
    if (total >= MAX_TOTAL_CHARS) break;
    const page = await fetchHtml(link).catch(() => null);
    if (!page) continue;
    const text = htmlToText(page.html).slice(0, MAX_CHARS_PER_PAGE);
    if (text.length < 200) continue;
    pages.push({ url: link.href, text });
    total += text.length;
  }
  return { url: home.finalUrl.href, pages };
}
