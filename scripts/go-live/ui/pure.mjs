// scripts/go-live/ui/pure.mjs — the console's DOM-free decisions, imported by
// ui/app.js (as an ES module) AND by scripts/go-live/ui-pure.test.mjs, so the
// lock and address rules are pinned by tests even though the page itself is not.

export const VERCEL_APP = ".vercel.app";
export const TABLE_COUNT_MAX = 99;
/** Mirrors lib.mjs SUBDOMAIN_RE (a DNS label) and RESERVED_SUBDOMAINS — this
 *  file has no import of lib.mjs (kept DOM/runbook-free and dependency-light),
 *  so the two are pinned equal by ui-pure.test.mjs instead. */
const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const RESERVED_SUBDOMAINS = ["www", "app", "api", "admin", "hub"];

/** What is already real for a client: seeded (settings/admin/tables/menu live in
 *  its database) and deployed (the Vercel project exists). `seededAt` is written
 *  by run.mjs after a successful seed; the lastRun fallback covers files seeded
 *  before that field existed (a go-live can only finish "ok" after its seed ran).
 *  `configured` = the run has gone far enough to have an assigned Vercel host —
 *  a project can exist (`deployed`) with the run cut off BEFORE that (e.g. Fresh
 *  start stopped after project-create but before env vars / deploy): Redeploy
 *  is unsafe on such a client (its deploy profile may not exist yet either). */
export function lockStateOf(client) {
  const g = (client && client.generated) || {};
  const lr = client && client.lastRun;
  const seededAt = g.seededAt || (lr && lr.action === "go-live" && lr.status === "ok" ? lr.at : null);
  return { seeded: Boolean(seededAt), seededAt: seededAt || null, deployed: Boolean(g.projectId), configured: Boolean(g.host) };
}

/**
 * Whether a client's run is currently "running" (this client IS the job the
 * console/CLI is executing right now) or "interrupted" (its `lastRun` was left
 * at status "running" — recorded when a job STARTS — but no live job is
 * running it any more: the console/CLI closed or crashed mid-run). `currentJob`
 * is the console's current job summary (`{ name, status } | null`, from
 * GET /api/jobs/current or the /api/locks snapshot's `job` field) — a running
 * job for ANY client counts as "not interrupted for its own client", but a
 * `lastRun.status === "running"` client that is NOT the current job's target
 * is interrupted regardless of what else is running. Returns null when the
 * client has no run history at all (nothing to report).
 */
export function runStateOf(client, currentJob) {
  const lr = client && client.lastRun;
  if (!lr || lr.status !== "running") return null;
  const name = (client && (client.name || client.slug)) || null;
  const isCurrent = Boolean(currentJob && currentJob.status === "running" && name != null && currentJob.name === name);
  return isCurrent ? "running" : "interrupted";
}

/**
 * The client's "Web address" input → a `subdomain` value (or null for empty).
 * Accepts a bare label ("lucifer"), a full host ("lucifer.sandbee.in") or a
 * pasted URL ("https://lucifer.sandbee.in/") — trims, lowercases, strips a
 * leading scheme, a trailing slash and a trailing ".<apex>" before validating.
 * Throws the owner-facing reason on anything that is not a plain first label.
 */
export function subdomainFromInput(raw, apex) {
  let s = String(raw ?? "").trim().toLowerCase();
  if (s === "") return null;
  s = s.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const apexSuffix = typeof apex === "string" && apex ? `.${apex.toLowerCase()}` : null;
  if (apexSuffix && s.endsWith(apexSuffix)) s = s.slice(0, -apexSuffix.length);
  if (s.includes(".")) throw new Error(`Web address: just the first part — "lucifer" for lucifer${apexSuffix || ".<apex>"}`);
  if (!SUBDOMAIN_RE.test(s)) throw new Error("Web address: lowercase letters, digits and hyphens only");
  if (RESERVED_SUBDOMAINS.includes(s)) throw new Error(`Web address: "${s}" is reserved`);
  return s;
}

/** The status shown in the #web-address panel, from the client + platform
 *  records alone (no network) — states mirror `generated.webAddress.state`
 *  from run.mjs/checkWebAddress, plus the client-side-only "none"/"legacy". */
