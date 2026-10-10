import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { getDb } from "@/lib/db";
import { InviteNeedsEmailError, InviteNotConfirmedError, sendConnectionRequest } from "@/lib/linkedin/connect";
import { requeueMissingInvites } from "@/lib/linkedin/invite-reconcile";

/**
 * A stand-in LinkedIn profile: Follow as the main button, Connect inside "More", an invitation
 * dialog that opens after `dialogDelay` ms, and (when `sends`) a Pending state after Send.
 */
function profile({ dialogDelay = 0, sends = true, needsEmail = false } = {}) {
  return `<!doctype html><html><body><nav><button aria-label="More">nav</button></nav>
<main><section class="pv-top-card">Jane Doe · 2nd</section>
<button aria-label="Follow Jane">Follow</button><button aria-label="More" id="more">More</button>
<div id="menu" hidden><div role="menuitem" id="connect">Connect</div><div role="menuitem">Report</div></div></main>
<script>
const more = document.getElementById("more"), menu = document.getElementById("menu");
let pending = false;
more.onclick = () => { menu.hidden = false; menu.innerHTML = pending ? '<div role="menuitem">Pending</div>' : '<div role="menuitem" id="connect">Connect</div>';
  const c = document.getElementById("connect"); if (c) c.onclick = openDialog; };
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { menu.hidden = true; document.querySelectorAll("[role=dialog]").forEach((d) => d.remove()); } });
function openDialog() {
  menu.hidden = true;
  setTimeout(() => {
    const d = document.createElement("div"); d.setAttribute("role", "dialog");
    d.innerHTML = ${JSON.stringify(needsEmail)} ? 'To verify this member knows you, please enter their email to connect.<button aria-label="Dismiss">x</button>'
      : '<p>Add a note to your invitation?</p><button>Add a note</button><button aria-label="Send without a note">Send without a note</button>';
    document.body.appendChild(d);
    const s = d.querySelector('[aria-label="Send without a note"]');
    if (s) s.onclick = () => { d.remove(); if (${JSON.stringify(sends)}) pending = true; };
  }, ${dialogDelay});
}
</script></body></html>`;
}

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); }, 60_000);
afterAll(async () => { await browser?.close(); });

async function run(html: string) {
  const page = await browser.newPage();
  await page.route("https://www.linkedin.com/in/**", (r) => r.fulfill({ contentType: "text/html", body: html }));
  try { return await sendConnectionRequest(page, "https://www.linkedin.com/in/jane-doe"); } finally { await page.close(); }
}

describe("sending an invitation", () => {
  it("waits for a slow dialog, sends, and confirms it is pending", async () => {
    await expect(run(profile({ dialogDelay: 2500 }))).resolves.toMatchObject({ noteSent: false, publicUrl: "https://www.linkedin.com/in/jane-doe/" });
  }, 60_000);

  it("never reports a send LinkedIn didn't take", async () => {
    await expect(run(profile({ sends: false }))).rejects.toBeInstanceOf(InviteNotConfirmedError);
  }, 60_000);

  it("recognises LinkedIn asking for an email", async () => {
    await expect(run(profile({ needsEmail: true }))).rejects.toBeInstanceOf(InviteNeedsEmailError);
  }, 60_000);
});

describe("sent-invitations check", () => {
  it("requeues invitations missing from LinkedIn's sent list, keeps the rest", () => {
    const db = getDb();
    db.prepare("INSERT INTO workspaces (id, name, slug) VALUES ('ws-inv', 'W', 'ws-inv')").run();
    db.prepare("INSERT INTO accounts (id, workspace_id, name, email, is_authenticated) VALUES ('acc-inv', 'ws-inv', 'Me', 'm@x.io', 1)").run();
    const lead = db.prepare("INSERT INTO targets (id, workspace_id, full_name, linkedin_url, connection_requested_at) VALUES (?, 'ws-inv', ?, ?, datetime('now','-2 hours'))");
    lead.run("t-there", "There", "https://www.linkedin.com/in/there-person/");
    lead.run("t-missing", "Missing", "https://www.linkedin.com/in/missing-person/");
    lead.run("t-internal", "Internal", "https://www.linkedin.com/in/ACoAAAC619cBn5PkvybNQn_F6KRPBmneEfkeccI");
    db.pragma("foreign_keys = OFF");
    const act = db.prepare("INSERT INTO linkedin_actions (id, idempotency_key, account_id, run_id, track_id, step_id, target_id, type, status, updated_at) VALUES (?, ?, 'acc-inv', 'r', 'tr', 's', ?, 'connect', 'sent', datetime('now','-2 hours'))");
    for (const t of ["t-there", "t-missing", "t-internal"]) act.run(`a-${t}`, `k-${t}`, t);
    db.pragma("foreign_keys = ON");

    expect(requeueMissingInvites(db, "acc-inv", new Set()).requeued).toEqual([]); // unreadable list: no action
    const r = requeueMissingInvites(db, "acc-inv", new Set(["there-person", "someone-else"]));
    expect(r).toMatchObject({ requeued: ["t-missing"], checked: 2, skipped: 1 });
    expect(db.prepare("SELECT status FROM linkedin_actions WHERE id = 'a-t-missing'").get()).toEqual({ status: "failed" });
    expect(db.prepare("SELECT connection_requested_at FROM targets WHERE id = 't-missing'").get()).toEqual({ connection_requested_at: null });
    expect(db.prepare("SELECT status FROM linkedin_actions WHERE id = 'a-t-there'").get()).toEqual({ status: "sent" });
  });
});
