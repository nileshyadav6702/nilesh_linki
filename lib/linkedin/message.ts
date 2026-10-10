import type { Locator, Page } from "playwright";
import { partDelayMs } from "@/lib/linkedin/split-message";

/** Put `text` in the composer: paste (clipboard), else type it. */
async function typeInto(page: Page, input: Locator, text: string): Promise<void> {
  await input.click();
  try {
    await page.evaluate((t) => navigator.clipboard.writeText(t), text);
    await page.waitForTimeout(300);
    await input.press("Control+V");
  } catch {
    // Clipboard blocked in headless — fall back to keyboard typing
    await input.pressSequentially(text, { delay: 20 });
  }
  await page.waitForTimeout(500);
}

/**
 * Sends a message to a LinkedIn 1st-degree connection.
 * Strategy: navigate to /messaging/thread/new/, search by full name,
 * select the first result, paste message, click send.
 * This works regardless of whether the linkedin_url is a Sales Nav or /in/ URL.
 */
export async function sendMessage(page: Page, fullName: string, text: string, opts: { attachmentPath?: string; parts?: string[] } = {}): Promise<void> {
  await page.goto("https://www.linkedin.com/messaging/thread/new/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(1500 + Math.random() * 1000);

  // Search for recipient by name
  const searchField = page.locator("input.msg-connections-typeahead__search-field").first();
  await searchField.waitFor({ timeout: 10000 });
  await searchField.click();
  await searchField.type(fullName, { delay: 60 + Math.random() * 40 });
  await page.waitForTimeout(1500);

  // Select first result
  const firstResult = page.locator('div[class*="msg-connections-typeahead__search-result-row"]').first();
  await firstResult.waitFor({ timeout: 8000 });
  await firstResult.click({ delay: 100 });
  await page.waitForTimeout(800);

  // Paste message into compose area
  const msgInput = page.locator("div.msg-form__contenteditable").first();
  await msgInput.waitFor({ timeout: 8000 });
  // Split into a conversation: every part but the last is sent here, a few seconds apart, in the same thread.
  const parts = opts.parts && opts.parts.length > 1 ? opts.parts : null;
  if (parts) {
    for (const part of parts.slice(0, -1)) {
      await typeInto(page, msgInput, part);
      await page.locator("button.msg-form__send-button:visible").first().click({ delay: 100 });
      await page.waitForTimeout(partDelayMs());
    }
    text = parts[parts.length - 1];
  }
  if (text) await typeInto(page, msgInput, text);

  // Attach a file (a recorded voice message) through the composer's own file input.
  if (opts.attachmentPath) {
    const fileInput = page.locator('.msg-form input[type="file"], form.msg-form__form input[type="file"]').first();
    if (await fileInput.count() === 0) throw new Error("Message composer has no file attachment input");
    await fileInput.setInputFiles(opts.attachmentPath);
    // Wait for the upload to finish: the send button turns enabled once the attachment is ready.
    await page.locator("button.msg-form__send-button:enabled").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
  }

  // Send
  const sendBtn = page.locator("button.msg-form__send-button:visible").first();
  await sendBtn.waitFor({ timeout: 5000 });
  await sendBtn.click({ delay: 100 });
  await page.waitForTimeout(2000);
}
