import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { pickLastOrder } from "../components/public/public-home-data";
import { stripComments } from "./source-pin-utils";

// S7 — pins for the diner Home tab's pure data helper (public-home-data.ts)
// and source-only pins on the component (PublicHomeTab.tsx never fetches,
// never emoji, and gates its reorder card on orderingAllowed).

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const HOME_TAB_SRC = "apps/cafe/components/public/PublicHomeTab.tsx";
const HOME_DATA_SRC = "apps/cafe/components/public/public-home-data.ts";

// ── pickLastOrder ────────────────────────────────────────────────────────────

test("pickLastOrder picks the NEWEST createdAt, not the first array element", () => {
  const orders = [
    { code: "OLD1", data: { itemCount: 1, total: 100, createdAt: "2026-01-01T00:00:00.000Z", status: "accepted" as const } },
    { code: "NEW1", data: { itemCount: 2, total: 200, createdAt: "2026-06-15T00:00:00.000Z", status: "accepted" as const } },
    { code: "MID1", data: { itemCount: 3, total: 300, createdAt: "2026-03-01T00:00:00.000Z", status: "accepted" as const } },
  ];
  const result = pickLastOrder(orders);
  assert.ok(result !== null, "expected a resolved row");
  assert.equal(result.code, "NEW1", "must pick the newest createdAt, not the first row");
});

test("pickLastOrder ignores unresolved (null data) rows, and returns null when ALL are unresolved", () => {
  const mixed = [
    { code: "PENDING1", data: null },
    { code: "RESOLVED1", data: { itemCount: 1, total: 50, createdAt: "2026-05-01T00:00:00.000Z", status: "accepted" as const } },
    { code: "PENDING2", data: null },
  ];
  const result = pickLastOrder(mixed);
  assert.ok(result !== null);
  assert.equal(result.code, "RESOLVED1", "must skip unresolved rows and pick the only resolved one");

  const allUnresolved = [
    { code: "PENDING1", data: null },
    { code: "PENDING2", data: null },
  ];
  assert.equal(pickLastOrder(allUnresolved), null, "all-unresolved input must return null");
});

test("pickLastOrder returns null for an empty array and does not throw on a malformed createdAt", () => {
  assert.equal(pickLastOrder([]), null, "empty array must return null, not throw");

  assert.doesNotThrow(() => {
    const result = pickLastOrder([
      { code: "BAD1", data: { itemCount: 1, total: 10, createdAt: "not-a-date", status: "accepted" as const } },
      { code: "GOOD1", data: { itemCount: 2, total: 20, createdAt: "2026-04-01T00:00:00.000Z", status: "accepted" as const } },
    ]);
    assert.ok(result !== null);
    assert.equal(result.code, "GOOD1", "a malformed createdAt must lose to a parseable one, never throw or win");
  });

  assert.doesNotThrow(() => {
    // ALL malformed: must still return without throwing (no valid time to
    // compare against, but no crash either).
    const result = pickLastOrder([{ code: "BAD1", data: { itemCount: 1, total: 10, createdAt: "garbage", status: "accepted" as const } }]);
    assert.ok(result !== null, "a single row, even with a malformed date, is still the only candidate");
    assert.equal(result.code, "BAD1");
  });
});

// ── SOURCE PIN: reorder affordance gated on orderingAllowed ─────────────────

test("PIN: PublicHomeTab.tsx gates the reorder affordance on orderingAllowed", () => {
  const raw = readSrc(HOME_TAB_SRC);
  const src = stripComments(raw);

  // Vision guard: the positive landmark this pin's negative would otherwise
  // pass vacuously against — a gutted file with no onRepeatLast reference
  // would make "orderingAllowed guards it" meaningless.
  assert.match(src, /onRepeatLast/, "expected the component to reference onRepeatLast");
  assert.match(
    src,
    /orderingAllowed\s*&&\s*lastOrder/,
    "expected the reorder card to be gated on `orderingAllowed && lastOrder`",
  );
});

// ── SOURCE PIN: no fetch — Home renders from props only ─────────────────────

test("PIN: neither public-home-data.ts nor PublicHomeTab.tsx calls fetch(); Home renders from props only", () => {
  const dataSrc = stripComments(readSrc(HOME_DATA_SRC));
  const tabSrc = stripComments(readSrc(HOME_TAB_SRC));

  // Positive landmark: the component does reference stampCard (proves this
  // is the real file, not an accidentally emptied one).
  assert.match(tabSrc, /stampCard/, "expected the component to reference stampCard");

  assert.ok(!dataSrc.includes("fetch("), "public-home-data.ts must not call fetch(— pure data only");
  assert.ok(!tabSrc.includes("fetch("), "PublicHomeTab.tsx must not call fetch(— it receives data as props");
});

// ── SOURCE PIN: lucide icons only, never emoji ───────────────────────────────

// Astral-range emoji plus the common BMP pictograph/symbol blocks — matches
// what other *-paths.test.ts emoji gates in this repo scan for.
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

test("PIN: PublicHomeTab.tsx uses lucide-react icons and contains no emoji", () => {
  const raw = readSrc(HOME_TAB_SRC);
  const src = stripComments(raw);

  // Positive landmark: it does import from lucide-react.
  assert.match(src, /from\s+"lucide-react"/, "expected an import from lucide-react");
  assert.ok(!EMOJI_PATTERN.test(src), "component source must contain no emoji — lucide icons only");
});
