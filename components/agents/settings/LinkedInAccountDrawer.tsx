import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  RiCheckLine, RiCloseLine, RiDashboard3Line, RiGlobalLine, RiInformationLine, RiLinkedinBoxFill, RiMagicLine, RiSettings4Line, RiTimeLine, RiWifiLine,
} from "react-icons/ri";
import { inputCls, primaryBtn, secondaryBtn, textareaCls } from "@/components/agents/ui";
import { SideDrawer, Tip } from "@/components/agents/campaign/kit";
import { DAY_NAMES, hourLabel, parseDays, SettingsSection, UsageBar } from "@/components/agents/settings/kit";

interface Account {
  id: string; name: string | null; email: string | null; is_authenticated: number;
  daily_connection_limit: number | null; daily_message_limit: number | null; daily_inmail_limit: number | null; daily_visit_limit: number | null;
  active_hours_start: number | null; active_hours_end: number | null; timezone: string | null; working_days: string | null;
  proxy_url: string | null; proxy_username: string | null; has_proxy_password?: boolean | number;
  usage_today?: { visit?: number; connect?: number; message?: number; inmail?: number };
}

const FALLBACK_ZONES = ["UTC", "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "Europe/Paris", "Europe/Berlin", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Australia/Sydney"];
function timeZones(current: string): string[] {
  let all: string[] = FALLBACK_ZONES;
  try { all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? FALLBACK_ZONES; } catch { /* old browser */ }
  return all.includes(current) ? all : [current, ...all];
}

/** "http://user@1.2.3.4:8080" → host + port. */
function parseProxy(url: string | null): { host: string; port: string } {
  if (!url) return { host: "", port: "" };
  try { const u = new URL(url.includes("://") ? url : `http://${url}`); return { host: u.hostname, port: u.port }; } catch { return { host: url, port: "" }; }
}

const LIMITS = [
  { key: "daily_visit_limit", label: "Profile visits / day", usage: "visit", max: 150, fallback: 80 },
  { key: "daily_connection_limit", label: "Invitations / day", usage: "connect", max: 100, fallback: 20 },
  { key: "daily_message_limit", label: "Messages / day", usage: "message", max: 150, fallback: 40 },
  { key: "daily_inmail_limit", label: "InMails / day", usage: "inmail", max: 50, fallback: 15 },
] as const;

/**
 * LinkedIn sender settings: time zone, daily quotas, schedule, proxy — and, when opened from an
 * agent, that agent's AI reply context. From Settings (no agent) the reply section is hidden.
 */
