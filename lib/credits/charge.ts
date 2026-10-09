import type Database from "better-sqlite3";
import { enrichTargetEmail, type Provider, type WaterfallResult } from "@/lib/enrichment/waterfall";
import { balance, CREDIT_COSTS, debit, ensureBilling, refund } from "@/lib/credits/ledger";

/** Paid actions: take the credits first, give them back when the work does not pay off. */

type DB = Database.Database;

/**
 * Email lookup for one contact: 1 credit, refunded when nothing is found or the lookup fails.
 * Contacts that already have an email are skipped for free. Throws InsufficientCreditsError.
 */
export async function findEmailCharged(db: DB, workspaceId: string, targetId: string, userId: string | null = null, providers?: Provider[]): Promise<WaterfallResult | null> {
  const t = db.prepare("SELECT email FROM targets WHERE id = ? AND workspace_id = ?").get(targetId, workspaceId) as { email: string | null } | undefined;
  if (!t || t.email) return null;
  const cost = CREDIT_COSTS.email_enrichment;
  debit(db, workspaceId, { type: "email_enrichment", credits: cost, userId, units: 1, refId: targetId });
  let r: WaterfallResult | null;
  try {
    r = await enrichTargetEmail(db, workspaceId, targetId, providers);
  } catch (err) {
    refund(db, workspaceId, "email_enrichment", cost, { userId, units: 1, refId: targetId });
    throw err;
  }
  if (!r) refund(db, workspaceId, "email_enrichment", cost, { userId, units: 1, refId: targetId });
  else db.prepare("UPDATE credit_ledger SET provider = ? WHERE id = (SELECT id FROM credit_ledger WHERE workspace_id = ? AND ref_id = ? AND type = 'email_enrichment' ORDER BY created_at DESC, rowid DESC LIMIT 1)")
    .run(r.provider, workspaceId, targetId);
  return r;
}

/** Credits for leads already imported: 1 per `per` leads, rounded up; takes what is left if short. */
export function chargeImport(db: DB, workspaceId: string, type: "lead_import" | "engager_import", imported: number, refId: string | null, userId: string | null = null): number {
  if (imported <= 0) return 0;
  const per = type === "lead_import" ? CREDIT_COSTS.lead_import_per : CREDIT_COSTS.engager_import_per;
  return debit(db, workspaceId, { type, credits: Math.ceil(imported / per), units: imported, refId, userId, partial: true });
}

/** How many leads the balance pays for (imports stop at this). */
export function leadsAffordable(db: DB, workspaceId: string, type: "lead_import" | "engager_import"): number {
  ensureBilling(db, workspaceId);
  const per = type === "lead_import" ? CREDIT_COSTS.lead_import_per : CREDIT_COSTS.engager_import_per;
  return Math.max(0, balance(db, workspaceId)) * per;
}
