import { getDb } from "@/lib/db";
import { addMessages, upsertThread } from "@/lib/inbox/store";
import { messagesPath, messagesQueryId, parseConversations, parseMessages, type ParsedConversation } from "@/lib/inbox/linkedin-parse";

/**
 * Pull a LinkedIn account's conversations into the unified inbox: open /messaging/ the way a
 * person would (the page loads the conversation list), scroll for older ones, then fetch the
 * messages of conversations with new activity through the same GraphQL query the page used.
 * Runs on the account's session lease, so it never overlaps outreach on the same account.
 */

const MAX_MESSAGE_FETCHES = 15;
const SCROLLS = 2;

export async function syncLinkedInInbox(accountId: string): Promise<{ threads: number; messages: number }> {
  const db = getDb();
  const account = db.prepare("SELECT id, workspace_id, is_authenticated FROM accounts WHERE id = ?").get(accountId) as { id: string; workspace_id: string; is_authenticated: number } | undefined;
  if (!account?.is_authenticated) return { threads: 0, messages: 0 };
  const { withAccountSession } = await import("@/lib/linkedin/account-session");
  const { getSessionContext, saveSessionState } = await import("@/lib/linkedin/session");
  const { VoyagerClient } = await import("@/lib/linkedin/voyager");
  const { consume } = await import("@/lib/linkedin/budget");
  const { linkedInImageUrl } = await import("@/lib/linkedin/images");

  const changedIds: string[] = [];
  const result = await withAccountSession(accountId, async () => {
    const ctx = await getSessionContext(accountId);
    const captured: Array<{ url: string; body: string }> = [];
    let convs: ParsedConversation[] = [];
    const page = await ctx.newPage();
    try {
      if (!consume(accountId, "voyager_read")) throw new Error("Daily LinkedIn read budget reached");
      const pending: Array<Promise<void>> = [];
      page.on("response", (r) => {
        if (!/voyagerMessagingGraphQL/.test(r.url()) || r.status() !== 200) return;
        pending.push(r.text().then((t) => { captured.push({ url: r.url(), body: t }); }, () => {}));
      });
      await page.goto("https://www.linkedin.com/messaging/", { waitUntil: "domcontentloaded", timeout: 30000 });
      if (/\/(login|checkpoint|authwall)/.test(page.url())) throw new Error("LinkedIn needs you to sign in again");
      await page.waitForTimeout(6000 + Math.random() * 2000);
      for (let i = 0; i < SCROLLS; i++) {
        await page.mouse.move(250, 500);
        await page.mouse.wheel(0, 3000);
        await page.waitForTimeout(2500 + Math.random() * 1500);
      }
      await Promise.all(pending);
    } finally {
      await page.close().catch(() => {});
    }
    for (const c of captured.filter((x) => /messengerConversations/.test(x.url))) {
      try { convs.push(...parseConversations(JSON.parse(c.body))); } catch { /* not JSON */ }
    }
    convs = [...new Map(convs.map((c) => [c.externalId, c])).values()];
    const queryId = messagesQueryId(captured.map((c) => c.url));

    let messages = 0;
    const changed: Array<{ id: string; conv: ParsedConversation }> = [];
    for (const c of convs) {
      const t = upsertThread(db, {
        workspaceId: account.workspace_id, channel: "linkedin", accountId, externalId: c.externalId, url: c.url, subject: c.title,
        participantName: c.other?.name ?? c.title ?? "LinkedIn", participantHeadline: c.other?.headline, participantUrl: c.other?.url,
        participantPhoto: c.other ? linkedInImageUrl(c.other.photo, 100) : null, snippet: c.preview?.bodyText ?? null, lastMessageAt: c.lastActivityAt, unread: c.unread,
      });
      // The list already carries each conversation's latest message.
      if (c.preview) messages += addMessages(db, t.id, [c.preview]);
      if (t.changed) { changed.push({ id: t.id, conv: c }); changedIds.push(t.id); }
    }
    // Full history for conversations with new activity, a few per run (each costs a LinkedIn read).
    if (queryId && changed.length) {
      const client = new VoyagerClient(ctx, accountId);
      try {
        for (const { id, conv } of changed.slice(0, MAX_MESSAGE_FETCHES)) {
          const json = await client.get(messagesPath(queryId, conv.entityUrn), { accept: "application/graphql" }).catch(() => null);
          if (json) messages += addMessages(db, id, parseMessages(json));
        }
      } finally { await client.close(); }
    }
    await saveSessionState(accountId).catch(() => {});
    db.prepare("UPDATE accounts SET inbox_synced_at = datetime('now') WHERE id = ?").run(accountId);
    return { threads: convs.length, messages };
  });
  // Drafted after the session is released: AI calls shouldn't hold the account's browser lease.
  const { draftPendingReplies } = await import("@/lib/inbox/ai-draft");
  await draftPendingReplies(db, accountId, changedIds).catch((err) => console.warn("[inbox] AI drafts:", err instanceof Error ? err.message : err));
  return result;
}

