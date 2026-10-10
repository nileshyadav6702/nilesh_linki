import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { newReplyText } from "@/lib/email/reply-text";
import { classifyAndDispatch } from "@/lib/community-replies";

const WS = "ws-quoted-footer";
const FOOTER = "Unsubscribe: https://app.kairo.example/api/u/abc123";

beforeAll(() => {
  getDb().prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
});

describe("the words the person wrote", () => {
  it("cuts the quoted original (Gmail, Outlook, French) and our footer", () => {
    expect(newReplyText(`Yes, let's talk next week.\n\nOn Mon, Oct 6, 2026 at 10:00 AM Jane <jane@kairo.io> wrote:\n> Hi Sam,\n> ${FOOTER}`)).toBe("Yes, let's talk next week.");
    expect(newReplyText(`Sounds good\r\n\r\nOn Mon, 6 Oct 2026 at 10:00, Jane Doe <jane@kairo.io>\r\nwrote:\r\n> quoted`)).toBe("Sounds good");
    expect(newReplyText(`Interested.\n\nFrom: Jane <jane@kairo.io>\nSent: Monday, October 6, 2026\nTo: Sam\nSubject: Hi\n\n${FOOTER}`)).toBe("Interested.");
    expect(newReplyText(`Avec plaisir.\n\nLe lun. 6 oct. 2026 à 10:00, Jane <jane@kairo.io> a écrit :\n> Bonjour`)).toBe("Avec plaisir.");
    expect(newReplyText(`Book me in.\n${FOOTER}`)).toBe("Book me in.");
    expect(newReplyText("Please unsubscribe me from these emails.")).toBe("Please unsubscribe me from these emails.");
    expect(newReplyText('Interested!\nTo stop receiving these emails, reply "unsubscribe".')).toBe("Interested!");
  });
});

let n = 0;
function seed(body: string) {
  const db = getDb();
  n++;
  db.prepare("INSERT INTO targets (id, workspace_id, full_name, email) VALUES (?, ?, ?, ?)").run(`qf-t-${n}`, WS, `Lead ${n}`, `lead${n}@qf.test`);
  db.prepare(`INSERT INTO email_replies (id, workspace_id, target_id, from_email, subject, body_text, received_at)
    VALUES (?, ?, ?, ?, 'Re: Quick question', ?, datetime('now'))`).run(`qf-r-${n}`, WS, `qf-t-${n}`, `lead${n}@qf.test`, body);
  return { reply: `qf-r-${n}`, target: `qf-t-${n}`, email: `lead${n}@qf.test` };
}
const suppressed = (email: string) => !!getDb().prepare("SELECT 1 FROM suppressions WHERE workspace_id = ? AND value = ?").get(WS, email);

describe("reply classification", () => {
  it("a positive reply quoting our unsubscribe footer is positive, not an opt-out", async () => {
    const r = seed(`Sounds interesting, let's talk on Thursday.\n\nOn Mon, Oct 6, 2026 at 10:00 AM Sam <sam@kairo.io> wrote:\n> Hi,\n> ${FOOTER}`);
    await classifyAndDispatch(r.reply);
    expect((getDb().prepare("SELECT reply_kind FROM targets WHERE id = ?").get(r.target) as { reply_kind: string }).reply_kind).toBe("positive");
    expect(suppressed(r.email)).toBe(false);
  });

  it("a real opt-out above the quote is still honoured", async () => {
    const r = seed(`Please unsubscribe me.\n\nOn Mon, Oct 6, 2026 at 10:00 AM Sam <sam@kairo.io> wrote:\n> Hi`);
    await classifyAndDispatch(r.reply);
    expect(suppressed(r.email)).toBe(true);
  });
});
