import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import {
  bumpPrintWakeBudget,
  mergePrintWakeBudget,
  readPrintWakeBudget,
  writePrintWakeBudget,
  type PrintWakeBudget,
} from "@/lib/print-wake-budget";
import {
  PRINT_WAKE_FAST_MS,
  PRINT_WAKE_SLOW_MS,
  PRINT_WAKE_ACTIVE_WINDOW_MS,
  PRINT_WAKE_DAILY_CAP,
} from "@pos/shared/print-job";
import { REFETCH_INTERVALS } from "@pos/shared/query";

// CB-U1 (.claude/plan/v2/cb-u1-wake-and-session-plan.md, Slice A′) — the
// host's adaptive wake poll: DB-free unit tests for the pure budget helper
// (lib/print-wake-budget.ts), plus SOURCE-TEXT PINS (readFileSync +
// stripComments, mirroring lib/print-host-paths.test.ts / lib/print-queue.test.ts)
// over the read-only wake route and the hook that drives it. No mongod, no
// connectDB, no mongoose connection anywhere in this file.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const WAKE_ROUTE = "apps/cafe/app/api/print-jobs/wake/route.ts";
const USE_PRINT_HOST_WAKE = "apps/cafe/hooks/use-print-host-wake.ts";
const PRINT_HOST_DRAIN = "apps/cafe/components/print/PrintHostDrain.tsx";
const PRINT_JOB_SHARED_LIB = "packages/shared/src/print-job.ts";

// ── 1. bumpPrintWakeBudget — pure budget cases ──────────────────────────────

test("bumpPrintWakeBudget: a null record starts a fresh count at 1, always allowed", () => {
  const { record, allowed } = bumpPrintWakeBudget(null, "2026-09-07", 3);
  assert.deepEqual(record, { dayKey: "2026-09-07", count: 1 });
  assert.equal(allowed, true);
});

test("bumpPrintWakeBudget: cap of 3 — the 4th bump on the same dayKey is NOT allowed, and the count still advances to 4", () => {
  let record: PrintWakeBudget | null = null;
  let allowed = true;
  for (let i = 0; i < 4; i++) {
    ({ record, allowed } = bumpPrintWakeBudget(record, "2026-09-07", 3));
  }
  assert.equal(record!.count, 4, "the 4th bump must still advance the stored count");
  assert.equal(allowed, false, "the 4th bump (over the cap of 3) must not be allowed");
});

test("bumpPrintWakeBudget: the 3rd bump (at the cap) is still allowed — only strictly-over the cap is refused", () => {
  let record: PrintWakeBudget | null = null;
  let allowed = false;
  for (let i = 0; i < 3; i++) {
    ({ record, allowed } = bumpPrintWakeBudget(record, "2026-09-07", 3));
  }
  assert.equal(record!.count, 3);
  assert.equal(allowed, true, "the 3rd bump, exactly at the cap, must still be allowed");
});

test("bumpPrintWakeBudget: a different dayKey resets the count to 1, always allowed, even if the prior day was already over cap", () => {
  const overCapYesterday: PrintWakeBudget = { dayKey: "2026-09-06", count: 999 };
  const { record, allowed } = bumpPrintWakeBudget(overCapYesterday, "2026-09-07", 3);
  assert.deepEqual(record, { dayKey: "2026-09-07", count: 1 });
  assert.equal(allowed, true, "a cafe-day rollover must always start a fresh, allowed count");
});

test("bumpPrintWakeBudget: the stored count is clamped at cap+1 across MANY over-cap bumps — a misbehaving tab can never grow the stored number unbounded", () => {
  let record: PrintWakeBudget | null = null;
  for (let i = 0; i < 50; i++) {
    ({ record } = bumpPrintWakeBudget(record, "2026-09-07", 3));
  }
  assert.equal(record!.count, 4, "50 bumps against a cap of 3 must clamp the stored count at cap+1 (4), never grow past it");
});

