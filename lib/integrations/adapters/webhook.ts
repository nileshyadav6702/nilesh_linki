import { createHmac } from "crypto";
import { assertPublicWebhookTarget, postWebhook } from "@/lib/platform/events";
import { IntegrationError, type Adapter, type Config, type Lead, type Reply } from "@/lib/integrations/types";

/**
 * Webhook (any URL, per trigger) and Clay (one webhook URL). Bodies are JSON; with a signing
 * secret each request carries x-kairo-signature: sha256=HMAC(secret, "<timestamp>.<body>").
 * URLs must resolve to public addresses (same guard as workspace webhooks).
 */

export type Trigger = "lead" | "reply";
export interface Hook { url: string; trigger: Trigger }

export function webhookList(cfg: Config): Hook[] {
  try {
    const list = JSON.parse(cfg.webhooks ?? "[]") as Hook[];
    return Array.isArray(list) ? list.filter((h) => typeof h?.url === "string" && (h.trigger === "lead" || h.trigger === "reply")) : [];
  } catch { return []; }
}

const leadJson = (l: Lead) => ({
  id: l.id, first_name: l.first_name, last_name: l.last_name, full_name: l.full_name, email: l.email, title: l.title, headline: l.headline,
  company: l.company, company_domain: l.company_domain, linkedin_url: l.linkedin_url, phone: l.phone, location: l.location, lead_score: l.lead_score, agent: l.agent,
});

async function post(url: string, event: string, data: unknown, secret?: string): Promise<void> {
  let target: URL;
  try { target = await assertPublicWebhookTarget(url); } catch { throw new IntegrationError("The webhook URL must be a public http(s) address", true); }
  const body = JSON.stringify({ event, sent_at: new Date().toISOString(), data });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "Kairo-Integrations/1.0", "x-kairo-event": event, "x-kairo-timestamp": timestamp };
  if (secret) headers["x-kairo-signature"] = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
  let res: { status: number; text: string };
  try { res = await postWebhook(target, headers, body); } catch (err) { throw new IntegrationError(`Webhook unreachable: ${err instanceof Error ? err.message : String(err)}`); }
  if (res.status >= 200 && res.status < 300) return;
  throw new IntegrationError(`Webhook answered ${res.status}`, res.status >= 400 && res.status < 500 && res.status !== 429, res.status);
}

export const webhook: Adapter = {
  async verify(cfg) {
    const hooks = webhookList(cfg);
    if (!hooks.length) throw new IntegrationError("Add at least one webhook URL", true);
    for (const h of hooks) { try { await assertPublicWebhookTarget(h.url); } catch { throw new IntegrationError(`${h.url} is not a public http(s) address`, true); } }
    return {};
  },
  async pushContact(cfg, lead) {
    for (const h of webhookList(cfg).filter((x) => x.trigger === "lead")) await post(h.url, "lead.created", { lead: leadJson(lead) }, cfg.secret);
    return null;
  },
  async addReply(cfg, lead, reply: Reply) {
    for (const h of webhookList(cfg).filter((x) => x.trigger === "reply")) await post(h.url, "lead.replied", { lead: leadJson(lead), reply }, cfg.secret);
    return null;
  },
};

export const clay: Adapter = {
  async verify(cfg) {
    if (!cfg.webhook_url) throw new IntegrationError("Enter your Clay webhook URL", true);
    try { await assertPublicWebhookTarget(cfg.webhook_url); } catch { throw new IntegrationError("The Clay webhook URL must be a public https address", true); }
    return {};
  },
  async pushContact(cfg, lead) {
    // Clay maps top-level keys to table columns, so the lead goes flat.
    if (!cfg.webhook_url) throw new IntegrationError("Clay webhook URL is missing", true);
    let target: URL;
    try { target = await assertPublicWebhookTarget(cfg.webhook_url); } catch { throw new IntegrationError("The Clay webhook URL must be a public https address", true); }
    const res = await postWebhook(target, { "content-type": "application/json", "user-agent": "Kairo-Integrations/1.0" }, JSON.stringify(leadJson(lead)))
      .catch((err) => { throw new IntegrationError(`Clay unreachable: ${err instanceof Error ? err.message : String(err)}`); });
    if (res.status < 200 || res.status >= 300) throw new IntegrationError(`Clay answered ${res.status}`, res.status >= 400 && res.status < 500 && res.status !== 429, res.status);
    return null;
  },
};
