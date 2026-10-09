import type { Adapter } from "@/lib/integrations/types";
import { clay, webhook } from "@/lib/integrations/adapters/webhook";
import { attio, breakcold, folk, hubspot, pipedrive } from "@/lib/integrations/adapters/crm";
import { heyreach, instantly, smartlead, smartreach } from "@/lib/integrations/adapters/outreach";
import { salesforce, zoho, type OAuthAdapter } from "@/lib/integrations/adapters/oauth-crm";

/** Adapter per app key. Apps without one (Slack, Zapier) can't be connected yet. */
const ADAPTERS: Record<string, Adapter> = { webhook, clay, hubspot, pipedrive, attio, folk, breakcold, instantly, smartlead, smartreach, heyreach, zoho, salesforce };
const OAUTH: Record<string, OAuthAdapter> = { zoho, salesforce };

export const adapterFor = (app: string): Adapter | undefined => ADAPTERS[app];
export const oauthAdapterFor = (app: string): OAuthAdapter | undefined => OAUTH[app];
