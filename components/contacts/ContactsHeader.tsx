import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { RiAddBoxLine, RiArrowDownSLine, RiContactsLine, RiFileList3Line, RiSparkling2Line } from "react-icons/ri";
import { useDismiss } from "@/components/agents/leads/Listbox";

/** Title, "Add leads" and the All contacts / Lists tabs shared by /contacts and /lists. */
export default function ContactsHeader({ tab, action }: { tab: "contacts" | "lists"; action?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(open, [wrap], () => setOpen(false));
  const tabCls = (on: boolean) => `relative pb-3 text-[16px] transition-colors ${on ? "text-base-content after:absolute after:inset-x-0 after:-bottom-px after:h-[2px] after:rounded-full after:bg-base-content" : "text-base-content/45 hover:text-base-content/75"}`;
  return (
    <div className="-mt-2 mb-4 border-b border-[var(--border-subtle)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3"><RiContactsLine size={22} className="text-primary" /><div role="heading" aria-level={1} className="text-[24px] font-medium">Contacts</div></div>
          <p className="mt-1 pl-1 text-[16px] text-base-content/65">Manage and organize your contacts and lists</p>
        </div>
        {action ?? (
          <div ref={wrap} className="relative">
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
              className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-primary px-4 text-[15px] font-medium text-primary-content shadow-[0_4px_12px_-4px_rgba(204,120,92,0.6)] hover:bg-[var(--primary-hover)]">
              <RiAddBoxLine size={18} /> Add leads <RiArrowDownSLine size={18} className={`transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (
              <div className="wizard-rise absolute right-0 top-full z-40 mt-2 w-72 overflow-hidden rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-1 shadow-[var(--shadow-overlay)]">
                <Link href="/lists?new=1" className="flex items-start gap-3 rounded-[8px] px-3 py-2.5 hover:bg-base-200">
                  <RiFileList3Line size={18} className="mt-0.5 text-base-content/60" />
                  <span><span className="block text-[15px]">Import into a list</span><span className="block text-[13px] text-base-content/55">CSV or Sales Navigator</span></span>
                </Link>
                <Link href="/agents/new" className="flex items-start gap-3 rounded-[8px] px-3 py-2.5 hover:bg-base-200">
                  <RiSparkling2Line size={18} className="mt-0.5 text-primary" />
                  <span><span className="block text-[15px]">Find leads with an AI agent</span><span className="block text-[13px] text-base-content/55">Signals, lookalikes and more</span></span>
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
      <nav className="mt-5 flex gap-8 pl-1" aria-label="Contacts sections">
        <Link href="/contacts" className={tabCls(tab === "contacts")} aria-current={tab === "contacts" ? "page" : undefined}>All contacts</Link>
        <Link href="/lists" className={tabCls(tab === "lists")} aria-current={tab === "lists" ? "page" : undefined}>Lists</Link>
      </nav>
    </div>
  );
}
