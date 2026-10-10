import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Types } from "mongoose";

import { stripComments } from "@/lib/source-pin-utils";
import {
  OPEN_TAB_FILTER,
  KITCHEN_ORDER_SELECT,
  TOKEN_BOARD_SELECT,
  TOKEN_DAY_SCAN_LIMIT,
  TOKEN_KITCHEN_LIMIT,
  TOKEN_BOARD_LIMIT,
  TOKENS_OFF,
  paidTokenFilter,
  kitchenOrderFilter,
  tokenOrderFilter,
  kitchenSelectOf,
  tokenModeOf,
  filterModeOf,
  readyStampMs,
  readyUpdateOf,
  collectedUpdateOf,
  tokenStatusOf,
  isStalePaidToken,
  TOKEN_STALE_MINUTES,
  buildTokenBoard,
  pendingTokenIds,
  mergeKitchenArms,
  type TokenOrderInput,
  type TokenTickInput,
} from "./token-board";
import { applyTokenAction, tokenLabelOf, TOKEN_ACTIONS, type TokenBoard, type TokenBoardEntry } from "./token-view";
import { KITCHEN_CARD_LIMIT } from "./kitchen-cards";
import { slipDayStart, TOKEN_READY_CLEAR_MINUTES_DEFAULT } from "@pos/shared/slip-day";
import { PRINT_BUDGET_BUSY_DAY } from "@pos/shared/print-budget";

// Print customization S8 (phase 1) — the token board's pure core: the derived token status, the kitchen gate's
// filters, the KotTick update builders, the board builder and the optimistic client view. Everything here is DB-free
// and clock-free (every instant is a fixture), so each case is a plain value check.

const MIN = 60_000;
const T0 = Date.parse("2026-10-06T10:00:00.000Z");
const NOW = T0 + 15 * MIN; // 10:15 — the fixtures below are placed relative to it
const CLEAR = 10; // the default clear time, in minutes
const at = (ms: number): Date => new Date(ms);

function hex(n: number): string {
  return n.toString(16).padStart(24, "0");
}

function order(n: number, over: Partial<TokenOrderInput> = {}): TokenOrderInput {
  return { _id: hex(n), createdAt: at(T0), tokenNumber: n, ...over };
}

// A one-round order created at T0 (newest fire = T0). The ticks below are placed against it.
const BASE = order(1);

// ── tokenStatusOf: the truth table ───────────────────────────────────────────────────────────────────────────────────

test("tokenStatusOf: no tick, an empty tick, and a tick without readyAt are all preparing", () => {
  assert.equal(tokenStatusOf(BASE, undefined, NOW, CLEAR), "preparing");
  assert.equal(tokenStatusOf(BASE, {}, NOW, CLEAR), "preparing");
  assert.equal(tokenStatusOf(BASE, { collectedAt: at(NOW) }, NOW, CLEAR), "preparing", "a Collected stamp on a Preparing token is inert");
  // vision guard: the very same tick WITH a covering readyAt is ready, so "preparing" above is the missing Ready, not a broken helper.
  assert.equal(tokenStatusOf(BASE, { readyAt: at(T0), readyMarkedAt: at(NOW - MIN) }, NOW, CLEAR), "ready");
});

test("tokenStatusOf: a Ready that does not cover the newest round is preparing (readyAt older than the order, and the lost-ticket case of a later kotFiredAt)", () => {
  assert.equal(tokenStatusOf(BASE, { readyAt: at(T0 - 1), readyMarkedAt: at(NOW - MIN) }, NOW, CLEAR), "preparing", "readyAt one ms before createdAt");
  // THE lost-ticket case: round 1 at T0, Ready stamped at T0+1m, then a second round fired at T0+2m.
  const held = order(2, { kotFiredAt: [at(T0), at(T0 + 2 * MIN)] });
  const tick = { readyAt: at(T0 + MIN), readyMarkedAt: at(NOW - MIN) };
  assert.equal(tokenStatusOf(held, tick, NOW, CLEAR), "preparing", "a later round brings the token back to Preparing");
  assert.equal(tokenStatusOf(held, { ...tick, collectedAt: at(NOW) }, NOW, CLEAR), "preparing", "and a Collected stamp does not bury it");
  // vision guard: without the later round, the identical tick is ready — the round is the only difference.
  assert.equal(tokenStatusOf(order(2, { kotFiredAt: [at(T0)] }), tick, NOW, CLEAR), "ready");
  // the tie: a Ready stamped in the same millisecond as the newest round covers it (isHiddenByReady is >=)
  assert.equal(tokenStatusOf(held, { readyAt: at(T0 + 2 * MIN), readyMarkedAt: at(NOW - MIN) }, NOW, CLEAR), "ready");
  assert.equal(tokenStatusOf(held, { readyAt: at(T0 + 2 * MIN - 1), readyMarkedAt: at(NOW - MIN) }, NOW, CLEAR), "preparing");
});

test("tokenStatusOf: the clear window runs from readyMarkedAt, NOT readyAt (K2: readyAt 15 min old, marked 1 min ago => ready)", () => {
  const tick = { readyAt: at(T0), readyMarkedAt: at(NOW - MIN) };
  assert.equal(NOW - T0, 15 * MIN, "landmark: readyAt really is 15 minutes old");
  assert.equal(tokenStatusOf(BASE, tick, NOW, CLEAR), "ready");
  // vision guard: take the mark away and the readyAt fallback (15 min old, past the 10 min clear) hides it — so the mark is what kept it.
  assert.equal(tokenStatusOf(BASE, { readyAt: at(T0) }, NOW, CLEAR), "hidden");
});

test("tokenStatusOf: Collected at or after the Ready mark hides it, including the exact tie; before the mark it stays ready", () => {
  const marked = NOW - 3 * MIN;
  const ready = { readyAt: at(T0), readyMarkedAt: at(marked) };
  assert.equal(tokenStatusOf(BASE, { ...ready, collectedAt: at(marked) }, NOW, CLEAR), "hidden", "tie: Collected wins");
  assert.equal(tokenStatusOf(BASE, { ...ready, collectedAt: at(marked + 1) }, NOW, CLEAR), "hidden", "one ms after the mark");
  assert.equal(tokenStatusOf(BASE, { ...ready, collectedAt: at(marked - 1) }, NOW, CLEAR), "ready", "one ms before the mark: the Ready is the later tap");
  assert.equal(tokenStatusOf(BASE, ready, NOW, CLEAR), "ready", "landmark: no collectedAt at all is ready");
});

test("tokenStatusOf: Collected, then marked Ready again later, is ready; the compare is against readyMarkedAt, not the older readyAt", () => {
  // collected at 10:06, re-marked at 10:12 (readyAt still 10:00, the round it covers)
  const reMarked = { readyAt: at(T0), readyMarkedAt: at(T0 + 12 * MIN), collectedAt: at(T0 + 6 * MIN) };
  assert.equal(tokenStatusOf(BASE, reMarked, NOW, CLEAR), "ready");
  // vision guard: the same Collected stamp AFTER the re-mark hides it.
  assert.equal(tokenStatusOf(BASE, { ...reMarked, collectedAt: at(T0 + 13 * MIN) }, NOW, CLEAR), "hidden");
});