// ── 1b. mergePrintWakeBudget — pure merge cases (F1's F-C fix) ──────────────
//
// F-C: a localStorage that silently fails every read (private browsing, a
// full quota, another tab's write racing this one) looked IDENTICAL to
// "never bumped" and reset the cap every tick. The fix merges the stored
// record with an in-memory ref kept for the life of the tab — same dayKey,
// higher count wins — so a dead localStorage can only make the cap MORE
// strict, never defeat it.

const DAY = "2026-09-07";
const OTHER_DAY = "2026-09-06";

test("mergePrintWakeBudget: both null -> null", () => {
  assert.equal(mergePrintWakeBudget(null, null, DAY), null);
});

test("mergePrintWakeBudget: stored only, same day -> stored", () => {
  const stored: PrintWakeBudget = { dayKey: DAY, count: 5 };
  assert.deepEqual(mergePrintWakeBudget(stored, null, DAY), stored);
});

test("mergePrintWakeBudget: memory only, same day -> memory", () => {
  const memory: PrintWakeBudget = { dayKey: DAY, count: 7 };
  assert.deepEqual(mergePrintWakeBudget(null, memory, DAY), memory);
});

test("mergePrintWakeBudget: both same day -> the HIGHER count wins, in both orders (stored > memory AND memory > stored)", () => {
  const lower: PrintWakeBudget = { dayKey: DAY, count: 3 };
  const higher: PrintWakeBudget = { dayKey: DAY, count: 9 };
  assert.deepEqual(mergePrintWakeBudget(lower, higher, DAY), higher, "memory higher than stored must still win");
  assert.deepEqual(mergePrintWakeBudget(higher, lower, DAY), higher, "stored higher than memory must still win");
});

test("mergePrintWakeBudget: stored is for a DIFFERENT day, memory is for today -> memory (the other-day record is not this cafe-day's count at all)", () => {
  const staleStored: PrintWakeBudget = { dayKey: OTHER_DAY, count: 999 };
  const memoryToday: PrintWakeBudget = { dayKey: DAY, count: 2 };
  assert.deepEqual(mergePrintWakeBudget(staleStored, memoryToday, DAY), memoryToday);
});

test("mergePrintWakeBudget: stored is for today, memory is for a DIFFERENT day -> stored", () => {
  const storedToday: PrintWakeBudget = { dayKey: DAY, count: 4 };
  const staleMemory: PrintWakeBudget = { dayKey: OTHER_DAY, count: 999 };
  assert.deepEqual(mergePrintWakeBudget(storedToday, staleMemory, DAY), storedToday);
});

test("mergePrintWakeBudget: both are for OTHER days (neither matches dayKey) -> null", () => {
  const staleStored: PrintWakeBudget = { dayKey: OTHER_DAY, count: 12 };
  const staleMemory: PrintWakeBudget = { dayKey: "2026-09-01", count: 30 };
  assert.equal(mergePrintWakeBudget(staleStored, staleMemory, DAY), null);
});

// F-C's whole point, as an integration-style pure test: a storage that ALWAYS
// returns null (the exact failure mode that motivated the fix) must still be
// capped at exactly `cap` allowed hits per day, because the in-memory ref
// carries the true count across rounds even though nothing is ever actually
// persisted. Without the merge, every round would re-read null, bump from a
// fresh record, and be "allowed" forever.
test("mergePrintWakeBudget + bumpPrintWakeBudget integration: with a storage that ALWAYS returns null, 20 rounds of bump(merge(null, mem, day), day, cap=3) — carrying mem between rounds — must allow EXACTLY 3 of the 20", () => {
  const cap = 3;
  let mem: PrintWakeBudget | null = null;
  let allowedCount = 0;

  for (let i = 0; i < 20; i++) {
    const storedAlwaysNull: PrintWakeBudget | null = null; // the dead-localStorage stand-in
    const seed = mergePrintWakeBudget(storedAlwaysNull, mem, DAY);
    const { record, allowed } = bumpPrintWakeBudget(seed, DAY, cap);
    mem = record;
    if (allowed) allowedCount++;
  }

  assert.equal(
    allowedCount,
    3,
    "with a storage stuck on null, the in-memory carry must still cap allowed hits at EXACTLY the configured cap (3) across 20 rounds — this is the F-C fix's whole reason to exist",
  );
  assert.equal(mem!.count, 4, "the in-memory record must still reflect the true count, clamped at cap+1, after the cap is exceeded");
});

