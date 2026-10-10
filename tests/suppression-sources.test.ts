import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { addSuppression, isAddressSuppressed, removeSuppression } from "@/lib/platform/suppression";
import { recheckStaleCatchalls } from "@/lib/email/verify";

const WS = "ws-suppr-sources";

beforeAll(() => {
  getDb().prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, WS, WS);
});
const source = (v: string) => (getDb().prepare("SELECT source FROM suppressions WHERE workspace_id = ? AND value = ?").get(WS, v) as { source: string }).source;

describe("suppression sources", () => {
  it("a real unsubscribe isn't relabelled by the reply classifier, so reclassifying can't lift it", () => {
    addSuppression({ workspaceId: WS, kind: "email", value: "opt@x.io", reason: "unsubscribe", source: "unsubscribe_link" });
    addSuppression({ workspaceId: WS, kind: "email", value: "opt@x.io", reason: "unsubscribe", source: "reply_classifier" });
    expect(source("opt@x.io")).toBe("unsubscribe_link");
    removeSuppression(WS, "email", "opt@x.io", { source: "reply_classifier" });
    expect(isAddressSuppressed(WS, "opt@x.io")).not.toBeNull();
  });

  it("a catch-all entry confirmed by a hard bounce becomes the bounce", () => {
    addSuppression({ workspaceId: WS, kind: "email", value: "ca@x.io", reason: "Catch-all", source: "catchall" });
    addSuppression({ workspaceId: WS, kind: "email", value: "ca@x.io", reason: "Hard bounce", source: "bounce" });
    expect(source("ca@x.io")).toBe("bounce");
  });

  it("catch-all entries older than 90 days are lifted and re-verified before sending", () => {
    const db = getDb();
    db.prepare("INSERT INTO targets (id, workspace_id, full_name, email, email_status) VALUES ('ss-t1', ?, 'A', 'Old@Catch.io', 'catchall'), ('ss-t2', ?, 'B', 'new@catch.io', 'catchall')").run(WS, WS);
    addSuppression({ workspaceId: WS, kind: "email", value: "old@catch.io", reason: "Catch-all", source: "catchall", targetId: "ss-t1" });
    addSuppression({ workspaceId: WS, kind: "email", value: "new@catch.io", reason: "Catch-all", source: "catchall", targetId: "ss-t2" });
    db.prepare("UPDATE suppressions SET created_at = datetime('now', '-91 days') WHERE value = 'old@catch.io'").run();
    expect(recheckStaleCatchalls(db)).toBe(1);
    expect(isAddressSuppressed(WS, "old@catch.io")).toBeNull();
    expect(isAddressSuppressed(WS, "new@catch.io")).not.toBeNull();
    expect((db.prepare("SELECT email_status s FROM targets WHERE id = 'ss-t1'").get() as { s: string }).s).toBe("unverified");
    expect((db.prepare("SELECT email_status s FROM targets WHERE id = 'ss-t2'").get() as { s: string }).s).toBe("catchall");
  });
});