test("tokenStatusOf: the clear boundary — exactly clearMinutes after the mark is hidden, one ms short is ready", () => {
  const readyAt = at(T0);
  assert.equal(tokenStatusOf(BASE, { readyAt, readyMarkedAt: at(NOW - CLEAR * MIN) }, NOW, CLEAR), "hidden", "exactly at the boundary");
  assert.equal(tokenStatusOf(BASE, { readyAt, readyMarkedAt: at(NOW - CLEAR * MIN + 1) }, NOW, CLEAR), "ready", "1 ms before it");
  assert.equal(tokenStatusOf(BASE, { readyAt, readyMarkedAt: at(NOW - CLEAR * MIN - 1) }, NOW, CLEAR), "hidden", "1 ms after it");
  // the window is the argument, not a constant: 11 minutes old is ready under a 20 minute clear and hidden under 10.
  const eleven = { readyAt, readyMarkedAt: at(NOW - 11 * MIN) };
  assert.equal(tokenStatusOf(BASE, eleven, NOW, 20), "ready");
  assert.equal(tokenStatusOf(BASE, eleven, NOW, 10), "hidden");
  assert.equal(tokenStatusOf(BASE, eleven, NOW, 11), "hidden", "11 minutes old, 11 minute clear: the boundary again");
  assert.equal(tokenStatusOf(BASE, eleven, NOW, 12), "ready");
});

test("tokenStatusOf: a legacy tick (readyAt only, no readyMarkedAt) falls back to readyAt for the mark", () => {
  assert.equal(tokenStatusOf(BASE, { readyAt: at(NOW - MIN) }, NOW, CLEAR), "ready");
  assert.equal(tokenStatusOf(BASE, { readyAt: at(NOW - CLEAR * MIN) }, NOW, CLEAR), "hidden", "legacy boundary: hidden");
  assert.equal(tokenStatusOf(BASE, { readyAt: at(NOW - CLEAR * MIN + 1) }, NOW, CLEAR), "ready");
  // and a Collected stamp compares against that fallback too
  assert.equal(tokenStatusOf(BASE, { readyAt: at(NOW - 2 * MIN), collectedAt: at(NOW - MIN) }, NOW, CLEAR), "hidden");
  assert.equal(tokenStatusOf(BASE, { readyAt: at(NOW - 2 * MIN), collectedAt: at(NOW - 3 * MIN) }, NOW, CLEAR), "ready");
});

test("tokenStatusOf: an unparseable readyMarkedAt falls back to readyAt; an unparseable collectedAt never hides", () => {
  assert.equal(tokenStatusOf(BASE, { readyAt: at(NOW - MIN), readyMarkedAt: "not a date" }, NOW, CLEAR), "ready");
  assert.equal(tokenStatusOf(BASE, { readyAt: at(NOW - 11 * MIN), readyMarkedAt: "not a date" }, NOW, CLEAR), "hidden", "the fallback readyAt is what ages it out");
  assert.equal(tokenStatusOf(BASE, { readyAt: at(NOW - MIN), readyMarkedAt: new Date(Number.NaN) }, NOW, CLEAR), "ready", "an Invalid Date too");
  const fresh = { readyAt: at(T0), readyMarkedAt: at(NOW - MIN) };
  assert.equal(tokenStatusOf(BASE, { ...fresh, collectedAt: "garbage" }, NOW, CLEAR), "ready");
  assert.equal(tokenStatusOf(BASE, { ...fresh, collectedAt: new Date(Number.NaN) }, NOW, CLEAR), "ready");
  // vision guard: a parseable collectedAt on the same tick does hide it.
  assert.equal(tokenStatusOf(BASE, { ...fresh, collectedAt: at(NOW) }, NOW, CLEAR), "hidden");
  // an unparseable readyAt never covers a round: preparing, not a crash
  assert.equal(tokenStatusOf(BASE, { readyAt: "garbage" }, NOW, CLEAR), "preparing");
});

test("tokenStatusOf: ISO-string stamps (the wire shape) read like Dates", () => {
  const tick: TokenTickInput = { readyAt: at(T0).toISOString(), readyMarkedAt: at(NOW - MIN).toISOString() };
  assert.equal(tokenStatusOf(BASE, tick, NOW, CLEAR), "ready");
  assert.equal(tokenStatusOf(BASE, { ...tick, collectedAt: at(NOW).toISOString() }, NOW, CLEAR), "hidden");
});

// ── The kitchen gate's filters ───────────────────────────────────────────────────────────────────────────────────────

const DAY_START = new Date("2026-10-05T18:30:00.000Z"); // IST midnight of 6 Oct

test("kitchenOrderFilter(TOKENS_OFF) is exactly today's open-tab filter: deepStrictEqual AND byte-for-byte JSON key order", () => {
  const off = kitchenOrderFilter(TOKENS_OFF);
  assert.deepStrictEqual(off, { status: "Pending", payment: "Unpaid" });
  assert.equal(JSON.stringify(off), '{"status":"Pending","payment":"Unpaid"}');
  assert.deepStrictEqual(Object.keys(off), ["status", "payment"], "no third key, this order");
  assert.deepStrictEqual(kitchenOrderFilter({ tokenMode: false }), { status: "Pending", payment: "Unpaid" }, "a literal off mode, not just the constant");
  // landmark: the constant it copies is the same two keys, so the equality above is not vacuous
  assert.equal(JSON.stringify(OPEN_TAB_FILTER), '{"status":"Pending","payment":"Unpaid"}');
  assert.deepStrictEqual(TOKENS_OFF, { tokenMode: false });
});

test("kitchenOrderFilter(off) is a FRESH object each call: mutating one result changes neither the next call nor OPEN_TAB_FILTER", () => {
  const first = kitchenOrderFilter(TOKENS_OFF) as Record<string, unknown>;
  assert.notEqual(first, OPEN_TAB_FILTER as unknown, "not the shared constant itself");
  first.status = "Completed";
  first.kotRounds = { $gte: 1 };
  delete first.payment;
  assert.equal(JSON.stringify(kitchenOrderFilter(TOKENS_OFF)), '{"status":"Pending","payment":"Unpaid"}');
  assert.equal(JSON.stringify(OPEN_TAB_FILTER), '{"status":"Pending","payment":"Unpaid"}');
  assert.notEqual(kitchenOrderFilter(TOKENS_OFF), kitchenOrderFilter(TOKENS_OFF), "two calls, two objects");
});

test("paidTokenFilter: a token number, status Completed, created inside the business day", () => {
  assert.deepStrictEqual(paidTokenFilter(DAY_START), {
    tokenNumber: { $exists: true },
    status: "Completed",
    createdAt: { $gte: DAY_START },
  });
  assert.equal(paidTokenFilter(DAY_START).createdAt.$gte, DAY_START, "the very day start it was given");
});

test("kitchenOrderFilter(on): $or of the open-tab filter and the paid-token filter, and nothing else", () => {
  const on = kitchenOrderFilter({ tokenMode: true, dayStart: DAY_START });
  assert.deepStrictEqual(on, {
    $or: [{ status: "Pending", payment: "Unpaid" }, paidTokenFilter(DAY_START)],
  });
  assert.deepStrictEqual(Object.keys(on), ["$or"]);
  assert.equal(on.$or.length, 2);
  // the open-tab arm is a copy, so a mutation of it cannot reach the shared constant
  (on.$or[0] as Record<string, unknown>).status = "Cancelled";
  assert.equal(OPEN_TAB_FILTER.status, "Pending");
  // vision guard: the ON shape differs from the OFF shape (an ON that silently returned the OFF filter would fail here)
  assert.notDeepEqual(on, kitchenOrderFilter(TOKENS_OFF));
});