// ── 2. readPrintWakeBudget / writePrintWakeBudget — outside a window, safe ─

test("readPrintWakeBudget: returns null when `window` is undefined (this node:test env has no window) — the fresh-record branch for the caller, never a throw", () => {
  assert.equal(typeof globalThis.window, "undefined", "positive landmark: this test genuinely runs with no window global");
  assert.equal(readPrintWakeBudget(), null);
});

test("writePrintWakeBudget: is a no-op when `window` is undefined — must not throw", () => {
  assert.equal(typeof globalThis.window, "undefined", "positive landmark: this test genuinely runs with no window global");
  assert.doesNotThrow(() => writePrintWakeBudget({ dayKey: "2026-09-07", count: 1 }));
});

// ── 3. Route pins — GET /api/print-jobs/wake ────────────────────────────────

test('PIN: app/api/print-jobs/wake/route.ts contains requireAuth, connectDB, noStore(success(, printJobDrainHead(, force-dynamic, and export async function GET — and does NOT contain .find(, .aggregate(, prune, updateOne, findOneAndUpdate, deleteMany, deleteOne, insertMany, create(, or beat (READ-ONLY: no prune, no beat, no write, ever)', () => {
  const src = stripComments(readSrc(WAKE_ROUTE));

  // Positive landmarks FIRST, per testing.md's vision-guard rule, so the
  // negative checks below cannot be trivially true over a blinded file.
  assert.match(src, /requireAuth/, "the route must reference requireAuth");
  assert.match(src, /connectDB/, "the route must reference connectDB");
  assert.match(src, /noStore\(success\(/, "the route must return noStore(success(");
  assert.match(src, /printJobDrainHead\(/, "the route must call printJobDrainHead(");
  assert.match(src, /export const dynamic = "force-dynamic";/, 'the route must declare dynamic = "force-dynamic"');
  assert.match(src, /export async function GET\(/, "the route must export async function GET(");

  // Banned needles built by concatenation (testing.md rule: never a literal
  // that could match the gate's own source line) — beat/insertMany/deleteOne/
  // create( added per CB-U1 review round 1 (F2): a wake route must never gain
  // a PrintHost.findOneAndUpdate beat OR any other write verb, not just the
  // ones the original route happened to omit.
  const bannedNeedles = [
    "." + "find(",
    "." + "aggregate(",
    "prune",
    "updateOne",
    "findOneAndUpdate",
    "deleteMany",
    "deleteOne",
    "insertMany",
    "create" + "(",
    "beat",
  ];
  for (const needle of bannedNeedles) {
    assert.ok(!src.includes(needle), `the wake route must NEVER contain "${needle}" — it is READ-ONLY (one existence probe only), matching the invariant order-requests/pulse/route.ts pins for itself`);
  }
});

// ── 4. Hook pins — use-print-host-wake.ts ───────────────────────────────────

test("PIN: use-print-host-wake.ts's useQuery carries refetchIntervalInBackground:isDesktopShell() (CB-D1: the shell keeps polling in the tray, a hidden browser tab does not), retry:false, staleTime:0, enabled:drains; the refetchInterval arrow references BOTH PRINT_WAKE_FAST_MS and PRINT_WAKE_SLOW_MS; the hook declares capSpentRef and imports PRINT_WAKE_ACTIVE_WINDOW_MS and POS_PULSE_KEYS.all; the fetch endpoint is \"/api/print-jobs/wake\" — and it NEVER calls usePosPulseContext( or usePrintJobFeed( (landmark: it DOES call useQueryClient()", () => {
  const src = stripComments(readSrc(USE_PRINT_HOST_WAKE));

  // Positive landmarks first.
  assert.match(src, /useQueryClient\(\)/, "positive landmark: the hook must call useQueryClient()");
  assert.match(src, /refetchIntervalInBackground:\s*isDesktopShell\(\)/, "must set refetchIntervalInBackground: isDesktopShell() (CB-D1 — was a hardcoded false)");
  assert.ok(src.includes('from "@/lib/desktop-shell"'), "must import isDesktopShell from \"@/lib/desktop-shell\"");
  assert.match(src, /retry:\s*false/, "must set retry: false");
  assert.match(src, /staleTime:\s*0/, "must set staleTime: 0");
  assert.match(src, /enabled:\s*drains/, "must set enabled: drains");
  assert.ok(src.includes("capSpentRef"), "must declare capSpentRef");
  assert.ok(src.includes("PRINT_WAKE_ACTIVE_WINDOW_MS"), "must import/use PRINT_WAKE_ACTIVE_WINDOW_MS");
  assert.ok(src.includes("POS_PULSE_KEYS.all"), "must reference POS_PULSE_KEYS.all");
  assert.ok(src.includes('"/api/print-jobs/wake"'), 'must fetch the literal "/api/print-jobs/wake" endpoint');

  // Scoped to the arrow's own multi-line BODY (the predicate/branches live on
  // lines AFTER "refetchInterval: () =>" itself, not on that same line) — a
  // single-line slice would silently pass over an arrow whose body was ever
  // reduced to nothing, or fail to see the real constants it references.
  const refetchIntervalAt = src.search(/refetchInterval:\s*\(\)\s*=>/);
  assert.ok(refetchIntervalAt >= 0, "positive landmark: must declare a refetchInterval arrow function");
  const refetchIntervalBodyEnd = src.indexOf("});", refetchIntervalAt);
  assert.ok(refetchIntervalBodyEnd > refetchIntervalAt, "expected to find the end of the useQuery({...}) call after refetchInterval");
  const refetchIntervalBlock = src.slice(refetchIntervalAt, refetchIntervalBodyEnd);
  assert.ok(refetchIntervalBlock.includes("PRINT_WAKE_FAST_MS"), "the refetchInterval arrow must reference PRINT_WAKE_FAST_MS");
  assert.ok(refetchIntervalBlock.includes("PRINT_WAKE_SLOW_MS"), "the refetchInterval arrow must reference PRINT_WAKE_SLOW_MS");

  assert.ok(!src.includes("usePosPulseContext" + "("), "use-print-host-wake.ts must NEVER call usePosPulseContext( — the feed arrives as a prop, not the wide pulse context");
  assert.ok(!src.includes("usePrintJobFeed" + "("), "use-print-host-wake.ts must NEVER call usePrintJobFeed( itself — the feed arrives as a prop from its caller, keeping the hook independently testable");
});

// F1 fix (review round 1, F-A): a `pending:true` wake answer invalidated the
// pulse EVERY tick while the host was busy printing — live-probed against
// @tanstack/query-core 5.101.0. The fix widened the route's answer to a
// CHANGE SIGNAL (`newestId`) and made the hook invalidate ONLY when it
// changes, with DEFAULT cancelRefetch (an in-flight stale 20s pulse started
// before this job's insert must be cancelled, not left to satisfy the
// invalidation with stale data) — so `cancelRefetch: false` must be GONE
// entirely, not merely absent from one call site (negative by concatenation,
// vision-guarded by the invalidateQueries( landmark that must still be there).
test("PIN (F1 regression guard): use-print-host-wake.ts's invalidateQueries call carries NO cancelRefetch option at all (default cancelRefetch, deliberately) — landmark: invalidateQueries({ queryKey: POS_PULSE_KEYS.all }) IS present", () => {
  const src = stripComments(readSrc(USE_PRINT_HOST_WAKE));

  assert.ok(
    src.includes("invalidateQueries({ queryKey: POS_PULSE_KEYS.all })"),
    "positive landmark: the hook must call invalidateQueries({ queryKey: POS_PULSE_KEYS.all }) — with no second option",
  );
  assert.ok(
    !src.includes("cancelRefetch" + ":"),
    "use-print-host-wake.ts must NEVER pass a cancelRefetch option to invalidateQueries — F1 fixed a pulse-storm bug by reverting to the DEFAULT (true), which cancels an in-flight stale pulse rather than letting it satisfy the invalidation with data older than the new job",
  );
});

// F1 change-signal rule (F-A): invalidate ONLY when newestId CHANGES, not
// once per tick — and reset the remembered id once nothing is pending, so a
// job that arrives after a quiet spell is still recognised as NEW.
test("PIN: use-print-host-wake.ts declares lastNewestIdRef, compares data.newestId === lastNewestIdRef.current and returns early (no invalidation) on a match, and resets lastNewestIdRef.current = null when !data.pending — landmark: the effect DOES call invalidateQueries on the non-matching path", () => {
  const src = stripComments(readSrc(USE_PRINT_HOST_WAKE));

  assert.ok(src.includes("lastNewestIdRef"), "must declare lastNewestIdRef");
  assert.match(
    src,
    /if\s*\(\s*data\.newestId\s*===\s*lastNewestIdRef\.current\s*\)\s*return;/,
    "must compare data.newestId === lastNewestIdRef.current and return early on a match — the once-per-NEW-job rule",
  );
  assert.match(
    src,
    /lastNewestIdRef\.current\s*=\s*null;/,
    "must reset lastNewestIdRef.current = null when nothing is pending, so a later new job is recognised as a change",
  );
  // Positive landmark: the invalidation itself must still be reachable on the
  // non-matching path (a stripComments regression that blinded the effect
  // would otherwise make the two negative-shaped asserts above pass vacuously).
  assert.ok(
    src.includes("invalidateQueries({ queryKey: POS_PULSE_KEYS.all })"),
    "landmark: the effect must still call invalidateQueries on the changed-id path",
  );
});

// F1 SLOW-until-success backoff (F-D): a failing wake route must fall back to
// SLOW cadence, never storm the route at FAST — and a subsequent success
// must restore FAST eligibility.
test("PIN: use-print-host-wake.ts sets failedRef.current = true inside a catch block and failedRef.current = false immediately after a successful apiGet — the refetchInterval predicate consults failedRef.current (F-D: an unreachable route retries on SLOW, never FAST)", () => {
  const src = stripComments(readSrc(USE_PRINT_HOST_WAKE));

  const catchIdx = src.search(/catch\s*\([^)]*\)\s*\{[^}]*failedRef\.current\s*=\s*true;/);
  assert.ok(catchIdx >= 0, "failedRef.current = true must be set inside a catch block");

  assert.match(
    src,
    /const data = await apiGet<PrintWakeData>\(WAKE_ENDPOINT\);\s*\n\s*failedRef\.current = false;/,
    "failedRef.current = false must be set immediately after a successful apiGet call — a success restores FAST eligibility",
  );

  // Scoped to the arrow's own multi-line body (see the earlier hook-pin
  // test's comment: the predicate lives on lines AFTER "refetchInterval: () =>"
  // itself, never on that same line).
  const refetchIntervalAt = src.search(/refetchInterval:\s*\(\)\s*=>/);
  assert.ok(refetchIntervalAt >= 0, "positive landmark: must declare a refetchInterval arrow function");
  const refetchIntervalBodyEnd = src.indexOf("});", refetchIntervalAt);
  assert.ok(refetchIntervalBodyEnd > refetchIntervalAt, "expected to find the end of the useQuery({...}) call after refetchInterval");
  const refetchIntervalBlock = src.slice(refetchIntervalAt, refetchIntervalBodyEnd);
  assert.ok(refetchIntervalBlock.includes("failedRef.current"), "the refetchInterval predicate must reference failedRef.current");
});

// F1 polarity (the interval predicate's own shape): FAST only when NOT
// cap-spent, NOT failed, and still inside the active window — any one of the
// three false-ing it out falls back to SLOW. Pinned as one ternary so a
// future edit cannot silently drop a term.
test("PIN: use-print-host-wake.ts's refetchInterval arrow is exactly `<predicate> ? PRINT_WAKE_FAST_MS : PRINT_WAKE_SLOW_MS` (FAST only on the true branch, matching the /\\?\\s*PRINT_WAKE_FAST_MS\\s*:\\s*PRINT_WAKE_SLOW_MS/ shape) AND the predicate references capSpentRef.current, failedRef.current, AND activeUntilRef.current", () => {
  const src = stripComments(readSrc(USE_PRINT_HOST_WAKE));

  const refetchIntervalAt = src.search(/refetchInterval:\s*\(\)\s*=>/);
  assert.ok(refetchIntervalAt >= 0, "positive landmark: must declare a refetchInterval arrow function");
  // Scoped to the arrow's own multi-line body: up to the closing `,` that ends
  // the useQuery option (the arrow is the LAST option in the object, so the
  // slice runs to the object's own closing `});`).
  const bodyEnd = src.indexOf("});", refetchIntervalAt);
  assert.ok(bodyEnd > refetchIntervalAt, "expected to find the end of the useQuery({...}) call after refetchInterval");
  const body = src.slice(refetchIntervalAt, bodyEnd);

  assert.match(
    body,
    /\?\s*PRINT_WAKE_FAST_MS\s*:\s*PRINT_WAKE_SLOW_MS/,
    "the refetchInterval arrow must be a single ternary of the shape `<predicate> ? PRINT_WAKE_FAST_MS : PRINT_WAKE_SLOW_MS` — FAST must be the TRUE branch",
  );
  assert.ok(body.includes("capSpentRef.current"), "the refetchInterval predicate must reference capSpentRef.current");
  assert.ok(body.includes("failedRef.current"), "the refetchInterval predicate must reference failedRef.current");
  assert.ok(body.includes("activeUntilRef.current"), "the refetchInterval predicate must reference activeUntilRef.current");
});

// F1 budget wiring (F-C): the in-memory record must be MERGED with storage
// (higher count wins) before every bump, and the queryFn must refuse to fetch
// once the merged count is over cap — this is the whole point of the
// in-memory half: a localStorage that silently fails every read must never
// look identical to "never bumped" and reset the cap every tick.
test("PIN: use-print-host-wake.ts's queryFn calls mergePrintWakeBudget(readPrintWakeBudget(), memoryBudgetRef.current, dayKey), passes the merged seed into bumpPrintWakeBudget(seed, dayKey, PRINT_WAKE_DAILY_CAP), writes the result back via writePrintWakeBudget(record), and returns early (no fetch) with `if (!allowed) return` — landmark: the queryFn DOES still call apiGet on the allowed path", () => {
  const src = stripComments(readSrc(USE_PRINT_HOST_WAKE));

  assert.match(
    src,
    /const seed = mergePrintWakeBudget\(readPrintWakeBudget\(\),\s*memoryBudgetRef\.current,\s*dayKey\);/,
    "the queryFn must call mergePrintWakeBudget(readPrintWakeBudget(), memoryBudgetRef.current, dayKey)",
  );
  assert.match(
    src,
    /const \{ record, allowed \} = bumpPrintWakeBudget\(seed,\s*dayKey,\s*PRINT_WAKE_DAILY_CAP\);/,
    "the queryFn must call bumpPrintWakeBudget(seed, dayKey, PRINT_WAKE_DAILY_CAP) with the merged seed",
  );
  assert.ok(src.includes("writePrintWakeBudget(record)"), "the queryFn must persist the bumped record via writePrintWakeBudget(record)");
  assert.match(src, /if\s*\(\s*!allowed\s*\)\s*return\s/, "the queryFn must return early (no fetch) when the budget disallows the hit");

  // Positive landmark: the allowed path must still reach apiGet, or the two
  // negative-shaped asserts above (early-return, no direct fetch call) could
  // pass vacuously over a queryFn that never fetches at all.
  assert.ok(src.includes("await apiGet<PrintWakeData>(WAKE_ENDPOINT)"), "landmark: the allowed path must still call apiGet(WAKE_ENDPOINT)");
});

// ── 5. Call-site inventory: usePrintHostWake( ───────────────────────────────

test('INVENTORY: files containing the needle "usePrintHostWake(" under app/components/hooks are exactly PrintHostDrain.tsx (the call site) and use-print-host-wake.ts (its own declaration) — a new call site is a deliberate decision, not an accident (mirrors pos-pulse-paths.test.ts\'s usePosPulseContext( inventory style)', () => {
  const NEEDLE = "usePrintHostWake" + "(";
  const roots = ["app", "components", "hooks"].map((d) => path.join(REPO_ROOT, "apps/cafe", d));
  const hits: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (entry.name.endsWith(".test.ts")) continue;
      const text = readFileSync(full, "utf8");
      if (text.includes(NEEDLE)) {
        hits.push(path.relative(path.join(REPO_ROOT, "apps/cafe"), full).split(path.sep).join("/"));
      }
    }
  }
  for (const root of roots) walk(root);
  hits.sort();

  const expected = ["components/print/PrintHostDrain.tsx", "hooks/use-print-host-wake.ts"].sort();
  assert.deepEqual(hits, expected, `usePrintHostWake( call sites must be exactly these two files; found: ${hits.join(", ")}`);
});

test('PIN: PrintHostDrain.tsx calls usePrintHostWake({ drains, feed }) — the wiring pin that proves reachability, not just that the hook compiles — and "enabled: drains" still occurs exactly twice there (re-asserted here; owned by print-host-paths.test.ts, not touched)', () => {
  const src = readSrc(PRINT_HOST_DRAIN);
  assert.ok(src.includes("usePrintHostWake({ drains, feed });"), "PrintHostDrain.tsx must call usePrintHostWake({ drains, feed });");

  const enabledDrainsCount = src.split("enabled: drains").length - 1;
  assert.equal(enabledDrainsCount, 2, `expected "enabled: drains" exactly twice (both claiming lanes) in PrintHostDrain.tsx, found ${enabledDrainsCount}`);
});

// ── 6. Constants single-homed in print-job.ts ───────────────────────────────

test("PIN: PRINT_WAKE_FAST_MS = 3000, PRINT_WAKE_SLOW_MS = 15000, PRINT_WAKE_ACTIVE_WINDOW_MS = 60 * 60 * 1000, and PRINT_WAKE_DAILY_CAP = 14400 are declared verbatim in packages/shared/src/print-job.ts (single-homed) — AND no OTHER non-test file under apps/cafe/{app,components,hooks,lib} that mentions refetchInterval also contains the literal 3000 or 15000 (scan scope: only files referencing refetchInterval; a file with no polling has no reason to carry either literal at all)", () => {
  const sharedSrc = stripComments(readSrc(PRINT_JOB_SHARED_LIB));
  assert.match(sharedSrc, /export const PRINT_WAKE_FAST_MS = 3000;/, "PRINT_WAKE_FAST_MS must be declared as 3000 in print-job.ts");
  assert.match(sharedSrc, /export const PRINT_WAKE_SLOW_MS = 15000;/, "PRINT_WAKE_SLOW_MS must be declared as 15000 in print-job.ts");
  assert.match(sharedSrc, /export const PRINT_WAKE_ACTIVE_WINDOW_MS = 60 \* 60 \* 1000;/, "PRINT_WAKE_ACTIVE_WINDOW_MS must be declared as 60 * 60 * 1000 in print-job.ts");
  assert.match(sharedSrc, /export const PRINT_WAKE_DAILY_CAP = 14400;/, "PRINT_WAKE_DAILY_CAP must be declared as 14400 in print-job.ts");

  // Runtime values, so the negative scan below is checked against the REAL
  // numbers rather than a re-typed literal that could itself drift.
  assert.equal(PRINT_WAKE_FAST_MS, 3000);
  assert.equal(PRINT_WAKE_SLOW_MS, 15000);

  const dirs = ["app", "components", "hooks", "lib"].map((d) => path.join(REPO_ROOT, "apps/cafe", d));
  const offenders: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (entry.name.endsWith(".test.ts")) continue;
      const rel = path.relative(path.join(REPO_ROOT, "apps/cafe"), full).split(path.sep).join("/");
      // use-print-host-wake.ts itself legitimately references refetchInterval
      // AND imports the two constants BY NAME (never as bare literals) — the
      // scan below checks for the raw numeric literal 3000/15000 sitting next
      // to refetchInterval, which importing-by-name never produces.
      const text = readFileSync(full, "utf8");
      if (!text.includes("refetchInterval")) continue;
      if (/\b3000\b/.test(text) || /\b15000\b/.test(text)) {
        offenders.push(rel);
      }
    }
  }
  for (const dir of dirs) walk(dir);

  assert.ok(
    offenders.length === 0,
    `scan scope apps/cafe/{app,components,hooks,lib}, files mentioning "refetchInterval" only: found the raw literal 3000 or 15000 in ${offenders.join(", ")} — PRINT_WAKE_FAST_MS/PRINT_WAKE_SLOW_MS must stay single-homed in print-job.ts and be imported by name everywhere else`,
  );
});

