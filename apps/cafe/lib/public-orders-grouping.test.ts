import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { cafeDateString } from "@pos/shared/utils";
import type { PublicOrderRequestStatusData } from "@pos/shared/public";
import { stripComments } from "@/lib/source-pin-utils";
import {
  groupOrdersByDate,
  splitLiveOrders,
  type OrderDateGroup,
  type PastOrder,
} from "@/components/public/public-orders-grouping";
import { pickActiveOrders } from "@/components/public/public-home-data";

// S8 — DB-free pins for the pure date-grouping module behind "My Orders".
// Same readSrc/absence+landmark technique as public-bill-rows.test.ts.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const GROUPING_MODULE = "apps/cafe/components/public/public-orders-grouping.ts";
const BILL_VIEW_COMPONENT = "apps/cafe/components/public/PublicOrderBillView.tsx";
const MY_ORDERS_TAB = "apps/cafe/components/public/PublicMyOrdersTab.tsx";

function baseStatusData(overrides: Partial<PublicOrderRequestStatusData> = {}): PublicOrderRequestStatusData {
  return {
    status: "pending",
    shortCode: "ABCDEFGHJK",
    tableLabel: "T-1",
    parcel: false,
    itemCount: 1,
    total: 100,
    createdAt: new Date().toISOString(),
    items: [{ productId: "p1", name: "Filter Coffee", price: 40, qty: 2, modifiers: [] }],
    subtotal: 80,
    charge: 0,
    ...overrides,
  };
}

function order(code: string, overrides: Partial<PublicOrderRequestStatusData> = {}): PastOrder {
  return { code, data: baseStatusData(overrides) };
}

function findGroup(groups: OrderDateGroup[], label: string): OrderDateGroup | undefined {
  return groups.find((g) => g.label === label);
}

// ── 1. Today/Yesterday labelling across an IST day boundary ────────────────

