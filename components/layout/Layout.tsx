import { ReactNode } from "react";
import { useRouter } from "next/router";
import Image from "next/image";
import Sidebar from "./Sidebar";
import TourGate from "@/components/onboarding/TourGate";
import { useSidebarCollapsed } from "@/components/layout/useSidebar";
import { BRAND } from "@/lib/brand";

const hasNoLayout = (path: string) => path === "/login" || path === "/onboarding" || path.startsWith("/invite/");
/** Data-dense pages (the leads table) that use the full content width instead of the 1240px column. */
const WIDE_ROUTES = new Set(["/agents", "/agents/[id]", "/agents/new", "/copilot", "/contacts", "/lists", "/lists/[id]", "/inbox", "/insights", "/dashboard", "/leads"]);

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const collapsed = useSidebarCollapsed();

  if (hasNoLayout(router.pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-base-100">
      <TourGate />
      <Sidebar />
      <header className="sticky top-0 z-20 flex h-16 items-center gap-2.5 border-b border-[var(--border-subtle)] bg-base-100/90 px-4 backdrop-blur-sm md:hidden">
        <Image src={BRAND.logo} alt="" width={28} height={28} priority />
        <span className="text-[20px] font-semibold tracking-tight text-base-content">{BRAND.name}</span>
      </header>
      {/* The margin follows the sidebar (264px open, 84px collapsed) with the same easing. */}
      <main className={`min-h-screen px-4 pb-28 pt-6 transition-[margin] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] md:px-10 md:pb-14 md:pt-9 ${collapsed ? "md:ml-[84px]" : "md:ml-[264px]"}`}>
        <div className={`mx-auto w-full ${WIDE_ROUTES.has(router.pathname) ? "" : "max-w-[1240px]"}`}>{children}</div>
      </main>
    </div>
  );
}