export function webAddressStateOf(client, platform) {
  const w = client && client.generated && client.generated.webAddress;
  const host = (w && w.host) || (client && client.subdomain && platform && platform.apexDomain ? `${client.subdomain}.${platform.apexDomain}` : null);
  if (client && client.subdomain && (!client.generated || !client.generated.projectId) && !platform) {
    return { state: "none", host: null, message: "Set the apex domain first (⚙ Platform)." };
  }
  if (!client || !client.subdomain) {
    // Address cleared while one is recorded: the next Update on Vercel REVERTS (redirects removed first).
    if (client && w) return { state: "reverting", host: w.host, message: `Web address cleared — the next Update on Vercel removes the redirects and goes back to the *.vercel.app address; ${w.host} then shows Not found (remove it in Vercel → Domains if you like).` };
    if (client && client.generated && client.generated.projectId && !w) {
      return { state: "legacy", host: client.generated.host || null, message: `Not on ${platform && platform.apexDomain ? `.${platform.apexDomain}` : "the platform apex"} yet — set the web address, Save, Update on Vercel.` };
    }
    return { state: "none", host: null, message: "No web address set yet." };
  }
  if (!w) {
    const deployed = Boolean(client.generated && client.generated.projectId);
    return deployed
      ? { state: "not-attached", host, message: "Not attached yet — Save, then Update on Vercel (the DNS records appear here after that run)." }
      : { state: "not-deployed", host, message: "Not deployed yet — Save, then Go live; the DNS records appear here after the first run." };
  }
  if (w.live) return { state: "live", host: w.host, message: `Live at https://${w.host}` };
  const state = w.state || (w.verified && w.configured && w.reachable ? "ready" : !w.verified ? "pending-verify" : !w.configured ? "pending-dns" : "pending-cert");
  const messages = {
    "pending-dns": "Waiting for the DNS records below to be added.",
    "pending-verify": "Waiting for Vercel to verify the TXT record.",
    "pending-cert": "DNS looks right — waiting for the certificate.",
    "check-failed": "Vercel's DNS check did not answer — press Check DNS & verify again in a minute.",
    "tenant-mismatch": `The address answers, but as tenant "${w.probeTenant || "?"}" — press Update on Vercel once (it refreshes TENANT_ID), then check again.`,
    ready: "Ready — press Update on Vercel to switch.",
  };
  // A HOLD run (the switch was refused to protect the live cafe) says so explicitly.
  const hold = w.held && w.servingHost ? ` HOLD — ${w.servingHost} keeps serving until this is ready.` : "";
  return { state, host: w.host || host, message: (messages[state] || "Checking…") + hold };
}

/** The tables value the file gets from the form: a count (1..99) or a non-empty
 *  list of trimmed names. Throws the owner-facing reason otherwise. */
export function tablesFromForm(mode, countValue, namesText) {
  if (mode === "count") {
    const n = Number(countValue);
    if (!Number.isInteger(n) || n < 1 || n > TABLE_COUNT_MAX) throw new Error(`Tables: enter a count between 1 and ${TABLE_COUNT_MAX}, or switch to names.`);
    return n;
  }
  const names = String(namesText ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  if (!names.length) throw new Error("Tables: enter at least one table name, or switch to a count.");
  return names;
}

/** Whether a Save must ask first: the Mongo URI changes on a deployed cafe. */
export function needsUriConfirm({ deployed, previousUri, nextUri }) {
  return Boolean(deployed && previousUri && nextUri !== previousUri);
}

/** What a CLONE keeps and what it must never carry over. Kept: the starter
 *  setup that is the same for the next cafe of this kind (GST mode/rate, receipt
 *  footer, tables, menu, which image store, the contact/notes SHAPE). Cleared:
 *  everything that identifies or authenticates THIS cafe — name and address,
 *  every credential, every generated id/secret, run history, locks. The new
 *  slug is the caller's. Returns { client, cleared } (cleared = field names,
 *  for the banner). */
export const CLONE_CLEARED = ["cafe.name", "cafe.tagline", "cafe.mobile", "cafe.address", "cafe.fssai", "cafe.gst.number", "vercel.token", "vercel.project", "vercel.teamId", "subdomain (set to the new slug)", "mongodbUri", "admin.password", "image credentials / bucket / URL", "contact", "accounts (all logins)", "notes", "generated", "lastRun", "deployLock", "demo", "standby hosts (account-specific)"];
export function cloneTemplateOf(source, newSlug) {
  const s = source && typeof source === "object" ? JSON.parse(JSON.stringify(source)) : {};
  const cafe = s.cafe && typeof s.cafe === "object" ? s.cafe : {};
  const gst = cafe.gst && typeof cafe.gst === "object" ? cafe.gst : { enabled: false, number: "", rate: 5, mode: "inclusive" };
  const store = s.image && typeof s.image === "object" ? s.image.store : null;
  const image = store === "r2" ? { store: "r2", accountId: "", accessKeyId: "", secretAccessKey: "", bucket: "", publicBaseUrl: "" } : store === "cloudinary" ? { store: "cloudinary", cloudName: "", apiKey: "", apiSecret: "" } : null;
  const client = {
    slug: newSlug,
    vercel: { token: "", project: null, teamId: null },
    subdomain: newSlug,
    mongodbUri: "",
    admin: { username: (s.admin && s.admin.username) || "admin", password: "" },
    cafe: { name: "", tagline: "", mobile: "", address: "", receiptFooter: cafe.receiptFooter ?? "Thank you, visit again!", fssai: "", gst: { enabled: Boolean(gst.enabled), number: "", rate: gst.rate ?? 5, mode: gst.mode ?? "inclusive" } },
    tables: s.tables ?? 8,
    menu: s.menu ?? null,
    image,
    contact: { ownerName: "", phone: "", whatsapp: "" },
    accounts: { vercel: { email: "", password: "" }, atlas: { email: "", password: "" }, images: { email: "", password: "" }, other: "" },
    notes: "",
  };
  return { client, cleared: CLONE_CLEARED };
}

/** The database name a mongodb:// or mongodb+srv:// URI points at (the path). */
export function dbNameOf(uri) {
  const m = typeof uri === "string" ? uri.match(/^mongodb(?:\+srv)?:\/\/[^/?]+\/([^/?]+)/) : null;
  return m ? decodeURIComponent(m[1]) : null;
}