/** Older messages of one conversation, on demand when it is opened in the inbox. */
export async function fetchLinkedInThread(threadId: string): Promise<number> {
  const db = getDb();
  const t = db.prepare("SELECT account_id, external_id, url FROM inbox_threads WHERE id = ? AND channel = 'linkedin'").get(threadId) as { account_id: string; external_id: string; url: string | null } | undefined;
  if (!t?.url) return 0;
  const { withAccountSession } = await import("@/lib/linkedin/account-session");
  const { getSessionContext, saveSessionState } = await import("@/lib/linkedin/session");
  const { consume } = await import("@/lib/linkedin/budget");
  return withAccountSession(t.account_id, async () => {
    if (!consume(t.account_id, "voyager_read")) return 0;
    const ctx = await getSessionContext(t.account_id);
    const page = await ctx.newPage();
    const bodies: string[] = [];
    const pending: Array<Promise<void>> = [];
    page.on("response", (r) => {
      if (!/messengerMessages/.test(r.url()) || r.status() !== 200) return;
      pending.push(r.text().then((x) => { bodies.push(x); }, () => {}));
    });
    try {
      await page.goto(t.url!, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(5000 + Math.random() * 1500);
      await Promise.all(pending);
    } finally { await page.close().catch(() => {}); await saveSessionState(t.account_id).catch(() => {}); }
    let added = 0;
    for (const b of bodies) { try { added += addMessages(db, threadId, parseMessages(JSON.parse(b))); } catch { /* not JSON */ } }
    return added;
  });
}

/** Reply inside an existing conversation from the account's own session. */
export async function sendLinkedInReply(threadId: string, body: string): Promise<void> {
  const db = getDb();
  const t = db.prepare("SELECT account_id, url FROM inbox_threads WHERE id = ? AND channel = 'linkedin'").get(threadId) as { account_id: string; url: string | null } | undefined;
  if (!t?.url) throw new Error("This conversation has no LinkedIn link");
  const { withAccountSession } = await import("@/lib/linkedin/account-session");
  const { getSessionPage, saveSessionState } = await import("@/lib/linkedin/session");
  await withAccountSession(t.account_id, async () => {
    const page = await getSessionPage(t.account_id);
    try {
      await page.goto(t.url!, { waitUntil: "domcontentloaded", timeout: 30000 });
      const input = page.locator("div.msg-form__contenteditable").first();
      await input.waitFor({ timeout: 15000 });
      await input.click();
      // Enter sends on LinkedIn: break lines with Shift+Enter.
      const lines = body.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (i) await page.keyboard.press("Shift+Enter");
        if (lines[i]) await input.pressSequentially(lines[i], { delay: 15 });
      }
      await page.waitForTimeout(500);
      await page.locator("button.msg-form__send-button:visible").first().click({ delay: 80 });
      await page.waitForTimeout(2000);
    } finally { await page.close().catch(() => {}); await saveSessionState(t.account_id).catch(() => {}); }
  });
}
