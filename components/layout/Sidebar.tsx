import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/router";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import {
  RiArrowUpCircleLine,
  RiCompassLine,
  RiContactsLine,
  RiInboxLine,
  RiLogoutBoxLine,
  RiPlayCircleLine,
  RiQuestionLine,
  RiSettings4Line,
  RiAccountCircleLine,
  RiPlugLine,
  RiArrowDownSLine,
  RiMenuLine,
  RiCloseLine,
  RiShieldUserLine,
  RiRobot2Line,
  RiBrainLine,
  RiDashboard3Line,
} from "react-icons/ri";
import { LuChartBarDecreasing } from "react-icons/lu";
import { pathToTourPage, replayPageTour } from "@/lib/tour";

const LEARNING_PLAYLIST_URL = "https://www.youtube.com/playlist?list=PLBf6xNJOmsIQ";

const dailyNav = [
  { href: "/dashboard", label: "Dashboard", icon: RiDashboard3Line, tour: "nav-dashboard" },
  { href: "/copilot", label: "Copilot", icon: RiBrainLine, tour: "nav-copilot" },
  { href: "/agents", label: "Agents", icon: RiRobot2Line, tour: "nav-agents" },
  // Contacts covers both "All contacts" and "Lists" (tabs on the page).
  { href: "/contacts", label: "Contacts", icon: RiContactsLine, tour: "nav-contacts" },
  { href: "/inbox", label: "Inbox", icon: RiInboxLine, tour: "nav-inbox" },
  { href: "/insights", label: "Insights", icon: LuChartBarDecreasing, tour: "nav-insights" },
];

// Only rendered for instance administrators (SUPERADMIN_EMAILS). The flag is a UI
// affordance only - /admin and /api/admin/* re-check the allowlist server-side.
const adminNav = [
  { href: "/admin", label: "Platform admin", icon: RiShieldUserLine, tour: "nav-admin" },
];

// Agents and Inbox sit on the phone bar. Records and workspace tools live in More.
const mobilePrimary = [dailyNav[0], dailyNav[1], dailyNav[2]];

export const SIDEBAR_WIDTH_EXPANDED = 264;
export const SIDEBAR_WIDTH_COLLAPSED = 264;

type NavItem = (typeof dailyNav)[number] | (typeof adminNav)[number];

/** Settings sub-pages in the sidebar group. */
const settingsNav = [
  { href: "/settings", label: "Account settings", icon: RiAccountCircleLine, tab: null },
  { href: "/settings?tab=integrations", label: "Integrations", icon: RiPlugLine, tab: "integrations" },
] as const;

