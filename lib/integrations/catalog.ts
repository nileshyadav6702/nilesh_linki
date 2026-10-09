/**
 * The Integrations page catalog: which apps exist, what each asks for, and which sync options it
 * offers. Client-safe (no server imports): the page renders from it and the API validates with it.
 */

export type Category = "crm" | "outreach" | "automation" | "enrichment";
export const CATEGORIES: Array<{ key: Category; label: string }> = [
  { key: "crm", label: "CRM" },
  { key: "outreach", label: "Outreach Tools" },
  { key: "automation", label: "Automation" },
  { key: "enrichment", label: "Enrichment" },
];

export interface Field {
  key: string; label: string; type: "secret" | "text" | "url" | "select";
  placeholder?: string; help?: string; helpUrl?: string; options?: Array<{ value: string; label: string }>; default?: string;
}

/** Sync options a connection can switch on. */
export type OptionKey = "auto_sync" | "reply_notes" | "create_on_reply" | "verify_on_import";

export interface AppDef {
  key: string; name: string; category: Category; tagline: string; color: string; mark: string;
  /** Text shown in the blue banner of the connect dialog. */
  banner: { title: string; body: string };
  fields: Field[];
  options: OptionKey[];
  /** Outreach tools push into one campaign (or list) picked after the key is verified. */
  pick?: { label: string; help: string };
  /** Connect through an OAuth redirect after the fields are saved. */
  oauth?: boolean;
  /** Needs an email address to create the record (waits for enrichment). */
  needsEmail?: boolean;
  comingSoon?: boolean;
}

const crmBanner = (name: string) => ({ title: "Automatically sync leads to your CRM", body: `New leads can be transferred into ${name} automatically, so opportunities do not slip through the cracks.` });
const outreachBanner = (name: string) => ({ title: "Automatically sync leads to your outreach platform", body: `New leads can be transferred into ${name} campaigns automatically, so opportunities do not slip through the cracks.` });
const key = (name: string, help: string, helpUrl?: string, placeholder?: string): Field => ({ key: "api_key", label: `${name} API Key`, type: "secret", placeholder: placeholder ?? `Enter your ${name} API key…`, help, helpUrl });

export const ZOHO_REGIONS = [
  { value: "com", label: "United States (zoho.com)" }, { value: "eu", label: "Europe (zoho.eu)" }, { value: "in", label: "India (zoho.in)" },
  { value: "com.au", label: "Australia (zoho.com.au)" }, { value: "jp", label: "Japan (zoho.jp)" }, { value: "ca", label: "Canada (zohocloud.ca)" },
  { value: "sa", label: "Saudi Arabia (zoho.sa)" }, { value: "com.cn", label: "China (zoho.com.cn)" },
];