test("tokenOrderFilter: the kitchen gate (on) plus a token-number and day-window condition at the top level", () => {
  const f = tokenOrderFilter(DAY_START);
  assert.deepStrictEqual(f, {
    $or: [{ status: "Pending", payment: "Unpaid" }, paidTokenFilter(DAY_START)],
    tokenNumber: { $exists: true },
    createdAt: { $gte: DAY_START },
  });
  assert.deepStrictEqual(Object.keys(f).sort(), ["$or", "createdAt", "tokenNumber"]);
});

// ── Selects and limits ───────────────────────────────────────────────────────────────────────────────────────────────

test("kitchenSelectOf: off is KITCHEN_ORDER_SELECT is the literal (parcel included); on adds ' tokenNumber'", () => {
  const LITERAL = "orderId items kotRounds kotNumbers kotFiredAt tableNo parcel notes source createdAt";
  assert.equal(kitchenSelectOf(TOKENS_OFF), KITCHEN_ORDER_SELECT);
  assert.equal(kitchenSelectOf(TOKENS_OFF), LITERAL);
  assert.equal(KITCHEN_ORDER_SELECT, LITERAL);
  assert.ok(KITCHEN_ORDER_SELECT.split(" ").includes("parcel"), "landmark: the PARCEL fix is in the select");
  assert.equal(kitchenSelectOf({ tokenMode: true, dayStart: DAY_START }), LITERAL + " tokenNumber");
  assert.equal(kitchenSelectOf({ tokenMode: false }), LITERAL);
});

test("TOKEN_BOARD_SELECT is exactly the four top-level fields plus the two kitchen-round sub-paths — never a name, an amount, a dish or a receiver", () => {
  const fields = TOKEN_BOARD_SELECT.split(/\s+/);
  assert.deepStrictEqual(fields, ["tokenNumber", "kotFiredAt", "createdAt", "status", "items.kotRound", "items.noKot"], "positive landmark: numbers, times, the status for the stale rule, and the per-line round + kitchen flag");
  for (const banned of ["customerName", "total", "items", "paidAmount", "receiver", "notes", "tableNo", "items.name", "items.price"]) {
    assert.ok(!fields.includes(banned), `the token board must not select ${banned}`);
  }
  assert.ok(!TOKEN_BOARD_SELECT.startsWith("-"), "an inclusive projection, not an exclusion list");
  assert.ok(!fields.includes("paymentMode") && !fields.includes("payment"), "no payment field either: status is the only extra");
});

test("limits: scan = twice a busy day's orders, kitchen arm = the card cap, board = 50 per list", () => {
  assert.equal(PRINT_BUDGET_BUSY_DAY.orders, 300, "landmark: the budget the scan bound derives from");
  assert.equal(TOKEN_DAY_SCAN_LIMIT, 2 * PRINT_BUDGET_BUSY_DAY.orders);
  assert.equal(TOKEN_DAY_SCAN_LIMIT, 600);
  assert.equal(TOKEN_KITCHEN_LIMIT, KITCHEN_CARD_LIMIT);
  assert.equal(TOKEN_KITCHEN_LIMIT, 60);
  assert.equal(TOKEN_BOARD_LIMIT, 50);
});

// ── tokenModeOf / filterModeOf ───────────────────────────────────────────────────────────────────────────────────────

type ModeSettings = Parameters<typeof tokenModeOf>[0];
const settingsOf = (over: Record<string, unknown>): ModeSettings => over as ModeSettings;

test("tokenModeOf: tokens off or absent => enabled false, whatever else is set", () => {
  assert.equal(tokenModeOf(undefined, new Date(NOW)).enabled, false);
  assert.equal(tokenModeOf(null, new Date(NOW)).enabled, false);
  assert.equal(tokenModeOf(settingsOf({}), new Date(NOW)).enabled, false);
  assert.equal(tokenModeOf(settingsOf({ tokenEnabled: false, tokenReadyClearMinutes: 30 }), new Date(NOW)).enabled, false);
  assert.equal(tokenModeOf(settingsOf({ tokenEnabled: true }), new Date(NOW)).enabled, true, "vision guard: on is on");
});

test("tokenModeOf: dayStart is slipDayStart(now, numberResetMinutes) — midnight by default, shifted by the restart time", () => {
  const now = new Date("2026-10-06T21:00:00.000Z"); // 02:30 IST on the 7th
  const midnight = tokenModeOf(settingsOf({ tokenEnabled: true }), now).dayStart;
  assert.equal(midnight.toISOString(), "2026-10-06T18:30:00.000Z", "IST midnight of the 7th");
  assert.equal(midnight.getTime(), slipDayStart(now, 0).getTime());
  const shifted = tokenModeOf(settingsOf({ tokenEnabled: true, numberResetMinutes: 240 }), now).dayStart;
  assert.equal(shifted.toISOString(), "2026-10-05T22:30:00.000Z", "04:00 IST on the 6th: still the previous business day at 02:30");
  assert.equal(shifted.getTime(), slipDayStart(now, 240).getTime());
  assert.ok(shifted.getTime() < midnight.getTime(), "the restart time moved the window");
  assert.ok(shifted.getTime() > 0, "never the epoch");
  assert.ok(shifted.getTime() <= now.getTime() && now.getTime() < shifted.getTime() + 24 * 60 * MIN, "now sits inside the window");
});

test("tokenModeOf: clearMinutes is 10 by default, a valid stored value is kept, an invalid one reads as 10", () => {
  const clearOf = (v: unknown) => tokenModeOf(settingsOf({ tokenEnabled: true, tokenReadyClearMinutes: v }), new Date(NOW)).clearMinutes;
  assert.equal(tokenModeOf(settingsOf({ tokenEnabled: true }), new Date(NOW)).clearMinutes, 10);
  assert.equal(TOKEN_READY_CLEAR_MINUTES_DEFAULT, 10, "landmark: 10 is the shared default");
  for (const ok of [1, 2, 25, 60, 120]) assert.equal(clearOf(ok), ok, String(ok));
  for (const bad of [0, -5, 121, 1.5, "20", null, Number.NaN]) assert.equal(clearOf(bad), 10, String(bad));
});

test("filterModeOf: enabled => token mode carrying the very dayStart; disabled => TOKENS_OFF", () => {
  const dayStart = new Date(DAY_START);
  const on = filterModeOf({ enabled: true, dayStart, clearMinutes: 10 });
  assert.deepStrictEqual(on, { tokenMode: true, dayStart });
  assert.ok(on.tokenMode && on.dayStart === dayStart);
  const off = filterModeOf({ enabled: false, dayStart, clearMinutes: 10 });
  assert.deepStrictEqual(off, { tokenMode: false });
  // end to end: an off settings document yields exactly today's filter and select
  const mode = filterModeOf(tokenModeOf(settingsOf({ tokenReadyClearMinutes: 30 }), new Date(NOW)));
  assert.equal(JSON.stringify(kitchenOrderFilter(mode)), '{"status":"Pending","payment":"Unpaid"}');
  assert.equal(kitchenSelectOf(mode), KITCHEN_ORDER_SELECT);
  // and an on document yields the widened ones
  const onMode = filterModeOf(tokenModeOf(settingsOf({ tokenEnabled: true }), new Date(NOW)));
  assert.ok("$or" in kitchenOrderFilter(onMode));
  assert.ok(kitchenSelectOf(onMode).endsWith(" tokenNumber"));
});

// ── The KotTick update builders ──────────────────────────────────────────────────────────────────────────────────────

