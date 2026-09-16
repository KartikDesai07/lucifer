// CB-DL-1 S5.4 — source pins for the wiring that makes "ONE master-data call
// per page load" true. None of it is reachable from a unit test in this repo
// (no React test framework, by design — see customer-privacy-paths.test.ts's
// header), so the shapes that carry the guarantee are pinned against the real
// source: the seed runs in a useState initializer (not an effect — an effect
// is one paint too late and every mounted screen would fetch first), the
// bootstrap query never refetches on mount/focus/reconnect, the write-back is
// change-gated and single-segment only, and the blob is cleared on both
// user-switch paths.
//
// Same readSrc/stripComments idiom as lib/pos-pulse-paths.test.ts; RAW source
// for every negative check, every negative paired with a positive landmark
// from the same file (testing.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import { STALE_TIMES, GC_TIMES } from "@pos/shared/query";
import { MASTERS_BLOB_MAX_AGE_MS, MASTERS_HOLD_MAX_MS } from "@/lib/bootstrap-contract";
import { BOOTSTRAP_QUERY_KEY } from "@/components/layout/MasterDataProvider";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const PROVIDER = "apps/cafe/components/layout/MasterDataProvider.tsx";
const USE_AUTH = "apps/cafe/hooks/use-auth.ts";
const LOGIN_PAGE = "apps/cafe/app/(auth)/login/page.tsx";
const MASTERS_BLOB = "apps/cafe/lib/masters-blob.ts";
const MASTERS_SEED = "apps/cafe/lib/masters-seed.ts";
const USE_SETTINGS = "apps/cafe/hooks/use-settings.ts";
const USE_CATEGORIES = "apps/cafe/hooks/use-categories.ts";
const USE_PRODUCTS = "apps/cafe/hooks/use-products.ts";
const USE_STAFF = "apps/cafe/hooks/use-staff.ts";
const USE_TABLES = "apps/cafe/hooks/use-tables.ts";

const MAX_FILE_LINES = 300;

// Scans forward from an opening `(` and returns the index of its MATCHING
// closing `)`. A naive indexOf(")") would stop inside the first nested call
// (the useState initializer contains readMastersBlob() and seedMasters(...)).
function matchingParenEnd(src: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i += 1) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error("matchingParenEnd: no matching closing paren found");
}

function mustIndexOf(src: string, needle: string, label: string): number {
  const idx = src.indexOf(needle);
  assert.ok(idx >= 0, `${label}: could not find ${JSON.stringify(needle)}`);
  return idx;
}

function lineCount(src: string): number {
  return src.replace(/\n$/, "").split("\n").length;
}

// ── (1) the seed runs DURING the first render, not in an effect ─────────────

test("PIN: MasterDataProvider seeds the device's copy inside the useState initializer — readMastersBlob( and seedMasters( both live between useState( and its matching close paren, and the FIRST seedMasters( precedes the FIRST useEffect(", () => {
  const src = stripComments(readSrc(PROVIDER));

  const useStateIdx = mustIndexOf(src, "useState(", "MasterDataProvider");
  const initializerEnd = matchingParenEnd(src, src.indexOf("(", useStateIdx));
  const initializer = src.slice(useStateIdx, initializerEnd + 1);

  assert.ok(
    initializer.includes("readMastersBlob("),
    "the useState initializer must read the device's stored copy — readMastersBlob( was not inside it",
  );
  assert.ok(
    initializer.includes("seedMasters("),
    "the useState initializer must seed the five keys SYNCHRONOUSLY — a useEffect would run after the first paint, by which time every mounted screen has already fired its own master fetch (that is the extra query this slice removes)",
  );

  const firstSeed = mustIndexOf(src, "seedMasters(", "MasterDataProvider");
  const firstEffect = mustIndexOf(src, "useEffect(", "MasterDataProvider");
  assert.ok(
    firstSeed < firstEffect,
    `the first seedMasters( (index ${firstSeed}) must come before the first useEffect( (index ${firstEffect}) — the synchronous seed is the whole point of the initializer`,
  );
  assert.ok(
    firstSeed > useStateIdx && firstSeed < initializerEnd,
    `the first seedMasters( (index ${firstSeed}) must sit inside the useState initializer (${useStateIdx}..${initializerEnd})`,
  );

  // positive landmarks — proves the slicing above is not reading a blinded file.
  assert.match(src, /useQueryClient\(\)/, "positive landmark: the provider must take the query client from useQueryClient()");
  assert.match(src, /\{children\}/, "positive landmark: the provider must render {children}");
});

