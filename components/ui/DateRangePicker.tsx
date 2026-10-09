import { useState } from "react";
import { DayPicker, type DateRange } from "react-day-picker";
import { addMonths, format, isAfter, parseISO, startOfDay, startOfMonth } from "date-fns";
import { RiArrowLeftSLine, RiArrowRightSLine } from "react-icons/ri";

/**
 * Calendars for the whole app (react-day-picker + date-fns): a range picker and a single-date
 * field. Weeks start on Monday; the header shows the year with the month under it.
 */

export const toDay = (d: Date) => format(d, "yyyy-MM-dd");
export const fromDay = (s: string | null | undefined) => (s ? parseISO(s) : undefined);

const DAY_CLASSES = {
  root: "w-full select-none",
  months: "relative",
  month: "w-full",
  month_caption: "hidden",
  month_grid: "w-full border-collapse",
  weekdays: "",
  weekday: "h-9 w-[14.28%] text-center text-[13px] font-normal text-base-content/50",
  week: "",
  day: "group/day p-0 text-center align-middle",
  day_button: "mx-auto my-[3px] flex h-11 w-full items-center justify-center text-[14px] text-base-content/80 outline-none transition-colors hover:bg-base-200 focus-visible:ring-2 focus-visible:ring-[var(--ring)] rounded-[8px]",
  today: "[&>button]:font-medium [&>button]:!text-primary",
  outside: "invisible",
  disabled: "[&>button]:cursor-not-allowed [&>button]:!text-base-content/25 [&>button]:hover:bg-transparent",
};
const ENDPOINT = "[&>button]:!bg-primary [&>button]:font-medium [&>button]:!text-primary-content";
/** Range: coral ends, a soft coral run between them. */
const RANGE_CLASSES = {
  ...DAY_CLASSES,
  range_start: `${ENDPOINT} [&>button]:rounded-r-none`,
  range_end: `${ENDPOINT} [&>button]:rounded-l-none`,
  range_middle: "[&>button]:rounded-none [&>button]:bg-primary/15 [&>button]:hover:bg-primary/25",
};
const SINGLE_CLASSES = { ...DAY_CLASSES, selected: ENDPOINT };

function Header({ month, setMonth, max }: { month: Date; setMonth: (d: Date) => void; max?: Date }) {
  const nextDisabled = !!max && !isAfter(startOfMonth(max), month);
  const btn = "flex h-9 w-9 items-center justify-center rounded-[8px] text-base-content/70 hover:bg-base-200 disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <div className="mb-1">
      <div className="flex items-center justify-between">
        <button type="button" className={btn} onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month"><RiArrowLeftSLine size={24} /></button>
        <div className="text-[17px] font-medium tabular-nums" aria-live="polite">{format(month, "yyyy")}</div>
        <button type="button" className={btn} onClick={() => setMonth(addMonths(month, 1))} disabled={nextDisabled} aria-label="Next month"><RiArrowRightSLine size={24} /></button>
      </div>
      <div className="mt-2 text-center text-[14px] text-base-content/70">{format(month, "MMMM")}</div>
    </div>
  );
}

/** Range calendar: `onChange` fires once both ends are picked. Future days are off by default. */
export function DateRangeCalendar({ value, onChange, allowFuture = false, title = "Pick a start and an end date", className = "w-[340px] max-w-[calc(100vw-32px)] p-4" }: {
  value: { from: string; to: string } | null; onChange: (r: { from: string; to: string }) => void; allowFuture?: boolean; title?: string; className?: string;
}) {
  const today = startOfDay(new Date());
  const [draft, setDraft] = useState<DateRange | undefined>(value ? { from: fromDay(value.from), to: fromDay(value.to) } : undefined);
  const [month, setMonth] = useState(startOfMonth(fromDay(value?.to) ?? today));
  return (
    <div className={className}>
      {title && <div className="mb-3 text-[14px] text-base-content/65">{title}</div>}
      <Header month={month} setMonth={setMonth} max={allowFuture ? undefined : today} />
      <DayPicker mode="range" weekStartsOn={1} month={month} onMonthChange={setMonth} hideNavigation
        selected={draft} disabled={allowFuture ? undefined : { after: today }} classNames={RANGE_CLASSES}
        formatters={{ formatWeekdayName: (d) => format(d, "EEEEE") }}
        onSelect={(_r, picked) => {
          // First click picks the start, second the end (either order); a third starts over.
          if (!draft?.from || draft.to) { setDraft({ from: picked, to: undefined }); return; }
          const [a, b] = isAfter(draft.from, picked) ? [picked, draft.from] : [draft.from, picked];
          setDraft({ from: a, to: b });
          onChange({ from: toDay(a), to: toDay(b) });
        }} />
    </div>
  );
}

/** Single date calendar (for date fields). */
export function DateCalendar({ value, onChange, min, max }: { value: string | null; onChange: (d: string | null) => void; min?: string; max?: string }) {
  const [month, setMonth] = useState(startOfMonth(fromDay(value) ?? new Date()));
  const disabled = [min ? { before: fromDay(min)! } : null, max ? { after: fromDay(max)! } : null].filter((x): x is { before: Date } | { after: Date } => !!x);
  return (
    <div className="w-[320px] max-w-[calc(100vw-32px)] p-4">
      <Header month={month} setMonth={setMonth} max={fromDay(max)} />
      <DayPicker mode="single" weekStartsOn={1} month={month} onMonthChange={setMonth} hideNavigation selected={fromDay(value)}
        disabled={disabled} classNames={SINGLE_CLASSES} formatters={{ formatWeekdayName: (d) => format(d, "EEEEE") }}
        onSelect={(d) => onChange(d ? toDay(d) : null)} />
    </div>
  );
}
