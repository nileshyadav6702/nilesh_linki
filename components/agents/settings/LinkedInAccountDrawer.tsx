import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getAllCountries, getCountry, getTimezone } from "countries-and-timezones";
import {
  RiCheckLine, RiCloseLine, RiDashboard3Fill, RiGlobalLine, RiInformationLine, RiLinkedinBoxFill, RiMagicFill, RiSettings4Fill, RiTimeFill, RiWifiLine,
} from "react-icons/ri";
import { inputCls, primaryBtn, secondaryBtn, textareaCls } from "@/components/agents/ui";
import { SideDrawer, Tip } from "@/components/agents/campaign/kit";
import { DAY_NAMES, hourLabel, LaunchHourSlider, parseDays, SettingsSection, UsageBar } from "@/components/agents/settings/kit";

interface Account {
  id: string; name: string | null; email: string | null; is_authenticated: number;
  daily_connection_limit: number | null; daily_message_limit: number | null; daily_visit_limit: number | null;
  weekly_connection_limit: number | null; weekly_message_limit: number | null; weekly_visit_limit: number | null;
  active_hours_start: number | null; active_hours_end: number | null; timezone: string | null; working_days: string | null; country: string | null;
  inbox_contacts_only: number; ai_draft_replies: number; booking_url: string | null; reply_instructions: string | null;
  proxy_url: string | null; proxy_username: string | null; has_proxy_password?: boolean | number;
  usage_week?: { visit?: number; connect?: number; message?: number };
}

/** Activities start at the launch hour and are spread over this many hours after it. */
const SPAN_HOURS = 8;

const COUNTRIES = Object.values(getAllCountries()).filter((c) => c.timezones.length).sort((a, b) => a.name.localeCompare(b.name));
/** The browser's zone, or the country whose zones include the account's saved one. */
function countryForZone(tz: string): string {
  // Old aliases (Asia/Calcutta) resolve through the zone's own country list.
  return COUNTRIES.find((c) => (c.timezones as string[]).includes(tz))?.id ?? getTimezone(tz)?.countries?.[0] ?? "";
}
/** The country's IANA zones (the library types them as literals). */
const zonesOf = (id: string): string[] => (id ? getCountry(id as Parameters<typeof getCountry>[0])?.timezones ?? [] : []);

/** "http://user@1.2.3.4:8080" → host + port. */
function parseProxy(url: string | null): { host: string; port: string } {
  if (!url) return { host: "", port: "" };
  try { const u = new URL(url.includes("://") ? url : `http://${url}`); return { host: u.hostname, port: u.port }; } catch { return { host: url, port: "" }; }
}

const LIMITS = [
  { key: "weekly_visit_limit", daily: "daily_visit_limit", label: "Profile visits / week", usage: "visit", max: 700, fallback: 100 },
  { key: "weekly_connection_limit", daily: "daily_connection_limit", label: "Invitations / week", usage: "connect", max: 200, fallback: 80 },
  { key: "weekly_message_limit", daily: "daily_message_limit", label: "Messages / week", usage: "message", max: 700, fallback: 100 },
] as const;

const RECOMMENDED = [["New accounts", "35–70"], ["Active accounts", "70–140"], ["Mature accounts", "140–175"]] as const;

/** Checkbox card: title, hint and, while on, the fields under it. */
function OptionCard({ on, onToggle, title, badge, hint, children }: { on: boolean; onToggle: () => void; title: string; badge?: string; hint: string; children?: React.ReactNode }) {
  return (
    <div className={`rounded-[12px] border px-5 py-4 transition-colors ${on ? "border-primary/35 bg-primary/[0.04]" : "border-[var(--border-subtle)] bg-base-100"}`}>
      <label className="flex cursor-pointer items-start gap-3.5">
        <input type="checkbox" className="checkbox checkbox-primary mt-0.5" checked={on} onChange={onToggle} />
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-[17px] font-medium text-base-content">{title}
            {badge && <span className="rounded-full bg-[#c026d3]/12 px-2.5 py-0.5 text-[12.5px] font-semibold tracking-wide text-[#b02ac6]">{badge}</span>}
          </span>
          <span className="mt-0.5 block text-[15px] text-base-content/60">{hint}</span>
        </span>
      </label>
      {children}
    </div>
  );
}

