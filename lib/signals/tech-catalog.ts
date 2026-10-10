/**
 * Technologies the Tech stack signal can detect on a company website, with the fingerprints
 * that identify them (lower-case substrings of the homepage HTML or its response headers).
 * No Node imports: the Lead sources drawer searches this list in the browser.
 */
export interface Technology { name: string; category: string; html: string[]; headers?: string[] }

export const TECHNOLOGIES: Technology[] = [
  { name: "Intercom", category: "Live chat", html: ["widget.intercom.io", "js.intercomcdn.com", "intercomsettings"] },
  { name: "Drift", category: "Live chat", html: ["js.driftt.com", "drift.load(", "driftt.com/include"] },
  { name: "Zendesk", category: "Support", html: ["static.zdassets.com", "zopim", "zendesk.com/embeddable"] },
  { name: "Freshdesk", category: "Support", html: ["freshdesk.com", "freshchat", "wchat.freshchat.com"] },
  { name: "HubSpot", category: "Marketing automation", html: ["js.hs-scripts.com", "js.hsforms.net", "js.hs-analytics.net", "hs-banner.com"] },
  { name: "Salesforce Pardot", category: "Marketing automation", html: ["pi.pardot.com", "piaid ="] },
  { name: "Marketo", category: "Marketing automation", html: ["munchkin.marketo.net", "mktoforms"] },
  { name: "Klaviyo", category: "Email marketing", html: ["static.klaviyo.com", "klaviyo.js"] },
  { name: "Mailchimp", category: "Email marketing", html: ["chimpstatic.com", "list-manage.com"] },
  { name: "Hotjar", category: "Analytics", html: ["static.hotjar.com", "hotjar.com/c/hotjar"] },
  { name: "Google Analytics", category: "Analytics", html: ["google-analytics.com/analytics.js", "gtag('config', 'g-", "gtag(\"config\", \"g-", "googletagmanager.com/gtag/js"] },
  { name: "Google Tag Manager", category: "Tag management", html: ["googletagmanager.com/gtm.js", "googletagmanager.com/ns.html"] },
  { name: "Segment", category: "Analytics", html: ["cdn.segment.com", "analytics.load("] },
  { name: "Mixpanel", category: "Analytics", html: ["cdn.mxpnl.com", "mixpanel.init("] },
  { name: "Amplitude", category: "Analytics", html: ["cdn.amplitude.com", "amplitude.getinstance"] },
  { name: "Heap", category: "Analytics", html: ["cdn.heapanalytics.com", "heap.load("] },
  { name: "FullStory", category: "Analytics", html: ["fullstory.com/s/fs.js", "edge.fullstory.com"] },
  { name: "Pendo", category: "Product analytics", html: ["cdn.pendo.io", "pendo.initialize"] },
  { name: "Plausible", category: "Analytics", html: ["plausible.io/js"] },
  { name: "Optimizely", category: "A/B testing", html: ["cdn.optimizely.com"] },
  { name: "VWO", category: "A/B testing", html: ["dev.visualwebsiteoptimizer.com"] },
  { name: "LinkedIn Insight Tag", category: "Advertising", html: ["snap.licdn.com/li.lms-analytics"] },
  { name: "Meta Pixel", category: "Advertising", html: ["connect.facebook.net/en_us/fbevents.js", "fbq('init'"] },
  { name: "Clearbit", category: "Data enrichment", html: ["tag.clearbitscripts.com", "x.clearbitjs.com"] },
  { name: "6sense", category: "Intent data", html: ["j.6sc.co"] },
  { name: "ZoomInfo", category: "Intent data", html: ["ws.zoominfo.com", "js.zi-scripts.com"] },
  { name: "Qualified", category: "Live chat", html: ["js.qualified.com"] },
  { name: "Chili Piper", category: "Scheduling", html: ["js.chilipiper.com"] },
  { name: "Calendly", category: "Scheduling", html: ["assets.calendly.com", "calendly.com/assets/external/widget"] },
  { name: "Typeform", category: "Forms", html: ["embed.typeform.com"] },
  { name: "Crisp", category: "Live chat", html: ["client.crisp.chat"] },
  { name: "Tawk.to", category: "Live chat", html: ["embed.tawk.to"] },
  { name: "LiveChat", category: "Live chat", html: ["cdn.livechatinc.com"] },
  { name: "Gorgias", category: "Support", html: ["config.gorgias.chat", "gorgias.chat"] },
  { name: "Stripe", category: "Payments", html: ["js.stripe.com"] },
  { name: "Shopify", category: "E-commerce", html: ["cdn.shopify.com", "shopify.theme"], headers: ["x-shopify-stage", "x-shopid"] },
  { name: "WooCommerce", category: "E-commerce", html: ["woocommerce"] },
  { name: "Magento", category: "E-commerce", html: ["mage/cookies", "magento_"] },
  { name: "WordPress", category: "CMS", html: ["wp-content/", "wp-includes/", "content=\"wordpress"] },
  { name: "Webflow", category: "CMS", html: ["webflow.js", "data-wf-site", "assets.website-files.com"] },
  { name: "Wix", category: "CMS", html: ["static.wixstatic.com", "x-wix-"], headers: ["x-wix-request-id"] },
  { name: "Squarespace", category: "CMS", html: ["static1.squarespace.com", "squarespace.com/universal"] },
  { name: "Framer", category: "CMS", html: ["framerusercontent.com", "framer.com/m/"] },
  { name: "Next.js", category: "Framework", html: ["__next_data__", "/_next/static/"], headers: ["x-nextjs-"] },
  { name: "Nuxt", category: "Framework", html: ["__nuxt", "/_nuxt/"] },
  { name: "Gatsby", category: "Framework", html: ["___gatsby"] },
  { name: "Vercel", category: "Hosting", html: [], headers: ["x-vercel-id", "server: vercel"] },
  { name: "Netlify", category: "Hosting", html: [], headers: ["x-nf-request-id", "server: netlify"] },
  { name: "Cloudflare", category: "CDN", html: [], headers: ["cf-ray"] },
  { name: "Sentry", category: "Monitoring", html: ["browser.sentry-cdn.com", "sentry.init("] },
  { name: "Auth0", category: "Authentication", html: ["cdn.auth0.com"] },
  { name: "Algolia", category: "Search", html: ["algolianet.com", "algoliasearch"] },
  { name: "Cookiebot", category: "Consent", html: ["consent.cookiebot.com"] },
  { name: "OneTrust", category: "Consent", html: ["cdn.cookielaw.org", "onetrust"] },
];

/** Shown as one-click chips before the user searches. */
export const POPULAR_TECH = ["Intercom", "Drift", "Zendesk", "Hotjar", "Google Analytics", "Google Tag Manager", "Segment", "Mixpanel", "Shopify", "WordPress"];

/** Catalog entries whose name starts with / contains the query (best matches first). */
export function searchTechnologies(query: string, limit = 8): Technology[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = TECHNOLOGIES.filter((t) => t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
  return hits.sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q))).slice(0, limit);
}
