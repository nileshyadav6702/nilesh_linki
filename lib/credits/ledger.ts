import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { addMonths } from "date-fns";

/**
 * Workspace credits. Every grant, debit and refund is a row in credit_ledger and the balance is
 * their sum, so the usage log and the balance can never disagree. Credits are shared by everyone
 * in the workspace, refill monthly (credits_per_seat x members) and unused credits roll over.
 */

type DB = Database.Database;

/** What each paid action costs. Everything else (discovery, scoring, drafting, sending) is included. */
export const CREDIT_COSTS = {
  email_enrichment: 1, // per email found; refunded when none is found
  lead_import_per: 2, // 1 credit per 2 Sales Navigator leads imported
  engager_import_per: 30, // 1 credit per 30 post engagers imported
  agent_launch: 10, // "Launch now" instead of waiting for the schedule
} as const;

export const DEFAULT_CREDITS_PER_SEAT = 200;

export const LEDGER_TYPES = {
  monthly_grant: "Monthly credits",
  admin_grant: "Credits added",
  purchase: "Credit purchase",
  email_enrichment: "Email enrichment",
  email_enrichment_refund: "Email enrichment refund",
  lead_import: "Lead import",
  engager_import: "Post engager import",
  agent_launch: "Instant agent launch",
  agent_launch_refund: "Instant agent launch refund",
} as const;
export type LedgerType = keyof typeof LEDGER_TYPES;
const GRANTS: LedgerType[] = ["monthly_grant", "admin_grant", "purchase"];

export class InsufficientCreditsError extends Error {
  status = 402;
  constructor(public needed: number, public balance: number) {
    super(`Not enough credits: this needs ${needed} and the workspace has ${balance}. Credits refill monthly.`);
    this.name = "InsufficientCreditsError";
  }
}

export interface BillingRow { workspace_id: string; plan: string; credits_per_seat: number; cycle_start: string; next_refill_at: string; invoice_email: string | null }

const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
export const parseTime = (s: string) => new Date(`${s.replace(" ", "T")}Z`);

export function seats(db: DB, workspaceId: string): number {
  return Math.max(1, (db.prepare("SELECT COUNT(*) n FROM workspace_members WHERE workspace_id = ?").get(workspaceId) as { n: number }).n);
}

export function balance(db: DB, workspaceId: string): number {
  return (db.prepare("SELECT COALESCE(SUM(credits), 0) b FROM credit_ledger WHERE workspace_id = ?").get(workspaceId) as { b: number }).b;
}

function insert(db: DB, workspaceId: string, row: { type: LedgerType; credits: number; userId?: string | null; units?: number | null; refId?: string | null; provider?: string | null; note?: string | null; at?: string }) {
  db.prepare(`INSERT INTO credit_ledger (id, workspace_id, user_id, type, credits, units, ref_id, provider, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`)
    .run(randomUUID(), workspaceId, row.userId ?? null, row.type, row.credits, row.units ?? null, row.refId ?? null, row.provider ?? null, row.note ?? null, row.at ?? null);
}

/**
 * The workspace's billing row, created on first use with its first month of credits, and any
 * monthly refills that came due since (one grant per missed month). Safe to call on every read.
 */
export function ensureBilling(db: DB, workspaceId: string, now = new Date()): BillingRow {
  return db.transaction(() => {
    let row = db.prepare("SELECT * FROM workspace_billing WHERE workspace_id = ?").get(workspaceId) as BillingRow | undefined;
    if (!row) {
      const start = sqlTime(now);
      db.prepare("INSERT INTO workspace_billing (workspace_id, cycle_start, next_refill_at, credits_per_seat) VALUES (?, ?, ?, ?)")
        .run(workspaceId, start, sqlTime(addMonths(now, 1)), DEFAULT_CREDITS_PER_SEAT);
      insert(db, workspaceId, { type: "monthly_grant", credits: DEFAULT_CREDITS_PER_SEAT * seats(db, workspaceId), units: seats(db, workspaceId), at: start });
      row = db.prepare("SELECT * FROM workspace_billing WHERE workspace_id = ?").get(workspaceId) as BillingRow;
    }
    let next = parseTime(row.next_refill_at);
    if (next <= now) {
      let start = next;
      while (next <= now) {
        insert(db, workspaceId, { type: "monthly_grant", credits: row.credits_per_seat * seats(db, workspaceId), units: seats(db, workspaceId), at: sqlTime(next) });
        start = next;
        next = addMonths(next, 1);
      }
      db.prepare("UPDATE workspace_billing SET cycle_start = ?, next_refill_at = ? WHERE workspace_id = ?").run(sqlTime(start), sqlTime(next), workspaceId);
      row = { ...row, cycle_start: sqlTime(start), next_refill_at: sqlTime(next) };
    }
    return row;
  }).immediate();
}

