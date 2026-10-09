import { beforeAll, describe, expect, it, vi } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcryptjs";

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn(async () => ({ user: { email: "Pw@Example.test" } })) }));

import { getDb } from "@/lib/db";
import handler from "@/pages/api/auth/change-password";

let ip = 0;
async function call(body: unknown) {
  const res: Record<string, unknown> = { statusCode: 200 };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.end = () => res;
  // A fresh address per call so the attempt limiter never interferes with the assertions.
  await handler({ method: "POST", body, headers: {}, socket: { remoteAddress: `10.0.0.${++ip}` } } as unknown as NextApiRequest, res as unknown as NextApiResponse);
  return res as { statusCode: number; body: { error?: string; ok?: boolean } };
}

beforeAll(async () => {
  getDb().prepare("INSERT INTO users (id, email, password_hash) VALUES ('pw-user', 'pw@example.test', ?)").run(await bcrypt.hash("old-password-1", 4));
});

describe("change password", () => {
  it("rejects a wrong current password, a short or unchanged new one", async () => {
    expect((await call({ currentPassword: "nope", newPassword: "new-password-1" })).body.error).toBe("Current password is incorrect.");
    expect((await call({ currentPassword: "old-password-1", newPassword: "short" })).statusCode).toBe(400);
    expect((await call({ currentPassword: "old-password-1", newPassword: "old-password-1" })).body.error).toMatch(/different/);
  });

  it("changes it (email matched case-insensitively)", async () => {
    expect((await call({ currentPassword: "old-password-1", newPassword: "new-password-1" })).body).toEqual({ ok: true });
    const { password_hash } = getDb().prepare("SELECT password_hash FROM users WHERE id = 'pw-user'").get() as { password_hash: string };
    expect(await bcrypt.compare("new-password-1", password_hash)).toBe(true);
  });
});