test("readyStampMs: the seen instant when it is in the past; now when it is absent, empty, invalid or in the future", () => {
  const nowMs = T0;
  assert.equal(readyStampMs(at(T0 - MIN).toISOString(), nowMs), T0 - MIN);
  assert.equal(readyStampMs(at(T0).toISOString(), nowMs), T0, "exactly now");
  assert.equal(readyStampMs(at(T0 + MIN).toISOString(), nowMs), nowMs, "a future stamp is clamped to now");
  assert.equal(readyStampMs(undefined, nowMs), nowMs);
  assert.equal(readyStampMs("", nowMs), nowMs);
  assert.equal(readyStampMs("not a date", nowMs), nowMs);
});

test("readyUpdateOf(ready): $set readyAt = the clamped seenFiredAt and readyMarkedAt = now, and nothing else", () => {
  const seen = at(T0 - 12 * MIN).toISOString();
  const update = readyUpdateOf(true, seen, NOW);
  assert.deepStrictEqual(update, { $set: { readyAt: at(T0 - 12 * MIN), readyMarkedAt: at(NOW) } });
  assert.deepStrictEqual(Object.keys(update), ["$set"], "no $unset beside it");
  assert.ok("$set" in update);
  assert.ok(update.$set.readyAt instanceof Date && update.$set.readyMarkedAt instanceof Date, "Dates, not numbers or strings");
  assert.notEqual(update.$set.readyAt.getTime(), update.$set.readyMarkedAt.getTime(), "the two stamps differ — the mark is the tap, readyAt is what was seen");
});

test("readyUpdateOf(ready): a future seenFiredAt clamps readyAt to now; an invalid or absent one is now", () => {
  const setOf = (u: ReturnType<typeof readyUpdateOf>) => {
    assert.ok(u.$set, "landmark: a Ready update is a $set");
    return u.$set;
  };
  const future = setOf(readyUpdateOf(true, at(NOW + 5 * MIN).toISOString(), NOW));
  assert.equal(future.readyAt.getTime(), NOW, "future clamps to now");
  assert.equal(future.readyMarkedAt.getTime(), NOW);
  for (const seen of ["garbage", undefined, ""]) {
    const u = setOf(readyUpdateOf(true, seen, NOW));
    assert.equal(u.readyAt.getTime(), NOW, `${String(seen)} => now`);
    assert.equal(u.readyMarkedAt.getTime(), NOW);
  }
});

test("readyUpdateOf(un-ready): $unset of BOTH keys with the empty string — never null, never a $set", () => {
  for (const seen of [undefined, at(T0).toISOString()]) {
    const update = readyUpdateOf(false, seen, NOW);
    assert.deepStrictEqual(update, { $unset: { readyAt: "", readyMarkedAt: "" } });
    assert.deepStrictEqual(Object.keys(update), ["$unset"]);
    assert.ok("$unset" in update);
    assert.deepStrictEqual(Object.keys(update.$unset).sort(), ["readyAt", "readyMarkedAt"]);
    for (const value of Object.values(update.$unset)) assert.strictEqual(value, "");
  }
  assert.ok(!JSON.stringify(readyUpdateOf(false, undefined, NOW)).includes("null"), "no null anywhere in the update");
});

test("collectedUpdateOf: collected is a $set of collectedAt = now; undone is a $unset with the empty string (never null)", () => {
  assert.deepStrictEqual(collectedUpdateOf(true, NOW), { $set: { collectedAt: at(NOW) } });
  assert.deepStrictEqual(Object.keys(collectedUpdateOf(true, NOW)), ["$set"]);
  const undone = collectedUpdateOf(false, NOW);
  assert.deepStrictEqual(undone, { $unset: { collectedAt: "" } });
  assert.ok("$unset" in undone);
  assert.strictEqual(undone.$unset.collectedAt, "");
  assert.ok(!JSON.stringify(undone).includes("null"));
  assert.deepStrictEqual(Object.keys(undone), ["$unset"], "no $set on an undo");
});

// ── buildTokenBoard ──────────────────────────────────────────────────────────────────────────────────────────────────

const noExtras = (e: TokenBoardEntry) => Object.keys(e).sort();

test("buildTokenBoard: entry keys are EXACTLY {id, number, firedAt} (+ readySince on ready) — nothing from the order leaks", () => {
  // orders arrive from a DB read with more than the board selects; none of it may ride out.
  const leaky = {
    ...order(1),
    customerName: "A. Customer",
    total: 12345,
    items: [{ name: "Chai" }],
    paidAmount: 12345,
    receiver: "Staff",
  } as unknown as TokenOrderInput;
  const readyOrder = { ...order(2), customerName: "B. Customer", total: 999 } as TokenOrderInput;
  const board = buildTokenBoard({
    orders: [leaky, readyOrder],
    ticks: { [hex(2)]: { readyAt: at(T0), readyMarkedAt: at(NOW - MIN) } },
    nowMs: NOW,
    clearMinutes: CLEAR,
  });
  assert.equal(board.preparing.length, 1, "landmark: one preparing");
  assert.equal(board.ready.length, 1, "landmark: one ready");
  assert.deepStrictEqual(noExtras(board.preparing[0]), ["firedAt", "id", "number"]);
  assert.deepStrictEqual(noExtras(board.ready[0]), ["firedAt", "id", "number", "readySince"]);
  assert.ok(!("readySince" in board.preparing[0]), "a preparing entry carries no readySince key at all");
  const wire = JSON.stringify(board);
  for (const leak of ["A. Customer", "B. Customer", "12345", "Chai", "Staff"]) assert.ok(!wire.includes(leak), `no ${leak} on the wire`);
});

test("buildTokenBoard: id is the string _id, number the token, firedAt the NEWEST fire instant (createdAt when nothing fired), readySince the Ready mark", () => {
  const objectId = new Types.ObjectId();
  const o1 = { ...order(1), _id: objectId, kotFiredAt: [at(T0), at(T0 + 3 * MIN)] } as TokenOrderInput;
  const o2 = order(2); // no kotFiredAt: createdAt is round one
  const board = buildTokenBoard({
    orders: [o1, o2],
    ticks: { [hex(2)]: { readyAt: at(T0 + 4 * MIN), readyMarkedAt: at(T0 + 14 * MIN) } },
    nowMs: NOW,
    clearMinutes: CLEAR,
  });
  assert.deepStrictEqual(board.preparing, [{ id: objectId.toHexString(), number: 1, firedAt: at(T0 + 3 * MIN).toISOString() }]);
  assert.deepStrictEqual(board.ready, [{ id: hex(2), number: 2, firedAt: at(T0).toISOString(), readySince: at(T0 + 14 * MIN).toISOString() }]);
});

test("buildTokenBoard: hidden tokens (collected, auto-cleared) appear in neither list", () => {
  const orders = [order(1), order(2), order(3), order(4)];
  const board = buildTokenBoard({
    orders,
    ticks: {
      [hex(2)]: { readyAt: at(T0), readyMarkedAt: at(NOW - MIN), collectedAt: at(NOW - 30_000) }, // collected
      [hex(3)]: { readyAt: at(T0), readyMarkedAt: at(NOW - CLEAR * MIN) }, // aged out, exactly at the boundary
      [hex(4)]: { readyAt: at(T0), readyMarkedAt: at(NOW - MIN) }, // ready
    },
    nowMs: NOW,
    clearMinutes: CLEAR,
  });
  assert.deepStrictEqual(board.preparing.map((e) => e.number), [1]);
  assert.deepStrictEqual(board.ready.map((e) => e.number), [4]);
});

