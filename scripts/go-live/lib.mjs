// scripts/go-live/lib.mjs — the PURE half of the go-live tool: validation of a
// client file, the tenant/host decision, the Vercel env map, profile merging and
// secret minting. No IO here — run.mjs owns every network/disk/process call, so
// everything in this file is unit-testable with plain data.
//
// Mirrors (kept in sync by hand — the cafe app is a separate workspace):
//   RESERVED_SUBDOMAINS  ← apps/cafe/lib/platform.ts
//   password rule        ← apps/cafe/scripts/seed-admin.ts
//   GST_RATES/GST_MODES, TABLE_NO_* ← packages/shared/src/constants.ts
//
// validateCloudflare lives in cloudflare-validate.mjs, a LEAF module with no
// imports — importing realtime.mjs from here would close the cycle
// lib.mjs → realtime.mjs → core.mjs → lib.mjs (core.mjs imports this file).

import { validateCloudflare } from "./cloudflare-validate.mjs";

/** Subdomains the cafe runtime never resolves to a tenant (apps/cafe/lib/platform.ts). */
export const RESERVED_SUBDOMAINS = ["www", "app", "api", "admin", "hub"];
/** Vercel project names: lowercase letters, digits, hyphens; no leading/trailing hyphen. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,50}[a-z0-9])?$/;
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
/** A host with at least three labels, e.g. demo.pos.sandbee.in (label + a 2+ label root). */
export const CUSTOM_DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+){2,}$/;
/** mongodb:// or mongodb+srv:// with a DATABASE PATH — a path-less URI silently lands in `test`. */
export const MONGO_URI_WITH_DB_RE = /^mongodb(\+srv)?:\/\/[^/?]+\/[^/?]+/;
export const TABLE_NO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;
export const TABLE_NO_MAX_LEN = 24;
export const TABLE_COUNT_MAX = 99;
export const GST_RATES = [0, 5, 12, 18, 28];
export const GST_MODES = ["inclusive", "exclusive"];
export const PASSWORD_MIN_LEN = 8;
export const DEFAULT_ROOT_DOMAIN = "vercel.app";
export const VERCEL_APP_SUFFIX = ".vercel.app";
/** The name of the owner-only platform file next to the client files (never a client itself). */
export const PLATFORM_FILE = "_platform.json";
/** An apex domain: dot-separated DNS labels, lowercase, no scheme/port/path. */
export const APEX_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
export const APEX_MAX_LEN = 253;
/** A subdomain: one DNS label (no dots — underscores are already impossible here). */
export const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const ROOT_DIRECTORY = "apps/cafe";
export const APP_WORKSPACE = "apps/cafe";
export const FRAMEWORK = "nextjs";
export const ENV_TARGETS = ["production", "preview"];
export const AUTH_SECRET_BYTES = 32;
export const HEALTH_TOKEN_BYTES = 32;
export const IMAGE_STORES = ["r2", "cloudinary"];

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v) => typeof v === "string" && v.trim().length > 0;
/** An example-file value that was never replaced: `<vercel-token>`, `…@<cluster>.mongodb.net/…`. */
export const PLACEHOLDER_RE = /<[^<>\s]+>/;
const isPlaceholder = (v) => typeof v === "string" && PLACEHOLDER_RE.test(v);

/** Same rule as apps/cafe/scripts/seed-admin.ts — the seeder refuses anything weaker. */
export function isStrongPassword(p) {
  return typeof p === "string" && p.length >= PASSWORD_MIN_LEN && /\d/.test(p) && /[^A-Za-z0-9]/.test(p);
}

/** Resolve the table list a client asked for: a count (T-1..T-n) or explicit names.
 *  REQUIRED in the client file — the floor plan is per-cafe data (CR1.1), so the
 *  tool carries no default list of its own. */
export function tableNames(tables) {
  if (typeof tables === "number") return Array.from({ length: tables }, (_, i) => `T-${i + 1}`);
  return Array.isArray(tables) ? tables : [];
}

