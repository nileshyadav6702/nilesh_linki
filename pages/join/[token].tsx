import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { LuArrowRight, LuLoaderCircle } from "react-icons/lu";
import { BRAND } from "@/lib/brand";

interface JoinInfo { workspace_name: string; role: string; valid: boolean; reason: string | null }

/** Landing page of a shareable invite link: join with your account, or create one. */
export default function JoinPage() {
  const router = useRouter();
  const token = typeof router.query.token === "string" ? router.query.token : "";
  const { data: session, status, update } = useSession();
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!token) return;
    fetch(`/api/join/${encodeURIComponent(token)}`).then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error); return b; })
      .then(setInfo).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [token]);

  async function join() {
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/join/${encodeURIComponent(token)}`, { method: "POST" });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      await update({ workspaceId: b.workspace_id });
      await router.replace("/dashboard");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  async function createAccount(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    const r = await fetch("/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, join_token: token }) });
    const b = await r.json();
    if (!r.ok) { setError(b.error ?? "Unable to create account"); setBusy(false); return; }
    const login = await signIn("credentials", { email, password, redirect: false });
    if (!login?.ok) { setError("Account created, but sign-in failed. Sign in to continue."); setBusy(false); return; }
    await update({ workspaceId: b.workspace_id });
    await router.replace("/dashboard");
  }

  const input = "h-12 w-full rounded-[10px] border border-[var(--border-strong)] bg-base-100 px-4 text-[16px] outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-[var(--ring)]";
  const primary = "inline-flex h-12 w-full items-center justify-between rounded-[10px] bg-primary px-5 text-[16px] font-semibold text-primary-content transition-colors hover:bg-[var(--primary-hover)] disabled:opacity-60";
  return (
    <>
      <Head><title>Join a workspace — {BRAND.name}</title><meta name="robots" content="noindex,nofollow" /></Head>
      <main className="flex min-h-screen items-center justify-center bg-base-200 px-5 py-10">
        <div className="w-full max-w-[440px]">
          <div className="mb-8 flex justify-center"><span className="flex items-center gap-2.5"><Image src={BRAND.logo} alt="" width={34} height={34} priority /><span className="text-[24px] font-semibold tracking-tight">{BRAND.name}</span></span></div>
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-base-100 p-7 shadow-[var(--shadow-raised)] sm:p-8">
            <div className="text-[13px] font-semibold text-primary">You&apos;ve been invited</div>
            <div role="heading" aria-level={1} className="mt-2 text-[28px] font-semibold leading-tight tracking-tight">Join {info?.workspace_name ?? "the workspace"}</div>
            {info?.valid && <p className="mt-3 text-[15px] text-base-content/60">You&apos;ll join as a <strong className="font-medium text-base-content/80">{info.role}</strong> and share its agents, contacts and inbox.</p>}

            <div className="mt-6 space-y-4">
              {!info && !error && <div className="flex justify-center py-3"><LuLoaderCircle size={22} className="animate-spin text-base-content/40" /></div>}
              {info && !info.valid && <div role="alert" className="rounded-[10px] border border-warning/30 bg-warning/10 px-4 py-3 text-[15px] text-warning">{info.reason}</div>}
              {info?.valid && status === "authenticated" && (
                <>
                  <p className="text-[14px] text-base-content/55">Signed in as {session?.user?.email}</p>
                  <button type="button" className={primary} disabled={busy} onClick={() => void join()}><span>{busy ? "Joining…" : "Join workspace"}</span>{busy ? <LuLoaderCircle size={18} className="animate-spin" /> : <LuArrowRight size={18} />}</button>
                </>
              )}
              {info?.valid && status === "unauthenticated" && (
                <>
                  <form className="space-y-3" onSubmit={createAccount}>
                    <input className={input} type="email" required autoComplete="email" placeholder="Work email" aria-label="Work email" value={email} onChange={(e) => setEmail(e.target.value)} />
                    <input className={input} type="password" required minLength={8} autoComplete="new-password" placeholder="Create a password (8+ characters)" aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
                    <button type="submit" className={primary} disabled={busy}><span>{busy ? "Creating account…" : "Create account and join"}</span>{busy ? <LuLoaderCircle size={18} className="animate-spin" /> : <LuArrowRight size={18} />}</button>
                  </form>
                  <p className="text-center text-[14px] text-base-content/55">Already have an account? <Link href={`/login?callbackUrl=${encodeURIComponent(`/join/${token}`)}`} className="font-medium text-primary hover:underline">Sign in to join</Link></p>
                </>
              )}
              {error && <div role="alert" className="rounded-[10px] border border-error/30 bg-error/10 px-4 py-3 text-[15px] text-error">{error}</div>}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
