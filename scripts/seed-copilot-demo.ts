/**
 * Demo data for the Copilot page: two agents ("Demo · Autopilot", "Demo · Review") with
 * fictional leads, company details, signals and AI drafts on every message/email step.
 *
 * Safe by construction: the agents have no lead sources (nothing scrapes LinkedIn), outreach
 * is off (an approved lead only lands in a pending run), and every LinkedIn URL is a fake
 * "linki-demo-…" slug.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/seed-copilot-demo.ts           # seed (replaces earlier demo data)
 *   npx tsx --env-file-if-exists=.env.local scripts/seed-copilot-demo.ts --clean   # remove it
 */
import { getDb } from "@/lib/db";
import { createAgent, deleteAgent, updateAgent, type Agent } from "@/lib/agents/store";
import { createDefaultCampaign } from "@/lib/agents/default-campaign";
import { queueDraft, sequenceSteps } from "@/lib/agents/drafts";
import { ingestSignal } from "@/lib/platform/signals";
import { upsertLead } from "@/lib/signals/leads";

const DEMO_PREFIX = "Demo · ";
const db = getDb();

interface Person {
  name: string; title: string; company: string; location: string; size: string; industry: string; about: string; score: number;
  signal: { type: string; title: string; snippet: string };
}

const AUTOPILOT: Person[] = [
  { name: "Umiya Sharma", title: "Founder and Head of Partnerships", company: "V-INNOVIZE", location: "Srinagar, India", size: "11-50 employees", industry: "Marketing Services",
    about: "We Innovize Lead Generation and Appointment Settings, pioneering cutting-edge strategies to connect your business with potential clients across North America and Europe.", score: 82,
    signal: { type: "keyword_engagement", title: "Just engaged with a post written by Kim Willis", snippet: "trigger events" } },
  { name: "Chris O'Stean", title: "Chief Sales Officer", company: "Baxter Planning", location: "Atlanta Metropolitan Area, United States", size: "201-500 employees", industry: "Software Development",
    about: "Baxter Planning is a global leader in Service Supply Chain software, delivering a Service Experience that helps companies plan parts and service levels with confidence.", score: 78,
    signal: { type: "job_change", title: "Strategic Window: Just hired · August 2026", snippet: "Recently changed jobs" } },
  { name: "Naresh Chichhula", title: "Sr Manager - Business Ops & Growth", company: "Terastar Networks", location: "Hyderabad, India", size: "51-200 employees", industry: "Telecommunications",
    about: "Terastar Networks builds carrier-grade networking software for operators modernising their access and transport networks.", score: 64,
    signal: { type: "competitor_engagement", title: "Liked a post from a competitor page", snippet: "partner enablement" } },
  { name: "David Malone", title: "SR. Vice President Of Sales", company: "CallRevu", location: "Austin, Texas, United States", size: "51-200 employees", industry: "Software Development",
    about: "CallRevu turns every inbound dealership call into revenue with call tracking, coaching and AI scoring built for automotive retail.", score: 74,
    signal: { type: "keyword_engagement", title: "Commented on a post about sales onboarding", snippet: "sales onboarding" } },
  { name: "Luis Pantoja", title: "Founding Senior Account Executive", company: "Vori", location: "San Francisco Bay Area, United States", size: "11-50 employees", industry: "Software Development",
    about: "Vori is the operating system for independent grocers: inventory, ordering and pricing in one place.", score: 58,
    signal: { type: "influencer_engagement", title: "Engaged with a post by an industry expert", snippet: "playbooks" } },
  { name: "Anna Grubbs", title: "Senior Director, Global Commercial Sales", company: "Redpanda Data", location: "Denver, Colorado, United States", size: "201-500 employees", industry: "Software Development",
    about: "Redpanda is a streaming data platform for developers, API-compatible with Kafka and built for simplicity and performance.", score: 69,
    signal: { type: "hiring", title: "Hiring 4 Account Executives this month", snippet: "sales hiring" } },
];

