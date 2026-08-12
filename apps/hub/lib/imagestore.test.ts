import { test } from "node:test";
import assert from "node:assert/strict";

import { parseCloudinaryUsage, validateCloudinary, validateR2 } from "./imagestore";
import type { RetryDeps } from "./provider-retry";

// DB-free tests for the F3.5 image-store validators. The Cloudinary response
// shapes below are the LIVE-probed 2026-07-12 free-plan body and the docs'
// paid ("Basic") sample — both plan dialects must parse.

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function makeDeps(handler: Handler) {
  const calls: { method: string; url: string; headers: Headers }[] = [];
  const sleeps: number[] = [];
  let clock = 1_750_000_000_000;
  const deps: Partial<RetryDeps> = {
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? "GET",
        url: String(url),
        headers: new Headers(init?.headers),
      });
      return handler(String(url), init);
    }) as typeof fetch,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
  };
  return { deps, calls, sleeps };
}

const CLD = { cloudName: "demo-cloud", apiKey: "key-1", apiSecret: "secret-1" };

// ── parseCloudinaryUsage ──────────────────────────────────────────────────────

test("free-plan shape: per-metric credits_usage against credits.limit", () => {
  // The live-probed free-plan body (trimmed to the parsed fields).
  const usage = parseCloudinaryUsage({
    credits: { usage: 0.18, limit: 25.0, used_percent: 0.72 },
    storage: { usage: 177_587_433, credits_usage: 0.17 },
    bandwidth: { usage: 26_183, credits_usage: 0.0 },
  });
  assert.equal(usage.creditsPct, 0.72);
  assert.ok(Math.abs(usage.storagePct! - 0.68) < 0.001); // 0.17/25 → 0.68%
  assert.equal(usage.bandwidthPct, 0);
});

test("paid-plan shape: per-metric used_percent, no credits object", () => {
  // The docs' "Basic" sample (trimmed).
  const usage = parseCloudinaryUsage({
    storage: { usage: 2_993_024_407_597, limit: 21_991_843_168_256, used_percent: 13.61 },
    bandwidth: { usage: 5_995_728_643_541, limit: 21_993_453_780_992, used_percent: 27.26 },
  });
  assert.equal(usage.storagePct, 13.61);
  assert.equal(usage.bandwidthPct, 27.26);
  assert.equal(usage.creditsPct, undefined);
});

test("credits.limit of 0 never divides — no Infinity/NaN percentages", () => {
  const usage = parseCloudinaryUsage({
    credits: { usage: 5, limit: 0 },
    storage: { credits_usage: 2 },
    bandwidth: { credits_usage: 1 },
  });
  assert.deepEqual(usage, {}); // a zero limit is unusable — honest empty
});

test("historical-date shape: credits.limit omitted → only derivable fields", () => {
  // Live-probed: a historical /usage/{date} shrinks credits to {usage} only.
  const usage = parseCloudinaryUsage({
    credits: { usage: 0.17 },
    storage: { usage: 177_587_433, credits_usage: 0.17 },
  });
  assert.deepEqual(usage, {}); // nothing derivable without a limit — honest empty
});

// ── validateCloudinary ────────────────────────────────────────────────────────

test("validateCloudinary GETs /usage with Basic auth and returns usage", async () => {
  const { deps, calls } = makeDeps(() =>
    new Response(
      JSON.stringify({ plan: "Free", credits: { usage: 5, limit: 25, used_percent: 20 } }),
      { status: 200 },
    ),
  );
  const result = await validateCloudinary(CLD, deps);
  assert.deepEqual(result, { ok: true, usage: { creditsPct: 20 } });
  assert.equal(calls[0].url, "https://api.cloudinary.com/v1_1/demo-cloud/usage");
  assert.equal(
    calls[0].headers.get("Authorization"),
    `Basic ${Buffer.from("key-1:secret-1").toString("base64")}`,
  );
});

test("validateCloudinary: 401 and 404 are validation FAILURES, not exceptions", async () => {
  const unauth = makeDeps(() =>
    new Response(JSON.stringify({ error: { message: "api_secret mismatch" } }), { status: 401 }),
  );
  const bad = await validateCloudinary(CLD, unauth.deps);
  assert.equal(bad.ok, false);
  assert.match((bad as { reason: string }).reason, /HTTP 401/);
  assert.ok(!(bad as { reason: string }).reason.includes("secret-1"));

  const missing = makeDeps(() => new Response("{}", { status: 404 }));
  const gone = await validateCloudinary(CLD, missing.deps);
  assert.equal(gone.ok, false);
  assert.match((gone as { reason: string }).reason, /not found/);
});

