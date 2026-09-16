// ─────────────────────────────────────────────────────────────────────────────
// F3.5 — image-store validation for provisioning intake (plan §3.1): prove a
// PASTED credential actually works BEFORE the F3.6 machine records it as the
// tenant's image pool, and read usage % where the provider exposes it.
//
//  - Cloudinary: GET /usage (Basic api_key:api_secret). Facts pinned live
//    2026-07-12: the Admin API rate-limit status is 420 (not 429) with
//    X-FeatureRateLimit-* headers (Reset = HTTP-date); a FREE plan reports
//    only credits {usage, limit, used_percent} + per-metric credits_usage
//    (no per-metric limit), while paid plans carry per-metric used_percent.
//    Both shapes are parsed; every field is optional-defensive.
//  - R2: a SigV4-signed ListObjectsV2 (max-keys=1 — max-keys=0 is
//    undocumented on R2) — the one zero-side-effect probe whose permission is
//    EXPLICITLY documented for bucket-scoped "Object Read & Write" tokens
//    ("read, write, and list objects", R2 auth docs, re-verified 2026-07-12).
//    One 200 proves creds + signature + scope + bucket at once; 401/403
//    (AccessDenied / SignatureDoesNotMatch) fail the paste; 404 NoSuchBucket
//    fails the bucket. R2 exposes NO free usage API — R2 usage is the runtime
//    heartbeat's job (F3.7), so usage stays empty here.
//
// Validation failures RETURN {ok:false, reason} (a paste error is a user-facing
// outcome the wizard shows, not an exception); transport/unexpected statuses
// THROW. Reasons never echo the pasted secret. No-console gate applies.
// ─────────────────────────────────────────────────────────────────────────────

import { AwsV4Signer } from "aws4fetch";

import {
  createRetryingFetch,
  resolveRetryDeps,
  type RetryDeps,
} from "@/lib/provider-retry";

const LABEL = "hub-imagestore";

// ── Result shape (feeds Tenant.imagePool.usage — F3.7 trips ADD_CLOUD ≥75%) ──
export interface ImageStoreUsage {
  storagePct?: number;
  bandwidthPct?: number;
  creditsPct?: number;
}
export type ImageStoreValidation =
  | { ok: true; usage: ImageStoreUsage }
  | { ok: false; reason: string };

