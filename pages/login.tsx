import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/router";
import { useState } from "react";
import { RiEyeLine, RiEyeOffLine, RiLoginBoxLine, RiUserAddLine } from "react-icons/ri";
import AuthIllustration from "@/components/auth/AuthIllustration";

type Mode = "signin" | "signup";

const COPY: Record<Mode, { title: string; heading: string; sub: string; cta: string; switchText: string; switchCta: string }> = {
  signin: {
    title: "Sign in",
    heading: "Sign in to your account",
    sub: "Welcome back. Pick up where your team left off.",
    cta: "Sign in",
    switchText: "Don't have an account?",
    switchCta: "Sign up here",
  },
  signup: {
    title: "Create your account",
    heading: "Signals → Conversations",
    sub: "Create your workspace in under a minute.",
    cta: "Create account",
    switchText: "Already have an account?",
    switchCta: "Sign in here",
  },
};

const inputClass =
  "h-12 w-full rounded-[10px] border border-[var(--border-subtle)] bg-white px-4 text-[15px] text-base-content outline-none transition placeholder:text-base-content/40 hover:border-base-content/25 focus:border-primary focus:ring-4 focus:ring-primary/15";

export default function LoginPage() {
  const router = useRouter();
  const callbackUrl = typeof router.query.callbackUrl === "string" && router.query.callbackUrl.startsWith("/")
    ? router.query.callbackUrl
    : "/agents";
  // Mode lives in the URL (?mode=signup) so sign-up links can be shared.
  const mode: Mode = router.query.mode === "signup" ? "signup" : "signin";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function modeHref(next: Mode) {
    const query: Record<string, string> = {};
    if (next === "signup") query.mode = "signup";
    if (typeof router.query.callbackUrl === "string") query.callbackUrl = router.query.callbackUrl;
    return { pathname: "/login", query };
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);

    if (res?.ok) {
      router.replace(callbackUrl);
    } else {
      setError("Incorrect email or password.");
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    if (!res.ok) {
      setLoading(false);
      setError(data.error ?? "Something went wrong.");
      return;
    }

    // Auto sign in after signup
    const signInRes = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);

    if (signInRes?.ok) {
      router.replace("/onboarding");
    } else {
      setError("Account created but sign-in failed. Try signing in manually.");
      router.replace(modeHref("signin"), undefined, { shallow: true });
    }
  }

  const copy = COPY[mode];
  const other: Mode = mode === "signin" ? "signup" : "signin";

  return (
    <>
    <Head>
      <title>{`${copy.title} — Kairo`}</title>
      <meta name="robots" content="noindex, nofollow" />
    </Head>
    <div className="app-sans grid min-h-screen bg-base-100 lg:grid-cols-[minmax(0,1fr)_minmax(0,.9fr)]">
      <section className="relative flex min-h-screen flex-col px-5 py-6 sm:px-10">
        <div className="flex justify-end text-[14px] text-base-content/60">
          <span>
            {copy.switchText}{" "}
            <Link href={modeHref(other)} shallow onClick={() => setError("")} className="ml-1 font-semibold text-base-content underline decoration-base-content/30 underline-offset-4 transition hover:text-primary hover:decoration-primary">
              {copy.switchCta}
            </Link>
          </span>
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[420px]">
            <div className="mb-10 flex flex-col items-center text-center">
              <span className="flex items-center gap-3">
                <Image src="/logo_kairo.svg" alt="" width={44} height={44} priority />
                <span className="text-[40px] font-semibold leading-none tracking-[-.03em] text-base-content">Kairo</span>
              </span>
              <h1 className="pt-6 text-[24px] font-semibold tracking-[-.01em] text-base-content">{copy.heading}</h1>
              <p className="pt-2 text-[15px] text-base-content/55">{copy.sub}</p>
            </div>

            <form onSubmit={mode === "signin" ? handleSignIn : handleSignUp} className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <label htmlFor="email" className="text-[14px] font-medium text-base-content/80">
                  {mode === "signup" ? "Business email" : "Email address"}
                </label>
                <input id="email" type="email" className={inputClass} placeholder={mode === "signup" ? "you@company.com" : "Enter your email"} value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" autoFocus required />
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="password" className="text-[14px] font-medium text-base-content/80">Password</label>
                <div className="relative">
                  <input id="password" type={showPassword ? "text" : "password"} className={`${inputClass} pr-12`} placeholder={mode === "signup" ? "Create a strong password (8+ characters)" : "Enter your password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={mode === "signup" ? 8 : undefined} required />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-base-content/45 transition hover:bg-base-200 hover:text-base-content">
                    {showPassword ? <RiEyeLine size={19} /> : <RiEyeOffLine size={19} />}
                  </button>
                </div>
              </div>

              {error && <div role="alert" className="rounded-[10px] border border-error/20 bg-error/[0.07] px-4 py-3 text-[13px] text-error">{error}</div>}

              <button type="submit" disabled={loading} className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-primary text-[15px] font-semibold text-primary-content shadow-[0_10px_24px_-12px_rgba(204,120,92,.9)] transition hover:-translate-y-px hover:bg-[#bd6a4f] hover:shadow-[0_14px_28px_-12px_rgba(204,120,92,.95)] active:translate-y-0 disabled:pointer-events-none disabled:opacity-70">
                {loading ? <span className="loading loading-spinner loading-sm" /> : mode === "signin" ? <RiLoginBoxLine size={19} /> : <RiUserAddLine size={19} />}
                <span>{loading ? "Working…" : copy.cta}</span>
              </button>
            </form>

            <p className="pt-7 text-center text-[12px] leading-5 text-base-content/45">
              By continuing, you agree to keep outreach human, relevant, and respectful.
            </p>
          </div>
        </div>
      </section>

      <section className="relative hidden overflow-hidden lg:flex lg:flex-col lg:items-center lg:justify-center lg:px-10">
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_70%_20%,#fde3d2_0%,#fbeee4_40%,#faf6ef_75%)]" />
        <div className="absolute -right-24 top-24 h-72 w-72 rounded-full bg-[#f6c3a6]/40 blur-3xl" />
        <div className="absolute -left-16 bottom-10 h-64 w-64 rounded-full bg-[#fde7c8]/60 blur-3xl" />

        <div className="relative flex w-full max-w-[520px] flex-col items-center">
          <AuthIllustration />
          <div className="mt-10 text-center">
            <h2 className="text-[26px] font-semibold leading-tight tracking-[-.02em] text-base-content">
              From buying signal to booked meeting.
            </h2>
            <p className="mx-auto max-w-sm pt-3 text-[15px] leading-6 text-base-content/60">
              Kairo spots the right people, writes the first message, and keeps every conversation moving.
            </p>
          </div>
        </div>
      </section>
    </div>
    </>
  );
}
