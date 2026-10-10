import type { Page } from "playwright";
import { assertSignedIn } from "@/lib/linkedin/session-guard";

/**
 * Visits a LinkedIn profile page. This registers as a profile view on LinkedIn.
 * Just navigates and waits — no interaction.
 */
export async function visitProfile(page: Page, linkedinUrl: string): Promise<void> {
  await page.goto(linkedinUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await assertSignedIn(page);
  await page.waitForTimeout(3000 + Math.random() * 2000);
}