test("buildTokenBoard: preparing is oldest-fired first, ready is newest-marked first (by readyMarkedAt, not readyAt)", () => {
  const board = buildTokenBoard({
    orders: [
      order(1, { createdAt: at(T0 + 3 * MIN) }),
      order(2, { createdAt: at(T0 + 1 * MIN) }),
      order(3, { createdAt: at(T0 + 2 * MIN) }),
      order(4),
      order(5),
      order(6),
    ],
    ticks: {
      // 4: marked earliest but readyAt latest; 5: marked in the middle; 6: marked latest but readyAt earliest
      [hex(4)]: { readyAt: at(T0 + 9 * MIN), readyMarkedAt: at(T0 + 10 * MIN) },
      [hex(5)]: { readyAt: at(T0 + 5 * MIN), readyMarkedAt: at(T0 + 11 * MIN) },
      [hex(6)]: { readyAt: at(T0 + 1 * MIN), readyMarkedAt: at(T0 + 12 * MIN) },
    },
    nowMs: NOW,
    clearMinutes: CLEAR,
  });
  assert.deepStrictEqual(board.preparing.map((e) => e.number), [2, 3, 1], "oldest fire first");
  assert.deepStrictEqual(board.ready.map((e) => e.number), [6, 5, 4], "newest Ready mark first");
});

test("buildTokenBoard: each list is capped at TOKEN_BOARD_LIMIT — preparing keeps the OLDEST 50, ready keeps the NEWEST-marked 50", () => {
  const COUNT = TOKEN_BOARD_LIMIT + 10;
  const orders: TokenOrderInput[] = [];
  const ticks: Record<string, TokenTickInput> = {};
  for (let i = 1; i <= COUNT; i += 1) {
    orders.push(order(i, { createdAt: at(T0 + i * 1000) })); // preparing: 1 is oldest
    orders.push(order(1000 + i, { createdAt: at(T0) }));
    ticks[hex(1000 + i)] = { readyAt: at(T0), readyMarkedAt: at(NOW - MIN - i * 1000) }; // ready: 1001 is newest-marked
  }
  const board = buildTokenBoard({ orders, ticks, nowMs: NOW, clearMinutes: CLEAR });
  assert.equal(board.preparing.length, TOKEN_BOARD_LIMIT);
  assert.equal(board.ready.length, TOKEN_BOARD_LIMIT);
  assert.equal(board.preparing[0].number, 1);
  assert.equal(board.preparing[TOKEN_BOARD_LIMIT - 1].number, TOKEN_BOARD_LIMIT, "the oldest 50, the newest 10 dropped");
  assert.equal(board.ready[0].number, 1001);
  assert.equal(board.ready[TOKEN_BOARD_LIMIT - 1].number, 1000 + TOKEN_BOARD_LIMIT, "the newest-marked 50, the oldest-marked 10 dropped");
});

test("buildTokenBoard: an order without a numeric tokenNumber is skipped (absent, null, a string)", () => {
  const board = buildTokenBoard({
    orders: [
      order(1),
      order(2, { tokenNumber: undefined }),
      { ...order(3), tokenNumber: null } as unknown as TokenOrderInput,
      { ...order(4), tokenNumber: "4" } as unknown as TokenOrderInput,
    ],
    ticks: {},
    nowMs: NOW,
    clearMinutes: CLEAR,
  });
  assert.deepStrictEqual(board.preparing.map((e) => e.number), [1], "only the numeric one stays");
  assert.deepStrictEqual(board.ready, []);
  assert.deepStrictEqual(buildTokenBoard({ orders: [], ticks: {}, nowMs: NOW, clearMinutes: CLEAR }), { preparing: [], ready: [] });
});

test("buildTokenBoard: the lost-ticket case — a Ready'd order with a later round is back on the Preparing list", () => {
  const held = order(7, { kotFiredAt: [at(T0), at(T0 + 5 * MIN)] });
  const board = buildTokenBoard({
    orders: [held],
    ticks: { [hex(7)]: { readyAt: at(T0 + MIN), readyMarkedAt: at(NOW - MIN) } },
    nowMs: NOW,
    clearMinutes: CLEAR,
  });
  assert.deepStrictEqual(board.ready, []);
  assert.deepStrictEqual(board.preparing.map((e) => e.number), [7]);
  assert.equal(board.preparing[0].firedAt, at(T0 + 5 * MIN).toISOString());
});

// ── pendingTokenIds (the kitchen arm's survivors) ────────────────────────────────────────────────────────────────────

test("pendingTokenIds: the comparison, not readyAt presence — a Ready older than the newest round keeps the order pending", () => {
  const covered = order(1);
  const lost = order(2, { kotFiredAt: [at(T0), at(T0 + 5 * MIN)] });
  const never = order(3);
  const ids = pendingTokenIds(
    [covered, lost, never],
    { [hex(1)]: at(T0), [hex(2)]: at(T0 + MIN) }, // 1 is covered; 2 has a Ready, but a later round; 3 has none
    NOW,
  );
  assert.deepStrictEqual(ids.sort(), [hex(2), hex(3)].sort());
  assert.ok(!ids.includes(hex(1)), "the covered order is dropped");
  // an unparseable stamp never hides work, and a Ready equal to the newest fire covers it (>=)
  assert.deepStrictEqual(pendingTokenIds([covered], { [hex(1)]: "garbage" }, NOW), [hex(1)]);
  assert.deepStrictEqual(pendingTokenIds([covered], { [hex(1)]: at(T0 - 1) }, NOW), [hex(1)]);
  assert.deepStrictEqual(pendingTokenIds([covered], { [hex(1)]: at(T0) }, NOW), []);
});

test("pendingTokenIds: oldest fire first, string ids, capped at TOKEN_KITCHEN_LIMIT (the oldest survive)", () => {
  const objectId = new Types.ObjectId();
  const first = pendingTokenIds(
    [
      order(1, { createdAt: at(T0 + 2 * MIN) }),
      { ...order(2, { createdAt: at(T0) }), _id: objectId } as TokenOrderInput,
      order(3, { createdAt: at(T0 + MIN) }),
    ],
    {},
    NOW,
  );
  assert.deepStrictEqual(first, [objectId.toHexString(), hex(3), hex(1)], "oldest first, ObjectId stringified");
  assert.ok(first.every((id) => typeof id === "string"));

  const many: TokenOrderInput[] = [];
  const COUNT = TOKEN_KITCHEN_LIMIT + 10;
  for (let i = 1; i <= COUNT; i += 1) many.push(order(i, { createdAt: at(T0 + (COUNT - i) * 1000) })); // 1 is the NEWEST
  const capped = pendingTokenIds(many, {}, NOW);
  assert.equal(capped.length, TOKEN_KITCHEN_LIMIT);
  assert.equal(capped[0], hex(COUNT), "the oldest order leads");
  assert.ok(!capped.includes(hex(1)), "the newest order is the one cut");
});

// ── The paid stale-out (owner s82, review I-1) ───────────────────────────────────────────────────────────────────────

const STALE_MS = 120 * MIN;
const paid = (n: number, createdMsAgo: number, over: Partial<TokenOrderInput> = {}): TokenOrderInput =>
  order(n, { createdAt: at(NOW - createdMsAgo), status: "Completed", ...over });

test("TOKEN_STALE_MINUTES is 120", () => {
  assert.equal(TOKEN_STALE_MINUTES, 120);
});

