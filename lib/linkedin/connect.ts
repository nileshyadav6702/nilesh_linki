import type { Locator, Page } from "playwright";

export class WeeklyLimitError extends Error {}
export class AlreadyConnectedError extends Error {}
export class PendingInviteError extends Error {}
/** LinkedIn wants the person's email before it lets you invite them: not something a retry fixes. */
export class InviteNeedsEmailError extends Error {}
/** The invitation could not be confirmed as sent. Safe to retry: a retry that finds it pending counts it as sent. */
export class InviteNotConfirmedError extends Error {}

export interface ConnectResult {
  noteSent: boolean;
  /** The profile's public URL ("https://www.linkedin.com/in/jane-doe") when LinkedIn redirected to it. */
  publicUrl: string | null;
}

const PENDING_BUTTON = 'main button[aria-label*="Pending"]:visible, main button:has-text("Pending"):visible';
const SEND_BUTTON = /^(Send without a note|Send now|Send|Send invitation)$/i;

/** The profile's public URL from the page we landed on, when it's a public handle (not an ACoAA id). */
function publicUrlOf(page: Page): string | null {
  const m = page.url().match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!m || /^ACo[A-Za-z0-9_-]{20,}$/.test(m[1])) return null;
  return `https://www.linkedin.com/in/${decodeURIComponent(m[1]).toLowerCase()}/`;
}

/** The profile card's own "More" button (the nav bar has one too). */
function profileMore(page: Page): Locator {
  return page.locator('main button[aria-label="More"]:visible').first();
}

/** Pending shown on the profile: as the main button, or inside the More menu. Leaves the menu closed. */
async function showsPending(page: Page): Promise<boolean> {
  if (await page.locator(PENDING_BUTTON).count()) return true;
  const more = profileMore(page);
  if (!(await more.count())) return false;
  await more.click().catch(() => {});
  await page.waitForTimeout(700);
  const pending = await page.locator('[role="menuitem"]:visible').filter({ hasText: /Pending|Withdraw/i }).count();
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
  return pending > 0;
}

/**
 * Sends a LinkedIn connection request (with the note when one is given and LinkedIn allows it),
 * and only returns once LinkedIn shows the invitation as pending. Every wait is for the element
 * itself, not a fixed delay: a dialog that opens slowly used to be missed, the send skipped and
 * the invitation still recorded as sent.
 *
 * Throws AlreadyConnectedError / PendingInviteError when already in that state, WeeklyLimitError
 * on the weekly limit, InviteNeedsEmailError when LinkedIn asks for an email, and
 * InviteNotConfirmedError when the send can't be confirmed (retryable).
 */
