import { RiLinkedinBoxFill, RiMailFill } from "react-icons/ri";

/** Shared bits of the Inbox: types, avatar with channel badge, relative time. */

export interface ThreadRow {
  id: string; channel: "linkedin" | "email"; account_id: string; subject: string | null; participant_name: string | null; participant_headline: string | null;
  participant_email: string | null; participant_url: string | null; participant_photo: string | null; target_id: string | null; snippet: string | null;
  last_message_at: string; unread: number; interested: number; archived: number; has_inbound: number;
}

export interface Message { id: string; direction: "in" | "out"; sender_name: string | null; sender_email: string | null; body_text: string | null; body_html: string | null; sent_at: string }

export interface AccountsInfo {
  all: number;
  linkedin: { total: number; accounts: Array<{ id: string; name: string; count: number }> };
  email: { total: number; accounts: Array<{ id: string; name: string; provider: string; count: number }> };
  sync: Array<{ kind: string; id: string; synced_at: string | null; error: string | null; running: boolean }>;
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  const units: Array<[number, string]> = [[31536000, "year"], [2592000, "month"], [86400, "day"], [3600, "hour"], [60, "minute"]];
  for (const [n, u] of units) if (s >= n) { const v = Math.floor(s / n); return `${v} ${u}${v === 1 ? "" : "s"} ago`; }
  return "just now";
}

export function PersonAvatar({ name, photo, channel, size = 44 }: { name: string | null; photo?: string | null; channel?: "linkedin" | "email"; size?: number }) {
  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {photo
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={photo} alt="" className="h-full w-full rounded-full object-cover ring-1 ring-[var(--border-subtle)]" />
        : <span className="flex h-full w-full items-center justify-center rounded-full bg-[#ece9fb] text-[15px] font-medium text-[#5b4fd6]">{initial}</span>}
      {channel && (
        <span className={`absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-base-100 ring-2 ring-base-100 ${channel === "linkedin" ? "text-[#0a66c2]" : "text-[#e2603f]"}`}>
          {channel === "linkedin" ? <RiLinkedinBoxFill size={16} /> : <RiMailFill size={14} />}
        </span>
      )}
    </span>
  );
}
