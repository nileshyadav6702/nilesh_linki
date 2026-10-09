import type { IconType } from "react-icons";
import { SiHubspot, SiSalesforce, SiSlack, SiZapier, SiZoho } from "react-icons/si";
import { LuWebhook } from "react-icons/lu";
import type { AppDef } from "@/lib/integrations/catalog";

/** Brand mark for an app: the official glyph where an icon set has one, else its initials in brand colour. */
const ICONS: Record<string, IconType> = { hubspot: SiHubspot, salesforce: SiSalesforce, slack: SiSlack, zapier: SiZapier, zoho: SiZoho, webhook: LuWebhook };

export default function AppLogo({ app, size = 56 }: { app: AppDef; size?: number }) {
  const Icon = ICONS[app.key];
  return (
    <span className="flex shrink-0 items-center justify-center rounded-[12px] border border-[var(--border-subtle)] bg-base-100" style={{ width: size, height: size }}>
      {Icon ? <Icon size={size * 0.52} style={{ color: app.color }} />
        : <span className="flex items-center justify-center rounded-[8px] font-bold text-white" style={{ width: size * 0.66, height: size * 0.66, background: app.color, fontSize: size * (app.mark.length > 1 ? 0.24 : 0.32) }}>{app.mark}</span>}
    </span>
  );
}
