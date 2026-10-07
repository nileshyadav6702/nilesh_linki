import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RiArrowDownLine, RiArrowUpLine, RiFileCopyLine } from "react-icons/ri";
import { Card, ghostBtn, inputCls, primaryBtn } from "@/components/agents/ui";

interface Provider { key: string; label: string; needs_key: boolean; configured: boolean; enabled: boolean }

/** Email-waterfall provider keys + order, and the website-visitor pixel. */
export default function SignalDataSettings() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [ipinfo, setIpinfo] = useState(false);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [pixel, setPixel] = useState<{ snippet: string; visits: Array<{ company_name: string; company_domain: string | null; views: number; last_seen: string }>; total_views_30d: number } | null>(null);

  const load = useCallback(() => {
    fetch("/api/enrichment/settings").then((r) => r.json()).then((d) => { setProviders(d.providers ?? []); setIpinfo(!!d.ipinfo_configured); }).catch(() => {});
    fetch("/api/site-pixel").then((r) => r.ok ? r.json() : null).then(setPixel).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function saveKey(key: string) {
    if (!keys[key]) return;
    const r = await fetch("/api/integrations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, api_key: keys[key] }) });
    if (!r.ok) return toast.error((await r.json()).error ?? "Could not save key");
    toast.success("Key saved");
    setKeys({ ...keys, [key]: "" });
    load();
  }

  async function saveOrder(next: Provider[]) {
    setProviders(next);
    const r = await fetch("/api/enrichment/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: next.filter((p) => p.enabled).map((p) => p.key) }) });
    if (!r.ok) toast.error("Could not save order");
  }
  const move = (i: number, d: -1 | 1) => { const n = [...providers]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; saveOrder(n); };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="space-y-3">
        <div><h2 className="text-sm font-semibold">Email waterfall</h2><p className="text-xs text-base-content/50">Providers run top to bottom; the first verified email wins. Keys are encrypted at rest.</p></div>
        {providers.map((p, i) => (
          <div key={p.key} className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-subtle)] p-2.5">
            <input type="checkbox" className="checkbox checkbox-sm" checked={p.enabled} onChange={(e) => saveOrder(providers.map((x) => x.key === p.key ? { ...x, enabled: e.target.checked } : x))} aria-label={`Use ${p.label}`} />
            <span className="w-32 text-sm font-medium">{p.label}</span>
            {p.needs_key && (
              <span className="flex flex-1 items-center gap-1.5">
                <input className={`${inputCls} h-8`} type="password" placeholder={p.configured ? "Key saved — paste to replace" : "API key"} value={keys[p.key] ?? ""} onChange={(e) => setKeys({ ...keys, [p.key]: e.target.value })} />
                <button className={ghostBtn} onClick={() => saveKey(p.key)}>Save</button>
              </span>
            )}
            {!p.needs_key && <span className="flex-1 text-xs text-base-content/45">Free — guesses common patterns and checks the mailbox</span>}
            <button className={ghostBtn} onClick={() => move(i, -1)} aria-label="Move up"><RiArrowUpLine size={14} /></button>
            <button className={ghostBtn} onClick={() => move(i, 1)} aria-label="Move down"><RiArrowDownLine size={14} /></button>
          </div>
        ))}
      </Card>

      <Card className="space-y-3">
        <div><h2 className="text-sm font-semibold">Website visitors</h2><p className="text-xs text-base-content/50">Add this snippet to your site. With an IPinfo key, visiting companies become signals for your agents.</p></div>
        {pixel && (
          <>
            <div className="relative">
              <pre className="overflow-x-auto rounded-xl bg-base-200 p-3 pr-10 text-[11px] leading-relaxed">{pixel.snippet}</pre>
              <button className={`${ghostBtn} absolute right-1.5 top-1.5`} onClick={() => { navigator.clipboard.writeText(pixel.snippet); toast.success("Copied"); }} aria-label="Copy snippet"><RiFileCopyLine size={14} /></button>
            </div>
            <div className="flex items-center gap-1.5">
              <input className={`${inputCls} h-8`} type="password" placeholder={ipinfo ? "IPinfo key saved — paste to replace" : "IPinfo API key"} value={keys.ipinfo ?? ""} onChange={(e) => setKeys({ ...keys, ipinfo: e.target.value })} />
              <button className={primaryBtn + " !h-8"} onClick={() => saveKey("ipinfo")}>Save</button>
            </div>
            <p className="text-xs text-base-content/50">{pixel.total_views_30d} page views in the last 30 days.</p>
            {pixel.visits.map((v) => (
              <div key={v.company_name} className="flex justify-between text-sm"><span>{v.company_name}{v.company_domain ? <span className="text-base-content/40"> · {v.company_domain}</span> : null}</span><span className="tabular-nums text-base-content/50">{v.views}</span></div>
            ))}
          </>
        )}
      </Card>
    </div>
  );
}
