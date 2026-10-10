import type { Locator, Page } from "playwright";
import { partDelayMs } from "@/lib/linkedin/split-message";

/** The recipient could not be reached safely (no Message button, no unique name match): nothing was sent. */
export class RecipientNotFoundError extends Error {
  constructor(message: string) { super(message); this.name = "RecipientNotFoundError"; }
}

/**
 * Something may have gone out but could not be confirmed (send clicked, thread didn't show it;
 * or a later part of a split message failed). Recorded as 'uncertain': never re-sent automatically.
 */
export class MessageMaybeSentError extends Error {
  constructor(message: string) { super(message); this.name = "MessageMaybeSentError"; }
}

export interface Recipient {
  fullName: string;
  /** linkedin.com/in/… profile URL: the conversation is opened from it, so it reaches this person. */
  profileUrl?: string | null;
}

const COMPOSER = "div.msg-form__contenteditable";
const SEND_BUTTON = "button.msg-form__send-button";
const normalize = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** Put `text` in the composer: paste (clipboard), else type it. Verifies the composer holds it. */
async function typeInto(page: Page, input: Locator, text: string): Promise<void> {
  await input.click();
  try {
    await page.evaluate((t) => navigator.clipboard.writeText(t), text);
    await input.press("Control+V");
  } catch {
    // Clipboard blocked in headless — fall back to keyboard typing.
    await input.pressSequentially(text, { delay: 20 });
  }
  const head = normalize(text).slice(0, 40);
  try {
    await page.waitForFunction(({ sel, head }) => {
      const el = Array.from(document.querySelectorAll(sel)).pop() as HTMLElement | undefined;
      const t = (el?.innerText ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
      return t.includes(head);
    }, { sel: COMPOSER, head }, { timeout: 5000 });
  } catch {
    // A paste that silently did nothing: type it instead, once.
    await input.pressSequentially(text, { delay: 20 });
  }
}

/** Open the conversation from the person's own profile ("Message" button): reaches exactly them. */
async function openFromProfile(page: Page, profileUrl: string): Promise<boolean> {
  await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  const main = page.locator("main").first();
  await main.waitFor({ timeout: 15000 });
  const direct = main.locator('button[aria-label^="Message"], a[aria-label^="Message"], button:has-text("Message"), a:has-text("Message")').first();
  if (await direct.isVisible({ timeout: 6000 }).catch(() => false)) {
    await direct.click({ delay: 80 });
    await page.locator(COMPOSER).last().waitFor({ timeout: 15000 });
    return true;
  }
  return false;
}

/**
 * Fallback without a profile URL (Sales Navigator-only leads): search the name in a new thread
 * and pick a result only when exactly one has exactly this name. Ambiguity sends nothing.
 */
async function openBySearch(page: Page, fullName: string): Promise<void> {
  await page.goto("https://www.linkedin.com/messaging/thread/new/", { waitUntil: "domcontentloaded", timeout: 30000 });
  const searchField = page.locator("input.msg-connections-typeahead__search-field").first();
  await searchField.waitFor({ timeout: 15000 });
  await searchField.click();
  await searchField.pressSequentially(fullName, { delay: 60 + Math.random() * 40 });
  const rows = page.locator('div[class*="msg-connections-typeahead__search-result-row"]');
  const want = normalize(fullName);
  // Wait for results that reflect the whole name, not a partial query still on screen.
  await page.waitForFunction(({ want }) => {
    const rs = Array.from(document.querySelectorAll('div[class*="msg-connections-typeahead__search-result-row"]'));
    return rs.some((r) => ((r as HTMLElement).innerText ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(want.split(" ")[0]));
  }, { want }, { timeout: 10000 }).catch(() => {});
  const names = await rows.evaluateAll((els) => els.map((e) => ((e as HTMLElement).innerText ?? "").split("\n")[0] ?? ""));
  const matches = names.map((n, i) => ({ n: normalize(n), i })).filter((x) => x.n === want);
  if (matches.length !== 1) {
    throw new RecipientNotFoundError(matches.length
      ? `${matches.length} connections are named "${fullName}"; not guessing which one`
      : `No connection named "${fullName}" in the message search`);
  }
  await rows.nth(matches[0].i).click({ delay: 100 });
  await page.locator(COMPOSER).last().waitFor({ timeout: 10000 });
}

/** Wait until the thread shows our message (its opening words) as the newest outgoing event. */
async function confirmSent(page: Page, text: string | null): Promise<boolean> {
  const head = text ? normalize(text).slice(0, 30) : null;
  try {
    await page.waitForFunction(({ head, sel }) => {
      const composer = Array.from(document.querySelectorAll(sel)).pop() as HTMLElement | undefined;
      const empty = !composer || !(composer.innerText ?? "").trim();
      if (!head) return empty;
      const bodies = Array.from(document.querySelectorAll(".msg-s-event-listitem__body, .msg-s-message-list__event"));
      const last = bodies.slice(-3).map((b) => ((b as HTMLElement).innerText ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").toLowerCase());
      return empty && last.some((t) => t.includes(head));
    }, { head, sel: COMPOSER }, { timeout: 12000 });
    return true;
  } catch { return false; }
}

async function clickSend(page: Page): Promise<void> {
  const sendBtn = page.locator(`${SEND_BUTTON}:visible`).last();
  await sendBtn.waitFor({ timeout: 8000 });
  await sendBtn.click({ delay: 100 });
}

/**
 * Send a LinkedIn message to a 1st-degree connection. The conversation is opened from the
 * person's profile; without a profile URL, from a unique exact-name search result. Every part is
 * confirmed in the thread; once anything may have gone out, failures are MessageMaybeSentError.
 */
export async function sendMessage(page: Page, recipient: Recipient, text: string, opts: { attachmentPath?: string; parts?: string[] } = {}): Promise<void> {
  const viaProfile = recipient.profileUrl && /linkedin\.com\/in\//i.test(recipient.profileUrl)
    ? await openFromProfile(page, recipient.profileUrl) : false;
  if (!viaProfile) await openBySearch(page, recipient.fullName);

  const input = page.locator(COMPOSER).last();
  const parts = opts.parts && opts.parts.length > 1 ? opts.parts : text ? [text] : [];
  let sentAny = false;
  try {
    for (let i = 0; i < parts.length; i++) {
      const last = i === parts.length - 1;
      await typeInto(page, input, parts[i]);
      if (last && opts.attachmentPath) break; // the attachment goes with the last part
      await clickSend(page);
      sentAny = true;
      if (!(await confirmSent(page, parts[i]))) throw new MessageMaybeSentError("LinkedIn did not show the message in the thread after sending");
      if (!last) await page.waitForTimeout(partDelayMs());
    }
    if (opts.attachmentPath) {
      const fileInput = page.locator('.msg-form input[type="file"], form.msg-form__form input[type="file"]').last();
      if (await fileInput.count() === 0) throw new Error("Message composer has no file attachment input");
      await fileInput.setInputFiles(opts.attachmentPath);
      // The send button turns enabled once the attachment has uploaded.
      await page.locator(`${SEND_BUTTON}:enabled`).last().waitFor({ timeout: 30000 });
      await clickSend(page);
      sentAny = true;
      if (!(await confirmSent(page, null))) throw new MessageMaybeSentError("LinkedIn did not clear the composer after sending the voice message");
    }
  } catch (err) {
    if (sentAny && !(err instanceof MessageMaybeSentError)) {
      throw new MessageMaybeSentError(`Part of the message went out before an error: ${err instanceof Error ? err.message : String(err)}`);
    }
    throw err;
  }
}
