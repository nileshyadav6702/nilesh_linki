import type { Page } from "playwright";

/**
 * LinkedIn sent the session to a login, auth-wall or security checkpoint instead of the page:
 * the account must be reconnected. Steps hold (they are not failed) and the account is flagged.
 */
export class SessionExpiredError extends Error {
  override name = "SessionExpiredError";
  constructor(url: string) { super(`LinkedIn asked to sign in again (${url.replace(/\?.*$/, "")})`); }
}

/** A restriction or captcha page: stop using this account until a human looks. */
export class AccountRestrictedError extends Error {
  override name = "AccountRestrictedError";
}

const SIGNED_OUT = /linkedin\.com\/(login|authwall|uas\/|checkpoint\/(lg|rp|challenge)|signup)/i;
const RESTRICTED = /linkedin\.com\/checkpoint\/(restricted|challengesV2|.*captcha)/i;

/** Throws when the page that loaded is a sign-in wall or a restriction page. Call after each navigation. */
export async function assertSignedIn(page: Page): Promise<void> {
  const url = page.url();
  if (RESTRICTED.test(url)) throw new AccountRestrictedError(`LinkedIn restricted this account or asked for a security check (${url.replace(/\?.*$/, "")})`);
  if (SIGNED_OUT.test(url)) throw new SessionExpiredError(url);
  // Some walls keep the URL but swap the page for a sign-in form.
  const wall = await page.locator('form[action*="login-submit"], input#session_key, a[data-tracking-control-name*="auth_wall"]').count().catch(() => 0);
  if (wall > 0) throw new SessionExpiredError(url);
}