test("PIN: the two seeds carry DIFFERENT force flags — the bootstrap RESPONSE seeds with { force: true } (authoritative) while the initial useState seed from the device's stored copy does NOT (a stored blob's age is only a lower bound)", () => {
  const src = stripComments(readSrc(PROVIDER));

  // The payload seed must be forced: a browser clock running ahead of the
  // server would otherwise stamp the device's own copy in the future and keep
  // older data outranking every later bootstrap.
  assert.match(
    src,
    /seedMasters\(qc, blob, \{ force: true \}\)/,
    "the bootstrap response must be seeded with { force: true } — it is the authoritative refresh; without it a client clock ahead of the server pins stale masters for the rest of the device's life",
  );

  // The initializer's seed must NOT be forced: that copy may be up to
  // MASTERS_BLOB_MAX_AGE_MS old, so anything already in the cache with a
  // newer stamp must win.
  const useStateIdx = mustIndexOf(src, "useState(", "MasterDataProvider");
  const initializerEnd = matchingParenEnd(src, src.indexOf("(", useStateIdx));
  const initializer = src.slice(useStateIdx, initializerEnd + 1);
  assert.ok(
    initializer.includes("seedMasters("),
    "positive landmark: the initializer must still contain the stored-copy seed",
  );
  assert.ok(
    !initializer.includes("force"),
    "the useState initializer's seed must NOT force — the device's stored copy can be up to a day old, so fresher in-memory data must outrank it",
  );

  // Ordering: the values are recorded BEFORE the forced seed, so the seed's
  // own setQueryData successes cannot echo back through the subscription as
  // redundant single-part writes.
  const recordIdx = mustIndexOf(src, "lastWritten.current[part] = blob.parts[part]", "MasterDataProvider");
  const forcedSeedIdx = mustIndexOf(src, "seedMasters(qc, blob, { force: true })", "MasterDataProvider");
  const writeBlobIdx = mustIndexOf(src, "writeMastersBlob(blob)", "MasterDataProvider");
  assert.ok(
    recordIdx < forcedSeedIdx,
    `lastWritten must be recorded (index ${recordIdx}) BEFORE the forced seed (index ${forcedSeedIdx}) — otherwise each seeded part echoes back through the cache subscription as a redundant per-part blob write`,
  );
  assert.ok(
    forcedSeedIdx < writeBlobIdx,
    `the forced seed (index ${forcedSeedIdx}) must run before writeMastersBlob (index ${writeBlobIdx}) — the cache is what the screens read; the blob is only the next load's head start`,
  );
});

// ── (2) the provider owns no pulse subscription ─────────────────────────────

test("PIN: MasterDataProvider never subscribes to the wide pulse context (RAW source, negative) — paired with the positive landmarks useQueryClient( and {children}", () => {
  // Needle by concatenation so this gate cannot match its own source line.
  const BANNED = "usePosPulseContext" + "(";
  // RAW source: a banned call hiding in a comment is one edit from being real,
  // and the six-call-site inventory in pos-pulse-paths.test.ts must stay six.
  const src = readSrc(PROVIDER);
  assert.ok(src.length > 500, `positive landmark: ${PROVIDER} must have been read (got ${src.length} bytes)`);
  assert.ok(
    !src.includes(BANNED),
    "MasterDataProvider must never subscribe to the wide pulse context — it would re-render the whole dashboard shell on every pulse tick, and it would break the six-call-site inventory pin in pos-pulse-paths.test.ts",
  );
  assert.ok(src.includes("useQueryClient("), "positive landmark: the provider must call useQueryClient(");
  assert.ok(src.includes("{children}"), "positive landmark: the provider must render {children}");
});

// ── (3) the bootstrap query fetches exactly once per tab load ──────────────

