import type { Page } from "playwright";
import { assertSignedIn } from "@/lib/linkedin/session-guard";

/**
 * Likes up to `count` of the contact's most recent posts from their activity page.
 * Already-liked posts are skipped (never un-liked). Returns how many were liked now —
 * 0 when the contact has no recent posts, which is not an error.
 */
export async function likeRecentPosts(page: Page, linkedinUrl: string, count: number): Promise<number> {
  const base = linkedinUrl.replace(/[?#].*$/, "").replace(/\/+$/, "");
  await page.goto(`${base}/recent-activity/all/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await assertSignedIn(page);
  await page.waitForTimeout(2500 + Math.random() * 1500);
  if (/\/(login|checkpoint|authwall)/.test(page.url())) throw new Error("LinkedIn session is not signed in");

  // The reaction button on each feed card. aria-pressed="false" = not reacted yet.
  const likeButtons = page.locator('button.react-button__trigger[aria-pressed="false"]:visible, button[aria-label^="React Like"][aria-pressed="false"]:visible');
  let liked = 0;
  for (let attempt = 0; attempt < count + 2 && liked < count; attempt++) {
    const btn = likeButtons.first();
    if (await btn.count() === 0) {
      // Load a little more of the feed before giving up.
      await page.mouse.wheel(0, 1200 + Math.random() * 600);
      await page.waitForTimeout(1500 + Math.random() * 1000);
      if (await likeButtons.count() === 0) break;
      continue;
    }
    await btn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600 + Math.random() * 900);
    await btn.click({ delay: 80 + Math.random() * 80 });
    await page.waitForTimeout(1200 + Math.random() * 1800);
    liked++;
  }
  return liked;
}
