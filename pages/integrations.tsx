import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { toast } from "sonner";
import { LuBlocks, LuCircleCheck, LuCode, LuLayoutGrid, LuLoaderCircle, LuPlus, LuSend, LuSettings, LuTriangleAlert, LuUsers, LuWebhook, LuWorkflow } from "react-icons/lu";
import AppLogo from "@/components/integrations/AppLogo";
import ConnectDialog, { type AppState } from "@/components/integrations/ConnectDialog";
import { APPS, CATEGORIES, type Category } from "@/lib/integrations/catalog";
import { BRAND } from "@/lib/brand";

/** Integrations: push qualified leads and replies into CRMs, outreach tools and webhooks. */

const CAT_ICON: Record<Category, React.ElementType> = { crm: LuUsers, outreach: LuSend, automation: LuWorkflow, enrichment: LuBlocks };

export default function IntegrationsPage() {
  const router = useRouter();
  const [data, setData] = useState<{ apps: AppState[]; can_edit: boolean; oauth_callback_base: string } | null>(null);
  const [cat, setCat] = useState<Category | "all">("all");
  const [installedOnly, setInstalledOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => fetch("/api/integrations/apps").then((r) => r.json()).then(setData).catch(() => toast.error("Could not load integrations")), []);
  useEffect(() => { void load(); }, [load]);

  // Back from an OAuth sign-in.
  useEffect(() => {
    const { connected, error, app } = router.query;
    if (!connected && !error) return;
    const name = APPS.find((a) => a.key === (connected ?? app))?.name ?? "The app";
    if (connected) toast.success(`${name} connected`); else toast.error(`${name}: ${String(error)}`);
    void router.replace("/integrations", undefined, { shallow: true });
  }, [router]);

  const state = (k: string) => data?.apps.find((a) => a.app === k);
  const visible = APPS.filter((a) => (cat === "all" || a.category === cat) && (!installedOnly || state(a.key)?.installed));
  const count = (c: Category) => APPS.filter((a) => a.category === c).length;
  const openApp = APPS.find((a) => a.key === open);

  return (
    <>
      <Head><title>Integrations — {BRAND.name}</title></Head>
      <div className="-mx-4 -mt-6 border-b border-[var(--border-subtle)] px-4 pb-6 pt-6 md:-mx-10 md:-mt-9 md:px-10 md:pt-8">
        <div className="flex items-center gap-3"><LuWebhook size={24} className="text-primary" /><div role="heading" aria-level={1} className="text-[24px] font-semibold">Integrations</div></div>
        <div className="mt-1.5 pl-[36px] text-[16px] text-base-content/65">Connect your favorite tools and services</div>
      </div>

      <div className="mt-7 grid gap-6 lg:grid-cols-[300px_1fr]">
        <aside className="h-fit rounded-[16px] border border-[var(--border-subtle)] bg-base-100 p-5 lg:sticky lg:top-6">
          <div className="px-2 text-[20px] font-medium">Categories</div>
          <div className="mt-4 space-y-1">
            {CATEGORIES.map((c) => {
              const Icon = CAT_ICON[c.key];
              const on = cat === c.key;
              return (
                <button key={c.key} type="button" onClick={() => setCat(c.key)} aria-pressed={on}
                  className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-3 text-left text-[17px] transition-colors ${on ? "bg-primary/10 font-medium text-primary" : "hover:bg-base-200/60"}`}>
                  <Icon size={21} /><span className="flex-1">{c.label}</span>
                  <span className={`flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-[13px] tabular-nums ${on ? "bg-primary/15" : "bg-base-200"}`}>{count(c.key)}</span>
                </button>
              );
            })}
          </div>
          <div className="my-4 border-t border-[var(--border-subtle)]" />
          <button type="button" onClick={() => setCat("all")} aria-pressed={cat === "all"}
            className={`flex w-full items-center gap-3 rounded-[10px] border px-3 py-3 text-left text-[17px] transition-colors ${cat === "all" ? "border-primary/40 bg-primary/10 font-medium text-primary" : "border-transparent hover:bg-base-200/60"}`}>
            <LuLayoutGrid size={21} /><span className="flex-1">All Integrations</span><span className="tabular-nums">{APPS.length}</span>
          </button>
        </aside>

        <section className="rounded-[16px] border border-[var(--border-subtle)] bg-base-100">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border-subtle)] px-7 py-6">
            <div>
              <div className="text-[22px] font-medium">Available Integrations</div>
              <div className="mt-1 text-[16px] text-base-content/65">Manage your third-party integrations and connections</div>
            </div>
            <label className="flex cursor-pointer items-center gap-3 text-[16px]">
              <button type="button" role="switch" aria-checked={installedOnly} onClick={() => setInstalledOnly((v) => !v)}
                className={`relative h-7 w-12 rounded-full transition-colors ${installedOnly ? "bg-primary" : "bg-base-300"}`}>
                <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${installedOnly ? "left-6" : "left-1"}`} />
              </button>
              Show only installed
            </label>
          </div>

          {!data ? <div className="flex justify-center py-20"><LuLoaderCircle size={26} className="animate-spin text-primary" /></div> : (
            <div className="p-7">
              {visible.length === 0 && <div className="py-16 text-center text-[17px] text-base-content/60">No installed integrations{cat !== "all" ? " in this category" : ""} yet.</div>}
              <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {visible.map((a) => {
                  const s = state(a.key);
                  const cl = CATEGORIES.find((c) => c.key === a.category)!.label.replace(" Tools", "").toLowerCase();
                  return (
                    <div key={a.key} className="flex flex-col rounded-[16px] border border-[var(--border-subtle)] bg-base-100 p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_8px_24px_-12px_rgba(0,0,0,0.18)]">
                      <div className="flex items-start gap-4">
                        <AppLogo app={a} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-[20px] font-medium">{a.name}
                            {s?.installed && s.status === "connected" && <LuCircleCheck size={18} className="text-success" aria-label="Connected" />}
                            {s?.installed && s.status !== "connected" && <LuTriangleAlert size={18} style={{ color: "#d97706" }} aria-label="Needs attention" />}
                          </div>
                          <span className="mt-1 inline-block rounded-[6px] bg-base-200/70 px-2.5 py-0.5 text-[14px] text-base-content/70">{cl}</span>
                        </div>
                      </div>
                      <div className="mt-5 flex-1 text-[17px] leading-relaxed text-base-content/80">{a.tagline}</div>
                      {s?.installed && a.category !== "enrichment" && (
                        <div className="mt-3 text-[14px] text-base-content/60">{s.status === "connected" ? `${s.stats.synced} synced${s.stats.pending ? ` · ${s.stats.pending} waiting` : ""}${s.stats.failed ? ` · ${s.stats.failed} failed` : ""}` : s.status === "pending_oauth" ? "Sign-in not finished" : s.last_error ?? "Needs attention"}</div>
                      )}
                      <div className="mt-5">
                        {a.comingSoon ? (
                          <span className="flex h-12 w-full items-center justify-center rounded-[10px] bg-base-200 text-[16px] font-medium text-base-content/55">Coming soon</span>
                        ) : s?.installed ? (
                          <button type="button" onClick={() => setOpen(a.key)} disabled={!data.can_edit} className="flex h-12 w-full items-center justify-center gap-2 rounded-[10px] border border-[var(--border-strong)] text-[16px] font-semibold hover:bg-base-200 disabled:opacity-60"><LuSettings size={18} />Manage</button>
                        ) : (
                          <button type="button" onClick={() => setOpen(a.key)} disabled={!data.can_edit} title={data.can_edit ? undefined : "Only workspace admins can install apps"}
                            className="flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-primary text-[16px] font-semibold text-primary-content shadow-[0_6px_16px_-8px_var(--color-primary)] hover:bg-[var(--primary-hover)] disabled:opacity-60"><LuPlus size={19} />Install this app</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-8 flex flex-col items-center gap-3 rounded-[16px] border border-primary/25 bg-gradient-to-r from-primary/[0.08] to-primary/[0.14] px-6 py-10 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-content"><LuCode size={26} /></span>
                <div className="text-[20px] font-medium">Need another integration?</div>
                <div className="max-w-[560px] text-[16px] text-base-content/70">Connect anything with a webhook, the public API or MCP.</div>
                <div className="mt-1 flex flex-wrap justify-center gap-3">
                  <button type="button" onClick={() => setOpen("webhook")} disabled={!data.can_edit} className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-primary px-5 text-[16px] font-semibold text-primary-content hover:bg-[var(--primary-hover)] disabled:opacity-60"><LuWebhook size={18} />Add a webhook</button>
                  <Link href="/settings?tab=api" className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-[var(--border-strong)] bg-base-100 px-5 text-[16px] font-medium hover:bg-base-200">API keys</Link>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {openApp && data && <ConnectDialog key={openApp.key} app={openApp} state={state(openApp.key)} callbackBase={data.oauth_callback_base}
        onClose={() => setOpen(null)} onChanged={() => { setOpen(null); void load(); }} />}
    </>
  );
}