test("PIN: the bootstrap query is fetch-once — staleTime Infinity, gcTime 0, retry 1, and no refetch on mount/focus/reconnect; its key is exactly ['bootstrap']", () => {
  const src = stripComments(readSrc(PROVIDER));

  assert.deepEqual(
    [...BOOTSTRAP_QUERY_KEY],
    ["bootstrap"],
    "BOOTSTRAP_QUERY_KEY must be exactly ['bootstrap'] — a longer key would be picked up by the provider's own single-segment write-back filter",
  );
  assert.match(src, /queryKey:\s*BOOTSTRAP_QUERY_KEY/, "the bootstrap query must use the exported BOOTSTRAP_QUERY_KEY constant, not an inline literal");

  const options: Array<[RegExp, string]> = [
    [/staleTime:\s*Infinity/, "staleTime: Infinity — the payload is never stale within a tab load"],
    [/gcTime:\s*0/, "gcTime: 0 — the payload is seeded into the five keys, so keeping a second copy alive is pure memory"],
    [/retry:\s*1/, "retry: 1 — one retry, then the hooks fall back to their own routes"],
    [/refetchOnMount:\s*false/, "refetchOnMount: false — a client-side navigation inside the tab must not repeat the call"],
    [/refetchOnWindowFocus:\s*false/, "refetchOnWindowFocus: false — tabbing back to the POS must not re-fetch the masters"],
    [/refetchOnReconnect:\s*false/, "refetchOnReconnect: false — a flaky counter WiFi must not turn into a master-fetch storm"],
  ];
  for (const [re, why] of options) {
    assert.match(src, re, `the bootstrap query must set ${why}`);
  }

  assert.match(src, /apiGet<BootstrapPayload>\("\/api\/bootstrap"\)/, "positive landmark: the query must fetch /api/bootstrap through apiGet");
});

// ── (4) the write-back is single-segment and change-gated ──────────────────

