import type { Page } from "playwright";

export class WeeklyLimitError extends Error {}
export class AlreadyConnectedError extends Error {}
export class PendingInviteError extends Error {}

/**
 * Sends a LinkedIn connection request, with the note when one is given and LinkedIn allows it.
 * Navigates to the profile page and clicks the Connect button.
 * Throws WeeklyLimitError if the weekly limit popup appears.
 * Throws AlreadyConnectedError / PendingInviteError if already in that state.
 */
export async function sendConnectionRequest(page: Page, linkedinUrl: string, note?: string | null): Promise<{ noteSent: boolean }> {
  await page.goto(linkedinUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000 + Math.random() * 1000);

  // Already connected?
  const pageText = await page.locator(".pv-top-card, .scaffold-layout__main").first().innerText().catch(() => "");
  if (/\b1st\b/.test(pageText)) throw new AlreadyConnectedError("Already connected");

  // Pending?
  if (/\bPending\b/.test(pageText)) throw new PendingInviteError("Invitation already pending");
  const pendingBtn = page.locator('button[aria-label*="Pending"]:visible');
  if (await pendingBtn.count() > 0) throw new PendingInviteError("Invitation already pending");

  // Case 1: Direct Connect link (primary CTA) — navigate to its href directly.
  // Clicking fails because the Sales Nav overlay SVG intercepts pointer events.
  const directConnect = page.locator('a[aria-label*="Invite"][aria-label*="to connect"]:visible, a[href*="custom-invite"]:visible').first();
  if (await directConnect.count() > 0) {
    const href = await directConnect.getAttribute("href");
    if (!href) throw new Error("Connect link has no href");
    const inviteUrl = href.startsWith("http") ? href : `https://www.linkedin.com${href}`;
    await page.goto(inviteUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1000);
  } else {
    // Case 2: Connect is inside the "..." More menu
    // LinkedIn has two "More" buttons on page: [0] = nav bar, [1] = profile card
    const moreBtn = page.locator('button[aria-label="More"]:visible').nth(1);
    await moreBtn.click();
    await page.waitForTimeout(800);

    // Check for Pending in the menu — means invite was already sent
    const pendingMenuItem = page.locator('[role="menuitem"]:has-text("Pending"):visible');
    if (await pendingMenuItem.count() > 0) throw new PendingInviteError("Invitation already pending (found in More menu)");

    const connectOption = page.locator('[role="menuitem"]:has-text("Connect"):visible');
    if (await connectOption.count() === 0) throw new Error("Connect option not found in More menu");
    await connectOption.first().click();
  }

  await page.waitForTimeout(1000);

  // With a note: "Add a note" → type it → "Send". LinkedIn caps notes for free accounts; when the
  // note box doesn't open (quota used up, upsell shown) the invitation still goes out without it.
  let noteSent = false;
  const text = note?.trim().slice(0, 300);
  if (text) {
    const addNote = page.locator('button[aria-label*="Add a note"]:visible, button:has-text("Add a note"):visible').first();
    if (await addNote.count() > 0) {
      await addNote.click({ force: true });
      await page.waitForTimeout(800);
      const box = page.locator('textarea[name="message"]:visible, textarea#custom-message:visible').first();
      if (await box.count() > 0) {
        await box.click();
        await box.pressSequentially(text, { delay: 25 + Math.random() * 25 });
        await page.waitForTimeout(500);
        const send = page.locator('button[aria-label="Send invitation"]:visible, button[aria-label*="Send"]:not([aria-label*="without"]):visible').first();
        if (await send.count() > 0 && await send.isEnabled()) {
          await send.click({ force: true });
          await page.waitForTimeout(1500);
          noteSent = true;
        }
      } else {
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(600);
      }
    }
  }

  if (!noteSent) {
    // Click "Send without a note" / "Send now"
    const sendBtn = page.locator(
      'button:has-text("Send now"), button[aria-label*="Send without"], button[aria-label*="Send invitation"]:not([aria-label*="note"])'
    );
    if (await sendBtn.count() > 0) {
      await sendBtn.first().click({ force: true });
      await page.waitForTimeout(1500);
    }
  }

  // Check for weekly limit popup
  const limitPopup = page.locator('div[class*="ip-fuse-limit-alert__warning"]');
  if (await limitPopup.count() > 0) throw new WeeklyLimitError("Weekly connection limit reached");

  // Check for error toast
  const errorToast = page.locator('div[data-test-artdeco-toast-item-type="error"]:visible');
  if (await errorToast.count() > 0) {
    const msg = await errorToast.innerText();
    throw new Error(`Connection error: ${msg.trim()}`);
  }
  return { noteSent };
}
