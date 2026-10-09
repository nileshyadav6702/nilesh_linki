import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/router";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  LuBrain, LuChartLine, LuChevronDown, LuChevronLeft, LuChevronRight, LuCircleArrowUp, LuCircleHelp, LuCirclePlay, LuCircleUser, LuCompass,
  LuGauge, LuLogOut, LuMail, LuMenu, LuPlug, LuSettings, LuShieldCheck, LuUsers, LuWorkflow, LuX,
} from "react-icons/lu";
import { useDismiss } from "@/components/agents/leads/Listbox";
import Notifications from "@/components/layout/Notifications";
import { SIDEBAR_WIDTH, setSidebarCollapsed, useSidebarCollapsed } from "@/components/layout/useSidebar";
import { BRAND } from "@/lib/brand";
import { pathToTourPage, replayPageTour } from "@/lib/tour";

const LEARNING_PLAYLIST_URL = "https://www.youtube.com/playlist?list=PLBf6xNJOmsIQ";

type Icon = ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
interface NavItem { href: string; label: string; icon: Icon; tour: string }

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LuGauge, tour: "nav-dashboard" },
  { href: "/copilot", label: "Copilot", icon: LuBrain, tour: "nav-copilot" },
  { href: "/agents", label: "Agents", icon: LuWorkflow, tour: "nav-agents" },
  // Contacts covers both "All contacts" and "Lists" (tabs on the page).
  { href: "/contacts", label: "Contacts", icon: LuUsers, tour: "nav-contacts" },
  { href: "/inbox", label: "Inbox", icon: LuMail, tour: "nav-inbox" },
  { href: "/insights", label: "Insights", icon: LuChartLine, tour: "nav-insights" },
];
// Only rendered for instance administrators (SUPERADMIN_EMAILS); /admin re-checks server-side.
const ADMIN: NavItem = { href: "/admin", label: "Platform admin", icon: LuShieldCheck, tour: "nav-admin" };
const SETTINGS = [
  { href: "/settings", label: "Account settings", icon: LuCircleUser, tab: null },
  { href: "/settings?tab=integrations", label: "Integrations", icon: LuPlug, tab: "integrations" },
] as const;
const MOBILE_PRIMARY = NAV.slice(0, 3);

const EASE = [0.22, 1, 0.36, 1] as const;

