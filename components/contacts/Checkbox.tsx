import { RiCheckLine, RiSubtractLine } from "react-icons/ri";

/** Row selection checkbox drawn explicitly so it stays visible on the cream theme. */
export default function Checkbox({ checked, indeterminate = false, onChange, label }: { checked: boolean; indeterminate?: boolean; onChange: (v: boolean) => void; label: string }) {
  const on = checked || indeterminate;
  return (
    <label className="relative inline-flex h-6 w-6 cursor-pointer items-center justify-center" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" className="peer absolute inset-0 cursor-pointer opacity-0" aria-label={label} checked={checked}
        ref={(el) => { if (el) el.indeterminate = indeterminate; }} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden="true" className={`flex h-[20px] w-[20px] items-center justify-center rounded-[5px] border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ring)] ${on ? "border-[#4f46e5] bg-[#4f46e5] text-white" : "border-base-content/40 bg-base-100 peer-hover:border-base-content/70"}`}>
        {indeterminate ? <RiSubtractLine size={14} /> : checked ? <RiCheckLine size={15} /> : null}
      </span>
    </label>
  );
}
