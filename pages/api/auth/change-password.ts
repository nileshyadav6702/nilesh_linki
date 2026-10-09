import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./[...nextauth]";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/db";
import { isRateLimited } from "@/lib/rate-limit";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Not authenticated" });
  // Guessing the current password through this form is throttled like the login form.
  if (isRateLimited(req, "change-password", 10, 15 * 60 * 1000)) return res.status(429).json({ error: "Too many attempts. Try again later." });

  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || !currentPassword || !newPassword) {
    return res.status(400).json({ error: "Current and new password are required." });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters." });
  }
  // bcrypt only reads the first 72 bytes; a cap keeps hashing cheap and the rule honest.
  if (newPassword.length > 200 || currentPassword.length > 200) return res.status(400).json({ error: "Passwords must be 200 characters or fewer." });
  if (newPassword === currentPassword) return res.status(400).json({ error: "Choose a password different from your current one." });

  const db = getDb();
  const user = db
    .prepare("SELECT id, password_hash FROM users WHERE lower(email) = lower(?)")
    .get(session.user.email) as { id: string; password_hash: string } | undefined;

  if (!user) return res.status(404).json({ error: "User not found." });

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) return res.status(400).json({ error: "Current password is incorrect." });

  const hash = await bcrypt.hash(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, user.id);

  return res.status(200).json({ ok: true });
}