export const APPS: AppDef[] = [
  { key: "hubspot", name: "HubSpot", category: "crm", tagline: "Auto-sync AI leads to your HubSpot CRM", color: "#ff7a59", mark: "HS",
    banner: crmBanner("HubSpot"), options: ["auto_sync", "reply_notes", "create_on_reply"],
    fields: [key("HubSpot", "Create a private app in HubSpot (Settings → Integrations → Private Apps) with the crm.objects.contacts read and write scopes, and paste its access token.", "https://developers.hubspot.com/docs/api/private-apps", "pat-…")] },
  { key: "pipedrive", name: "Pipedrive", category: "crm", tagline: "Send leads directly to your Pipedrive pipeline", color: "#017737", mark: "P",
    banner: { title: "Automatically sync leads to your CRM", body: "Seamlessly transfer new leads directly into your Pipedrive CRM. Save time and ensure no opportunities slip through the cracks." },
    options: ["auto_sync", "reply_notes", "create_on_reply"],
    fields: [key("Pipedrive", "Generate an API key in your Pipedrive account settings (Personal preferences → API).", "https://pipedrive.readme.io/docs/how-to-find-the-api-token")] },
  { key: "instantly", name: "Instantly", category: "outreach", tagline: "Automated email outreach and campaign management", color: "#2563eb", mark: "In",
    banner: outreachBanner("Instantly"), options: ["verify_on_import", "auto_sync"], needsEmail: true,
    pick: { label: "Campaign", help: "New leads are added to this Instantly campaign." },
    fields: [key("Instantly", "Generate an API key (v2) in Instantly with the leads:all and campaigns:all scopes.", "https://developer.instantly.ai/")] },
  { key: "slack", name: "Slack", category: "automation", tagline: "Get instant lead notifications in Slack", color: "#4a154b", mark: "S",
    banner: { title: "", body: "" }, options: [], fields: [], comingSoon: true },
  { key: "clay", name: "Clay", category: "automation", tagline: "Sync leads to your Clay workflows via webhook", color: "#e2318c", mark: "C",
    banner: { title: "Automatically sync leads to Clay", body: "New leads can be sent to your Clay workflow via webhook, so enrichment and routing can start right away." },
    options: ["auto_sync"],
    fields: [{ key: "webhook_url", label: "Clay Webhook URL", type: "url", placeholder: "https://api.clay.com/v3/sources/webhook/…", help: "Create a webhook source in your Clay table and paste its URL here. Kairo will send new leads to this endpoint.", helpUrl: "https://www.clay.com/university/guide/webhook-integration-guide" }] },
  { key: "folk", name: "Folk", category: "crm", tagline: "Auto-sync leads to your Folk CRM", color: "#111111", mark: "F",
    banner: crmBanner("Folk"), options: ["auto_sync"],
    pick: { label: "Group", help: "New leads are added to this Folk group." },
    fields: [key("Folk", "Generate an API key in your Folk workspace settings (Settings → API).", "https://developer.folk.app/")] },
  { key: "smartlead", name: "Smartlead", category: "outreach", tagline: "Send leads directly to your Smartlead campaign", color: "#6d28d9", mark: "SL",
    banner: { title: "Automatically sync leads to your email campaigns", body: "New leads can be transferred into Smartlead campaigns automatically, so outreach sequences can start right away." },
    options: ["auto_sync"], needsEmail: true, pick: { label: "Campaign", help: "New leads are added to this Smartlead campaign." },
    fields: [key("Smartlead", "Generate an API key in your Smartlead settings.", "https://helpcenter.smartlead.ai/en/articles/125-full-api-documentation")] },
  { key: "zoho", name: "Zoho CRM", category: "crm", tagline: "Sync leads to your Zoho CRM", color: "#e42527", mark: "Z",
    banner: crmBanner("Zoho CRM"), options: ["auto_sync"], oauth: true,
    fields: [
      { key: "client_id", label: "Client ID", type: "text", placeholder: "Enter your Zoho Client ID", help: "Your Zoho CRM application's Client ID from the Zoho Developer Console." },
      { key: "client_secret", label: "Client Secret", type: "secret", placeholder: "Enter your Zoho Client Secret", help: "Your Zoho CRM application's Client Secret from the Zoho Developer Console." },
      { key: "region", label: "Data Center Region", type: "select", placeholder: "Select your Zoho data center region", help: "Select the data center region where your Zoho CRM account is located.", options: ZOHO_REGIONS },
    ] },
  { key: "salesforce", name: "Salesforce", category: "crm", tagline: "Sync leads to your Salesforce CRM", color: "#00a1e0", mark: "SF",
    banner: { title: "Connect with your Salesforce app", body: "Enter the Client ID, Client Secret, and Salesforce URL from the Connected App your Salesforce admin created." },
    options: ["auto_sync", "reply_notes", "create_on_reply"], oauth: true,
    fields: [
      { key: "instance_url", label: "Salesforce URL", type: "url", default: "https://login.salesforce.com", placeholder: "https://login.salesforce.com", help: "Use your Salesforce login URL, sandbox URL (https://test.salesforce.com), or My Domain URL." },
      { key: "client_id", label: "Client ID", type: "text", placeholder: "Enter your Salesforce Connected App Client ID", help: "The Consumer Key from your Salesforce Connected App." },
      { key: "client_secret", label: "Client Secret", type: "secret", placeholder: "Enter your Salesforce Connected App Client Secret", help: "The Consumer Secret from your Salesforce Connected App." },
    ] },
  { key: "breakcold", name: "Breakcold", category: "crm", tagline: "Sync leads to your Breakcold CRM", color: "#4f46e5", mark: "Br",
    banner: crmBanner("Breakcold"), options: ["auto_sync"],
    fields: [{ ...key("Breakcold", "Generate a new API key in your Breakcold account settings.", "https://developer.breakcold.com/"), label: "API Key", placeholder: "Enter your Breakcold API key" }] },
  { key: "webhook", name: "Webhook", category: "automation", tagline: "Add your custom webhook URLs to receive real-time notifications", color: "#c73a63", mark: "W",
    banner: { title: "Receive real-time notifications", body: "Configure webhook URLs to receive POST requests when new leads are created or reply in Kairo." },
    options: ["auto_sync"], fields: [] },
  { key: "zapier", name: "Zapier", category: "automation", tagline: "Connect to 5,000+ apps and automate your workflows", color: "#ff4f00", mark: "Z",
    banner: { title: "", body: "" }, options: [], fields: [], comingSoon: true },
  { key: "heyreach", name: "HeyReach", category: "outreach", tagline: "Send leads directly to your HeyReach campaign", color: "#1f2937", mark: "HR",
    banner: outreachBanner("HeyReach"), options: ["auto_sync"], pick: { label: "Lead list", help: "New leads are added to this HeyReach list (attach it to a campaign in HeyReach)." },
    fields: [key("HeyReach", "Generate an API key in your HeyReach account settings (Integrations → API).", "https://documenter.getpostman.com/view/23808049/2sA2xb5F75")] },
  { key: "smartreach", name: "SmartReach", category: "outreach", tagline: "Send leads directly to your SmartReach campaign", color: "#f59e0b", mark: "SR",
    banner: outreachBanner("SmartReach"), options: ["auto_sync"], needsEmail: true,
    fields: [
      key("SmartReach", "Generate an API key in your SmartReach account settings.", "https://smartreach.io/api_docs"),
      { key: "team_id", label: "Team ID", type: "text", placeholder: "team_…", help: "Shown in SmartReach under Settings → Team Settings → Integrations." },
      { key: "campaign_id", label: "Campaign ID", type: "text", placeholder: "e.g. 12345", help: "Open the campaign in SmartReach: the ID is the number in its URL. New leads are added to it." },
    ] },
  { key: "attio", name: "Attio", category: "crm", tagline: "Sync leads to your Attio CRM", color: "#111827", mark: "A",
    banner: { title: "Automatically sync leads to your CRM", body: "New leads can be transferred into Attio automatically, so opportunities do not slip through the cracks." },
    options: ["auto_sync", "reply_notes", "create_on_reply"], needsEmail: true,
    fields: [key("Attio", "Generate an API key in Attio with Read & Write permissions on Records and Notes, plus Read permissions for User Management and Object Configuration.", "https://developers.attio.com/")] },
  // Email finding (the enrichment waterfall). Keys only; no sync options.
  { key: "apollo", name: "Apollo.io", category: "enrichment", tagline: "Find verified work emails for your leads", color: "#1f2937", mark: "Ap",
    banner: { title: "Find more emails", body: "Apollo is tried in the email-finding waterfall before the free pattern check." }, options: [],
    fields: [key("Apollo", "Create an API key in Apollo (Settings → Integrations → API).", "https://docs.apollo.io/")] },
  { key: "hunter", name: "Hunter", category: "enrichment", tagline: "Find professional emails by name and domain", color: "#f4511e", mark: "H",
    banner: { title: "Find more emails", body: "Hunter is tried in the email-finding waterfall." }, options: [],
    fields: [key("Hunter", "Copy your API key from Hunter (Dashboard → API).", "https://hunter.io/api-keys")] },
  { key: "prospeo", name: "Prospeo", category: "enrichment", tagline: "Find emails from LinkedIn profiles", color: "#0ea5e9", mark: "Pr",
    banner: { title: "Find more emails", body: "Prospeo is tried in the email-finding waterfall." }, options: [],
    fields: [key("Prospeo", "Copy your API key from the Prospeo dashboard.", "https://prospeo.io/api")] },
];

export const appByKey = (k: string) => APPS.find((a) => a.key === k);

export const OPTION_TEXT: Record<OptionKey, (app: string) => { title: string; body: string; note?: string }> = {
  auto_sync: (app) => ({ title: `Automatically send new contacts to ${app}`, body: `When enabled, new leads your agents qualify in Kairo will be sent to ${app}. You can disable this and manually trigger syncs later.` }),
  reply_notes: (app) => ({ title: "Send lead replies into the contact notes", body: `When a lead replies to an outreach message (LinkedIn or Email), automatically add a note to the matching ${app} contact with the message, the date, and the teammate who received it.` }),
  create_on_reply: (app) => ({ title: "Create the contact on reply if it doesn't exist", body: `If the contact isn't found in ${app} when they reply, create it automatically. Lets you keep "Automatically send new contacts" off and only push contacts once they engage.` }),
  verify_on_import: () => ({ title: "Ask Instantly to verify leads on import", body: "Automatically verify leads during import to protect deliverability. Requires Instantly credits." }),
};