// ── 7. Sanity: cadence ordering + the daily cap's own meaning ───────────────

test("PIN: PRINT_WAKE_FAST_MS < PRINT_WAKE_SLOW_MS < REFETCH_INTERVALS.POS_PULSE (3s < 15s < 20s) — the wake poll's own SLOW cadence must never fall back to being SLOWER than the pulse it exists to beat; and PRINT_WAKE_DAILY_CAP * PRINT_WAKE_FAST_MS === 12 hours in ms, which is the cap's actual meaning (12h of FAST-cadence hits/day, the free-tier ceiling from the plan's arithmetic)", () => {
  assert.ok(PRINT_WAKE_FAST_MS < PRINT_WAKE_SLOW_MS, "PRINT_WAKE_FAST_MS must be strictly less than PRINT_WAKE_SLOW_MS");
  assert.ok(PRINT_WAKE_SLOW_MS < REFETCH_INTERVALS.POS_PULSE, "PRINT_WAKE_SLOW_MS must be strictly less than REFETCH_INTERVALS.POS_PULSE (20s) — a wake poll slower than the pulse it exists to beat would be pointless");
  assert.equal(PRINT_WAKE_DAILY_CAP * PRINT_WAKE_FAST_MS, 12 * 60 * 60 * 1000, "PRINT_WAKE_DAILY_CAP * PRINT_WAKE_FAST_MS must equal 12 hours in ms — the cap is sized as 12h of FAST-cadence hits per cafe-day");
  // The "active" window (how long a host is considered FAST-eligible after
  // its last feed change) must itself be strictly longer than a single FAST
  // tick, or the window would close before even one extra poll could fire.
  assert.ok(PRINT_WAKE_ACTIVE_WINDOW_MS > PRINT_WAKE_FAST_MS, "PRINT_WAKE_ACTIVE_WINDOW_MS must be strictly greater than PRINT_WAKE_FAST_MS");
  assert.equal(PRINT_WAKE_ACTIVE_WINDOW_MS, 60 * 60 * 1000, "PRINT_WAKE_ACTIVE_WINDOW_MS must be exactly one hour in ms");
});