function validateTables(tables, errors) {
  if (tables === undefined || tables === null) return void errors.push(`tables: required — a count 1..${TABLE_COUNT_MAX} (T-1..T-n) or a list of table names`);
  if (typeof tables === "number") {
    if (!Number.isInteger(tables) || tables < 1 || tables > TABLE_COUNT_MAX) errors.push(`tables: a count must be an integer 1..${TABLE_COUNT_MAX}`);
    return;
  }
  if (!Array.isArray(tables) || tables.length === 0) return void errors.push("tables: a count (number) or a non-empty list of table names");
  const seen = new Set();
  for (const t of tables) {
    if (!isStr(t) || t.length > TABLE_NO_MAX_LEN || !TABLE_NO_PATTERN.test(t)) errors.push(`tables: "${String(t)}" must be 1-${TABLE_NO_MAX_LEN} chars of letters, digits, space, _ or -`);
    else if (seen.has(t)) errors.push(`tables: "${t}" is listed twice`);
    seen.add(t);
  }
}

function validateMenu(menu, errors) {
  if (menu === undefined || menu === null) return;
  if (!Array.isArray(menu)) return void errors.push("menu: must be a list of { category, items }");
  const names = new Set();
  menu.forEach((cat, ci) => {
    if (!isObj(cat) || !isStr(cat.category)) return void errors.push(`menu[${ci}]: needs a "category" name`);
    if (!Array.isArray(cat.items) || cat.items.length === 0) return void errors.push(`menu "${cat.category}": needs a non-empty "items" list`);
    cat.items.forEach((it, ii) => {
      const where = `menu "${cat.category}" item ${ii + 1}`;
      if (!isObj(it) || !isStr(it.name)) return void errors.push(`${where}: needs a "name"`);
      if (typeof it.price !== "number" || it.price < 0) errors.push(`${where} "${it.name}": "price" must be a number >= 0`);
      if (names.has(it.name)) errors.push(`${where}: "${it.name}" appears twice in the menu`);
      names.add(it.name);
      if (it.variations !== undefined) {
        if (!Array.isArray(it.variations) || it.variations.length === 0) errors.push(`${where} "${it.name}": "variations" must be a non-empty list`);
        else it.variations.forEach((v) => { if (!isObj(v) || !isStr(v.name) || typeof v.price !== "number" || v.price < 0) errors.push(`${where} "${it.name}": each variation needs { name, price >= 0 }`); });
      }
      if (it.modifiers !== undefined && (!Array.isArray(it.modifiers) || !it.modifiers.every(isStr))) errors.push(`${where} "${it.name}": "modifiers" must be a list of names`);
    });
  });
}

