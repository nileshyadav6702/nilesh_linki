import { LuWebhook } from "react-icons/lu";
import type { AppDef } from "@/lib/integrations/catalog";

/** Company logo from public/integrations; the generic webhook glyph, or initials in brand colour, otherwise. */
const LOGOS: Record<string, string> = {
  apollo: "apollo.png", attio: "attio.png", breakcold: "breakcold.png", clay: "clay.png", folk: "folk.png", heyreach: "heyreach.png",
  hubspot: "hubspot.png", hunter: "hunter.png", instantly: "instantly.png", pipedrive: "pipedrive.png", prospeo: "prospeo.png",
  salesforce: "salesforce.svg", slack: "slack.svg", smartlead: "smartlead.png", smartreach: "smartreach.png", zapier: "zapier.png", zoho: "zoho.svg",
};

export default function AppLogo({ app, size = 56 }: { app: AppDef; size?: number }) {
  const file = LOGOS[app.key];
  return (
    <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-[12px] border border-[var(--border-subtle)] bg-white" style={{ width: size, height: size }}>
      {file ? (
        // eslint-disable-next-line @next/next/no-img-element -- small static brand marks
        <img src={`/integrations/${file}`} alt={`${app.name} logo`} width={size * 0.66} height={size * 0.66} className="object-contain" style={{ width: size * 0.66, height: size * 0.66 }} />
      ) : app.key === "webhook" ? <LuWebhook size={size * 0.52} style={{ color: app.color }} />
        : <span className="flex items-center justify-center rounded-[8px] font-bold text-white" style={{ width: size * 0.66, height: size * 0.66, background: app.color, fontSize: size * (app.mark.length > 1 ? 0.24 : 0.32) }}>{app.mark}</span>}
    </span>
  );
}