const REVIEW: Person[] = [
  { name: "Updesh Dandriyal", title: "Associate Vice President", company: "PROPVR", location: "Gurugram, India", size: "51-200 employees", industry: "Real Estate",
    about: "PROPVR builds immersive virtual tours and sales tools for real estate developers across India and the Middle East.", score: 71,
    signal: { type: "keyword_engagement", title: "Liked a post about training new sales hires", snippet: "sales training" } },
  { name: "Abinaya Thennarasu", title: "Founder", company: "Career Buddy", location: "Chennai, India", size: "2-10 employees", industry: "E-Learning Providers",
    about: "Career Buddy helps students and early professionals build careers with mentorship, courses and AI-guided learning paths.", score: 66,
    signal: { type: "own_content_engagement", title: "Reacted to your latest post", snippet: "self-hosted LMS" } },
  { name: "Tarell Harrison", title: "Global Head of Sales", company: "ConversionIQ.ai", location: "New York, United States", size: "11-50 employees", industry: "Software Development",
    about: "ConversionIQ.ai analyses every sales conversation to show reps exactly what to say next.", score: 80,
    signal: { type: "funding", title: "Raised a $6M seed round", snippet: "funding" } },
  { name: "Navyashree N", title: "Growth Manager", company: "Bluemind Solutions", location: "Bengaluru, India", size: "51-200 employees", industry: "IT Services and IT Consulting",
    about: "Bluemind Solutions delivers custom software and cloud migration for mid-market companies.", score: 52,
    signal: { type: "keyword_engagement", title: "Commented on a post about customer education", snippet: "customer education" } },
];

const firstName = (n: string) => n.split(/\s+/)[0];

function draftsFor(p: Person): { message: string[]; email: Array<{ subject: string; body: string }> } {
  const f = firstName(p.name);
  return {
    message: [
      `Hi ${f},\n\nSaw your take on ${p.signal.snippet}. When a new partner or hire joins ${p.company}, how do you get them up to speed today?\n\nWe help teams turn their playbook into a branded course in days.`,
      `Hi ${f}, following up on my note. Happy to share how similar ${p.industry.toLowerCase()} teams cut ramp time without adding headcount. Worth a quick look?`,
      `Last one from me, ${f}. If onboarding isn't a priority right now, no worries at all. Should I check back next quarter?`,
    ],
    email: [
      { subject: `${p.company} onboarding`, body: `Hi ${f},\n\nDeciding when a course or certification should update based on a partner action is rarely as simple as it sounds. Most closed platforms force you to rebuild that logic every time a vendor changes its rules.\n\nOwning the platform means you set those triggers yourself. How do you currently decide when training content needs to update?\n\nBest,` },
      { subject: `Re: ${p.company} onboarding`, body: `Hi ${f},\n\nQuick follow-up: a few ${p.industry.toLowerCase()} teams use us to keep partner training in sync automatically. Open to a 15-minute walkthrough next week?\n\nBest,` },
    ],
  };
}

function clean() {
  const agents = db.prepare("SELECT id, workspace_id FROM agents WHERE name LIKE ?").all(`${DEMO_PREFIX}%`) as Array<{ id: string; workspace_id: string }>;
  const leads = (db.prepare("SELECT id FROM targets WHERE linkedin_url LIKE '%/in/linki-demo-%'").all() as Array<{ id: string }>).map((r) => r.id);
  db.transaction(() => {
    for (const id of leads) {
      db.prepare("DELETE FROM approval_queue WHERE target_id = ?").run(id);
      db.prepare("DELETE FROM signals WHERE target_id = ?").run(id);
      db.prepare("DELETE FROM list_targets WHERE target_id = ?").run(id);
      db.prepare("DELETE FROM run_profiles WHERE target_id = ?").run(id);
      db.prepare("DELETE FROM targets WHERE id = ?").run(id);
    }
  })();
  for (const a of agents) deleteAgent(a.id, a.workspace_id);
  console.log(`Removed ${agents.length} demo agent(s) and ${leads.length} demo lead(s).`);
}

