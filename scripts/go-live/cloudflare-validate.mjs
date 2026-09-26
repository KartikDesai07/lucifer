// scripts/go-live/cloudflare-validate.mjs — the client-file `cloudflare` block
// rules, as a LEAF module: no imports at all. lib.mjs (validateClient) and
// realtime.mjs both import from here, so neither has to import the other —
// lib.mjs → realtime.mjs → core.mjs → lib.mjs would be an ESM cycle (safe only
// while nothing reads a binding at module-evaluation time; not worth the trap).

export const ACCOUNT_ID_RE = /^[0-9a-f]{32}$/;
export const PUBLISH_SECRET_MIN_LEN = 16;
/** The cafe's three realtime env vars (apps/cafe/.env.example) — here, in the
 *  leaf, so lib.mjs can name them without importing realtime.mjs. */
export const REALTIME_ENV_KEYS = ["REALTIME_PUBLISH_URL", "REALTIME_PUBLISH_SECRET", "NEXT_PUBLIC_REALTIME_URL"];
const PLACEHOLDER_RE = /<[^<>\s]+>/;
const isStr = (v) => typeof v === "string" && v.trim().length > 0;

/** `validateClient`'s cloudflare check: null/undefined ok; else an object with
 *  a non-empty, non-placeholder `token`, `accountId` null|32-hex, and
 *  `publishSecret` null|string of at least PUBLISH_SECRET_MIN_LEN chars. */
export function validateCloudflare(cf, errors) {
  if (cf === undefined || cf === null) return;
  if (typeof cf !== "object" || Array.isArray(cf)) return void errors.push("cloudflare: must be an object { token, accountId, publishSecret } (or null to leave realtime off)");
  if (!isStr(cf.token)) errors.push("cloudflare.token: paste a token from the client's OWN Cloudflare account (My Profile → API Tokens → Create)");
  else if (PLACEHOLDER_RE.test(cf.token)) errors.push("cloudflare.token: still holds a <placeholder> from the example file — replace it with the real value");
  if (cf.accountId !== undefined && cf.accountId !== null && !(typeof cf.accountId === "string" && ACCOUNT_ID_RE.test(cf.accountId))) errors.push("cloudflare.accountId: a 32-character hex account id (or omit — only needed when the token can see several accounts)");
  if (cf.publishSecret !== undefined && cf.publishSecret !== null && !(typeof cf.publishSecret === "string" && cf.publishSecret.length >= PUBLISH_SECRET_MIN_LEN)) errors.push(`cloudflare.publishSecret: at least ${PUBLISH_SECRET_MIN_LEN} characters (or omit — one is minted on the first run)`);
}