export interface DebitInput { type: LedgerType; credits: number; userId?: string | null; units?: number | null; refId?: string | null; provider?: string | null; note?: string | null }

/**
 * Take credits atomically. Throws InsufficientCreditsError when the balance is short, unless
 * `partial` is set, which takes what is left instead (for work that already happened).
 * Returns how many credits were taken.
 */
export function debit(db: DB, workspaceId: string, input: DebitInput & { partial?: boolean }): number {
  ensureBilling(db, workspaceId);
  if (input.credits <= 0) return 0;
  return db.transaction(() => {
    const have = balance(db, workspaceId);
    let take = input.credits;
    if (have < take) {
      if (!input.partial) throw new InsufficientCreditsError(take, Math.max(0, have));
      take = Math.max(0, have);
    }
    if (take > 0) insert(db, workspaceId, { ...input, credits: -take });
    return take;
  }).immediate();
}

/** Give back credits for work that did not happen ("<type>_refund"). */
export function refund(db: DB, workspaceId: string, type: "email_enrichment" | "agent_launch", credits: number, extra: Omit<DebitInput, "type" | "credits"> = {}): void {
  if (credits > 0) insert(db, workspaceId, { ...extra, type: `${type}_refund`, credits });
}

export function grant(db: DB, workspaceId: string, credits: number, type: "admin_grant" | "purchase", note: string | null = null, userId: string | null = null): void {
  ensureBilling(db, workspaceId);
  if (credits > 0) insert(db, workspaceId, { type, credits, note, userId });
}

export function setInvoiceEmail(db: DB, workspaceId: string, email: string | null): void {
  ensureBilling(db, workspaceId);
  db.prepare("UPDATE workspace_billing SET invoice_email = ? WHERE workspace_id = ?").run(email, workspaceId);
}

export interface BillingSummary {
  plan: string; balance: number; used_this_cycle: number; cycle_start: string; next_refill_at: string;
  next_refill: number; credits_per_seat: number; seats: number; agents: number; invoice_email: string | null;
  costs: typeof CREDIT_COSTS;
}

export function billingSummary(db: DB, workspaceId: string): BillingSummary {
  const row = ensureBilling(db, workspaceId);
  const placeholders = GRANTS.map(() => "?").join(",");
  const spent = (db.prepare(`SELECT COALESCE(SUM(credits), 0) s FROM credit_ledger WHERE workspace_id = ? AND created_at >= ? AND type NOT IN (${placeholders})`)
    .get(workspaceId, row.cycle_start, ...GRANTS) as { s: number }).s;
  const n = seats(db, workspaceId);
  return {
    plan: row.plan, balance: Math.max(0, balance(db, workspaceId)), used_this_cycle: Math.max(0, -spent),
    cycle_start: row.cycle_start, next_refill_at: row.next_refill_at, next_refill: row.credits_per_seat * n,
    credits_per_seat: row.credits_per_seat, seats: n, invoice_email: row.invoice_email, costs: CREDIT_COSTS,
    agents: (db.prepare("SELECT COUNT(*) n FROM agents WHERE workspace_id = ?").get(workspaceId) as { n: number }).n,
  };
}

export interface UsageRow { id: string; type: LedgerType; label: string; credits: number; units: number | null; note: string | null; created_at: string }

export function usagePage(db: DB, workspaceId: string, page: number, pageSize = 10): { rows: UsageRow[]; total: number } {
  ensureBilling(db, workspaceId);
  const total = (db.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE workspace_id = ?").get(workspaceId) as { n: number }).n;
  const rows = (db.prepare(`SELECT id, type, credits, units, note, created_at FROM credit_ledger WHERE workspace_id = ?
    ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`).all(workspaceId, pageSize, Math.max(0, page - 1) * pageSize) as Omit<UsageRow, "label">[])
    .map((r) => ({ ...r, label: LEDGER_TYPES[r.type] ?? r.type }));
  return { rows, total };
}