function seedAgent(workspaceId: string, mode: "autopilot" | "copilot", people: Person[], account: string | null, email: string | null): Agent {
  const name = `${DEMO_PREFIX}${mode === "autopilot" ? "Autopilot" : "Review"}`;
  const channel = email ? "multi" : "linkedin";
  const workflowId = createDefaultCampaign(db, workspaceId, `${name} · VP of Sales · North America`, channel);
  const agent = createAgent(workspaceId, {
    name, mode, min_score: 55, fit_weight: 0.6, workflow_id: workflowId, linkedin_account_id: account, email_account_id: email,
    autopilot_delay_minutes: 11 * 60, daily_lead_cap: 25, enrich_emails: false, goal: "conversations", tone: "professional", channel, exclude_first_degree: true,
  });
  // Finding leads (so Copilot counts it as an active campaign), outreach off (nothing is sent).
  updateAgent(agent.id, workspaceId, { status: "active", outreach_enabled: false });
  const live = { ...agent, status: "active", outreach_enabled: 0 } as Agent;
  const steps = sequenceSteps(db, workflowId).filter((s) => s.channel && !s.fixed);

  people.forEach((p, i) => {
    const slug = `linki-demo-${p.name.toLowerCase().replace(/[^a-z]+/g, "-")}`;
    const { targetId } = upsertLead(db, workspaceId, agent.id, { name: p.name, title: p.title, company: p.company, location: p.location, profileUrl: `https://www.linkedin.com/in/${slug}` }, "signal");
    db.prepare(`UPDATE targets SET agent_status = 'drafted', lead_score = ?, fit_verdict = 'strong', fit_score = ?, headline = ?, company_industry = ?, company_location = ?,
        company_size = ?, company_description = ?, company_linkedin_url = ? WHERE id = ?`)
      .run(p.score, p.score, `${p.title} at ${p.company}`, p.industry, p.location, p.size, p.about,
        `https://www.linkedin.com/company/linki-demo-${p.company.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, targetId);
    if (agent.list_id) db.prepare("INSERT OR IGNORE INTO list_targets (list_id, target_id) VALUES (?, ?)").run(agent.list_id, targetId);
    const signal = ingestSignal({ workspaceId, targetId, agentId: agent.id, type: p.signal.type, title: p.signal.title, snippet: p.signal.snippet, source: "demo",
      dedupeKey: `demo:${agent.id}:${targetId}` }) as { id?: string } | undefined;
    const copy = draftsFor(p);
    let m = 0, e = 0;
    for (const s of steps) {
      const draft = s.channel === "email" ? copy.email[Math.min(e++, copy.email.length - 1)] : { subject: null, body: copy.message[Math.min(m++, copy.message.length - 1)] };
      const id = queueDraft(db, live, targetId, s.channel!, draft, signal?.id ?? null, s);
      // Autopilot leads launch ~11h from now; two of them are already approved (green check).
      if (mode === "autopilot" && i >= people.length - 2) db.prepare("UPDATE approval_queue SET status = 'approved', decided_at = datetime('now') WHERE id = ?").run(id);
    }
  });
  return agent;
}

function seed() {
  clean();
  const account = db.prepare("SELECT id, workspace_id FROM accounts WHERE is_authenticated = 1 ORDER BY created_at LIMIT 1").get() as { id: string; workspace_id: string } | undefined;
  const workspaceId = account?.workspace_id ?? (db.prepare("SELECT id FROM workspaces ORDER BY created_at LIMIT 1").get() as { id: string } | undefined)?.id;
  if (!workspaceId) throw new Error("No workspace found. Sign up in the app first.");
  const email = (db.prepare("SELECT id FROM email_accounts WHERE workspace_id = ? ORDER BY created_at LIMIT 1").get(workspaceId) as { id: string } | undefined)?.id ?? null;
  const a = seedAgent(workspaceId, "autopilot", AUTOPILOT, account?.id ?? null, email);
  const r = seedAgent(workspaceId, "copilot", REVIEW, account?.id ?? null, email);
  console.log(`Seeded "${a.name}" (${AUTOPILOT.length} leads) and "${r.name}" (${REVIEW.length} leads) in workspace ${workspaceId}. Open /copilot.`);
}

if (process.argv.includes("--clean")) clean(); else seed();
