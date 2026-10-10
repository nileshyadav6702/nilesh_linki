import type { Page } from "playwright";
import { assertSignedIn } from "@/lib/linkedin/session-guard";
import { profileDegree } from "@/lib/linkedin/profile-degree";

export type WithdrawOutcome = "withdrawn" | "connected" | "not_pending";

/**
 * Withdraws a pending invitation from the contact's profile: the "Pending" button (on the
 * profile card or in its "More" menu), then "Withdraw" in the confirmation dialog.
 */
export async function withdrawInvitation(page: Page, linkedinUrl: string): Promise<WithdrawOutcome> {
  await page.goto(linkedinUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await assertSignedIn(page);
  await page.waitForTimeout(2000 + Math.random() * 1500);
  if (/\/(login|checkpoint|authwall)/.test(page.url())) throw new Error("LinkedIn session is not signed in");

  if ((await profileDegree(page)) === 1) return "connected";

  let pending = page.locator('button[aria-label*="Pending"]:visible').first();
  if (await pending.count() === 0) {
    const more = page.locator('button[aria-label="More"]:visible').nth(1);
    if (await more.count() > 0) {
      await more.click();
      await page.waitForTimeout(800);
      pending = page.locator('[role="menuitem"]:has-text("Pending"):visible, [role="button"]:has-text("Withdraw"):visible').first();
    }
  }
  if (await pending.count() === 0) return "not_pending";
  await pending.click({ force: true });
  await page.waitForTimeout(1000);

  const confirm = page.locator('button:has-text("Withdraw"):visible, button[aria-label*="Withdraw"]:visible').last();
  if (await confirm.count() === 0) throw new Error("Withdraw confirmation did not appear");
  await confirm.click({ force: true });
  await page.waitForTimeout(1500);
  return "withdrawn";
}
