import Link from "next/link";
import { useState, type ReactNode } from "react";
import { RiAddBoxLine, RiContactsLine } from "react-icons/ri";
import ChooseAgentDialog from "@/components/contacts/ChooseAgentDialog";

/** Title, "Add leads" and the All contacts / Lists tabs shared by /contacts and /lists. */
export default function ContactsHeader({ tab, action }: { tab: "contacts" | "lists"; action?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const tabCls = (on: boolean) => `relative pb-3 text-[16px] transition-colors ${on ? "text-base-content after:absolute after:inset-x-0 after:-bottom-px after:h-[2px] after:rounded-full after:bg-base-content" : "text-base-content/45 hover:text-base-content/75"}`;
  return (
    <div className="-mt-2 mb-4 border-b border-[var(--border-subtle)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3"><RiContactsLine size={22} className="text-primary" /><div role="heading" aria-level={1} className="text-[24px] font-medium">Contacts</div></div>
          <p className="mt-1 pl-1 text-[16px] text-base-content/65">Manage and organize your contacts and lists</p>
        </div>
        {action ?? (
          <button type="button" onClick={() => setOpen(true)}
            className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-primary px-4 text-[15px] font-medium text-primary-content shadow-[0_4px_12px_-4px_rgba(204,120,92,0.6)] hover:bg-[var(--primary-hover)]">
            <RiAddBoxLine size={18} /> Add leads
          </button>
        )}
        {open && <ChooseAgentDialog onClose={() => setOpen(false)} />}
      </div>
      <nav className="mt-5 flex gap-8 pl-1" aria-label="Contacts sections">
        <Link href="/contacts" className={tabCls(tab === "contacts")} aria-current={tab === "contacts" ? "page" : undefined}>All contacts</Link>
        <Link href="/lists" className={tabCls(tab === "lists")} aria-current={tab === "lists" ? "page" : undefined}>Lists</Link>
      </nav>
    </div>
  );
}
