import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { MessageMaybeSentError, RecipientNotFoundError, sendMessage } from "@/lib/linkedin/message";
import { isAmbiguousSendError } from "@/lib/linkedin/actions";

/** Wires a composer + send button into `root`; `delivers` decides whether the sent text shows in the thread. */
const THREAD_JS = `function thread(root, delivers) {
  root.innerHTML = '<div class="msg-s-message-list"></div><form class="msg-form"><div class="msg-form__contenteditable" contenteditable="true"></div><button type="button" class="msg-form__send-button">Send</button></form>';
  const box = root.querySelector(".msg-form__contenteditable");
  root.querySelector(".msg-form__send-button").onclick = () => {
    const t = box.innerText; box.innerText = "";
    if (delivers) { const d = document.createElement("div"); d.className = "msg-s-event-listitem__body"; d.innerText = t; root.querySelector(".msg-s-message-list").appendChild(d); }
  };
}`;

const profile = (delivers = true) => `<!doctype html><html><body><main><h1>Jane Doe</h1>
<button aria-label="Message Jane" id="msg">Message</button><div id="overlay"></div></main>
<script>${THREAD_JS}
document.getElementById("msg").onclick = () => thread(document.getElementById("overlay"), ${delivers});</script></body></html>`;

const newThread = (names: string[]) => `<!doctype html><html><body>
<input class="msg-connections-typeahead__search-field"><div id="results"></div><div id="conv"></div>
<script>${THREAD_JS}
const names = ${JSON.stringify(names)};
document.querySelector("input").oninput = () => {
  const box = document.getElementById("results");
  box.innerHTML = "";
  names.forEach((n) => {
    const row = document.createElement("div"); row.className = "msg-connections-typeahead__search-result-row";
    row.innerHTML = "<div>" + n + "</div><div>Sales at Acme</div>";
    row.onclick = () => thread(document.getElementById("conv"), true);
    box.appendChild(row);
  });
};</script></body></html>`;

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); }, 60_000);
afterAll(async () => { await browser?.close(); });

async function run(html: string, recipient: { fullName: string; profileUrl?: string | null }, text = "Hi Jane, quick question about outbound") {
  const page = await browser.newPage();
  await page.route("https://www.linkedin.com/**", (r) => r.fulfill({ contentType: "text/html", body: html }));
  try { return await sendMessage(page, recipient, text); } finally { await page.close(); }
}

describe("LinkedIn message recipient", () => {
  it("opens the conversation from the lead's profile and confirms the send", async () => {
    await expect(run(profile(), { fullName: "Jane Doe", profileUrl: "https://www.linkedin.com/in/jane-doe" })).resolves.toBeUndefined();
  }, 60_000);

  it("reports an unconfirmed send as maybe-sent, so it is never retried", async () => {
    const err = await run(profile(false), { fullName: "Jane Doe", profileUrl: "https://www.linkedin.com/in/jane-doe" }).catch((e) => e);
    expect(err).toBeInstanceOf(MessageMaybeSentError);
    expect(isAmbiguousSendError(err)).toBe(true);
  }, 60_000);

  it("without a profile URL, refuses to guess between two people with the same name", async () => {
    const err = await run(newThread(["Jane Doe", "Jane Doe"]), { fullName: "Jane Doe" }).catch((e) => e);
    expect(err).toBeInstanceOf(RecipientNotFoundError);
    expect(String(err.message)).toMatch(/2 connections are named/);
  }, 60_000);

  it("without a profile URL, sends to the one exact match", async () => {
    await expect(run(newThread(["Jane Doerr", "Jane Doe"]), { fullName: "Jane Doe" })).resolves.toBeUndefined();
  }, 60_000);

  it("without a profile URL, refuses a partial-name match", async () => {
    const err = await run(newThread(["Jane Doerr"]), { fullName: "Jane Doe" }).catch((e) => e);
    expect(err).toBeInstanceOf(RecipientNotFoundError);
  }, 60_000);
});