function initials(value?: string | null) {
  if (!value) return "K";
  return value.split(/\s|@/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

/** Label that fades / slides with the sidebar (hidden while collapsed). */
function Label({ show, children, className = "" }: { show: boolean; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }} transition={{ duration: 0.16 }}
          className={`min-w-0 truncate whitespace-nowrap ${className}`}>
          {children}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** Tooltip to the right of an icon, only while collapsed. */
function Tip({ show, text }: { show: boolean; text: string }) {
  if (!show) return null;
  return (
    <span role="tooltip" className="pointer-events-none invisible absolute left-full top-1/2 z-[60] ml-3 -translate-y-1/2 -translate-x-1 whitespace-nowrap rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-3 py-1.5 text-[14px] font-medium text-base-content opacity-0 shadow-[var(--shadow-overlay)] transition-all duration-150 group-hover:visible group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100">
      {text}
    </span>
  );
}

export default function Sidebar() {
  const router = useRouter();
  const { data: session } = useSession();
  const reduce = useReducedMotion();
  const collapsed = useSidebarCollapsed();
  const open = !collapsed;
  const width = open ? SIDEBAR_WIDTH.open : SIDEBAR_WIDTH.closed;
  const isSuperadmin = Boolean(session?.user?.isSuperadmin);
  const onSettings = ["/settings", "/accounts"].some((p) => router.pathname.startsWith(p));
  const [settingsOpen, setSettingsOpen] = useState(onSettings);
  const [helpOpen, setHelpOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [update, setUpdate] = useState<{ current: string | null; latest: string | null; available: boolean }>({ current: null, latest: null, available: false });
  const helpRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  useDismiss(helpOpen, [helpRef], () => setHelpOpen(false));
  useDismiss(accountOpen, [accountRef], () => setAccountOpen(false));
  const tourPage = pathToTourPage(router.pathname);

  useEffect(() => {
    fetch("/api/system/update").then((r) => r.json()).then((d) => setUpdate({ current: d.current ?? null, latest: d.latest ?? null, available: Boolean(d.updateAvailable) })).catch(() => {});
  }, []);
  // Close the phone menu whenever navigation happens.
  useEffect(() => {
    const close = () => setMenuOpen(false);
    router.events.on("routeChangeStart", close);
    return () => router.events.off("routeChangeStart", close);
  }, [router.events]);

  const isActive = (href: string) => (href === "/contacts" ? ["/contacts", "/lists"].some((p) => router.pathname.startsWith(p)) : router.pathname.startsWith(href));
  const tab = typeof router.query.tab === "string" ? router.query.tab : null;
  const name = session?.user?.name ?? session?.user?.email?.split("@")[0] ?? "You";
  const email = session?.user?.email ?? "";
  const row = (active: boolean) => `group relative flex h-[54px] items-center rounded-[12px] text-[17px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${open ? "gap-4 px-4" : "justify-center"} ${active ? "bg-primary/[0.12] text-base-content" : "text-base-content/65 hover:bg-base-content/[0.05] hover:text-base-content"}`;

  const navLink = (item: NavItem) => {
    const active = isActive(item.href);
    return (
      <Link key={item.href} href={item.href} data-tour={item.tour} aria-current={active ? "page" : undefined} aria-label={open ? undefined : item.label} className={row(active)}>
        {active && <motion.span layoutId="nav-active" transition={{ duration: reduce ? 0 : 0.28, ease: EASE }} className="absolute -left-4 top-1/2 h-7 w-[4px] -translate-y-1/2 rounded-r-full bg-primary" />}
        <item.icon size={24} strokeWidth={1.75} className={`shrink-0 transition-colors ${active ? "text-base-content" : "text-base-content/60 group-hover:text-base-content"}`} />
        <Label show={open}>{item.label}</Label>
        <Tip show={!open} text={item.label} />
      </Link>
    );
  };

  return (
    <>
      <motion.aside initial={false} animate={{ width }} transition={{ duration: reduce ? 0 : 0.3, ease: EASE }}
        className="fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-[var(--border-subtle)] bg-base-100 md:flex">
        {/* Brand, notifications, collapse */}
        <div className={`flex shrink-0 items-center pt-5 ${open ? "h-[84px] gap-2 px-6" : "h-[84px] justify-center px-0"}`}>
          <Link href="/dashboard" aria-label={`${BRAND.name} home`} className="flex min-w-0 flex-1 items-center gap-2.5" style={open ? undefined : { flex: "none" }}>
            <Image src={BRAND.logo} alt="" width={36} height={36} priority className="shrink-0" />
            <Label show={open} className="text-[27px] font-semibold tracking-tight text-base-content">{BRAND.name}</Label>
          </Link>
          {open && <Notifications sidebarWidth={width} />}
          {open && (
            <button type="button" onClick={() => setSidebarCollapsed(true)} aria-label="Collapse sidebar" title="Collapse sidebar"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-base-content/55 transition-colors hover:bg-base-200 hover:text-base-content"><LuChevronLeft size={24} /></button>
          )}
        </div>
        {!open && (
          <div className="flex flex-col items-center gap-1 pt-3">
            <button type="button" onClick={() => setSidebarCollapsed(false)} aria-label="Expand sidebar"
              className="group relative flex h-10 w-10 items-center justify-center rounded-[10px] text-base-content/55 transition-colors hover:bg-base-200 hover:text-base-content">
              <LuChevronRight size={24} /><Tip show text="Expand" />
            </button>
            <Notifications sidebarWidth={width} />
          </div>
        )}

        <nav aria-label="Primary" className={`flex-1 px-4 pb-4 pt-6 ${open ? "overflow-y-auto" : ""}`}>
          <div className="space-y-2">
            {NAV.map(navLink)}
          </div>

          <div className="mt-8">
            {open ? (
              <>
                <button type="button" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((v) => !v)} data-tour="nav-settings" className={`${row(onSettings && !settingsOpen)} w-full`}>
                  {onSettings && !settingsOpen && <motion.span layoutId="nav-active" className="absolute -left-4 top-1/2 h-7 w-[4px] -translate-y-1/2 rounded-r-full bg-primary" />}
                  <LuSettings size={24} strokeWidth={1.75} className="shrink-0 text-base-content/60 group-hover:text-base-content" />
                  <Label show className="flex-1 text-left text-[17px] font-medium">Settings</Label>
                  <LuChevronDown size={19} className={`shrink-0 text-base-content/55 transition-transform duration-200 ${settingsOpen ? "rotate-180" : ""}`} />
                </button>
                <AnimatePresence initial={false}>
                  {settingsOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reduce ? 0 : 0.22, ease: EASE }} className="overflow-hidden">
                      <div className="ml-[27px] mt-1.5 space-y-1.5 border-l border-[var(--border-subtle)] pl-3">
                        {SETTINGS.map((s) => {
                          const active = router.pathname === "/settings" && (s.tab ? tab === s.tab : tab !== "integrations");
                          return (
                            <Link key={s.href} href={s.href} aria-current={active ? "page" : undefined} className={row(active)}>
                              {active && <motion.span layoutId="nav-active" transition={{ duration: reduce ? 0 : 0.28, ease: EASE }} className="absolute -left-[13px] top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-primary" />}
                              <s.icon size={22} strokeWidth={1.75} className={`shrink-0 ${active ? "text-base-content" : "text-base-content/55 group-hover:text-base-content"}`} />
                              <span className="truncate whitespace-nowrap">{s.label}</span>
                            </Link>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            ) : (
              <Link href="/settings" aria-label="Settings" data-tour="nav-settings" className={row(onSettings)}>
                {onSettings && <motion.span layoutId="nav-active" className="absolute -left-4 top-1/2 h-7 w-[4px] -translate-y-1/2 rounded-r-full bg-primary" />}
                <LuSettings size={24} strokeWidth={1.75} className={`shrink-0 ${onSettings ? "text-base-content" : "text-base-content/60 group-hover:text-base-content"}`} />
                <Tip show text="Settings" />
              </Link>
            )}
            {isSuperadmin && <div className="mt-1.5">{navLink(ADMIN)}</div>}
          </div>
        </nav>

        <div className="shrink-0 space-y-2 border-t border-[var(--border-subtle)] p-4">
          {update.available && open && (
            <div className="mb-1 flex items-start gap-2.5 rounded-[10px] border border-warning/25 bg-warning/[0.08] px-3 py-2.5">
              <LuCircleArrowUp size={17} className="mt-0.5 shrink-0 text-warning" />
              <div className="min-w-0 text-[12px] leading-snug"><div className="font-semibold text-warning">Update available</div><div className="text-warning/75">{BRAND.name} {update.latest ? `v${update.latest}` : "has a new release"}</div></div>
            </div>
          )}

          <div ref={helpRef} className="relative">
            <button type="button" onClick={() => setHelpOpen((v) => !v)} aria-expanded={helpOpen} aria-label={open ? undefined : "Help & learning"} className={`${row(false)} w-full`}>
              <LuCircleHelp size={24} strokeWidth={1.75} className="shrink-0 text-base-content/60 group-hover:text-base-content" />
              <Label show={open} className="text-[17px] font-medium">Help &amp; learning</Label>
              <Tip show={!open && !helpOpen} text="Help & learning" />
            </button>
            <AnimatePresence>
              {helpOpen && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.14 }}
                  className={`absolute z-[60] w-[240px] rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-1.5 shadow-[var(--shadow-overlay)] ${open ? "bottom-full left-0 mb-2" : "bottom-0 left-full ml-3"}`}>
                  {tourPage && (
                    <button type="button" onClick={() => { replayPageTour(tourPage); setHelpOpen(false); }} className="flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2.5 text-left text-[14px] text-base-content/80 hover:bg-base-200 hover:text-base-content">
                      <LuCompass size={17} /> Replay page tour
                    </button>
                  )}
                  <a href={LEARNING_PLAYLIST_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 rounded-[8px] px-3 py-2.5 text-[14px] text-base-content/80 hover:bg-base-200 hover:text-base-content">
                    <LuCirclePlay size={17} /> Learning resources
                  </a>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div ref={accountRef} className="relative">
            <button type="button" onClick={() => setAccountOpen((v) => !v)} aria-expanded={accountOpen} aria-label={`Account: ${email || name}`}
              className={`group relative flex w-full items-center rounded-[12px] transition-colors hover:bg-base-200/80 ${open ? "gap-3 p-2" : "justify-center p-1.5"} ${accountOpen ? "bg-base-200/80" : ""}`}>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#f29a6b] to-[#d4553a] text-[15px] font-semibold text-white">{initials(name)}</span>
              {open && (
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-[16px] font-semibold text-base-content">{name}</span>
                  <span className="block truncate text-[12px] text-base-content/50">{email || (update.current ? `v${update.current}` : "Self-hosted")}</span>
                </span>
              )}
              <Tip show={!open && !accountOpen} text={email || name} />
            </button>
            <AnimatePresence>
              {accountOpen && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.14 }}
                  className={`absolute z-[60] w-[240px] rounded-[14px] border border-[var(--border-subtle)] bg-base-100 p-1.5 shadow-[var(--shadow-overlay)] ${open ? "bottom-full left-0 mb-2" : "bottom-0 left-full ml-3"}`}>
                  <div className="border-b border-[var(--border-subtle)] px-3 pb-2.5 pt-2">
                    <div className="truncate text-[14px] font-semibold">{name}</div>
                    <div className="truncate text-[12px] text-base-content/50">{email}{update.current ? ` · v${update.current}` : ""}</div>
                  </div>
                  <button type="button" onClick={() => signOut({ callbackUrl: "/login" })} className="mt-1 flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2.5 text-left text-[15px] text-error hover:bg-error/10">
                    <LuLogOut size={17} /> Sign out
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.aside>

      {/* Phone: bottom bar with the first pages, and a full menu. */}
      <nav aria-label="Primary navigation" className="fixed inset-x-3 bottom-3 z-40 flex h-16 items-center justify-around rounded-[16px] border border-[var(--border-subtle)] bg-base-100 px-2 shadow-[var(--shadow-popover)] md:hidden">
        {MOBILE_PRIMARY.map((item) => {
          const active = isActive(item.href);
          return (
            <Link key={item.href} href={item.href} aria-label={item.label} aria-current={active ? "page" : undefined} className={`flex h-11 w-11 items-center justify-center rounded-[12px] transition-colors ${active ? "bg-primary/[0.09] text-base-content" : "text-base-content/55"}`}>
              <item.icon size={24} strokeWidth={1.75} />
            </Link>
          );
        })}
        <button type="button" aria-label="More" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)} className="flex h-11 w-11 items-center justify-center rounded-[12px] text-base-content/55"><LuMenu size={21} /></button>
      </nav>

      <AnimatePresence>
        {menuOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <motion.button type="button" aria-label="Close menu" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ duration: 0.28, ease: EASE }}
              className="absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col overflow-y-auto rounded-t-[20px] border-t border-[var(--border-subtle)] bg-base-100 px-4 pb-8 pt-3">
              <div className="mb-3 flex items-center justify-between">
                <span className="flex items-center gap-2"><Image src={BRAND.logo} alt="" width={24} height={24} /><span className="text-[16px] font-semibold">{BRAND.name}</span></span>
                <button type="button" aria-label="Close menu" onClick={() => setMenuOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg text-base-content/55 hover:bg-base-200"><LuX size={19} /></button>
              </div>
              <div className="space-y-1">
                {[...NAV, ...(isSuperadmin ? [ADMIN] : [])].map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`flex h-12 items-center gap-3.5 rounded-[10px] px-3 text-[16px] font-medium ${active ? "bg-primary/[0.09] text-base-content" : "text-base-content/75 hover:bg-base-200"}`}>
                      <item.icon size={24} strokeWidth={1.75} className={active ? "text-base-content" : "text-base-content/55"} />{item.label}
                    </Link>
                  );
                })}
                {SETTINGS.map((s) => (
                  <Link key={s.href} href={s.href} className="flex h-12 items-center gap-3.5 rounded-[10px] px-3 text-[16px] font-medium text-base-content/75 hover:bg-base-200">
                    <s.icon size={24} strokeWidth={1.75} className="text-base-content/55" />{s.label}
                  </Link>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-3 rounded-[12px] border border-[var(--border-subtle)] bg-base-200/60 p-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#f29a6b] to-[#d4553a] text-[14px] font-semibold text-white">{initials(name)}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-semibold">{name}</span><span className="block truncate text-[12px] text-base-content/50">{email}</span></span>
                <button type="button" onClick={() => signOut({ callbackUrl: "/login" })} className="inline-flex items-center gap-1.5 rounded-[8px] px-3 py-2 text-[14px] text-error hover:bg-error/10"><LuLogOut size={16} /> Sign out</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
