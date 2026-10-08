/**
 * LinkedIn image objects → a plain URL we can store and render.
 *
 * Sales Navigator and Voyager both describe pictures as a vector image:
 * { rootUrl, artifacts: [{ width, fileIdentifyingUrlPathSegment }] }, sometimes wrapped
 * (mini profile `picture`, lockup `image.attributes[].detailData…`). Pass the specific
 * picture node, not a whole profile: the search walks into wrappers and would otherwise
 * find the first logo anywhere in it.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Only LinkedIn's CDN: these URLs end up in <img src>, so nothing else is accepted. */
const LICDN = /^https:\/\/[a-z0-9.-]*\.licdn\.com\//i;

export function linkedInImageUrl(img: unknown, preferWidth = 200, depth = 0): string | null {
  if (depth > 6 || img === null || typeof img !== "object") return null;
  if (Array.isArray(img)) {
    for (const v of img) { const u = linkedInImageUrl(v, preferWidth, depth + 1); if (u) return u; }
    return null;
  }
  const o = img as Obj;
  const root = typeof o.rootUrl === "string" ? o.rootUrl : "";
  const artifacts = Array.isArray(o.artifacts) ? o.artifacts.filter(isObj) : [];
  if (artifacts.length) {
    const best = [...artifacts].sort((a, b) => Math.abs(Number(a.width ?? 0) - preferWidth) - Math.abs(Number(b.width ?? 0) - preferWidth))[0];
    const seg = typeof best.fileIdentifyingUrlPathSegment === "string" ? best.fileIdentifyingUrlPathSegment : "";
    const url = seg.startsWith("http") ? seg : root + seg;
    if (seg && LICDN.test(url)) return url;
  }
  if (typeof o.url === "string" && LICDN.test(o.url)) return o.url;
  for (const v of Object.values(o)) {
    if (v && typeof v === "object") { const u = linkedInImageUrl(v, preferWidth, depth + 1); if (u) return u; }
  }
  return null;
}

/** "urn:li:fs_salesCompany:1234" / "urn:li:fsd_company:1234" → the company's LinkedIn page. */
export function companyUrlFromUrn(urn: unknown): string | null {
  if (typeof urn !== "string") return null;
  const id = urn.match(/:(\d+)\)?$/)?.[1];
  return id ? `https://www.linkedin.com/company/${id}` : null;
}