/**
 * LinkedIn sender settings: country and time zone, weekly quotas, launch hour and days, inbox
 * filtering with AI reply drafts, and the proxy. Opened from Settings → Senders or an agent.
 */
export default function LinkedInAccountDrawer({ accountId, inbox, onClose, onSaved }: {
  accountId: string; agentId?: string; inbox?: { booking_url: string | null; reply_instructions: string | null };
  onClose: () => void; onSaved: () => void;
}) {
  const [acc, setAcc] = useState<Account | null>(null);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [country, setCountry] = useState("");
  const [tz, setTz] = useState("UTC");
  const [launch, setLaunch] = useState(9);
  const [days, setDays] = useState<Set<number>>(new Set([1, 2, 3, 4, 5]));
  const [contactsOnly, setContactsOnly] = useState(false);
  const [aiDraft, setAiDraft] = useState(false);
  const [booking, setBooking] = useState("");
  const [instructions, setInstructions] = useState("");
  const [proxy, setProxy] = useState({ host: "", port: "", username: "", password: "" });
  const [check, setCheck] = useState<{ state: "idle" | "checking" | "ok" | "fail"; text?: string }>({ state: "idle" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/accounts/${accountId}`).then((r) => (r.ok ? r.json() : null)).then((a: Account | null) => {
      if (!a) { toast.error("Could not load this LinkedIn account"); return; }
      setAcc(a);
      const active = parseDays(a.working_days);
      // No weekly quota saved yet: start from the daily cap over the active days.
      setLimits(Object.fromEntries(LIMITS.map((l) => [l.key, a[l.key] ?? Math.min(l.max, (a[l.daily] ?? Math.ceil(l.fallback / 5)) * active.size)])));
      const zone = a.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      setTz(zone);
      setCountry(a.country ?? countryForZone(zone));
      setLaunch(a.active_hours_start ?? 9);
      setDays(active);
      setContactsOnly(!!a.inbox_contacts_only);
      setAiDraft(!!a.ai_draft_replies);
      setBooking(a.booking_url ?? inbox?.booking_url ?? "");
      setInstructions(a.reply_instructions ?? inbox?.reply_instructions ?? "");
      setProxy({ ...parseProxy(a.proxy_url), username: a.proxy_username ?? "", password: "" });
    }).catch(() => toast.error("Could not load this LinkedIn account"));
  }, [accountId, inbox?.booking_url, inbox?.reply_instructions]);

  const zones = useMemo(() => zonesOf(country), [country]);
  const activeDays = days.size;
  const proxyUrl = proxy.host.trim() ? `http://${proxy.host.trim()}${proxy.port.trim() ? `:${proxy.port.trim()}` : ""}` : "";
  const savedProxyHost = parseProxy(acc?.proxy_url ?? null).host;
  const usage = acc?.usage_week ?? {};

  function pickCountry(id: string) {
    setCountry(id);
    const z = zonesOf(id);
    if (z.length && !z.includes(tz)) setTz(z[0]);
  }

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
    if (days.size === 0) return toast.error("Pick at least one active day");
    if (booking.trim() && !/^https?:\/\/\S+\.\S+/i.test(booking.trim())) return toast.error("The calendar link must be a full https:// URL");
    setBusy(true);
    const body: Record<string, unknown> = {
      ...Object.fromEntries(LIMITS.map((l) => [l.key, Math.max(0, Math.min(l.max, Math.round(Number(limits[l.key]) || 0)))])),
      country, timezone: tz, active_hours_start: launch, active_hours_end: Math.min(24, launch + SPAN_HOURS),
      working_days: Array.from(days).sort((a, b) => a - b).join(","),
      inbox_contacts_only: contactsOnly, ai_draft_replies: aiDraft, booking_url: booking.trim(), reply_instructions: instructions.trim(),
      proxy_url: proxyUrl, proxy_username: proxyUrl ? proxy.username.trim() : "",
    };
    if (!proxyUrl) body.proxy_password = "";
    else if (proxy.password) body.proxy_password = proxy.password;
    const r = await fetch(`/api/accounts/${accountId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) return toast.error((await r.json().catch(() => ({}))).error ?? "Could not save the account");
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
      <span className="flex items-center gap-2">LinkedIn Account <RiLinkedinBoxFill size={24} className="text-[#0a66c2]" /></span>
      {acc && (
        <span className="font-sans text-[16px] font-normal text-base-content/60">
          {acc.name || acc.email} · <span className={acc.is_authenticated ? "font-medium text-success" : "font-medium text-error"}>{acc.is_authenticated ? "Connected" : "Logged out"}</span>
        </span>
      )}
    </span>
  );
  const field = `${inputCls} !h-12 !text-[16px]`;
  const invites = Number(limits.weekly_connection_limit) || 0;

  return (
    <SideDrawer title={title} onClose={onClose} width={920} footer={
      <div className="flex w-full flex-col gap-3">
        <button type="button" onClick={disconnect} disabled={busy || !acc} className="self-center text-[15.5px] font-medium text-[#4f46e5] hover:underline disabled:opacity-40">Disconnect LinkedIn</button>
        <div className="flex justify-end gap-3 border-t border-[var(--border-subtle)] pt-3">
          <button type="button" className="px-3 text-[15.5px] font-medium text-base-content/70 hover:text-base-content" onClick={onClose}>Cancel</button>
          <button type="button" className={primaryBtn} disabled={busy || !acc} onClick={save}>{busy ? "Saving…" : "Save settings"}</button>
        </div>
      </div>
    }>
      {!acc ? <p className="text-[15px] text-base-content/45">Loading…</p> : (
        <div className="space-y-4">
          <section className="rounded-[14px] border border-[var(--border-subtle)] bg-base-100 p-6">
            <div className="text-[18px] font-semibold text-base-content">Country</div>
            <p className="text-[16px] text-base-content/60">Select the country for this LinkedIn seat</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <select className={`${field} max-w-md`} value={country} onChange={(e) => pickCountry(e.target.value)} aria-label="Country">
                {!country && <option value="">Select a country</option>}
                {COUNTRIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {zones.length > 1 && (
                <select className={`${field} max-w-xs`} value={tz} onChange={(e) => setTz(e.target.value)} aria-label="Time zone">
                  {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
                </select>
              )}
            </div>
            <p className="mt-2 text-[15px] text-base-content/55">Country information helps with localized LinkedIn activities. Schedules follow its time zone ({tz.replace(/_/g, " ")}).</p>
            {savedProxyHost
              ? <p className="mt-3 flex items-center gap-1.5 text-[15.5px] text-base-content/80">This sender is routed through your proxy {savedProxyHost} <RiCheckLine size={18} className="text-success" /></p>
              : <p className="mt-3 text-[15px] text-base-content/50">No proxy: this seat uses the server&apos;s own IP. Add one under Advanced parameters.</p>}
          </section>

          <SettingsSection icon={<RiDashboard3Fill size={24} />} tone="coral" title="Quotas & limits"
            pill={`${usage.connect ?? 0}/${invites} this week`} subtitle="Weekly volume this seat is allowed to send">
            <div className="grid gap-5 sm:grid-cols-3">
              {LIMITS.map((l) => {
                const n = Number(limits[l.key]) || 0;
                return (
                  <label key={l.key} className="block">
                    <span className="flex items-center gap-1.5 text-[17px] font-medium text-base-content">
                      {l.label}
                      {l.usage === "connect" && <Tip text="Invitations are the action LinkedIn watches most closely; it caps them at about 200 a week. Raise this slowly."><RiInformationLine size={17} className="text-base-content/45" /></Tip>}
                    </span>
                    <input type="number" min={0} max={l.max} className={`${field} mt-2`} value={limits[l.key] ?? ""} onChange={(e) => setLimits({ ...limits, [l.key]: Number(e.target.value) })} />
                    <UsageBar used={usage[l.usage] ?? 0} limit={n} label="Used this week" />
                    <span className="text-[13.5px] text-base-content/40">≈ {Math.ceil(n / Math.max(1, activeDays))}/day over {activeDays} active day{activeDays === 1 ? "" : "s"}</span>
                  </label>
                );
              })}
            </div>
            <div className="mt-6 rounded-[12px] bg-[#fbeef0] px-5 py-4">
              <div className="text-[16px] font-semibold text-[#3730a3]">Recommended LinkedIn invitations limits</div>
              <div className="mt-2.5 grid gap-3 sm:grid-cols-3">
                {RECOMMENDED.map(([k, v]) => (
                  <div key={k}><div className="text-[15.5px] text-[#4f46e5]">{k}</div><div className="text-[18px] font-bold text-[#312e81]">{v} <span className="text-[15px] font-normal text-[#4f46e5]">/week</span></div></div>
                ))}
              </div>
              <p className="mt-2.5 text-[15px] text-[#4f46e5]">Start low and increase gradually over the first 2–3 weeks.</p>
            </div>
          </SettingsSection>

          <SettingsSection icon={<RiTimeFill size={24} />} tone="indigo" title="Schedule"
            pill={`${activeDays} active day${activeDays === 1 ? "" : "s"} · ${hourLabel(launch)}`} subtitle="Launch hour and active days for this seat">
            <div className="text-[18px] font-semibold text-base-content">Launch hour</div>
            <p className="text-[16px] text-base-content/60">Select the period of time when this seat should run its activities.</p>
            <LaunchHourSlider value={launch} onChange={setLaunch} span={SPAN_HOURS} />
            <p className="mt-3 text-center text-[17px] text-base-content/75">Selected: From <span className="font-semibold text-primary">{hourLabel(launch)} ({tz})</span></p>
            <p className="mt-1 flex items-center justify-center gap-1.5 text-[15px] text-base-content/50"><RiInformationLine size={16} /> Activities are spread from the selected hour (up to {SPAN_HOURS} hours after)</p>
            <div className="mt-7 text-[18px] font-semibold text-base-content">Active days</div>
            <p className="text-[16px] text-base-content/60">Select which days this seat should be active for LinkedIn activities.</p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {DAY_NAMES.map((d, i) => {
                const n = i + 1; const on = days.has(n);
                return (
                  <label key={d} className={`flex cursor-pointer items-center gap-3.5 rounded-[12px] border px-5 py-4 text-[17px] transition-colors ${on ? "border-primary/45 bg-primary/[0.08]" : "border-[var(--border-subtle)] bg-base-100 hover:border-primary/25"}`}>
                    <input type="checkbox" className="checkbox checkbox-primary" checked={on} onChange={() => { const next = new Set(days); if (on) next.delete(n); else next.add(n); setDays(next); }} />
                    {d}
                  </label>
                );
              })}
            </div>
          </SettingsSection>

          <SettingsSection icon={<RiMagicFill size={24} />} tone="violet" title="Inbox & AI replies" subtitle="Inbox filtering and suggested replies for this seat">
            <div className="space-y-4">
              <OptionCard on={contactsOnly} onToggle={() => setContactsOnly(!contactsOnly)} title="Show only conversations with Kairo contacts"
                hint="Hides LinkedIn conversations with people who are not saved in Kairo." />
              <OptionCard on={aiDraft} onToggle={() => setAiDraft(!aiDraft)} title="AI draft reply" badge="BETA"
                hint="Drafts a reply for every incoming message. Nothing is sent without approval.">
                <fieldset disabled={!aiDraft} className={`mt-5 space-y-4 ${aiDraft ? "" : "opacity-55"}`}>
                  <label className="block">
                    <span className="text-[16.5px] font-medium text-base-content">Calendar link <span className="font-normal text-base-content/45">(optional)</span></span>
                    <input className={`${field} mt-2`} value={booking} onChange={(e) => setBooking(e.target.value)} placeholder="https://calendly.com/your-link" />
                  </label>
                  <label className="block">
                    <span className="text-[16.5px] font-medium text-base-content">AI reply instructions <span className="font-normal text-base-content/45">(optional)</span></span>
                    <textarea className={`${textareaCls} !text-[16px] mt-2 min-h-[120px]`} maxLength={500} value={instructions} onChange={(e) => setInstructions(e.target.value)}
                      placeholder="Example: keep replies short and friendly. If someone shows interest, invite them to book a demo and include the calendar link." />
                    <span className="mt-1 flex justify-between text-[14.5px] text-base-content/45"><span>Tone, product to mention, when to suggest a meeting.</span><span className="tabular-nums">{instructions.length}/500</span></span>
                  </label>
                </fieldset>
              </OptionCard>
            </div>
          </SettingsSection>

          <SettingsSection icon={<RiSettings4Fill size={24} />} tone="success" title="Advanced parameters" pill={savedProxyHost ? `Proxy · ${savedProxyHost}` : "No proxy"} subtitle="Proxy override">
            <div className="text-[18px] font-semibold text-base-content">Proxy override</div>
            <p className="text-[16px] text-base-content/60">Route this LinkedIn seat through your own proxy.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="text-[15.5px] font-medium">Proxy IP</span><input className={`${field} mt-1`} value={proxy.host} onChange={(e) => { setProxy({ ...proxy, host: e.target.value }); setCheck({ state: "idle" }); }} placeholder="e.g. 192.168.1.1" /></label>
              <label className="block"><span className="text-[15.5px] font-medium">Port</span><input className={`${field} mt-1`} inputMode="numeric" value={proxy.port} onChange={(e) => { setProxy({ ...proxy, port: e.target.value.replace(/\D/g, "") }); setCheck({ state: "idle" }); }} placeholder="e.g. 8080" /></label>
              <label className="block"><span className="text-[15.5px] font-medium">Username</span><input className={`${field} mt-1`} value={proxy.username} onChange={(e) => setProxy({ ...proxy, username: e.target.value })} placeholder="Optional" autoComplete="off" /></label>
              <label className="block"><span className="text-[15.5px] font-medium">Password</span><input type="password" className={`${field} mt-1`} value={proxy.password} onChange={(e) => setProxy({ ...proxy, password: e.target.value })} placeholder={acc.has_proxy_password ? "Saved — leave empty to keep" : "Optional"} autoComplete="new-password" /></label>
            </div>
            <div className="mt-3 flex items-center justify-end gap-3">
              {check.state === "ok" && <span className="flex items-center gap-1 text-[15px] text-success"><RiCheckLine size={15} /> {check.text}</span>}
              {check.state === "fail" && <span className="flex items-center gap-1 text-[15px] text-error"><RiCloseLine size={15} /> {check.text}</span>}
              <button type="button" className={`${secondaryBtn} !h-10`} disabled={!proxyUrl || check.state === "checking"} onClick={runCheck}><RiWifiLine size={16} /> {check.state === "checking" ? "Checking…" : "Check"}</button>
            </div>
            <p className="mt-3 flex items-start gap-1.5 rounded-[8px] bg-[#e8a55a]/10 px-3 py-2 text-[14.5px] text-[#b8742a]"><RiGlobalLine size={16} className="mt-0.5 shrink-0" />Changing the proxy changes the IP LinkedIn sees; reconnect the account afterwards so the session is created on the new IP.</p>
          </SettingsSection>
        </div>
      )}
    </SideDrawer>
  );
}
