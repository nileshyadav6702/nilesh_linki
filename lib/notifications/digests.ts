import type Database from "better-sqlite3";

export interface CampaignDigest {
  /** Local calendar day (YYYY-MM-DD) in the workspace's sending timezone. */
  day: string;
  today: boolean;
  /** ISO time of the day's last outreach action. */
  at: string;
  leads: number; messages: number; invites: number; visits: number; emails: number;
}

const iso = (s: string) => (/[TZ]/.test(s) ? s : `${s.replace(" ", "T")}Z`);

function localDay(at: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
  } catch {
    return at.slice(0, 10);
  }
}

/**
 * One summary per day of outreach the workspace's campaigns actually did (LinkedIn actions that
 * went out, campaign emails accepted), for the last `days` days: distinct leads touched and how
 * many messages, invitations, profile visits and emails. Days are the sending accounts' days
 * (their timezone), so an evening batch isn't split across two entries.
 */
export function campaignDigests(db: Database.Database, workspaceId: string, days = 14): CampaignDigest[] {
  const tz = (db.prepare(`SELECT timezone FROM accounts WHERE workspace_id = ? AND timezone IS NOT NULL
      UNION ALL SELECT timezone FROM email_accounts WHERE workspace_id = ? AND timezone IS NOT NULL LIMIT 1`).get(workspaceId, workspaceId) as { timezone: string } | undefined)?.timezone ?? "UTC";
  const since = `-${days + 1} days`;
  const linkedin = db.prepare(`SELECT la.type, la.target_id, la.created_at at FROM linkedin_actions la JOIN accounts a ON a.id = la.account_id
    WHERE a.workspace_id = ? AND la.status = 'sent' AND la.type IN ('connect','message','voice','inmail','visit','like')
      AND la.created_at >= datetime('now', ?)`).all(workspaceId, since) as Array<{ type: string; target_id: string | null; at: string }>;
  const emails = db.prepare(`SELECT sm.target_id, sm.accepted_at at FROM sent_messages sm JOIN email_jobs ej ON ej.id = sm.job_id
    WHERE sm.workspace_id = ? AND ej.source = 'campaign' AND sm.accepted_at >= datetime('now', ?)`).all(workspaceId, since) as Array<{ target_id: string | null; at: string }>;

  const byDay = new Map<string, CampaignDigest & { leadSet: Set<string> }>();
  const bucket = (at: string) => {
    const when = iso(at);
    const day = localDay(when, tz);
    let d = byDay.get(day);
    if (!d) { d = { day, today: false, at: when, leads: 0, messages: 0, invites: 0, visits: 0, emails: 0, leadSet: new Set() }; byDay.set(day, d); }
    if (Date.parse(when) > Date.parse(d.at)) d.at = when;
    return d;
  };
  for (const a of linkedin) {
    const d = bucket(a.at);
    if (a.target_id) d.leadSet.add(a.target_id);
    if (a.type === "connect") d.invites++;
    else if (a.type === "visit" || a.type === "like") d.visits++;
    else d.messages++;
  }
  for (const e of emails) {
    const d = bucket(e.at);
    if (e.target_id) d.leadSet.add(e.target_id);
    d.emails++;
  }

  const today = localDay(new Date().toISOString(), tz);
  return [...byDay.values()]
    .map(({ leadSet, ...d }) => ({ ...d, leads: leadSet.size, today: d.day === today }))
    .filter((d) => d.leads > 0)
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .slice(0, days);
}