test("PIN: the write-back subscribes to the query cache, ignores manual (setQueryData) successes and multi-segment keys, and skips a value referentially identical to the last one it wrote", () => {
  const src = stripComments(readSrc(PROVIDER));

  assert.match(
    src,
    /getQueryCache\(\)\.subscribe\(/,
    "the write-back must observe the cache via getQueryCache().subscribe( — reading dataUpdatedAt in render re-renders the provider (and every wide consumer) once per fetch",
  );
  assert.match(
    src,
    /event\.type !== "updated" \|\| event\.action\.type !== "success"/,
    "the handler must act only on a successful update event",
  );

  // Only a REAL fetch success may write back. query-core stamps every
  // setQueryData success with manual:true, so this guard excludes the
  // provider's own seeds and every optimistic write a mutation makes — without
  // it the seed would immediately echo back as five single-part blob writes,
  // and an optimistic setQueryData that later rolls back would already have
  // been persisted into the device's copy.
  const manualGuardIdx = src.indexOf("event.action.manual === true");
  assert.ok(
    manualGuardIdx >= 0,
    "the handler must return early on event.action.manual === true — a setQueryData success (the provider's own seed, or an optimistic write) must never be written back into the device's copy",
  );
  const keyLengthIdx = mustIndexOf(src, "queryKey.length !== SINGLE_SEGMENT_KEY_LENGTH", "MasterDataProvider");
  assert.ok(
    manualGuardIdx < keyLengthIdx,
    `the manual guard (index ${manualGuardIdx}) must come before the key-length check (index ${keyLengthIdx}) — cheapest rejection first, and it is the guard that fires on every one of our own seeds`,
  );
  assert.match(src, /return;/, "positive landmark: the guard must be an early return");

  // Single-segment gate: ["products","archived"] is a different list and must
  // never land in the part the POS reads. The length is a named constant.
  assert.match(
    src,
    /queryKey\.length !== SINGLE_SEGMENT_KEY_LENGTH/,
    "the handler must ignore any key that is not a single segment (['products','archived'] is a different list) — via the named constant, not a magic 1",
  );
  assert.match(src, /const SINGLE_SEGMENT_KEY_LENGTH = 1;/, "SINGLE_SEGMENT_KEY_LENGTH must be declared as a named constant");

  // Change gate: TanStack's structural sharing hands back the SAME reference
  // when a refetch produced an unchanged payload, so this identity check is
  // what stops the live 30s tables poll from rewriting the blob every tick.
  assert.match(
    src,
    /if \(value === lastWritten\.current\[part\]\) return;/,
    "the handler must skip a value referentially identical to the last one it wrote for that part — otherwise the 30s tables poll rewrites the device's copy on every tick",
  );
  assert.match(src, /lastWritten\.current\[part\] = value;/, "the handler must record what it wrote, or the change gate can never match");
  assert.match(src, /upsertMastersPart\(part, value, new Date\(\)\.toISOString\(\)\)/, "positive landmark: the handler must write through upsertMastersPart");
  assert.match(src, /Object\.hasOwn\(PART_OF_QUERY_ROOT, root\)/, "the root-segment lookup must use Object.hasOwn, not `in` (a key named 'constructor' must not resolve to a part)");
});

// ── (5) + (6) user-switch safety on both paths ─────────────────────────────

test("PIN: use-auth.ts logout() clears the device's master copy BEFORE queryClient.clear() — index compare, so the order cannot silently invert", () => {
  const src = stripComments(readSrc(USE_AUTH));
  const clearBlobIdx = mustIndexOf(src, "clearMastersBlob()", "use-auth.ts");
  const clearQcIdx = mustIndexOf(src, "queryClient.clear()", "use-auth.ts");
  assert.ok(
    clearBlobIdx < clearQcIdx,
    `clearMastersBlob() (index ${clearBlobIdx}) must run before queryClient.clear() (index ${clearQcIdx}) — the shared tablet's next operator must not inherit the previous admin's staff list from the device's copy`,
  );
  assert.match(
    src,
    /import \{ clearMastersBlob \} from "@\/lib\/masters-blob";/,
    "use-auth.ts must import clearMastersBlob from lib/masters-blob",
  );
  assert.match(src, /signOut\(\{ callbackUrl: "\/login" \}\)/, "positive landmark: logout must still sign out with a /login callback");
});

test("PIN: the login page clears the device's master copy on mount — clearMastersBlob() inside a useEffect with an EMPTY dependency array (an expired session lands here, and the next operator may be a different user)", () => {
  const src = stripComments(readSrc(LOGIN_PAGE));
  assert.match(
    src,
    /import \{ clearMastersBlob \} from "@\/lib\/masters-blob";/,
    "the login page must import clearMastersBlob",
  );
  // The whole effect, matched as one shape: the mount effect must be exactly
  // this call with [] deps. A deps array carrying anything would re-run it
  // (harmless) or, worse, a missing effect would leave the blob in place.
  assert.match(
    src,
    /useEffect\(\(\) => \{\s*clearMastersBlob\(\);\s*\}, \[\]\);/,
    "the login page must call clearMastersBlob() in a mount-only useEffect (empty deps)",
  );
  assert.match(src, /signIn\("credentials"/, "positive landmark: this must still be the credentials login page");
});

// ── (7) the hooks honour "fetch once per page load" ────────────────────────

test("PIN: the four static-master hooks use STALE_TIMES.MASTERS + GC_TIMES.MASTERS, use-products.ts has NO background poll, and use-tables.ts KEEPS its 30s poll (live floor state, not master data)", () => {
  for (const rel of [USE_SETTINGS, USE_CATEGORIES, USE_PRODUCTS, USE_STAFF]) {
    const src = stripComments(readSrc(rel));
    assert.match(src, /staleTime:\s*STALE_TIMES\.MASTERS/, `${rel} must set staleTime: STALE_TIMES.MASTERS`);
    assert.match(src, /gcTime:\s*GC_TIMES\.MASTERS/, `${rel} must set gcTime: GC_TIMES.MASTERS`);
  }

  // Negative (RAW source): the 5-minute products poll was exactly the recurring
  // Mongo work the owner rule forbids. Needle by concatenation.
  const POLL = "refetch" + "Interval";
  const productsRaw = readSrc(USE_PRODUCTS);
  assert.ok(productsRaw.length > 500, `positive landmark: ${USE_PRODUCTS} must have been read (got ${productsRaw.length} bytes)`);
  assert.ok(
    !productsRaw.includes(POLL),
    "use-products.ts must declare no background poll at all — the menu is master data, fetched once per page load",
  );
  assert.ok(productsRaw.includes("PRODUCT_KEYS"), "positive landmark: use-products.ts must still own PRODUCT_KEYS");
  assert.ok(productsRaw.includes("STALE_TIMES.MASTERS"), "positive landmark: use-products.ts must still use the masters stale time");

  // use-tables.ts is the deliberate exception: currentOrderId is live floor
  // occupancy, not master data, so its poll stays.
  const tablesSrc = stripComments(readSrc(USE_TABLES));
  assert.match(
    tablesSrc,
    /refetchInterval:\s*isMutating \? false : REFETCH_INTERVALS\.TABLES/,
    "use-tables.ts must KEEP its REFETCH_INTERVALS.TABLES poll — table occupancy is live floor state; folding it into the masters would freeze the floor for a day",
  );
  assert.match(tablesSrc, /staleTime:\s*STALE_TIMES\.TABLES/, "use-tables.ts must keep the 30s tables staleTime, not the masters one");
});

// ── (8) one clock for the blob and the in-memory copies ────────────────────

test("PIN: STALE_TIMES.MASTERS, GC_TIMES.MASTERS and MASTERS_BLOB_MAX_AGE_MS are the SAME 24h figure (imported, not re-typed) — the device's copy and the in-memory copies must expire together", () => {
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  assert.equal(STALE_TIMES.MASTERS, TWENTY_FOUR_HOURS_MS, "STALE_TIMES.MASTERS must be 24h");
  assert.equal(GC_TIMES.MASTERS, TWENTY_FOUR_HOURS_MS, "GC_TIMES.MASTERS must be 24h");
  assert.equal(
    MASTERS_BLOB_MAX_AGE_MS,
    STALE_TIMES.MASTERS,
    "MASTERS_BLOB_MAX_AGE_MS must equal STALE_TIMES.MASTERS — a blob that outlives the in-memory copy would paint masters the hooks then consider fresh for another day",
  );
  assert.equal(GC_TIMES.MASTERS, STALE_TIMES.MASTERS, "a gcTime below the staleTime would evict a parked tab's seeded parts and force a per-screen re-fetch");
});

// ── (9) the split's own reason for existing ────────────────────────────────

test("PIN: masters-blob.ts, masters-seed.ts and MasterDataProvider.tsx each stay <= 300 lines", () => {
  for (const rel of [MASTERS_BLOB, MASTERS_SEED, PROVIDER]) {
    const count = lineCount(readSrc(rel));
    assert.ok(count <= MAX_FILE_LINES, `${rel} must stay <= ${MAX_FILE_LINES} lines, got ${count}`);
  }
});

// ── (10) contract change (owner directive 2026-09-09/11, "use local store
// properly"): the hold predicate now reads fetchStatus, and is bounded by a
// mounted gate + a wall-clock ceiling, so a stuck placeholder can never be
// the only outcome — these pins did not exist before this change. ──────────

test("PIN: fetchStatus is destructured from useQuery and the hold predicate is exactly the five-way AND (!seededFromBlob, data === undefined, error === null, fetchStatus === \"fetching\", !holdExpired)", () => {
  const src = stripComments(readSrc(PROVIDER));

  assert.match(
    src,
    /const \{ data, error, fetchStatus \} = useQuery\(/,
    "fetchStatus must be destructured from the useQuery result alongside data and error",
  );

  const holdingIdx = mustIndexOf(src, "const holding =", "MasterDataProvider");
  const holdingStmtEnd = src.indexOf(";", holdingIdx);
  assert.ok(holdingStmtEnd > holdingIdx, "the `const holding = ...` statement must end with a `;`");
  const holdingExpr = src.slice(holdingIdx, holdingStmtEnd);

  for (const clause of [
    "!seededFromBlob",
    "data === undefined",
    "error === null",
    'fetchStatus === "fetching"',
    "!holdExpired",
  ]) {
    assert.ok(
      holdingExpr.includes(clause),
      `the hold predicate must include ${JSON.stringify(clause)} — got: ${holdingExpr}`,
    );
  }

  // Positive landmark: the placeholder branch actually reads `holding`.
  assert.match(src, /if \(!mounted \|\| holding\)/, "positive landmark: the placeholder branch must gate on !mounted || holding");
});

test("PIN: MASTERS_HOLD_MAX_MS is imported from @/lib/bootstrap-contract and used as a window.setTimeout( duration inside an effect that returns window.clearTimeout(", () => {
  const rawSrc = readSrc(PROVIDER);
  assert.ok(
    rawSrc.includes("MASTERS_HOLD_MAX_MS"),
    "positive landmark: MASTERS_HOLD_MAX_MS must appear in the raw source at all",
  );
  assert.match(
    rawSrc,
    /import\s*\{[^}]*MASTERS_HOLD_MAX_MS[^}]*\}\s*from\s*"@\/lib\/bootstrap-contract"/,
    "MASTERS_HOLD_MAX_MS must be imported from @/lib/bootstrap-contract, not re-declared locally",
  );

  const src = stripComments(rawSrc);
  assert.match(
    src,
    /window\.setTimeout\(\(\) => setHoldExpired\(true\), MASTERS_HOLD_MAX_MS\)/,
    "the hold ceiling must be armed with window.setTimeout(..., MASTERS_HOLD_MAX_MS) inside an effect",
  );

  // The effect that arms the timeout must clean it up with window.clearTimeout(.
  const setTimeoutIdx = mustIndexOf(src, "window.setTimeout(", "MasterDataProvider");
  const enclosingEffectStart = src.lastIndexOf("useEffect(", setTimeoutIdx);
  assert.ok(enclosingEffectStart >= 0, "window.setTimeout( must sit inside a useEffect(");
  const effectEnd = matchingParenEnd(src, src.indexOf("(", enclosingEffectStart));
  const effectBody = src.slice(enclosingEffectStart, effectEnd + 1);
  assert.ok(
    effectBody.includes("window.clearTimeout("),
    "the effect that arms the hold timeout must return a cleanup calling window.clearTimeout( — otherwise a re-render before the ceiling leaks a timer",
  );
  assert.ok(
    effectBody.includes("if (seededFromBlob) return;"),
    "the hold ceiling must be skipped entirely when a stored copy already seeded the screen — there is nothing to bound in that case",
  );
});

test("PIN: a mounted state is seeded useState(false) with setMounted(true) inside a useEffect, and the placeholder branch is gated !mounted || holding", () => {
  const src = stripComments(readSrc(PROVIDER));

  assert.match(
    src,
    /const \[mounted, setMounted\] = useState\(false\)/,
    "mounted must be seeded useState(false) — the server and the first client render must agree on the placeholder",
  );
  assert.match(
    src,
    /useEffect\(\(\) => \{\s*setMounted\(true\);\s*\}, \[\]\);/,
    "setMounted(true) must run inside a mount-only useEffect (empty deps) — an effect runs one paint after the first client render, which is exactly the gap that keeps server and first-client paint identical",
  );
  assert.match(
    src,
    /if \(!mounted \|\| holding\)/,
    "the placeholder branch must be gated !mounted || holding — a first client paint that skipped the placeholder would be a hydration mismatch of the whole dashboard shell",
  );
});

test("PIN: the first seedMasters( still precedes the first useEffect( with the new mounted/holdExpired effects in place", () => {
  const src = stripComments(readSrc(PROVIDER));
  const firstSeed = mustIndexOf(src, "seedMasters(", "MasterDataProvider");
  const firstEffect = mustIndexOf(src, "useEffect(", "MasterDataProvider");
  assert.ok(
    firstSeed < firstEffect,
    `the first seedMasters( (index ${firstSeed}) must still precede the first useEffect( (index ${firstEffect}) — the mounted-state effect and the hold-ceiling effect are BOTH useEffect(, so this ordering pin must keep holding as more effects are added`,
  );
  // Positive landmark: there are now at least three useEffect( call sites
  // (mounted, hold ceiling, bootstrap seed/write-back, cache subscription) —
  // proves this file was not blinded down to a single stub effect.
  const effectCount = (src.match(/useEffect\(/g) ?? []).length;
  assert.ok(
    effectCount >= 3,
    `MasterDataProvider must declare at least 3 useEffect( call sites (mounted, hold ceiling, and the bootstrap/write-back effects), found ${effectCount}`,
  );
});

test("PIN: MASTERS_HOLD_MAX_MS is a sane integer between 1000 and 10000 ms", () => {
  assert.ok(Number.isInteger(MASTERS_HOLD_MAX_MS), "MASTERS_HOLD_MAX_MS must be an integer");
  assert.ok(
    MASTERS_HOLD_MAX_MS >= 1000 && MASTERS_HOLD_MAX_MS <= 10000,
    `MASTERS_HOLD_MAX_MS must be between 1000 and 10000 ms, got ${MASTERS_HOLD_MAX_MS}`,
  );
});