function initials(value?: string | null) {
  if (!value) return "LK";
  return value.split(/\s|@/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

export default function Sidebar({ onCollapse }: { onCollapse?: (collapsed: boolean) => void }) {
  const router = useRouter();
  const { data: session } = useSession();
  const isSuperadmin = Boolean(session?.user?.isSuperadmin);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [hasCrm, setHasCrm] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const onSettings = ["/settings", "/accounts"].some((p) => router.pathname.startsWith(p));
  const [settingsOpen, setSettingsOpen] = useState(onSettings);
  const helpRef = useRef<HTMLDivElement>(null);
  const tourPage = pathToTourPage(router.pathname);

  useEffect(() => { onCollapse?.(false); }, [onCollapse]);
  // Close the mobile menu whenever navigation happens.
  useEffect(() => { setMenuOpen(false); }, [router.pathname]);

  useEffect(() => {
    if (!helpOpen) return;
    function onClick(event: MouseEvent) {
      if (helpRef.current && !helpRef.current.contains(event.target as Node)) setHelpOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [helpOpen]);

  useEffect(() => {
    fetch("/api/premium-status").then((response) => response.ok ? response.json() : null)
      .then((data) => { if (data) setHasCrm(Boolean(data.capabilities?.crm)); }).catch(() => {});
    fetch("/api/system/update").then((response) => response.json()).then((data) => {
      setCurrentVersion(data.current ?? null);
      setUpdateAvailable(Boolean(data.updateAvailable));
      setLatestVersion(data.latest ?? null);
    }).catch(() => {});
  }, []);

  function isActive(href: string) {
    if (href === "/") return router.pathname === "/";
    if (href === "/settings") return ["/settings", "/accounts"].some((path) => router.pathname.startsWith(path));
    if (href === "/contacts") return ["/contacts", "/lists"].some((path) => router.pathname.startsWith(path));
    return router.pathname.startsWith(href);
  }

  /** Settings: expands to Account settings and Integrations (tabs of /settings). */
  function SettingsGroup({ mobile = false }: { mobile?: boolean }) {
    const tab = typeof router.query.tab === "string" ? router.query.tab : null;
    const row = mobile ? "h-11 text-[15px]" : "h-10 text-[14px]";
    return (
      <div>
        <button type="button" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((v) => !v)} data-tour="nav-settings"
          className={`group flex w-full items-center gap-3 rounded-[8px] px-3 font-medium transition-colors ${row} ${onSettings ? "bg-base-300 text-base-content" : "text-base-content/65 hover:bg-base-300 hover:text-base-content"}`}>
          <RiSettings4Line size={18} className={onSettings ? "text-base-content" : "text-base-content/45 group-hover:text-base-content/75"} />
          <span className="flex-1 text-left">Settings</span>
          <RiArrowDownSLine size={18} className={`text-base-content/55 transition-transform duration-200 ${settingsOpen ? "rotate-180" : ""}`} />
        </button>
        <div className={`grid transition-[grid-template-rows] duration-200 ${settingsOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
          <div className="overflow-hidden">
            <div className="ml-[21px] mt-1 space-y-1 border-l border-[var(--border-subtle)] pl-3">
              {settingsNav.map((s) => {
                const active = router.pathname === "/settings" && (s.tab ? tab === s.tab : tab !== "integrations");
                return (
                  <Link key={s.href} href={s.href} onClick={() => setMenuOpen(false)} tabIndex={settingsOpen ? undefined : -1} aria-current={active ? "page" : undefined}
                    className={`group flex items-center gap-3 rounded-[8px] px-3 font-medium transition-colors ${row} ${active ? "text-base-content" : "text-base-content/65 hover:bg-base-300 hover:text-base-content"}`}>
                    <s.icon size={18} className={active ? "text-base-content" : "text-base-content/45 group-hover:text-base-content/75"} />{s.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function NavLink({ item }: { item: NavItem }) {
    const active = isActive(item.href);
    if ("premium" in item && item.premium && !hasCrm) return null;
    return (
      <Link
        href={item.href}
        data-tour={item.tour}
        aria-current={active ? "page" : undefined}
        className={`group relative flex h-10 items-center gap-3 rounded-[8px] px-3 text-[14px] transition-colors ${
          active
            ? "bg-base-300 font-medium text-base-content"
            : "font-medium text-base-content/65 hover:bg-base-300 hover:text-base-content"
        }`}
      >
        <item.icon size={18} className={active ? "text-base-content" : "text-base-content/45 group-hover:text-base-content/75"} />
        <span>{item.label}</span>
      </Link>
    );
  }

  const accountName = session?.user?.email ?? "Linki workspace";

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col border-r border-[var(--border-subtle)] bg-base-100 md:flex">
        <Link href="/dashboard" className="flex h-16 shrink-0 items-center gap-3 px-5">
          <Image src="/logo_linki.svg" alt="Linki" width={28} height={28} priority />
          <span className="font-display text-[22px] text-base-content">Linki</span>
        </Link>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          <NavSection label="" items={dailyNav} renderItem={(item) => <NavLink key={item.href} item={item} />} after={<SettingsGroup />} />
          {isSuperadmin && (
            <NavSection label="Instance" items={adminNav} renderItem={(item) => <NavLink key={item.href} item={item} />} />
          )}
        </div>

        <div className="shrink-0 p-3">
          {updateAvailable && (
            <div className="mb-2 rounded-[10px] border border-warning/25 bg-warning/[0.08] p-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-warning">
                <RiArrowUpCircleLine size={15} /> Update available
              </div>
              <p className="mt-1 text-[10px] text-warning/70">Linki {latestVersion ? `v${latestVersion}` : "has a new release"}</p>
            </div>
          )}

          <div className="relative" ref={helpRef}>
            <button
              type="button"
              onClick={() => setHelpOpen((open) => !open)}
              className="flex h-10 w-full items-center gap-3 rounded-[10px] px-3 text-[14px] font-medium text-base-content/65 transition-colors hover:bg-base-300 hover:text-base-content"
            >
              <RiQuestionLine size={18} className="text-base-content/45" /> Help & learning
            </button>
            {helpOpen && (
              <div className="absolute bottom-12 left-0 w-full overflow-hidden rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-1.5 shadow-[var(--shadow-popover)]">
                {tourPage && (
                  <button
                    type="button"
                    onClick={() => { replayPageTour(tourPage); setHelpOpen(false); }}
                    className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13px] text-base-content/70 hover:bg-base-200 hover:text-base-content"
                  >
                    <RiCompassLine size={15} /> Replay page tour
                  </button>
                )}
                <a href={LEARNING_PLAYLIST_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-[13px] text-base-content/70 hover:bg-base-200 hover:text-base-content">
                  <RiPlayCircleLine size={15} /> Learning resources
                </a>
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center gap-3 rounded-[12px] border border-[var(--border-subtle)] bg-base-300 p-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-neutral text-[11px] font-semibold text-neutral-content">
              {initials(accountName)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold text-base-content/85">{accountName}</p>
              <p className="text-[10px] text-base-content/45">{currentVersion ? `v${currentVersion}` : "Self-hosted"}</p>
            </div>
            <button type="button" onClick={() => signOut({ callbackUrl: "/login" })} title="Sign out" className="flex h-8 w-8 items-center justify-center rounded-[9px] text-base-content/50 transition-colors hover:bg-error/10 hover:text-error">
              <RiLogoutBoxLine size={15} />
            </button>
          </div>
        </div>
      </aside>

      <nav aria-label="Primary navigation" className="fixed inset-x-3 bottom-3 z-40 flex h-16 items-center justify-around rounded-[16px] border border-[var(--border-subtle)] bg-base-100 px-2 shadow-[var(--shadow-popover)] md:hidden">
        {mobilePrimary.map((item) => {
          const active = isActive(item.href);
          return (
            <Link key={item.href} href={item.href} aria-label={item.label} aria-current={active ? "page" : undefined} className={`flex h-11 w-11 items-center justify-center rounded-[12px] transition-colors ${active ? "bg-base-300 text-base-content" : "text-base-content/55"}`}>
              <item.icon size={20} />
            </Link>
          );
        })}
        <button type="button" aria-label="More" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)} className="flex h-11 w-11 items-center justify-center rounded-[12px] text-base-content/55">
          <RiMenuLine size={20} />
        </button>
      </nav>

      {/* Full mobile menu — every page (Settings, People, Companies, Tasks, Deliverability…). */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col overflow-y-auto rounded-t-[20px] border-t border-[var(--border-subtle)] bg-base-100 px-4 pb-8 pt-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-base-content">Menu</span>
              <button type="button" aria-label="Close menu" onClick={() => setMenuOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-base-content/50 hover:bg-base-200">
                <RiCloseLine size={18} />
              </button>
            </div>
            <div className="space-y-4">
              <MobileSection label="" items={dailyNav} render={(item) => <MobileLink key={item.href} item={item} />} />
              <SettingsGroup mobile />
              {isSuperadmin && <MobileSection label="Instance" items={adminNav} render={(item) => <MobileLink key={item.href} item={item} />} />}
              <div className="flex items-center gap-3 rounded-[12px] border border-[var(--border-subtle)] bg-base-200 p-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-neutral text-[11px] font-semibold text-neutral-content">{initials(accountName)}</div>
                <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-base-content/85">{accountName}</p>
                <button type="button" onClick={() => signOut({ callbackUrl: "/login" })} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-base-content/60 hover:bg-error/10 hover:text-error">
                  <RiLogoutBoxLine size={15} /> Sign out
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );

  function MobileLink({ item }: { item: NavItem }) {
    if ("premium" in item && item.premium && !hasCrm) return null;
    const active = isActive(item.href);
    return (
      <Link href={item.href} onClick={() => setMenuOpen(false)} aria-current={active ? "page" : undefined} className={`flex h-11 items-center gap-3 rounded-[8px] px-3 text-[15px] ${active ? "bg-base-300 font-medium text-base-content" : "font-medium text-base-content/70 hover:bg-base-200"}`}>
        <item.icon size={19} className={active ? "text-base-content" : "text-base-content/45"} /> <span>{item.label}</span>
      </Link>
    );
  }
}

function MobileSection({ label, items, render }: { label: string; items: readonly NavItem[]; render: (item: NavItem) => React.ReactNode }) {
  return (
    <div>
      {label ? <h3 className="mb-1 px-3 text-[11px] font-semibold tracking-[0.04em] text-base-content/40">{label}</h3> : null}
      <div className="space-y-1">{items.map(render)}</div>
    </div>
  );
}

function NavSection<T>({ label, items, renderItem, after }: { label: string; items: readonly T[]; renderItem: (item: T) => React.ReactNode; after?: React.ReactNode }) {
  return (
    <section className="mb-6">
      {label ? <h2 className="mb-2 px-3 text-[11px] font-semibold tracking-[0.04em] text-base-content/40">{label}</h2> : null}
      <nav className="space-y-1">{items.map(renderItem)}{after}</nav>
    </section>
  );
}