function validateImage(image, errors) {
  if (image === undefined || image === null) return;
  if (!isObj(image) || !IMAGE_STORES.includes(image.store)) return void errors.push(`image: "store" must be one of ${IMAGE_STORES.join("/")} (or set image to null)`);
  const need = image.store === "r2" ? ["accountId", "accessKeyId", "secretAccessKey", "bucket", "publicBaseUrl"] : ["cloudName", "apiKey", "apiSecret"];
  for (const k of need) if (!isStr(image[k])) errors.push(`image.${k}: required for store "${image.store}"`);
  if (image.store === "r2" && isStr(image.publicBaseUrl) && !/^https:\/\//.test(image.publicBaseUrl)) errors.push("image.publicBaseUrl: must start with https://");
}

/** Every problem with `clients/_platform.json` (the apex domain + owner note). */
export function validatePlatform(p) {
  const errors = [];
  if (!isObj(p)) return ["platform: must be a JSON object"];
  if (!isStr(p.apexDomain) || !APEX_RE.test(p.apexDomain) || p.apexDomain !== p.apexDomain.toLowerCase()) errors.push("apexDomain: a lowercase domain, e.g. \"sandbee.in\"");
  else if (p.apexDomain.length > APEX_MAX_LEN) errors.push(`apexDomain: must be ${APEX_MAX_LEN} characters or fewer`);
  else if (p.apexDomain.toLowerCase().endsWith(VERCEL_APP_SUFFIX)) errors.push("apexDomain: must not be a *.vercel.app address — use your own domain");
  if (p.dnsNote !== undefined && p.dnsNote !== null && typeof p.dnsNote !== "string") errors.push("dnsNote: must be text (or omit it)");
  return errors;
}

/** Parse `clients/_platform.json`'s text. Returns null when absent or invalid
 *  ("legacy mode": only *.vercel.app hosts, a `subdomain` is then an error). */
export function parsePlatform(text) {
  if (text === null || text === undefined) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (validatePlatform(parsed).length > 0) return null;
  return { apexDomain: parsed.apexDomain, dnsNote: isStr(parsed.dnsNote) ? parsed.dnsNote : null };
}

/** The host a platform subdomain resolves to: `<subdomain>.<apex>`. */
export function platformHostOf(subdomain, apex) {
  return `${subdomain}.${apex}`;
}

/** Migrate a client's old `domain` field into `subdomain`, in memory, PURE.
 *  Returns `{ client, note }` — `note` is a short owner-facing sentence when
 *  something changed, else null. Never mutates the input. */
export function migrateHosting(client, platform) {
  if (typeof client.subdomain === "string") {
    // `subdomain` is authoritative: any leftover `domain` (the pre-platform field) goes,
    // with a note when it named something else — a stale field must not block every run.
    if (typeof client.domain === "string" || client.domain === null) {
      const { domain, ...rest } = client;
      const apex = platform ? platform.apexDomain : "<apex>";
      const same = domain === platformHostOf(client.subdomain, apex);
      return { client: rest, note: domain && !same ? `the old domain field (${domain}) was removed — the web address is ${platformHostOf(client.subdomain, apex)}` : null };
    }
    return { client, note: null };
  }
  if (typeof client.domain === "string" && platform && platform.apexDomain) {
    const suffix = `.${platform.apexDomain}`;
    if (client.domain.toLowerCase().endsWith(suffix)) {
      const remainder = client.domain.slice(0, -suffix.length);
      if (remainder.length > 0 && !remainder.includes(".")) {
        const { domain: _domain, ...rest } = client;
        return { client: { ...rest, subdomain: remainder }, note: `domain ${client.domain} became subdomain ${remainder}` };
      }
    }
  }
  return { client, note: null };
}

/** The CNAME/TXT rows the owner adds at their DNS provider for a platform
 *  subdomain (pure — run.mjs supplies the Vercel-recommended CNAME target and
 *  any verification challenges). `name` is RELATIVE to the apex. */
export function webAddressRecords({ subdomain, apex, recommendedCname, verification }) {
  const records = [{ type: "CNAME", name: subdomain, value: recommendedCname }];
  for (const v of Array.isArray(verification) ? verification : []) {
    if (!v || v.type !== "TXT") continue;
    const suffix = `.${apex}`;
    const name = v.domain === apex ? "@" : v.domain && v.domain.toLowerCase().endsWith(suffix) ? v.domain.slice(0, -suffix.length) : v.domain;
    records.push({ type: "TXT", name, value: v.value });
  }
  return records;
}

/** Every problem in one pass (the owner fixes the file once, not one field per run). */
export function validateClient(c, platform = null) {
  const errors = [];
  if (!isObj(c)) return ["client file: must be a JSON object"];
  // Placeholders first: a forgotten `<…>` would otherwise pass the shape checks
  // below (a "<vercel-token>" IS a non-empty string) and fail late, at Vercel.
  const fields = [["slug", c.slug], ["vercel.token", isObj(c.vercel) ? c.vercel.token : undefined], ["mongodbUri", c.mongodbUri], ["admin.username", isObj(c.admin) ? c.admin.username : undefined], ["admin.password", isObj(c.admin) ? c.admin.password : undefined], ["cafe.name", isObj(c.cafe) ? c.cafe.name : undefined]];
  for (const [name, value] of fields) if (isPlaceholder(value)) errors.push(`${name}: still holds a <placeholder> from the example file — replace it with the real value`);
  if (errors.length) return errors;
  if (!isStr(c.slug) || !SLUG_RE.test(c.slug)) errors.push('slug: lowercase letters, digits and hyphens only (e.g. "sunrise-cafe")');
  else if (RESERVED_SUBDOMAINS.includes(c.slug)) errors.push(`slug: "${c.slug}" is reserved (${RESERVED_SUBDOMAINS.join("/")})`);
  if (!isObj(c.vercel) || !isStr(c.vercel.token)) errors.push("vercel.token: paste a token from the client's Vercel account (Settings → Tokens)");
  if (isObj(c.vercel) && c.vercel.project !== undefined && c.vercel.project !== null && !(isStr(c.vercel.project) && SLUG_RE.test(c.vercel.project))) errors.push("vercel.project: lowercase letters, digits and hyphens only (or omit to use the slug)");
  if (!isStr(c.mongodbUri) || !MONGO_URI_WITH_DB_RE.test(c.mongodbUri)) errors.push("mongodbUri: an Atlas SRV that ENDS with the database name, e.g. mongodb+srv://user:pass@cluster.mongodb.net/pos?retryWrites=true&w=majority");
  if (!isObj(c.admin) || !isStr(c.admin.username) || !USERNAME_RE.test(c.admin.username.toLowerCase())) errors.push("admin.username: 3-32 chars — letters, digits, . _ -");
  if (!isObj(c.admin) || !isStrongPassword(c.admin.password)) errors.push(`admin.password: at least ${PASSWORD_MIN_LEN} chars with a digit and a special character`);
  if (!isObj(c.cafe) || !isStr(c.cafe.name)) errors.push("cafe.name: the restaurant name (prints on every bill)");
  if (isObj(c.cafe) && c.cafe.gst !== undefined && c.cafe.gst !== null) {
    const g = c.cafe.gst;
    if (!isObj(g) || typeof g.enabled !== "boolean") errors.push("cafe.gst.enabled: true or false");
    if (isObj(g) && g.rate !== undefined && !GST_RATES.includes(g.rate)) errors.push(`cafe.gst.rate: one of ${GST_RATES.join(", ")}`);
    if (isObj(g) && g.mode !== undefined && !GST_MODES.includes(g.mode)) errors.push(`cafe.gst.mode: ${GST_MODES.join(" or ")}`);
  }
  const apex = platform ? platform.apexDomain : "<apex>";
  if (c.domain !== undefined && c.domain !== null) {
    errors.push(`domain: own domains are no longer used — every cafe is <name>.${apex}; move it to "subdomain"`);
  }
  if (c.subdomain !== undefined && c.subdomain !== null) {
    if (!isStr(c.subdomain) || !SUBDOMAIN_RE.test(c.subdomain)) errors.push('subdomain: lowercase letters, digits and hyphens, e.g. "lucifer"');
    else if (RESERVED_SUBDOMAINS.includes(c.subdomain)) errors.push(`subdomain: "${c.subdomain}" is reserved (${RESERVED_SUBDOMAINS.join("/")})`);
    else if (!platform) errors.push("subdomain: set the apex domain first (console ⚙ Platform → clients/_platform.json)");
  } else if (!(isObj(c.generated) && isStr(c.generated.projectId)) && platform) {
    errors.push("subdomain: required — every new cafe gets <name>.<apex>");
  }
  validateTables(c.tables, errors);
  validateMenu(c.menu, errors);
  validateImage(c.image, errors);
  validateStandbyHosts(c.standbyHosts, errors);
  validateCloudflare(c.cloudflare, errors);
  return errors;
}

/** Standby hosts: the SAME cafe (same database, images, secrets) deployed to
 *  other Vercel accounts as warm spares — each entry carries only what differs
 *  per account: a label, a token, an optional team id and project name. */
export const HOST_LABEL_RE = /^[a-z0-9][a-z0-9-]{0,20}$/;
export const PRIMARY_HOST = "primary";
function validateStandbyHosts(hosts, errors) {
  if (hosts === undefined || hosts === null) return;
  if (!Array.isArray(hosts)) return void errors.push("standbyHosts: must be a list");
  const seen = new Set();
  hosts.forEach((h, i) => {
    const where = `standbyHosts[${i}]`;
    if (!isObj(h)) return void errors.push(`${where}: must be an object { label, vercel: { token } }`);
    if (!isStr(h.label) || !HOST_LABEL_RE.test(h.label)) errors.push(`${where}.label: lowercase letters, digits, hyphens (e.g. "standby", "backup-2")`);
    else if (h.label === PRIMARY_HOST) errors.push(`${where}.label: "${PRIMARY_HOST}" is the main host — pick another name`);
    else if (seen.has(h.label)) errors.push(`${where}.label: "${h.label}" is used twice`);
    seen.add(h.label);
    if (!isObj(h.vercel) || !isStr(h.vercel.token)) errors.push(`${where}.vercel.token: a token from THAT Vercel account`);
    else if (isPlaceholder(h.vercel.token)) errors.push(`${where}.vercel.token: still a <placeholder>`);
    if (isObj(h.vercel) && h.vercel.project !== undefined && h.vercel.project !== null && !(isStr(h.vercel.project) && SLUG_RE.test(h.vercel.project))) errors.push(`${where}.vercel.project: lowercase letters, digits and hyphens only (or omit for "<slug>-<label>")`);
  });
}

/** The Vercel project name a host slot uses: its own `vercel.project`, else the
 *  slug for the primary and `<slug>-<label>` for a standby. */
export function projectNameForHost(client, label) {
  if (!label || label === PRIMARY_HOST) return projectNameOf(client);
  const entry = (client.standbyHosts ?? []).find((h) => h.label === label);
  return (entry && entry.vercel && entry.vercel.project) || `${client.slug}-${label}`;
}

/** The deploy.profiles.json entry name for a host slot. */
export function profileNameForHost(slug, label) {
  return !label || label === PRIMARY_HOST ? slug : `${slug}-${label}`;
}

/** "demo.pos.sandbee.in" → { label: "demo", root: "pos.sandbee.in" }. */
export function splitDomain(domain) {
  const i = domain.indexOf(".");
  return { label: domain.slice(0, i), root: domain.slice(i + 1) };
}

/** The Vercel-assigned production domain of a project, from its domain list.
 *  Vercel appends a suffix when the name is taken (the v1 project "lucifer"
 *  serves lucifer-liard.vercel.app) — so the LABEL is read from here, never
 *  assumed equal to the project name. */
export function pickVercelDomain(domains, projectName) {
  const list = (Array.isArray(domains) ? domains : []).filter((d) => d && typeof d.name === "string" && d.name.endsWith(VERCEL_APP_SUFFIX) && !d.gitBranch);
  // DETERMINISTIC: a project can carry several *.vercel.app names (a suffixed one
  // from when the plain name was taken, plus the plain one later). TENANT_ID can
  // match only one host, so always prefer the project's own `<name>.vercel.app`,
  // then a verified one, then the first — never "whatever came first today".
  const canonical = projectName ? `${String(projectName).toLowerCase()}${VERCEL_APP_SUFFIX}` : null;
  const hit = list.find((d) => d.name.toLowerCase() === canonical) ?? list.find((d) => d.verified) ?? list[0];
  return hit ? hit.name : null;
}

/** Every secret a client file holds, longest first (so a URI is scrubbed before
 *  the password embedded in it). Used to redact log lines and error messages. */
export function secretsOf(client) {
  if (!client || typeof client !== "object") return [];
  const out = new Set();
  const add = (v) => { if (typeof v === "string" && v.trim().length >= 6) out.add(v); };
  add(client.mongodbUri);
  if (client.vercel) add(client.vercel.token);
  for (const h of Array.isArray(client.standbyHosts) ? client.standbyHosts : []) if (h && h.vercel) add(h.vercel.token);
  // The client's OWN Cloudflare account token (realtime Worker) + the HMAC
  // publish secret that pairs with it — both must be scrubbed from every
  // logged line, exactly like vercel.token above.
  if (client.cloudflare) { add(client.cloudflare.token); add(client.cloudflare.publishSecret); }
  if (client.admin) add(client.admin.password);
  if (client.image) for (const k of ["secretAccessKey", "accessKeyId", "apiSecret", "apiKey"]) add(client.image[k]);
  if (client.accounts) for (const a of Object.values(client.accounts)) if (a && typeof a === "object") add(a.password);
  if (client.generated) {
    add(client.generated.authSecret); add(client.generated.healthStatsToken);
    // The publish secret is usually MINTED by the run (cloudflare.publishSecret
    // stays null) — its only copy on disk is here, so it must be scrubbed too.
    if (client.generated.realtime) add(client.generated.realtime.publishSecret);
  }
  // The password inside the URI on its own, too (driver errors quote it bare).
  const m = typeof client.mongodbUri === "string" ? client.mongodbUri.match(/^mongodb(?:\+srv)?:\/\/[^:/@]+:([^@]+)@/) : null;
  if (m) add(decodeURIComponent(m[1]));
  return [...out].sort((a, b) => b.length - a.length);
}

export const REDACTED = "•••";
/** Replace every known secret in `text` with •••. Also masks any mongodb URI's user:password part, known or not. */
export function redactSecrets(text, secrets) {
  let s = String(text);
  for (const secret of secrets) s = s.split(secret).join(REDACTED);
  return s.replace(/(mongodb(?:\+srv)?:\/\/)[^@\s/]+@/gi, `$1${REDACTED}@`);
}

/** The host/tenant decision (GO-LIVE-CHECKLIST §0 shapes A and B). Returns null
 *  when the project has no *.vercel.app domain listed yet (run.mjs then deploys
 *  first and re-reads the list). */
export function tenantOf(client, domains, projectName, platform = null) {
  if (client.subdomain && platform && platform.apexDomain) {
    const host = platformHostOf(client.subdomain, platform.apexDomain);
    return { tenantId: client.subdomain, rootDomain: platform.apexDomain, host, shape: "platform" };
  }
  const host = pickVercelDomain(domains, projectName ?? projectNameOf(client));
  if (!host) return null;
  return { tenantId: host.slice(0, -VERCEL_APP_SUFFIX.length), rootDomain: DEFAULT_ROOT_DOMAIN, host, shape: "vercel" };
}

/** The Vercel project name: an explicit `vercel.project`, else the slug. */
export function projectNameOf(client) {
  return (client.vercel && client.vercel.project) || client.slug;
}

const ENC = "encrypted";
const PLAIN = "plain";
const env = (key, value, type) => ({ key, value, type, target: ENV_TARGETS });

/** The runtime env for one cafe (apps/cafe/DEPLOY.md "Environment variables").
 *  Same map the Hub's provisioner writes (apps/hub/lib/provisioner-plan.ts
 *  buildTenantEnv), minus the vault: values come from the client file. Image
 *  vars are emitted only when a store is configured — shipping with none is a
 *  supported shape (uploads answer "not configured", everything else works). */
export function buildEnv(client, tenant, generated, realtimeEnv = []) {
  const out = [
    env("MONGODB_URI", client.mongodbUri, ENC),
    env("CORE_MONGODB_URI", client.mongodbUri, ENC),
    env("NEXTAUTH_SECRET", generated.authSecret, ENC),
    env("AUTH_SECRET", generated.authSecret, ENC),
    env("HEALTH_STATS_TOKEN", generated.healthStatsToken, ENC),
    env("HOSTING_TIER", "B", PLAIN),
    env("ROOT_DOMAIN", tenant.rootDomain, PLAIN),
  ];
  if (tenant.tenantId) out.push(env("TENANT_ID", tenant.tenantId, PLAIN));
  // Image store: EVERY store key is written on every run, the unselected store's
  // keys as "" — upsert can only overwrite, never delete, so this is what keeps a
  // switched-off or changed store's credentials from staying live on the project.
  // The cafe treats "" exactly like unset (apps/cafe/lib/r2.ts r2Config() returns
  // null on any falsy key; lib/images.ts checks `if (!cloudName)`), and with no
  // store at all it answers "Image uploads are not configured" — a supported shape.
  const img = client.image;
  const r2 = img && img.store === "r2" ? img : {};
  const cl = img && img.store === "cloudinary" ? img : {};
  out.push(
    env("IMAGE_STORE", img && img.store === "cloudinary" ? "cloudinary" : "r2", PLAIN),
    env("R2_ACCOUNT_ID", r2.accountId ?? "", ENC),
    env("R2_ACCESS_KEY_ID", r2.accessKeyId ?? "", ENC),
    env("R2_SECRET_ACCESS_KEY", r2.secretAccessKey ?? "", ENC),
    env("R2_BUCKET", r2.bucket ?? "", PLAIN),
    env("NEXT_PUBLIC_R2_PUBLIC_BASE_URL", r2.publicBaseUrl ?? "", PLAIN),
    env("CLOUDINARY_CLOUD_NAME", cl.cloudName ?? "", PLAIN),
    env("CLOUDINARY_API_KEY", cl.apiKey ?? "", ENC),
    env("CLOUDINARY_API_SECRET", cl.apiSecret ?? "", ENC),
    env("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", cl.cloudName ?? "", PLAIN),
  );
  // Realtime: `realtimeEnv` is whatever ensureRealtime returned — [] means
  // "leave the project's REALTIME_* untouched" (not provisioned yet), the 3
  // keys as "" mean off/standby, and the 3 real values mean on.
  out.push(...realtimeEnv);
  return out;
}

/** Keep already-minted secrets (rotating them on a re-run would log every
 *  device out and break the Worker's stats token); mint only what is missing. */
export function mintSecrets(generated, randomBytes) {
  const g = { ...(generated || {}) };
  if (!isStr(g.authSecret)) g.authSecret = randomBytes(AUTH_SECRET_BYTES).toString("base64");
  if (!isStr(g.healthStatsToken)) g.healthStatsToken = randomBytes(HEALTH_TOKEN_BYTES).toString("hex");
  return g;
}

/** Add/replace ONE profile in deploy.profiles.json, leaving every other profile
 *  byte-for-byte alone. The token is inline — the file is gitignored and
 *  .vercelignore'd by design (scripts/deploy.mjs header). */
export function mergeProfile(profiles, slug, { orgId, projectId, token, teamId }) {
  const base = isObj(profiles) ? profiles : {};
  return { ...base, [slug]: { app: APP_WORKSPACE, orgId, projectId, scope: teamId ?? null, tokenEnv: null, token } };
}

/** The verdict on GET /api/health for the production host. */
export function healthVerdict(status, body, tenantId) {
  if (status !== 200) return { ok: false, reason: body && body.db === "down" ? "app is up but cannot reach the cluster — check the Atlas Network Access allowlist (0.0.0.0/0) and mongodbUri" : `HTTP ${status}` };
  if (!body || body.ok !== true || body.db !== "up") return { ok: false, reason: "unexpected health body" };
  if (body.tenant !== tenantId) return { ok: false, reason: `health says tenant "${body.tenant}" but TENANT_ID is "${tenantId}" — the host label and TENANT_ID disagree (every page would 404)` };
  return { ok: true, reason: "ok" };
}

/** The CNAME the owner adds for a custom-domain shape (Vercel's standard target). */
export const VERCEL_CNAME_TARGET = "cname.vercel-dns.com";

export { REALTIME_ENV_KEYS } from "./cloudflare-validate.mjs";