test("validateCloudinary: a malformed cloud name fails closed with no HTTP call", async () => {
  const { deps, calls } = makeDeps(() => new Response("{}", { status: 200 }));
  const result = await validateCloudinary({ ...CLD, cloudName: "evil/../path" }, deps);
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});

test("validateCloudinary retries the documented 420 rate-limit status", async () => {
  let n = 0;
  const { deps, sleeps } = makeDeps(() => {
    n += 1;
    if (n === 1) {
      return new Response("{}", {
        status: 420,
        // The live-probed dialect: Reset is an HTTP-date.
        headers: { "X-FeatureRateLimit-Reset": new Date(1_750_000_000_000 + 20_000).toUTCString() },
      });
    }
    return new Response(JSON.stringify({ credits: { used_percent: 1 } }), { status: 200 });
  });
  const result = await validateCloudinary(CLD, deps);
  assert.equal(result.ok, true);
  assert.deepEqual(sleeps, [20_000]); // backed off to the HTTP-date reset
});

test("validateCloudinary throws on an unexpected status (transport, not paste, error)", async () => {
  const { deps } = makeDeps(() => new Response("{}", { status: 503 }));
  await assert.rejects(validateCloudinary(CLD, deps), /HTTP 503/);
});

// ── validateR2 ────────────────────────────────────────────────────────────────

const R2 = {
  accountId: "abc123def456",
  accessKeyId: "AKIA-TEST",
  secretAccessKey: "r2-secret-value",
  bucket: "cafe-images",
};

test("validateR2: a 200 on the signed ListObjectsV2 probe = reachable", async () => {
  const { deps, calls } = makeDeps(() =>
    new Response(`<?xml version="1.0"?><ListBucketResult></ListBucketResult>`, { status: 200 }),
  );
  const result = await validateR2(R2, deps);
  assert.deepEqual(result, { ok: true, usage: {} });
  const call = calls[0];
  assert.equal(call.method, "GET");
  const url = new URL(call.url);
  assert.equal(url.hostname, "abc123def456.r2.cloudflarestorage.com");
  assert.equal(url.pathname, "/cafe-images");
  assert.equal(url.searchParams.get("list-type"), "2");
  assert.equal(url.searchParams.get("max-keys"), "1"); // max-keys=0 is undocumented on R2
  assert.match(call.headers.get("Authorization") ?? "", /^AWS4-HMAC-SHA256 Credential=AKIA-TEST\//);
  assert.ok(!call.url.includes("r2-secret-value"), "secret never appears in the URL");
});

test("validateR2: 404 NoSuchBucket and 401/403 are validation failures", async () => {
  const noBucket = makeDeps(() =>
    new Response(`<Error><Code>NoSuchBucket</Code></Error>`, { status: 404 }),
  );
  const missing = await validateR2(R2, noBucket.deps);
  assert.equal(missing.ok, false);
  assert.match((missing as { reason: string }).reason, /not found/);

  const denied = makeDeps(() =>
    new Response(`<Error><Code>SignatureDoesNotMatch</Code></Error>`, { status: 403 }),
  );
  const bad = await validateR2(R2, denied.deps);
  assert.equal(bad.ok, false);
  assert.match((bad as { reason: string }).reason, /HTTP 403 SignatureDoesNotMatch/);
  assert.ok(!(bad as { reason: string }).reason.includes("r2-secret-value"));

  const unauth = makeDeps(() => new Response("", { status: 401 }));
  const invalid = await validateR2(R2, unauth.deps);
  assert.equal(invalid.ok, false);
  assert.match((invalid as { reason: string }).reason, /HTTP 401/);
});

test("validateR2: malformed account/bucket fails closed with no HTTP call", async () => {
  const { deps, calls } = makeDeps(() => new Response("", { status: 200 }));
  const badAccount = await validateR2({ ...R2, accountId: "not/valid" }, deps);
  assert.equal(badAccount.ok, false);
  const badBucket = await validateR2({ ...R2, bucket: "UPPER_Case" }, deps);
  assert.equal(badBucket.ok, false);
  assert.equal(calls.length, 0);
});

test("validateR2 throws on an unexpected status", async () => {
  const { deps } = makeDeps(() => new Response("", { status: 500 }));
  await assert.rejects(validateR2(R2, deps), /HTTP 500/);
});
