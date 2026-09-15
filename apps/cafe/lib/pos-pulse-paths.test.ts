// CB-1d.3b C1 — PosPage's render path holds no pulse subscription.
//
// C1's bug: two hooks in PosPage's OWN render body (useSelfOrderAutoPrint,
// useHostRouting via usePosPrint) each subscribed to the pulse context
// without ever displaying pulse data, so every payload-changing tick
// re-rendered the whole screen (~187 renders measured). The fix moved
// useSelfOrderAutoPrint into a null-rendering child (SelfOrderAutoPrint) and
// narrowed useHostRouting's read to a derived lane STRING served by its own
// context (PrintHostRoutingContext) — a consumer of that context re-renders
// only when the string itself changes. This file pins both halves of the
// split plus the inventory of who is still allowed to touch the wide pulse
// context directly.
//
// Same readSrc/stripComments idiom as lib/pos-tile-paths.test.ts; raw source
// preferred for absence checks, every negative pin paired with a positive
// landmark from the same file (testing.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const POS_PAGE = "apps/cafe/app/(dashboard)/pos/page.tsx";
const SELF_ORDER_AUTO_PRINT = "apps/cafe/components/pos/SelfOrderAutoPrint.tsx";
const USE_HOST_ROUTING = "apps/cafe/hooks/use-host-routing.ts";
const USE_PRINT_ROUTING = "apps/cafe/hooks/use-print-routing.ts";
const POS_PULSE_PROVIDER = "apps/cafe/components/layout/PosPulseProvider.tsx";