export async function sendConnectionRequest(page: Page, linkedinUrl: string, note?: string | null): Promise<ConnectResult> {
  await page.goto(linkedinUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator("main").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500 + Math.random() * 1000);
  const publicUrl = publicUrlOf(page);

  // Already connected / already invited?
  const topCard = await page.locator(".pv-top-card, .scaffold-layout__main").first().innerText().catch(() => "");
  if (/\b1st\b/.test(topCard)) throw new AlreadyConnectedError("Already connected");
  if (await page.locator(PENDING_BUTTON).count()) throw new PendingInviteError("Invitation already pending");

  // Open the invitation: a direct Connect button/link on the card, else Connect in the "More" menu.
  const direct = page.locator('main a[aria-label*="Invite"][aria-label*="to connect"]:visible, main a[href*="custom-invite"]:visible, main button[aria-label*="Invite"][aria-label*="to connect"]:visible').first();
  if (await direct.count()) {
    const href = await direct.getAttribute("href");
    if (href) await page.goto(href.startsWith("http") ? href : `https://www.linkedin.com${href}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    else await direct.click();
  } else {
    const more = profileMore(page);
    if (!(await more.count())) throw new InviteNotConfirmedError("No Connect button or More menu on the profile");
    await more.click();
    const menu = page.locator('[role="menuitem"]:visible');
    await menu.first().waitFor({ timeout: 8000 }).catch(() => {});
    if (await menu.filter({ hasText: /Pending|Withdraw/i }).count()) {
      await page.keyboard.press("Escape").catch(() => {});
      throw new PendingInviteError("Invitation already pending (found in More menu)");
    }
    const connect = menu.filter({ hasText: /^\s*Connect\s*$/ }).first();
    if (!(await connect.count())) {
      await page.keyboard.press("Escape").catch(() => {});
      throw new InviteNotConfirmedError("Connect is not offered for this profile (LinkedIn may only allow Follow)");
    }
    await connect.click();
  }

  // Wait for the invitation dialog itself.
  const dialog = page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').last();
  try {
    await dialog.waitFor({ timeout: 12000 });
  } catch {
    if (await showsPending(page)) return { noteSent: false, publicUrl }; // some layouts send straight away
    throw new InviteNotConfirmedError("The invitation dialog did not open");
  }
  const dialogText = await dialog.innerText().catch(() => "");
  if (/enter (their|the member's) email|to verify this member knows you/i.test(dialogText)) {
    await page.keyboard.press("Escape").catch(() => {});
    throw new InviteNeedsEmailError("LinkedIn asks for this person's email before inviting");
  }

  // With a note: "Add a note" → type it → "Send". LinkedIn caps notes for free accounts; when the
  // note box doesn't open (quota used up, upsell shown) the invitation still goes out without it.
  let noteSent = false;
  const text = note?.trim().slice(0, 300);
  if (text) {
    const addNote = dialog.getByRole("button", { name: /Add a note/i });
    if (await addNote.count()) {
      await addNote.first().click();
      const box = page.locator('textarea[name="message"]:visible, textarea#custom-message:visible').first();
      if (await box.waitFor({ timeout: 6000 }).then(() => true, () => false)) {
        await box.click();
        await box.pressSequentially(text, { delay: 25 + Math.random() * 25 });
        await page.waitForTimeout(400);
        const send = page.locator('[role="dialog"]:visible').getByRole("button", { name: /^Send( invitation)?$/i }).first();
        if (await send.waitFor({ timeout: 5000 }).then(() => true, () => false) && await send.isEnabled()) {
          await send.click();
          noteSent = true;
        }
      }
      if (!noteSent) {
        // Upsell instead of a note box (free accounts get a few notes a month): close it and
        // send the invitation without a note, from a fresh profile load.
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(600);
        const plain = await sendConnectionRequest(page, linkedinUrl, null);
        return { noteSent: false, publicUrl: plain.publicUrl ?? publicUrl };
      }
    }
  }

  if (!noteSent) {
    const send = dialog.getByRole("button", { name: SEND_BUTTON }).first();
    try {
      await send.waitFor({ timeout: 8000 });
    } catch {
      await page.keyboard.press("Escape").catch(() => {});
      throw new InviteNotConfirmedError("No Send button in the invitation dialog");
    }
    try { await send.click({ timeout: 5000 }); } catch { await send.click({ force: true }); }
  }

  // The dialog closes once LinkedIn accepts the request.
  await page.locator('[role="dialog"]:visible').filter({ hasText: /Send without a note|Add a note|Send invitation/i }).first()
    .waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1200);

  if (await page.locator('div[class*="ip-fuse-limit-alert__warning"], [role="dialog"]:has-text("weekly invitation limit")').count()) {
    throw new WeeklyLimitError("Weekly connection limit reached");
  }
  const errorToast = page.locator('div[data-test-artdeco-toast-item-type="error"]:visible');
  if (await errorToast.count()) throw new InviteNotConfirmedError(`LinkedIn error: ${(await errorToast.innerText()).trim()}`);

  // Confirm: the profile must now show the invitation as pending (reload once if it hasn't caught up).
  if (await showsPending(page)) return { noteSent, publicUrl };
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.locator("main").first().waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  if (await showsPending(page)) return { noteSent, publicUrl };
  throw new InviteNotConfirmedError("LinkedIn does not show the invitation as pending");
}
