import type { NextApiRequest, NextApiResponse } from "next";
import NextAuth, { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/db";
import { isRateLimited, REMOTE_ADDR_HEADER } from "@/lib/rate-limit";
import { normalizeInvitationEmail } from "@/lib/workspace-invitations";
import { createWorkspaceForUser, getMembership, getPrimaryMembership } from "@/lib/workspace";
import { isSuperadminEmail } from "@/lib/superadmin-allowlist";
import { displayName, getUserProfile } from "@/lib/user-profile";

type UserRow = { id: string; email: string; password_hash: string };

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null;

        // Throttle login attempts per IP — this is the password brute-force surface.
        if (isRateLimited(req, "login", 10, 15 * 60 * 1000)) {
          throw new Error("Too many attempts. Try again later.");
        }

        // Signup stores emails lowercased; match case-insensitively so "Me@x.com" can log in.
        // An exact-case row (legacy data) wins if two rows differ only by case.
        const db = getDb();
        const email = normalizeInvitationEmail(credentials.email);
        const user = db
          .prepare("SELECT id, email, password_hash FROM users WHERE lower(email) = ? ORDER BY CASE WHEN email = ? THEN 0 ELSE 1 END LIMIT 1")
          .get(email, credentials.email) as UserRow | undefined;

        if (!user) return null;

        const valid = await bcrypt.compare(credentials.password, user.password_hash);
        if (!valid) return null;

        return { id: user.id, email: user.email };
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      const userId = user?.id ?? token.userId ?? token.sub;
      if (!userId) return token;
      const requestedWorkspace = trigger === "update" && typeof session?.workspaceId === "string" ? session.workspaceId : null;
      let membership = requestedWorkspace ? getMembership(userId, requestedWorkspace) :
        !user && token.workspaceId ? getMembership(userId, token.workspaceId) : getPrimaryMembership(userId);
      if (!membership && (user?.email || token.email)) {
        createWorkspaceForUser(userId, String(user?.email ?? token.email));
        membership = getPrimaryMembership(userId);
      }
      token.userId = userId;
      token.workspaceId = membership?.workspaceId;
      token.workspaceName = membership?.workspaceName;
      token.role = membership?.role;
      // Recomputed on every token refresh so an allowlist change takes effect without
      // forcing a re-login. This flag is for UI affordances only - every admin route
      // re-checks the allowlist server-side and never trusts it.
      token.isSuperadmin = isSuperadminEmail(user?.email ?? token.email);
      // Name from Settings → Account (refreshed with the token, so edits show up without a re-login).
      token.name = displayName(getUserProfile(getDb(), userId)) ?? token.name ?? null;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.userId && token.workspaceId) {
        session.user.id = token.userId;
        session.user.workspaceId = token.workspaceId;
        session.user.workspaceName = token.workspaceName ?? "Workspace";
        session.user.role = token.role ?? "viewer";
      }
      if (session.user) { session.user.isSuperadmin = Boolean(token.isSuperadmin); session.user.name = token.name ?? null; }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const nextAuthHandler = NextAuth(authOptions);

// authorize() only sees a socket-less copy of the request, so stamp the real peer address
// for the login rate limiter. Always overwritten: a client-sent value is never trusted.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  req.headers[REMOTE_ADDR_HEADER] = req.socket?.remoteAddress ?? "";
  return nextAuthHandler(req, res);
}