test("isStalePaidToken: a Completed order whose newest fire is >= 120 min old — exact boundary stale, 1 ms short not", () => {
  assert.equal(isStalePaidToken(paid(1, STALE_MS), NOW), true, "exactly 120 minutes: stale (>=)");
  assert.equal(isStalePaidToken(paid(1, STALE_MS - 1), NOW), false, "119:59.999: not yet");
  assert.equal(isStalePaidToken(paid(1, STALE_MS + 1), NOW), true);
  assert.equal(isStalePaidToken(paid(1, 5 * 60 * MIN), NOW), true, "5 hours");
});

test("isStalePaidToken: only status Completed can go stale — Pending (an open tab), a missing status and a Cancelled one never do", () => {
  const old = 5 * 60 * MIN;
  assert.equal(isStalePaidToken(paid(1, old), NOW), true, "landmark: the same age IS stale when Completed");
  assert.equal(isStalePaidToken(paid(1, old, { status: "Pending" }), NOW), false);
  assert.equal(isStalePaidToken(paid(1, old, { status: undefined }), NOW), false, "absent status is never stale");
  assert.equal(isStalePaidToken(paid(1, old, { status: "Cancelled" }), NOW), false);
});

test("isStalePaidToken measures from the NEWEST fire, not createdAt: a held tab created 5 h ago whose later round fired minutes ago is not stale", () => {
  const held = paid(1, 5 * 60 * MIN, { kotFiredAt: [at(NOW - 5 * 60 * MIN), at(NOW - 5 * MIN)] });
  assert.equal(isStalePaidToken(held, NOW), false);
  const allOld = paid(1, 5 * 60 * MIN, { kotFiredAt: [at(NOW - 5 * 60 * MIN), at(NOW - 3 * 60 * MIN)] });
  assert.equal(isStalePaidToken(allOld, NOW), true, "vision guard: with the later round also old it is stale");
});

test("tokenStatusOf: a Completed UNCOVERED order is hidden at exactly 120 min and preparing 1 ms short", () => {
  assert.equal(tokenStatusOf(paid(1, STALE_MS), undefined, NOW, CLEAR), "hidden");
  assert.equal(tokenStatusOf(paid(1, STALE_MS - 1), undefined, NOW, CLEAR), "preparing");
  // a Ready that does NOT cover the newest round is still uncovered: stale hides it too
  assert.equal(tokenStatusOf(paid(1, STALE_MS), { readyAt: at(NOW - STALE_MS - 1), readyMarkedAt: at(NOW - MIN) }, NOW, CLEAR), "hidden");
});

test("tokenStatusOf: an OPEN tab (Pending) uncovered and fired 5 h ago is STILL preparing; an absent status is never stale", () => {
  assert.equal(tokenStatusOf(paid(1, 5 * 60 * MIN, { status: "Pending" }), undefined, NOW, CLEAR), "preparing");
  assert.equal(tokenStatusOf(paid(1, 5 * 60 * MIN, { status: undefined }), undefined, NOW, CLEAR), "preparing");
  assert.equal(tokenStatusOf(paid(1, 5 * 60 * MIN), undefined, NOW, CLEAR), "hidden", "landmark: the Completed twin is hidden");
});

test("tokenStatusOf: a held tab created 5 h ago whose LATER round fired recently is preparing (newest fire, not createdAt)", () => {
  const held = paid(1, 5 * 60 * MIN, { kotFiredAt: [at(NOW - 5 * 60 * MIN), at(NOW - 5 * MIN)] });
  assert.equal(tokenStatusOf(held, undefined, NOW, CLEAR), "preparing");
});

test("tokenStatusOf: a Ready-COVERED paid order 3 h old follows the old rules — stale does not apply (ready inside the clear window, hidden once it ages out or is collected)", () => {
  const threeHours = 3 * 60 * MIN;
  const covered = { readyAt: at(NOW - threeHours), readyMarkedAt: at(NOW - MIN) };
  assert.equal(tokenStatusOf(paid(1, threeHours), covered, NOW, CLEAR), "ready");
  assert.equal(tokenStatusOf(paid(1, threeHours), { ...covered, readyMarkedAt: at(NOW - 11 * MIN) }, NOW, CLEAR), "hidden", "the clear rule hides it, as before");
  assert.equal(tokenStatusOf(paid(1, threeHours), { ...covered, collectedAt: at(NOW) }, NOW, CLEAR), "hidden", "and so does Collected");
});

test("buildTokenBoard: a stale paid order is on neither list; a 119 min paid one and a 5 h open tab are on Preparing; a stale-aged but Ready-covered one is on Ready", () => {
  const board = buildTokenBoard({
    orders: [
      paid(1, STALE_MS), // stale: gone
      paid(2, STALE_MS - MIN), // 119 min: preparing
      paid(3, 5 * 60 * MIN, { status: "Pending" }), // open tab, 5 h: preparing
      paid(4, 3 * 60 * MIN), // paid, 3 h, Ready 1 min ago: ready
    ],
    ticks: { [hex(4)]: { readyAt: at(NOW - 3 * 60 * MIN), readyMarkedAt: at(NOW - MIN) } },
    nowMs: NOW,
    clearMinutes: CLEAR,
  });
  assert.deepStrictEqual(board.preparing.map((e) => e.number).sort(), [2, 3]);
  assert.deepStrictEqual(board.ready.map((e) => e.number), [4]);
});

test("buildTokenBoard: the order's status is READ for the rule but NEVER reaches the payload — entries are still exactly {id, number, firedAt} (+ readySince)", () => {
  const board = buildTokenBoard({
    orders: [paid(1, MIN), paid(2, MIN, { status: "Pending" }), paid(3, MIN)],
    ticks: { [hex(3)]: { readyAt: at(NOW - MIN), readyMarkedAt: at(NOW - 30_000) } },
    nowMs: NOW,
    clearMinutes: CLEAR,
  });
  assert.equal(board.preparing.length + board.ready.length, 3, "landmark: all three are on the board");
  for (const entry of [...board.preparing, ...board.ready]) {
    assert.ok(!("status" in entry), "no status key on an entry");
  }
  assert.deepStrictEqual(noExtras(board.preparing[0]), ["firedAt", "id", "number"]);
  assert.deepStrictEqual(noExtras(board.ready[0]), ["firedAt", "id", "number", "readySince"]);
  const wire = JSON.stringify(board);
  for (const leak of ["Completed", "Pending", "status"]) assert.ok(!wire.includes(leak), `no ${leak} on the wire`);
});

test("pendingTokenIds: a paid candidate fired exactly 120 min ago is dropped, 1 ms short is kept — covered or not-yet-covered alike", () => {
  const stale = paid(1, STALE_MS);
  const nearly = paid(2, STALE_MS - 1);
  const fresh = paid(3, MIN);
  assert.deepStrictEqual(pendingTokenIds([stale, nearly, fresh], {}, NOW).sort(), [hex(2), hex(3)].sort());
  assert.ok(!pendingTokenIds([stale], {}, NOW).includes(hex(1)), "the stale one alone yields nothing");
  assert.deepStrictEqual(pendingTokenIds([stale], {}, NOW), []);
  // a Ready that does not cover the newest round does not rescue a stale order
  assert.deepStrictEqual(pendingTokenIds([stale], { [hex(1)]: at(NOW - STALE_MS - 1) }, NOW), []);
  // the NEWEST round decides: created 5 h ago, a later round 5 min ago
  const held = paid(4, 5 * 60 * MIN, { kotFiredAt: [at(NOW - 5 * 60 * MIN), at(NOW - 5 * MIN)] });
  assert.deepStrictEqual(pendingTokenIds([held], {}, NOW), [hex(4)]);
  // a later "now" ages the same candidate out
  assert.deepStrictEqual(pendingTokenIds([nearly], {}, NOW), [hex(2)]);
  assert.deepStrictEqual(pendingTokenIds([nearly], {}, NOW + 1), []);
});