export default function LinkedInAccountDrawer({ accountId, agentId, inbox, onClose, onSaved }: {
  accountId: string; agentId?: string; inbox?: { booking_url: string | null; reply_instructions: string | null };
  onClose: () => void; onSaved: () => void;
}) {
  const [acc, setAcc] = useState<Account | null>(null);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [tz, setTz] = useState("UTC");
  const [hours, setHours] = useState<[number, number]>([9, 18]);
  const [days, setDays] = useState<Set<number>>(new Set([1, 2, 3, 4, 5]));
  const [booking, setBooking] = useState(inbox?.booking_url ?? "");
  const [instructions, setInstructions] = useState(inbox?.reply_instructions ?? "");
  const [proxy, setProxy] = useState({ host: "", port: "", username: "", password: "" });
  const [check, setCheck] = useState<{ state: "idle" | "checking" | "ok" | "fail"; text?: string }>({ state: "idle" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/accounts/${accountId}`).then((r) => (r.ok ? r.json() : null)).then((a: Account | null) => {
      if (!a) { toast.error("Could not load this LinkedIn account"); return; }
      setAcc(a);
      setLimits(Object.fromEntries(LIMITS.map((l) => [l.key, a[l.key] ?? l.fallback])));
      setTz(a.timezone || "UTC");
      setHours([a.active_hours_start ?? 9, a.active_hours_end ?? 18]);
      setDays(parseDays(a.working_days));
      setProxy({ ...parseProxy(a.proxy_url), username: a.proxy_username ?? "", password: "" });
    }).catch(() => toast.error("Could not load this LinkedIn account"));
  }, [accountId]);

  const zones = useMemo(() => timeZones(tz), [tz]);
  const activeDays = days.size;
  const proxyUrl = proxy.host.trim() ? `http://${proxy.host.trim()}${proxy.port.trim() ? `:${proxy.port.trim()}` : ""}` : "";
  const savedProxyHost = parseProxy(acc?.proxy_url ?? null).host;
  const usage = acc?.usage_today ?? {};
  const validHours = hours[0] < hours[1];

  async function runCheck() {
    if (!proxyUrl) return;
    setCheck({ state: "checking" });
    try {
      const r = await fetch(`/api/accounts/${accountId}/proxy-check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proxy_url: proxyUrl }) });
      const x = await r.json();
      setCheck(x.ok ? { state: "ok", text: `Reachable${x.ms != null ? ` in ${x.ms} ms` : ""}` } : { state: "fail", text: x.error ?? "Not reachable" });
    } catch { setCheck({ state: "fail", text: "Check failed" }); }
  }

  async function save() {
    if (!acc) return;
    if (!validHours) return toast.error("The end of the active hours must be after the start");
    if (days.size === 0) return toast.error("Pick at least one active day");
    setBusy(true);
    const body: Record<string, unknown> = {
      ...Object.fromEntries(LIMITS.map((l) => [l.key, Math.max(0, Math.min(l.max, Math.round(Number(limits[l.key]) || 0)))])),
      timezone: tz, active_hours_start: hours[0], active_hours_end: hours[1],
      working_days: Array.from(days).sort((a, b) => a - b).join(","),
      proxy_url: proxyUrl, proxy_username: proxyUrl ? proxy.username.trim() : "",
    };
    if (!proxyUrl) body.proxy_password = "";
    else if (proxy.password) body.proxy_password = proxy.password;
    const r = await fetch(`/api/accounts/${accountId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { setBusy(false); return toast.error((await r.json().catch(() => ({}))).error ?? "Could not save the account"); }
    if (agentId && (booking !== (inbox?.booking_url ?? "") || instructions !== (inbox?.reply_instructions ?? ""))) {
      const p = await fetch(`/api/agents/${agentId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ booking_url: booking.trim() || null, reply_instructions: instructions.trim() || null }) });
      if (!p.ok) { setBusy(false); return toast.error((await p.json().catch(() => ({}))).error ?? "Could not save the reply settings"); }
    }
    setBusy(false);
    toast.success("LinkedIn settings saved");
    onSaved();
    onClose();
  }

  async function disconnect() {
    if (!confirm("Disconnect this LinkedIn account? Its session is cleared and LinkedIn work stops until you reconnect it from Settings.")) return;
    setBusy(true);
    const r = await fetch(`/api/accounts/${accountId}/disconnect`, { method: "POST" });
    setBusy(false);
    if (!r.ok) return toast.error((await r.json().catch(() => ({}))).error ?? "Could not disconnect");
    toast.success("LinkedIn account disconnected");
    onSaved();
    onClose();
  }

  const title = (
    <span className="flex flex-col">
      <span className="flex items-center gap-2">LinkedIn Account <RiLinkedinBoxFill size={22} className="text-[#0a66c2]" /></span>
      {acc && (
        <span className="font-sans text-[15px] font-normal text-base-content/60">
          {acc.name || acc.email} · <span className={acc.is_authenticated ? "font-medium text-success" : "font-medium text-error"}>{acc.is_authenticated ? "Connected" : "Logged out"}</span>
        </span>
      )}
    </span>
  );

  return (
    <SideDrawer title={title} onClose={onClose} width={720} footer={
      <div className="flex w-full flex-col gap-3">
        <button type="button" onClick={disconnect} disabled={busy || !acc} className="self-center text-[15px] font-medium text-primary hover:underline disabled:opacity-40">Disconnect LinkedIn</button>
        <div className="flex justify-end gap-3 border-t border-[var(--border-subtle)] pt-3">
          <button type="button" className="px-3 text-[15px] font-medium text-base-content/70 hover:text-base-content" onClick={onClose}>Cancel</button>
          <button type="button" className={primaryBtn} disabled={busy || !acc} onClick={save}>{busy ? "Saving…" : "Save settings"}</button>
        </div>
      </div>
    }>
      {!acc ? <p className="text-[15px] text-base-content/45">Loading…</p> : (
        <div className="space-y-4">
          <section className="rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-5">
            <div className="text-[16px] font-semibold text-base-content">Time zone</div>
            <p className="text-[15px] text-base-content/55">Select the time zone for this LinkedIn seat</p>
            <select className={`${inputCls} !h-12 !text-[16px] mt-3 max-w-md`} value={tz} onChange={(e) => setTz(e.target.value)}>
              {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
            </select>
            <p className="mt-2 text-[14px] text-base-content/55">Schedules and daily limits follow this time zone.</p>
            {savedProxyHost
              ? <p className="mt-2 flex items-center gap-1.5 text-[14px] text-base-content/75">Traffic goes through your proxy {savedProxyHost} <RiCheckLine size={15} className="text-success" /></p>
              : <p className="mt-2 text-[14px] text-base-content/45">No proxy — this seat uses the server&apos;s own IP. Add one under Advanced parameters.</p>}
          </section>

          <SettingsSection icon={<RiDashboard3Line size={18} />} tone="coral" title="Quotas & limits"
            pill={`${usage.connect ?? 0}/${limits.daily_connection_limit ?? 0} invitations today`} subtitle="Daily volume this seat is allowed to send">
            <div className="grid gap-4 sm:grid-cols-2">
              {LIMITS.map((l) => {
                const n = Number(limits[l.key]) || 0;
                return (
                  <label key={l.key} className="block">
                    <span className="flex items-center gap-1.5 text-[15px] font-medium text-base-content">
                      {l.label}
                      {l.usage === "connect" && <Tip text="Invitations are the action LinkedIn watches most closely. Raise this slowly."><RiInformationLine size={15} className="text-base-content/40" /></Tip>}
                    </span>
                    <input type="number" min={0} max={l.max} className={`${inputCls} !h-12 !text-[16px] mt-1.5`} value={limits[l.key] ?? ""} onChange={(e) => setLimits({ ...limits, [l.key]: Number(e.target.value) })} />
                    <UsageBar used={usage[l.usage] ?? 0} limit={n} />
                    <span className="text-[14.5px] text-base-content/40">≈ {n * activeDays}/week</span>
                  </label>
                );
              })}
            </div>
            <div className="mt-5 rounded-[10px] bg-primary/[0.06] px-4 py-3.5 text-[15px]">
              <div className="font-semibold text-base-content">Recommended LinkedIn invitation limits</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {([["New accounts", "5–10"], ["Active accounts", "10–20"], ["Mature accounts", "20–25"]] as const).map(([k, v]) => (
                  <div key={k}><div className="text-[14px] text-primary">{k}</div><div className="font-semibold text-base-content">{v} <span className="text-[14px] font-normal text-base-content/55">/day</span></div></div>
                ))}
              </div>
              <p className="mt-2 text-[14px] text-primary">Start low and increase gradually over the first 2–3 weeks.</p>
            </div>
          </SettingsSection>

          <SettingsSection icon={<RiTimeLine size={18} />} tone="teal" title="Schedule"
            pill={`${activeDays} active day${activeDays === 1 ? "" : "s"} · ${hourLabel(hours[0])}–${hourLabel(hours[1])}`} subtitle="Active hours and days for this seat">
            <div className="text-[16px] font-semibold text-base-content">Active hours</div>
            <p className="text-[15px] text-base-content/55">Select the period of time when this seat should run its activities.</p>
            <HourRange value={hours} onChange={setHours} />
            <p className="mt-1 text-center text-[15px] text-base-content/70">Selected: from <span className="font-semibold text-primary">{hourLabel(hours[0])}</span> to <span className="font-semibold text-primary">{hourLabel(hours[1])}</span> ({tz})</p>
            <p className="mt-1 flex items-center justify-center gap-1 text-[14.5px] text-base-content/45"><RiInformationLine size={13} /> LinkedIn activities run only inside this window</p>
            {!validHours && <p className="mt-1 text-center text-[14.5px] text-error">The end must be after the start.</p>}
            <div className="mt-6 font-medium text-base-content">Active days</div>
            <p className="text-[15px] text-base-content/55">Select which days this seat should be active for LinkedIn activities.</p>
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {DAY_NAMES.map((d, i) => {
                const n = i + 1; const on = days.has(n);
                return (
                  <label key={d} className={`flex cursor-pointer items-center gap-3 rounded-[10px] border px-4 py-3 text-[15px] ${on ? "border-primary/50 bg-primary/[0.07]" : "border-[var(--border-subtle)] bg-base-100"}`}>
                    <input type="checkbox" className="checkbox checkbox-sm checkbox-primary" checked={on} onChange={() => { const next = new Set(days); if (on) next.delete(n); else next.add(n); setDays(next); }} />
                    {d}
                  </label>
                );
              })}
            </div>
          </SettingsSection>

          {agentId && <SettingsSection icon={<RiMagicLine size={18} />} tone="amber" title="Inbox & AI replies" subtitle="Suggested replies for this agent's leads">
            <p className="mb-4 text-[15px] text-base-content/60">Used when you click <span className="font-medium">Draft with AI</span> on a reply from this agent&apos;s leads. Applies to this agent, not only this seat.</p>
            <label className="block">
              <span className="text-[15px] font-medium text-base-content">Calendar link <span className="font-normal text-base-content/45">(optional)</span></span>
              <input className={`${inputCls} !h-12 !text-[16px] mt-1.5`} value={booking} onChange={(e) => setBooking(e.target.value)} placeholder="https://calendly.com/your-link" />
            </label>
            <label className="mt-4 block">
              <span className="text-[15px] font-medium text-base-content">AI reply instructions <span className="font-normal text-base-content/45">(optional)</span></span>
              <textarea className={`${textareaCls} !text-[16px] mt-1.5 min-h-[110px]`} maxLength={500} value={instructions} onChange={(e) => setInstructions(e.target.value)}
                placeholder="Example: keep replies short and friendly. If someone shows interest, invite them to book a demo and include the calendar link." />
              <span className="mt-1 flex justify-between text-[14.5px] text-base-content/45"><span>Tone, product to mention, when to suggest a meeting.</span><span className="tabular-nums">{instructions.length}/500</span></span>
            </label>
          </SettingsSection>}

          <SettingsSection icon={<RiSettings4Line size={18} />} tone="success" title="Advanced parameters" pill={savedProxyHost ? `Proxy · ${savedProxyHost}` : "No proxy"} subtitle="Proxy override">
            <div className="text-[16px] font-semibold text-base-content">Proxy override</div>
            <p className="text-[15px] text-base-content/55">Route this LinkedIn seat through your own proxy.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="text-[15px] font-medium">Proxy IP</span><input className={`${inputCls} !h-12 !text-[16px] mt-1`} value={proxy.host} onChange={(e) => { setProxy({ ...proxy, host: e.target.value }); setCheck({ state: "idle" }); }} placeholder="e.g. 192.168.1.1" /></label>
              <label className="block"><span className="text-[15px] font-medium">Port</span><input className={`${inputCls} !h-12 !text-[16px] mt-1`} inputMode="numeric" value={proxy.port} onChange={(e) => { setProxy({ ...proxy, port: e.target.value.replace(/\D/g, "") }); setCheck({ state: "idle" }); }} placeholder="e.g. 8080" /></label>
              <label className="block"><span className="text-[15px] font-medium">Username</span><input className={`${inputCls} !h-12 !text-[16px] mt-1`} value={proxy.username} onChange={(e) => setProxy({ ...proxy, username: e.target.value })} placeholder="Optional" autoComplete="off" /></label>
              <label className="block"><span className="text-[15px] font-medium">Password</span><input type="password" className={`${inputCls} !h-12 !text-[16px] mt-1`} value={proxy.password} onChange={(e) => setProxy({ ...proxy, password: e.target.value })} placeholder={acc.has_proxy_password ? "Saved — leave empty to keep" : "Optional"} autoComplete="new-password" /></label>
            </div>
            <div className="mt-3 flex items-center justify-end gap-3">
              {check.state === "ok" && <span className="flex items-center gap-1 text-[15px] text-success"><RiCheckLine size={15} /> {check.text}</span>}
              {check.state === "fail" && <span className="flex items-center gap-1 text-[15px] text-error"><RiCloseLine size={15} /> {check.text}</span>}
              <button type="button" className={`${secondaryBtn} !h-9`} disabled={!proxyUrl || check.state === "checking"} onClick={runCheck}><RiWifiLine size={15} /> {check.state === "checking" ? "Checking…" : "Check"}</button>
            </div>
            <p className="mt-3 flex items-start gap-1.5 rounded-[8px] bg-[#e8a55a]/10 px-3 py-2 text-[14px] text-[#b8742a]"><RiGlobalLine size={15} className="mt-0.5 shrink-0" />Changing the proxy changes the IP LinkedIn sees; reconnect the account afterwards so the session is created on the new IP.</p>
          </SettingsSection>
        </div>
      )}
    </SideDrawer>
  );
}

/** Dual-handle 0–24 hour range: two overlaid range inputs over a coral selected track. */
function HourRange({ value, onChange }: { value: [number, number]; onChange: (v: [number, number]) => void }) {
  const [start, end] = value;
  const pct = (h: number) => `${(h / 24) * 100}%`;
  const thumb = "pointer-events-none absolute inset-x-0 top-0 h-6 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary";
  return (
    <div className="mt-4">
      <div className="relative h-6">
        <div className="absolute inset-x-0 top-[9px] h-1.5 rounded-full bg-base-200" />
        <div className="absolute top-[9px] h-1.5 rounded-full bg-primary/60" style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }} />
        <input type="range" min={0} max={24} step={1} value={start} aria-label="Start hour" className={thumb} onChange={(e) => onChange([Math.min(Number(e.target.value), end - 1), end])} />
        <input type="range" min={0} max={24} step={1} value={end} aria-label="End hour" className={thumb} onChange={(e) => onChange([start, Math.max(Number(e.target.value), start + 1)])} />
      </div>
      <div className="mt-1 flex justify-between text-[12.5px] tabular-nums">
        {Array.from({ length: 25 }, (_, h) => <span key={h} className={`w-3 text-center ${h >= start && h <= end ? "text-primary" : "text-base-content/40"}`}>{h % 2 === 0 ? h : ""}</span>)}
      </div>
    </div>
  );
}
