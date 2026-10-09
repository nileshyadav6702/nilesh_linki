import type Database from "better-sqlite3";
import type { Agent } from "@/lib/agents/store";
import type { LookalikeLead } from "@/lib/agents/lookalike-rules";
import { ingestSignal } from "@/lib/platform/signals";
import { upsertLead } from "@/lib/signals/leads";

/**
 * Keep the matches the wizard previewed: each becomes a "new" lead on the agent (and in its
 * list) with a lookalike signal. The dedupe key is the one the agent's lookalike source uses
 * for regular-search results, so the source won't add the same person twice.
 */
export function adoptLookalikeLeads(db: Database.Database, agent: Agent, leads: LookalikeLead[]): number {
  let added = 0;
  db.transaction(() => {
    for (const l of leads) {
      const isProfile = !!l.url && /linkedin\.com\/in\//i.test(l.url);
      // Sales Navigator results have no /in/ URL, so upsertLead can't recognise them on a repeat.
      const known = !isProfile && l.url
        ? db.prepare("SELECT id FROM targets WHERE workspace_id = ? AND sales_nav_url = ?").get(agent.workspace_id, l.url) as { id: string } | undefined
        : undefined;
      if (known) db.prepare("UPDATE targets SET agent_id = COALESCE(agent_id, ?), agent_status = COALESCE(agent_status, 'new') WHERE id = ?").run(agent.id, known.id);
      const { targetId, created } = known ? { targetId: known.id, created: false } : upsertLead(db, agent.workspace_id, agent.id, {
        name: l.name, title: l.title, company: l.company, location: l.location, profileImageUrl: l.photo,
        profileUrl: isProfile ? l.url : null, salesNavUrl: isProfile ? null : l.url,
      }, "lookalike");
      if (agent.list_id) db.prepare("INSERT OR IGNORE INTO list_targets (list_id, target_id) VALUES (?, ?)").run(agent.list_id, targetId);
      ingestSignal({
        workspaceId: agent.workspace_id, targetId, agentId: agent.id, type: "lookalike", title: "Looks like your best customer",
        source: "agent:lookalike", sourceUrl: l.url ?? undefined, metadata: { match: l.match }, dedupeKey: `lookalike:${agent.id}:${l.id}`,
      });
      if (created) added++;
    }
  })();
  return added;
}