test("PIN: pos/page.tsx's render path carries no pulse subscription — no usePosPulseContext, no direct useSelfOrderAutoPrint(/useHostRouting( calls, no use-self-order-auto-print import — paired with the positive landmarks <SelfOrderAutoPrint and usePosTab( (line count is pinned elsewhere, not duplicated here)", () => {
  // RAW source (not stripped) — the negative checks below must see comments
  // too, so a banned call hiding in a comment cannot slip past a blinded scan.
  const src = readSrc(POS_PAGE);

  assert.ok(!src.includes("usePosPulseContext"), "pos/page.tsx must never reference usePosPulseContext — that subscription must not sit in PosPage's own render path (C1)");
  assert.ok(!src.includes("useSelfOrderAutoPrint("), "pos/page.tsx must never call useSelfOrderAutoPrint( directly — it now renders <SelfOrderAutoPrint instead");
  assert.ok(!src.includes("useHostRouting("), "pos/page.tsx must never call useHostRouting( directly — the pulse-lane read stays inside usePosTab -> usePosPrint -> usePrintRouting");
  assert.ok(!src.includes("use-self-order-auto-print"), "pos/page.tsx must not import from use-self-order-auto-print — that hook now lives inside the SelfOrderAutoPrint child");

  // positive landmarks — proves the scan above isn't vacuously passing against
  // a blinded/empty read, and that the intended replacements are present.
  assert.match(src, /<SelfOrderAutoPrint\b/, "positive landmark: pos/page.tsx must render <SelfOrderAutoPrint");
  assert.match(src, /usePosTab\(/, "positive landmark: pos/page.tsx must still call usePosTab(");
});

test("PIN: components/pos/SelfOrderAutoPrint.tsx is a named function inside memo(), renders null, and calls useSelfOrderAutoPrint({ enabled: true, busy, queueKotRound }) — imports memo from react", () => {
  const src = readSrc(SELF_ORDER_AUTO_PRINT);
  assert.match(
    src,
    /export const SelfOrderAutoPrint = memo\(function SelfOrderAutoPrint\(/,
    "SelfOrderAutoPrint.tsx must declare export const SelfOrderAutoPrint = memo(function SelfOrderAutoPrint( — named wrapper, so the profiler row keeps the name",
  );
  assert.match(src, /return null;/, "SelfOrderAutoPrint.tsx must return null; — it is a subscription-only, non-rendering child");
  assert.match(
    src,
    /useSelfOrderAutoPrint\(\{ enabled: true, busy, queueKotRound \}\)/,
    "SelfOrderAutoPrint.tsx must call useSelfOrderAutoPrint({ enabled: true, busy, queueKotRound })",
  );
  assert.match(src, /import\s*\{\s*memo\s*\}\s*from\s*"react"/, 'SelfOrderAutoPrint.tsx must import memo from "react"');
});

test("PIN: hooks/use-host-routing.ts reads the derived lane only — no usePosPulseContext, no useQuery(, no refetchInterval, no hostRoutingOf( (the derivation lives in PosPulseProvider.tsx now) — paired with the positive landmarks const routing = usePrintHostRouting(); and shouldRoutePrint(routing, printHostSeen)", () => {
  const src = readSrc(USE_HOST_ROUTING);

  assert.ok(!src.includes("usePosPulseContext"), "use-host-routing.ts must never reference usePosPulseContext — it must read the derived lane via usePrintHostRouting( only (CB-1d.3b C1)");
  assert.ok(!src.includes("useQuery("), "use-host-routing.ts must never call useQuery( — it is not its own TanStack observer; usePosPulse stays the single poller");
  assert.ok(!src.includes("refetchInterval"), "use-host-routing.ts must never reference refetchInterval — polling stays solely inside use-pos-pulse.ts");
  assert.ok(!src.includes("hostRoutingOf("), "use-host-routing.ts must never call hostRoutingOf( — the lane derivation lives in PosPulseProvider.tsx only, this hook just reads the already-derived string");

  // positive landmarks — proves the negative scan above isn't vacuous.
  assert.match(src, /const routing = usePrintHostRouting\(\);/, "positive landmark: use-host-routing.ts must read const routing = usePrintHostRouting();");
  assert.match(src, /shouldRoutePrint\(routing, printHostSeen\)/, "positive landmark: use-host-routing.ts must call shouldRoutePrint(routing, printHostSeen)");
});

test("PIN: PosPulseProvider.tsx declares PrintHostRoutingContext<PrintHostRouting|null>, derives hostRoutingOf( exactly once, provides it via <PrintHostRoutingContext.Provider value={routing}>, keeps the inner pulse value literal unchanged, and contains NO useMemo anywhere in the RAW file (measured inert in CB-1d.3 — the context narrowing is the fix) — paired with the positive landmark usePosPulse()", () => {
  // RAW source: the useMemo absence check must see comments too (testing.md —
  // a banned literal must never appear anywhere in a scanned file, including
  // a comment describing why it was removed).
  const src = readSrc(POS_PULSE_PROVIDER);

  assert.match(
    src,
    /createContext<PrintHostRouting \| null>\(null\)/,
    "PosPulseProvider.tsx must declare createContext<PrintHostRouting | null>(null) for the derived print-lane context",
  );
  const hostRoutingOfCalls = countOccurrences(src, "hostRoutingOf(");
  assert.equal(hostRoutingOfCalls, 1, `expected hostRoutingOf( exactly once in PosPulseProvider.tsx, found ${hostRoutingOfCalls}`);
  assert.match(
    src,
    /<PrintHostRoutingContext\.Provider value=\{routing\}>/,
    "PosPulseProvider.tsx must provide the derived lane through <PrintHostRoutingContext.Provider value={routing}>",
  );
  assert.match(
    src,
    /value=\{\{ pulse: data, soundUnlocked, unlock, printHandler, registerKotPrintHandler \}\}/,
    "the inner PosPulseContext.Provider's value literal must stay EXACTLY { pulse: data, soundUnlocked, unlock, printHandler, registerKotPrintHandler }",
  );

  // negative: a useMemo wrapping the provided value was measured INERT in
  // CB-1d.3 (the object identity still changed every render because `data`
  // itself is a fresh TanStack object each tick) — the context narrowing done
  // here is the actual fix, so a useMemo must never come back as a false
  // "optimization".
  assert.ok(!src.includes("useMemo"), "PosPulseProvider.tsx must contain NO useMemo anywhere — measured inert in CB-1d.3; the PrintHostRoutingContext narrowing is the real fix, not a memoized value");

  // positive landmark, so the useMemo absence check above isn't reading a
  // blinded/empty file.
  assert.match(src, /usePosPulse\(\)/, "positive landmark: PosPulseProvider.tsx must still call usePosPulse()");
});

test("INVENTORY: usePosPulseContext( call sites are exactly the six deliberate consumers — a new one under the POS screen must be a deliberate decision, not an accident", () => {
  const NEEDLE = "usePosPulseContext" + "(";
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

  const expected = [
    "components/layout/PosPulseProvider.tsx",
    "components/orders/DeviceAlertSettings.tsx",
    "components/orders/RequestAlertBar.tsx",
    "components/orders/RequestCountBadge.tsx",
    // PH-7 (2026-09-06), re-pointed PH-10b: the print-host card on
    // /settings/printing (PH-10b) — never under the POS screen — needs the
    // host's label/offline/silentMode, which live only on pulse.printHost
    // (the derived lane string cannot carry them). A deliberate sixth
    // consumer; the inventory below stays SIX files (D7).
    "components/print/PrintHostCard.tsx",
    "hooks/use-self-order-auto-print.ts",
  ].sort();

  assert.deepEqual(hits, expected, `usePosPulseContext( call sites must be exactly the six deliberate consumers; found: ${hits.join(", ")}`);
});

test("PIN: use-host-routing.ts, use-print-routing.ts, and PosPulseProvider.tsx each stay <= 300 lines (the split's own reason for existing)", () => {
  for (const file of [USE_HOST_ROUTING, USE_PRINT_ROUTING, POS_PULSE_PROVIDER]) {
    const src = readSrc(file);
    const lineCount = src.replace(/\n$/, "").split("\n").length;
    assert.ok(lineCount <= 300, `${file} must stay <= 300 lines, got ${lineCount}`);
  }
});