// ── mergeKitchenArms ─────────────────────────────────────────────────────────────────────────────────────────────────

test("mergeKitchenArms: dedupes by String(_id) across string and ObjectId ids, and the open arm's copy wins", () => {
  const sharedId = new Types.ObjectId();
  const open = [
    { _id: hex(1), tag: "open-1" },
    { _id: sharedId.toHexString(), tag: "open-shared" },
  ];
  const token = [
    { _id: sharedId as unknown as string, tag: "token-shared" }, // settled between the two reads: in both arms
    { _id: hex(3), tag: "token-3" },
  ];
  const merged = mergeKitchenArms(open, token);
  assert.deepStrictEqual(merged.map((o) => o.tag), ["open-1", "open-shared", "token-3"], "no duplicate, open before token");
  assert.equal(merged[1], open[1], "the open arm's very object, not the token arm's");
  assert.equal(merged.filter((o) => String(o._id) === sharedId.toHexString()).length, 1);
  assert.equal(new Set(merged.map((o) => String(o._id))).size, merged.length, "no duplicate React key");
});

test("mergeKitchenArms: disjoint arms concatenate, an empty arm returns the other, and neither input is mutated", () => {
  const open = [{ _id: hex(1) }];
  const token = [{ _id: hex(2) }, { _id: hex(3) }];
  const openBefore = JSON.stringify(open);
  const tokenBefore = JSON.stringify(token);
  assert.deepStrictEqual(mergeKitchenArms(open, token), [{ _id: hex(1) }, { _id: hex(2) }, { _id: hex(3) }]);
  assert.deepStrictEqual(mergeKitchenArms([], token), token);
  assert.deepStrictEqual(mergeKitchenArms(open, []), open);
  assert.deepStrictEqual(mergeKitchenArms([], []), []);
  assert.equal(JSON.stringify(open), openBefore);
  assert.equal(JSON.stringify(token), tokenBefore);
});

// ── token-view: the optimistic board ─────────────────────────────────────────────────────────────────────────────────