// ── Cloudinary ────────────────────────────────────────────────────────────────
export interface CloudinaryCredentials {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

/** Cloud names are URL path segments — fail closed on anything unexpected. */
const CLOUD_NAME_CHARSET = /^[a-z0-9_-]+$/i;

/** One usage metric, across both plan shapes (all fields optional-defensive). */
interface CloudinaryMetric {
  usage?: number;
  limit?: number;
  used_percent?: number;
  credits_usage?: number;
}
interface CloudinaryUsageBody {
  credits?: CloudinaryMetric;
  storage?: CloudinaryMetric;
  bandwidth?: CloudinaryMetric;
}

/** Percent for one metric: paid plans state used_percent per metric; free
 *  plans state per-metric credits_usage against the account credits.limit. */
function metricPct(metric: CloudinaryMetric | undefined, creditLimit: number | undefined) {
  if (typeof metric?.used_percent === "number") return metric.used_percent;
  if (typeof metric?.credits_usage === "number" && creditLimit && creditLimit > 0) {
    return (metric.credits_usage / creditLimit) * 100;
  }
  return undefined;
}

export function parseCloudinaryUsage(body: CloudinaryUsageBody): ImageStoreUsage {
  const creditLimit = body.credits?.limit;
  const credits =
    typeof body.credits?.used_percent === "number"
      ? body.credits.used_percent
      : typeof body.credits?.usage === "number" && creditLimit && creditLimit > 0
        ? (body.credits.usage / creditLimit) * 100
        : undefined;
  const storage = metricPct(body.storage, creditLimit);
  const bandwidth = metricPct(body.bandwidth, creditLimit);
  return {
    ...(storage !== undefined ? { storagePct: storage } : {}),
    ...(bandwidth !== undefined ? { bandwidthPct: bandwidth } : {}),
    ...(credits !== undefined ? { creditsPct: credits } : {}),
  };
}

/** GET /usage with the pasted creds: 200 → usage %, 401 (bad key/secret) and
 *  404 (no such cloud) → {ok:false}; anything else unexpected → throw. */
export async function validateCloudinary(
  creds: CloudinaryCredentials,
  overrides?: Partial<RetryDeps>,
): Promise<ImageStoreValidation> {
  if (!CLOUD_NAME_CHARSET.test(creds.cloudName)) {
    return { ok: false, reason: "Malformed Cloudinary cloud name" };
  }
  const deps = resolveRetryDeps(overrides);
  const rateLimitedFetch = createRetryingFetch(deps, {
    label: LABEL,
    // Cloudinary's documented rate-limit status is 420; keep 429 belt-and-braces.
    rateLimitStatuses: [420, 429],
  });
  const basic = Buffer.from(`${creds.apiKey}:${creds.apiSecret}`).toString("base64");
  const res = await rateLimitedFetch(
    `https://api.cloudinary.com/v1_1/${creds.cloudName}/usage`,
    { method: "GET", headers: { Authorization: `Basic ${basic}` } },
  );
  if (res.status === 401) {
    return { ok: false, reason: "Cloudinary rejected the API key/secret (HTTP 401)" };
  }
  if (res.status === 404) {
    return { ok: false, reason: `Cloudinary cloud "${creds.cloudName}" not found (HTTP 404)` };
  }
  if (!res.ok) {
    throw new Error(`[${LABEL}] cloudinary usage → HTTP ${res.status}`);
  }
  const body = (await res.json()) as CloudinaryUsageBody;
  return { ok: true, usage: parseCloudinaryUsage(body) };
}

// ── Cloudflare R2 ─────────────────────────────────────────────────────────────
export interface R2Credentials {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/** The cafe's r2.ts guards (apps/cafe/lib/r2.ts) — fail closed before ever
 *  building a URL from pasted input. */
const ACCOUNT_ID_CHARSET = /^[a-z0-9]+$/i;
const BUCKET_CHARSET = /^[a-z0-9.-]{3,63}$/;

/** Pull the S3 XML error <Code> out of a failure body (never echoed raw). */
async function s3ErrorCode(res: Response): Promise<string | undefined> {
  return /<Code>([^<]+)<\/Code>/.exec(await res.text().catch(() => ""))?.[1];
}

/**
 * Zero-side-effect reachability probe: a SigV4-signed ListObjectsV2 with
 * max-keys=1 on the pasted bucket.
 *   200                        → creds + signature + scope + bucket all OK
 *   401 / 403                  → credentials wrong / underscoped → not ok
 *   404 (NoSuchBucket)         → bucket name wrong               → not ok
 * R2 has no free usage endpoint, so usage is left empty (heartbeat owns it).
 */
export async function validateR2(
  creds: R2Credentials,
  overrides?: Partial<RetryDeps>,
): Promise<ImageStoreValidation> {
  if (!ACCOUNT_ID_CHARSET.test(creds.accountId) || !BUCKET_CHARSET.test(creds.bucket)) {
    return { ok: false, reason: "Malformed R2 account id or bucket name" };
  }
  const deps = resolveRetryDeps(overrides);
  const rateLimitedFetch = createRetryingFetch(deps, { label: LABEL });
  const url = `https://${creds.accountId}.r2.cloudflarestorage.com/${creds.bucket}?list-type=2&max-keys=1`;
  const signed = await new AwsV4Signer({
    method: "GET",
    url,
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    service: "s3",
    region: "auto", // R2's fixed SigV4 region
  }).sign();

  const res = await rateLimitedFetch(signed.url.toString(), {
    method: "GET",
    headers: signed.headers,
  });
  if (res.ok) return { ok: true, usage: {} };
  if (res.status === 401 || res.status === 403) {
    const code = await s3ErrorCode(res);
    return {
      ok: false,
      reason: `R2 rejected the credentials (HTTP ${res.status}${code ? ` ${code}` : ""})`,
    };
  }
  if (res.status === 404) {
    return { ok: false, reason: `R2 bucket "${creds.bucket}" not found (HTTP 404)` };
  }
  throw new Error(`[${LABEL}] r2 probe → HTTP ${res.status}`);
}
