import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { hashToken, issueTokenPair } from "@/lib/mcp/auth";
import handler from "@/pages/api/oauth/token";

const CLIENT = "sec-reuse-client";

function call(body: Record<string, string>) {
  const out = { status: 200, body: {} as Record<string, unknown> };
  const res = {
    setHeader: () => res,
    status(code: number) { out.status = code; return res; },
    json(b: Record<string, unknown>) { out.body = b; return res; },
  } as unknown as NextApiResponse;
  handler({ method: "POST", body, headers: {}, socket: { remoteAddress: "192.0.2.50" } } as unknown as NextApiRequest, res);
  return out;
}

function seed() {
  const db = getDb();
  const userId = randomUUID(), ws = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(userId, `${userId}@x.test`, "x");
  db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(ws, "W", `w-${ws.slice(0, 8)}`);
  db.prepare("INSERT OR IGNORE INTO oauth_clients (client_id, client_name, redirect_uris) VALUES (?, ?, ?)").run(CLIENT, "C", "[]");
  return issueTokenPair({ clientId: CLIENT, userId, scopes: ["mcp:read"], resource: "http://localhost:3000/api/mcp", workspaceId: ws });
}

describe("refresh token reuse", () => {
  it("returns the same rotated pair for a reuse inside the grace window", () => {
    const pair = seed();
    const a = call({ grant_type: "refresh_token", client_id: CLIENT, refresh_token: pair.refresh_token });
    const b = call({ grant_type: "refresh_token", client_id: CLIENT, refresh_token: pair.refresh_token });
    expect(a.body.access_token).toBeTruthy();
    expect(b.body.refresh_token).toBe(a.body.refresh_token);
  });

  it("revokes the whole family when a rotated token is replayed after the window", () => {
    const pair = seed();
    const a = call({ grant_type: "refresh_token", client_id: CLIENT, refresh_token: pair.refresh_token });
    const c = call({ grant_type: "refresh_token", client_id: CLIENT, refresh_token: String(a.body.refresh_token) });
    // Push the original past its grace window and evict it from the in-memory cache by
    // replaying with a different (narrower) scope string.
    getDb().prepare("UPDATE oauth_tokens SET refresh_expires_at = ? WHERE refresh_hash = ?")
      .run(new Date(Date.now() - 1000).toISOString(), hashToken(pair.refresh_token));
    const replay = call({ grant_type: "refresh_token", client_id: CLIENT, refresh_token: pair.refresh_token, scope: "mcp:read " });
    expect(replay.status).toBe(400);
    const live = getDb().prepare("SELECT 1 FROM oauth_tokens WHERE access_hash = ?").get(hashToken(String(c.body.access_token)));
    expect(live).toBeUndefined();
  });
});