const ENTRY = (n: number, firedAtMs: number, readySince?: number): TokenBoardEntry => ({
  id: hex(n),
  number: n,
  firedAt: at(firedAtMs).toISOString(),
  ...(readySince === undefined ? {} : { readySince: at(readySince).toISOString() }),
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function board(): TokenBoard {
  return {
    enabled: true,
    preparing: [ENTRY(1, T0), ENTRY(3, T0 + 10 * MIN)],
    ready: [ENTRY(5, T0 + 2 * MIN, T0 + 12 * MIN), ENTRY(6, T0 + MIN, T0 + 8 * MIN)],
    generatedAt: at(NOW).toISOString(),
  };
}
const NOW_ISO = at(NOW).toISOString();

test("applyTokenAction ready: the preparing entry moves to the FRONT of ready with readySince = now; the rest is untouched", () => {
  const next = applyTokenAction(deepFreeze(board()), hex(3), "ready", NOW_ISO);
  assert.deepStrictEqual(next.preparing, [ENTRY(1, T0)]);
  assert.deepStrictEqual(next.ready, [ENTRY(3, T0 + 10 * MIN, NOW), ENTRY(5, T0 + 2 * MIN, T0 + 12 * MIN), ENTRY(6, T0 + MIN, T0 + 8 * MIN)]);
  assert.equal(next.ready[0].readySince, NOW_ISO);
  assert.equal(next.enabled, true);
  assert.equal(next.generatedAt, board().generatedAt);
});

test("applyTokenAction ready: an id not in preparing (unknown, or already ready) is a no-op — never a duplicate", () => {
  const before = JSON.stringify(board());
  for (const id of [hex(99), hex(5)]) {
    const next = applyTokenAction(deepFreeze(board()), id, "ready", NOW_ISO);
    assert.equal(JSON.stringify(next), before, id);
  }
});

test("applyTokenAction unready: the ready entry returns to preparing in firedAt order, without readySince", () => {
  const next = applyTokenAction(deepFreeze(board()), hex(6), "unready", NOW_ISO);
  assert.deepStrictEqual(next.ready, [ENTRY(5, T0 + 2 * MIN, T0 + 12 * MIN)]);
  // 6 fired at T0+1m: between 1 (T0) and 3 (T0+10m)
  assert.deepStrictEqual(next.preparing.map((e) => e.number), [1, 6, 3]);
  const moved = next.preparing.find((e) => e.id === hex(6));
  assert.ok(moved, "landmark: it is on the preparing list");
  assert.ok(!("readySince" in moved), "readySince is gone");
  assert.deepStrictEqual(Object.keys(moved).sort(), ["firedAt", "id", "number"]);
  // earliest-fired lands first
  const early = board();
  early.ready[0] = ENTRY(5, T0 - 5 * MIN, T0 + 12 * MIN);
  assert.deepStrictEqual(applyTokenAction(early, hex(5), "unready", NOW_ISO).preparing.map((e) => e.number), [5, 1, 3]);
});

test("applyTokenAction unready: an id not in ready (unknown, or preparing) is a no-op", () => {
  const before = JSON.stringify(board());
  for (const id of [hex(99), hex(1)]) assert.equal(JSON.stringify(applyTokenAction(deepFreeze(board()), id, "unready", NOW_ISO)), before, id);
});

test("applyTokenAction collected: removes the entry from ready only; a preparing or unknown id is unchanged", () => {
  const next = applyTokenAction(deepFreeze(board()), hex(5), "collected", NOW_ISO);
  assert.deepStrictEqual(next.ready, [ENTRY(6, T0 + MIN, T0 + 8 * MIN)]);
  assert.deepStrictEqual(next.preparing, board().preparing, "preparing untouched");
  const before = JSON.stringify(board());
  for (const id of [hex(1), hex(99)]) assert.equal(JSON.stringify(applyTokenAction(deepFreeze(board()), id, "collected", NOW_ISO)), before, id);
});

test("applyTokenAction uncollected: the board is unchanged (the refetch restores the token)", () => {
  const before = JSON.stringify(board());
  for (const id of [hex(1), hex(5), hex(99)]) assert.equal(JSON.stringify(applyTokenAction(deepFreeze(board()), id, "uncollected", NOW_ISO)), before, id);
});

test("applyTokenAction never mutates its input board (deep-frozen input, all four actions)", () => {
  const frozen = deepFreeze(board());
  const snapshot = JSON.stringify(frozen);
  for (const action of TOKEN_ACTIONS) {
    for (const id of [hex(1), hex(5), hex(99)]) {
      assert.doesNotThrow(() => applyTokenAction(frozen, id, action, NOW_ISO), `${action} ${id}`);
    }
  }
  assert.equal(JSON.stringify(frozen), snapshot);
  // vision guard: the freeze is real — a mutation attempt on it throws
  assert.throws(() => frozen.preparing.push(ENTRY(9, T0)), TypeError);
  // and a real change did happen in a fresh run, so "no throw" above is not "no work"
  assert.notEqual(JSON.stringify(applyTokenAction(frozen, hex(1), "ready", NOW_ISO)), snapshot);
});

test("TOKEN_ACTIONS is exactly [ready, unready, collected, uncollected]; tokenLabelOf reads 'Token n'", () => {
  assert.deepStrictEqual([...TOKEN_ACTIONS], ["ready", "unready", "collected", "uncollected"]);
  assert.equal(TOKEN_ACTIONS.length, 4);
  assert.equal(tokenLabelOf(7), "Token 7");
  assert.equal(tokenLabelOf(101), "Token 101");
});

// ── Source pins: the two modules' layering ───────────────────────────────────────────────────────────────────────────

const readLib = (name: string): string => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");
const importsOf = (src: string): string[] => Array.from(src.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)).map((m) => m[1]);

test("PIN: lib/token-view.ts is import-free and client-safe (screens import it; it must never pull the card builder in)", () => {
  const src = stripComments(readLib("token-view.ts"));
  assert.match(src, /export const TOKEN_ACTIONS\b/, "positive landmark: the file is what we think it is");
  assert.match(src, /export function applyTokenAction\b/);
  assert.deepStrictEqual(importsOf(src), [], "no import of any kind");
  assert.ok(!/^\s*import\b/m.test(src), "no bare side-effect import either");
  assert.ok(!src.includes("require" + "("), "no require");
});

test("PIN: lib/token-board.ts is pure — no driver, model, DB, React or fetch; its imports are the planned pure modules", () => {
  const src = stripComments(readLib("token-board.ts"));
  assert.match(src, /export function tokenStatusOf\b/, "positive landmark");
  assert.match(src, /export function mergeKitchenArms\b/);
  const imports = importsOf(src);
  assert.ok(imports.length >= 4, `landmark: the import scan actually saw the imports (${imports.join(", ")})`);
  assert.deepStrictEqual(
    [...imports].sort(),
    [
      "@/lib/kitchen-board",
      "@/lib/kitchen-cards",
      // Skip-KOT (review M1): orderSkipsKitchen — kitchen-lines.ts itself imports nothing (pinned below).
      "@/lib/kitchen-lines",
      "@/lib/print",
      "@/lib/token-view",
      "@pos/shared/print-budget",
      "@pos/shared/print-qr",
      "@pos/shared/slip-day",
    ].sort(),
  );
  for (const banned of ["mongo" + "ose", "@/models", "@/lib/db", "react", "next/", "fetch" + "("]) {
    assert.ok(!src.includes(banned), `token-board.ts must not reference ${banned}`);
  }
});

test("PIN: lib/kitchen-lines.ts (now imported by the pure token board) imports nothing at all", () => {
  const src = stripComments(readLib("kitchen-lines.ts"));
  assert.match(src, /export function orderSkipsKitchen\b/, "positive landmark");
  assert.deepStrictEqual(importsOf(src), [], "kitchen-lines.ts stays dependency-free, so the token board stays pure");
});

test("PIN: neither module logs or names a cafe", () => {
  const cafeName = "Luci" + "fer";
  for (const name of ["token-board.ts", "token-view.ts"]) {
    const raw = readLib(name);
    assert.match(raw, /export /, `landmark: ${name} read`);
    assert.ok(!raw.includes("console" + "."), `${name} has no console call`);
    assert.ok(!raw.toLowerCase().includes(cafeName.toLowerCase()), `${name} hardcodes no cafe name`);
  }
});

// ── Skip-KOT (S4): token status uses the kitchen-round rule ───────────────────────────────────────────────

test("S4: a Ready token stays Ready after a water-only (no kitchen ticket) round", () => {
  const items = [{ kotRound: 1 }, { kotRound: 2, noKot: true }];
  const held = order(7, { kotFiredAt: [at(T0), at(T0 + 2 * MIN)], items });
  const tick = { readyAt: at(T0 + MIN), readyMarkedAt: at(NOW - MIN) };
  assert.equal(tokenStatusOf(held, tick, NOW, CLEAR), "ready", "the water round must not flip the token back to Preparing");
  // vision guard: the same second round WITHOUT the flag is a kitchen round, so it does flip back.
  const kitchen = order(7, { kotFiredAt: [at(T0), at(T0 + 2 * MIN)], items: [{ kotRound: 1 }, { kotRound: 2 }] });
  assert.equal(tokenStatusOf(kitchen, tick, NOW, CLEAR), "preparing");
  // and the board entry's firedAt stays the newest KITCHEN round.
  const board = buildTokenBoard({ orders: [held], ticks: { [hex(7)]: tick }, nowMs: NOW, clearMinutes: CLEAR });
  assert.equal(board.ready.length, 1);
  assert.equal(board.ready[0].firedAt, at(T0).toISOString());
});

test("S4: the paid arm's pendingTokenIds applies the same kitchen-round rule", () => {
  const paidHeld = { _id: hex(8), createdAt: at(T0), kotFiredAt: [at(T0), at(T0 + 2 * MIN)], items: [{ kotRound: 1 }, { kotRound: 2, noKot: true }] };
  assert.deepStrictEqual(pendingTokenIds([paidHeld], { [hex(8)]: at(T0 + MIN) }, NOW), [], "Ready covers the newest kitchen round");
});

test("S4: TOKEN_BOARD_SELECT reads only the kitchen-round sub-paths of items, never a name or a price", () => {
  const fields = TOKEN_BOARD_SELECT.split(/\s+/);
  assert.ok(fields.includes("items.kotRound") && fields.includes("items.noKot"), "positive landmark: the two sub-paths");
  assert.ok(!fields.includes("items"), "never the whole items array");
  for (const banned of ["items.name", "items.price", "items.productId", "items.qty", "items.modifiers", "items.instructions", "items.variation", "items.note"]) {
    assert.ok(!fields.includes(banned), `the public token board must not select ${banned}`);
  }
  assert.ok(fields.every((f) => !f.startsWith("items.") || f === "items.kotRound" || f === "items.noKot"), "no other items sub-path");
});

// Review M1 (skip-KOT): voiding every kitchen line of a token order leaves only no-kitchen lines. The Kitchen screen
// then shows no card (nothing for the cook to mark Ready), so the token must leave the board too — the F3 rule (an
// order with nothing for the kitchen is never on Now Serving) — instead of sitting on Preparing.
test("M1: a token order whose remaining fired lines ALL skip the kitchen is hidden, not Preparing", () => {
  const waterOnly = order(9, { kotFiredAt: [at(T0)], items: [{ kotRound: 1, noKot: true }] });
  assert.equal(tokenStatusOf(waterOnly, undefined, NOW, CLEAR), "hidden", "no kitchen work left: off the board");
  const board = buildTokenBoard({ orders: [waterOnly], ticks: {}, nowMs: NOW, clearMinutes: CLEAR });
  assert.equal(board.preparing.length + board.ready.length, 0, "neither Preparing nor Ready");
  // vision guards: a mixed order (a kitchen line remains) is still Preparing, and an order read WITHOUT items
  // (no line data) keeps today's rule.
  const mixed = order(9, { kotFiredAt: [at(T0)], items: [{ kotRound: 1 }, { kotRound: 1, noKot: true }] });
  assert.equal(tokenStatusOf(mixed, undefined, NOW, CLEAR), "preparing");
  const noLines = order(9, { kotFiredAt: [at(T0)] });
  assert.equal(tokenStatusOf(noLines, undefined, NOW, CLEAR), "preparing");
});