test("groupOrdersByDate: labels Today/Yesterday using cafeDateString's IST flip, not the UTC calendar day", () => {
  // `now` is chosen a few hours after UTC midnight but still the SAME IST day
  // as an order placed just before that UTC midnight — the exact window a
  // naive toLocaleDateString/getDate implementation gets wrong (it would read
  // the two instants as different UTC days when they are the same IST day, or
  // vice versa depending on the local run timezone).
  const now = new Date("2026-09-13T02:00:00.000Z"); // IST 2026-09-13 07:30
  const todayKey = cafeDateString(now);
  const yesterdayKey = cafeDateString(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  assert.notEqual(todayKey, yesterdayKey, "sanity: the two keys must actually differ");

  // An order stamped just before UTC midnight that is nonetheless cafe-local
  // TODAY (IST is UTC+5:30, so 2026-09-12T19:00:00Z is IST 2026-09-13 00:30).
  const todaysOrder = order("TODAYCODE1", { createdAt: "2026-09-12T19:00:00.000Z" });
  assert.equal(cafeDateString(new Date(todaysOrder.data!.createdAt)), todayKey, "sanity: fixture lands in today's IST day");

  // An order stamped on the previous IST calendar day (IST 2026-09-12 15:30).
  const yesterdaysOrder = order("YESTERCODE1", { createdAt: "2026-09-12T10:00:00.000Z" });
  assert.equal(
    cafeDateString(new Date(yesterdaysOrder.data!.createdAt)),
    yesterdayKey,
    "sanity: fixture lands in yesterday's IST day",
  );

  const groups = groupOrdersByDate([todaysOrder, yesterdaysOrder], now);
  const todayGroup = findGroup(groups, "Today");
  const yesterdayGroup = findGroup(groups, "Yesterday");
  assert.ok(todayGroup, "expected a Today group");
  assert.ok(yesterdayGroup, "expected a Yesterday group");
  assert.ok(todayGroup!.orders.some((o) => o.code === "TODAYCODE1"));
  assert.ok(yesterdayGroup!.orders.some((o) => o.code === "YESTERCODE1"));
});

// ── 2. Unresolved rows land in a trailing group, never dropped, never throw ─

test("groupOrdersByDate: unresolved rows (data === null) land in a trailing group, are never dropped and never throw", () => {
  const now = new Date("2026-09-13T06:00:00.000Z");
  const resolved = order("RESOLVEDCD1", { createdAt: now.toISOString() });
  const unresolved: PastOrder = { code: "PENDINGCD1", data: null };

  assert.doesNotThrow(() => groupOrdersByDate([resolved, unresolved], now));
  const result = groupOrdersByDate([resolved, unresolved], now);

  const allCodes = result.flatMap((g) => g.orders.map((o) => o.code));
  assert.ok(allCodes.includes("PENDINGCD1"), "unresolved row must not be dropped");
  const trailing = result[result.length - 1];
  assert.ok(
    trailing.orders.some((o) => o.code === "PENDINGCD1" && o.data === null),
    "unresolved row must land in the trailing group",
  );
});

// ── 3. Groups newest-day-first; orders within a group newest-first ─────────

test("groupOrdersByDate: groups are newest-day-first, and orders within a group are newest-first", () => {
  const now = new Date("2026-09-13T06:00:00.000Z");
  const older = order("OLDCODE001", { createdAt: "2026-09-11T06:00:00.000Z" }); // 2 days back
  const newer = order("NEWCODE001", { createdAt: now.toISOString() }); // today
  const todayEarlier = order("TODAYCODE2", { createdAt: "2026-09-13T02:00:00.000Z" });
  const todayLater = order("TODAYCODE3", { createdAt: "2026-09-13T05:00:00.000Z" });

  const groups = groupOrdersByDate([older, newer, todayEarlier, todayLater], now);

  // Day-level ordering: the group containing NEWCODE001 must come before the
  // group containing OLDCODE001.
  const newerGroupIndex = groups.findIndex((g) => g.orders.some((o) => o.code === "NEWCODE001"));
  const olderGroupIndex = groups.findIndex((g) => g.orders.some((o) => o.code === "OLDCODE001"));
  assert.notEqual(newerGroupIndex, -1, "existence: newer order's group must be found");
  assert.notEqual(olderGroupIndex, -1, "existence: older order's group must be found");
  assert.ok(newerGroupIndex < olderGroupIndex, "today's group must sort before the older day's group");

  // Within-group ordering: todayLater before todayEarlier before newer's own
  // baseline (all three share the same IST day as `now`).
  const todayGroup = groups[newerGroupIndex];
  const laterIdx = todayGroup.orders.findIndex((o) => o.code === "TODAYCODE3");
  const earlierIdx = todayGroup.orders.findIndex((o) => o.code === "TODAYCODE2");
  assert.notEqual(laterIdx, -1, "existence: later order must be in today's group");
  assert.notEqual(earlierIdx, -1, "existence: earlier order must be in today's group");
  assert.ok(laterIdx < earlierIdx, "the later-timestamped order must sort before the earlier one");
});

// ── 4. Empty input returns an empty array ───────────────────────────────────

test("groupOrdersByDate: empty input returns an empty array", () => {
  const groups = groupOrdersByDate([], new Date());
  assert.deepEqual(groups, []);
});

// ── 5. Source pin: uses the shared day helper, never reimplements day math ─

test("PIN: public-orders-grouping.ts imports/uses cafeDateString and never calls toLocaleDateString/getDate/getMonth directly", () => {
  const src = stripComments(readSrc(GROUPING_MODULE));
  // Positive landmark first — a gutted file that dropped the import would
  // otherwise pass every negative assertion below vacuously.
  assert.match(src, /cafeDateString/, "must reference the shared cafeDateString helper");
  assert.ok(!src.includes("toLocaleDateString"), "must not call toLocaleDateString for day math");
  assert.ok(!src.includes(".getDate("), "must not call getDate() to derive a calendar day");
  assert.ok(!src.includes(".getMonth("), "must not call getMonth() to derive a calendar day");
});

// ── 6. Source pin: PublicOrderBillView is read-only ─────────────────────────

test("PIN: PublicOrderBillView.tsx is read-only — no <input, no <Input, no onChange, no fetch( — paired with a positive landmark that it renders PublicBillRows", () => {
  const src = stripComments(readSrc(BILL_VIEW_COMPONENT));
  assert.ok(!src.includes("<input"), "must not render a raw <input>");
  assert.ok(!src.includes("<Input"), "must not render the shadcn <Input> form control");
  assert.ok(!src.includes("onChange"), "must not wire any onChange handler");
  assert.ok(!src.includes("fetch("), "must not fetch — this is a pure receipt view");
  assert.match(src, /<PublicBillRows/, "must actually render PublicBillRows (positive landmark)");
});

// ── 7. Source pin: PublicMyOrdersTab has a BACK affordance + gated repeat ──

test("PIN: PublicMyOrdersTab.tsx has a BACK control that clears openCode, and the repeat button is gated on orderingAllowed", () => {
  const src = stripComments(readSrc(MY_ORDERS_TAB));
  assert.match(src, /setOpenCode\(null\)/, "must have a control that clears openCode back to the list");
  assert.match(src, /ChevronLeft/, "the back control must use the ChevronLeft icon");
  assert.match(src, /orderingAllowed/, "the file must reference the orderingAllowed prop to gate the repeat affordance");
});

// ── 8. splitLiveOrders (CB-6D-B, AMENDED by F6): live keeps INPUT order now
// (pickActiveOrders owns newest-first ordering; the old sort here was DEAD —
// the only caller re-sorts by Date.parse); rest = settled + unresolved/null
// rows in INPUT order; never mutates; [] -> empty.

// RED now: the file still string-sorts live newest-first (opposite of the pin below).
test("PIN (F6): splitLiveOrders keeps live in INPUT order — the newest-first sort is DELETED (pickActiveOrders owns ordering)", () => {
  const older = order("OLDLIVE001", { status: "pending", createdAt: "2026-09-10T06:00:00.000Z" });
  const newer = order("NEWLIVE001", { status: "accepting", createdAt: "2026-09-13T06:00:00.000Z" });

  const { live, rest } = splitLiveOrders([older, newer]);

  assert.deepEqual(
    live.map((o) => o.code),
    ["OLDLIVE001", "NEWLIVE001"],
    "live must keep the INPUT order (older-then-newer here) — splitLiveOrders no longer re-sorts by createdAt",
  );
  assert.deepEqual(rest, [], "both rows are active — rest must be empty");
});

// F6 composed pin: pickActiveOrders(splitLiveOrders(...).live) still lands
// newest-first by PARSED time across mixed-form ISO strings a naive STRING
// compare would order wrong — proves ordering moved downstream, not dropped.
test("PIN (F6): pickActiveOrders(splitLiveOrders(orders).live) is newest-first by PARSED time, for mixed-form ISO timestamps", () => {
  // +05:30 offset form === one minute AFTER the plain-Z fixture, despite sorting earlier as a raw string.
  const zForm = order("ZFORM001", { status: "pending", createdAt: "2026-09-13T06:00:00.000Z" });
  const offsetForm = order("OFFSETFORM001", { status: "accepting", createdAt: "2026-09-13T11:31:00+05:30" });

  const { live } = splitLiveOrders([zForm, offsetForm]);
  const activeOrders = pickActiveOrders(live);

  assert.deepEqual(
    activeOrders.map((a) => a.code),
    ["OFFSETFORM001", "ZFORM001"],
    "pickActiveOrders must sort by PARSED time — the later offset-form timestamp must come first despite sorting earlier as a raw string",
  );
});

test("splitLiveOrders: settled (accepted/rejected) rows and unresolved (data === null) rows land in rest, in INPUT order, never dropped", () => {
  const accepted = order("SETTLED001", { status: "accepted", createdAt: "2026-09-13T06:00:00.000Z" });
  const rejected = order("SETTLED002", { status: "rejected", createdAt: "2026-09-13T05:00:00.000Z" });
  const unresolved: PastOrder = { code: "PENDINGFETCH1", data: null };

  const { live, rest } = splitLiveOrders([accepted, unresolved, rejected]);

  assert.deepEqual(live, [], "no row is pending/accepting — live must be empty");
  assert.deepEqual(
    rest.map((o) => o.code),
    ["SETTLED001", "PENDINGFETCH1", "SETTLED002"],
    "rest must keep the INPUT order (never re-sorted), and must not drop the null-data row",
  );
});

test("splitLiveOrders: a mix never double-counts a row between live and rest", () => {
  const live1 = order("MIXLIVE001", { status: "pending", createdAt: "2026-09-13T06:00:00.000Z" });
  const settled1 = order("MIXSETTLED1", { status: "accepted", createdAt: "2026-09-13T05:00:00.000Z" });
  const unresolved: PastOrder = { code: "MIXNULL1", data: null };
  const live2 = order("MIXLIVE002", { status: "accepting", createdAt: "2026-09-13T07:00:00.000Z" });

  const { live, rest } = splitLiveOrders([live1, settled1, unresolved, live2]);

  const liveCodes = live.map((o) => o.code);
  const restCodes = rest.map((o) => o.code);
  // F6: live keeps INPUT order now (live1 before live2), not the old
  // newest-first string sort — this incidental ordering assertion moves with
  // it so it stays a true post-fix oracle rather than re-pinning the bug.
  assert.deepEqual(liveCodes, ["MIXLIVE001", "MIXLIVE002"], "live must hold exactly the two active rows, in INPUT order");
  assert.deepEqual(restCodes, ["MIXSETTLED1", "MIXNULL1"], "rest must hold exactly the settled + unresolved rows, in input order");
  for (const code of liveCodes) {
    assert.ok(!restCodes.includes(code), `${code} must not appear in both live and rest`);
  }
});

test("splitLiveOrders: never mutates the input array or its rows", () => {
  const input: PastOrder[] = [
    order("IMMUT001", { status: "pending", createdAt: "2026-09-13T06:00:00.000Z" }),
    order("IMMUT002", { status: "accepted", createdAt: "2026-09-13T05:00:00.000Z" }),
  ];
  const inputSnapshot = input.map((o) => o.code);

  splitLiveOrders(input);

  assert.deepEqual(input.map((o) => o.code), inputSnapshot, "input array order must be unchanged after the call");
  assert.equal(input.length, 2, "input array length must be unchanged");
});

test("splitLiveOrders: [] input returns { live: [], rest: [] }", () => {
  const result = splitLiveOrders([]);
  assert.deepEqual(result, { live: [], rest: [] });
});

// ── F8 (review fix, LOW) — partitionPending ─────────────────────────────────
// useMyOrders seeded every row { code, data: null } before any fetch settled,
// with skeleton gate `orders === null` only, so the FIRST frame listed every
// order as an unresolved Link under "More orders". Fix: PastOrder gains
// optional `pending?: true`; this NEW partitionPending() splits settled from
// still-pending rows (input order kept). Not on the tree yet — dynamic
// import scopes the failure to these test()s (mirrors the STATUS_CHIP_META
// walk in public-diner-panel-pins.test.ts), so other pins here still run.

test("PIN (F8): partitionPending splits pending vs settled rows, both kept in INPUT order", async () => {
  const { partitionPending } = await import("@/components/public/public-orders-grouping");
  const settledA = order("PARTSETTLED1", { status: "accepted" });
  const pendingA: PastOrder = { code: "PARTPENDING1", data: null, pending: true };
  const settledB = order("PARTSETTLED2", { status: "rejected" });
  const pendingB: PastOrder = { code: "PARTPENDING2", data: null, pending: true };

  const { settled, pendingCount } = partitionPending([settledA, pendingA, settledB, pendingB]);

  assert.deepEqual(
    settled.map((o: PastOrder) => o.code),
    ["PARTSETTLED1", "PARTSETTLED2"],
    "settled must hold only the non-pending rows, in INPUT order",
  );
  assert.equal(pendingCount, 2, "pendingCount must count exactly the rows flagged pending: true");
});

test("PIN (F8): partitionPending — a resolved row with no pending flag counts as settled, never pending; [] input returns { settled: [], pendingCount: 0 }", async () => {
  const { partitionPending } = await import("@/components/public/public-orders-grouping");
  const resolved = order("PARTRESOLVED1", { status: "accepted" });

  const resolvedResult = partitionPending([resolved]);
  assert.deepEqual(resolvedResult.settled.map((o: PastOrder) => o.code), ["PARTRESOLVED1"]);
  assert.equal(resolvedResult.pendingCount, 0, "a resolved row with no pending flag must not be counted as pending");

  assert.deepEqual(partitionPending([]), { settled: [], pendingCount: 0 });
});
