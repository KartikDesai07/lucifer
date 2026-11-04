// Fix and send (Printing Phase 5, spec 5.8, ruling 9; plan Task 14): a refused entry opens in the cart, staff change
// what the server refused, and it is sent under a NEW key with the entry's offline lines and its taken time, so the
// lines already printed stay printed (no second KOT); the old entry leaves once the server saved it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyOutbox } from "@/lib/offline-outbox";
import type { OutboxEntry } from "@/lib/offline-outbox-schema";
import { finishOfflineFix, fixCartItems, fixRequestBody, offlineFixOf, offlineFixes } from "@/lib/offline-fix";

const entry = (over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  key: "k-old",
  ref: "O-3",
  at: 5_000,
  kind: "create",
  sale: false,
  uncertain: false,
  local: "offline-k-old",
  orderId: null,
  table: "T-2",
  body: { customerName: "Walk-In", tableNo: "T-2", items: [{ productId: "p1", name: "Tea", price: 20, qty: 2, modifiers: [], instructions: "" }], notes: "less sugar" },
  shownTotal: 40,
  lines: [{ printerId: "pr-k", part: "st-k", outcome: "printed" }],
  state: "needs-staff",
  message: "Masala Chai is out of stock.",
  ...over,
});

test("the fix keeps the entry's number, taken time and lines; its body is the fixed cart's under a new key", () => {
  const fix = offlineFixOf(entry());
  assert.deepEqual(fix, { key: "k-old", ref: "O-3", at: 5_000, lines: [{ printerId: "pr-k", part: "st-k", outcome: "printed" }], local: "offline-k-old", kind: "create", sale: false }, "the fix");
  const body = fixRequestBody({ items: [], total: 20, idemKey: "stale" }, "k-new", fix, 20);
  assert.deepEqual(body, { items: [], total: 20, idemKey: "k-new", offline: { ref: "O-3", takenAt: 5_000, lines: fix.lines } }, "a new key; no total on a non-sale");
  const sale = fixRequestBody({ items: [] }, "k-new", { ...fix, sale: true }, 260);
  assert.equal((sale.offline as { total?: number }).total, 260, "a sale carries the total taken now (the server's total, re-collected)");
});

test("the cart lines are unsent (round 0), exactly as the entry kept them", () => {
  const items = fixCartItems(entry());
  assert.deepEqual(items.map((i) => [i.name, i.qty, i.kotRound]), [["Tea", 2, 0]], "unsent");
});

test("finishing: the old entry leaves; an order made offline's waiting rounds take the new server id", () => {
  const round = { ...entry({ key: "k-r", kind: "round", state: "waiting" }), message: undefined };
  const record = { ...emptyOutbox("2026-11-04"), entries: [entry(), round] };
  const next = finishOfflineFix(record, offlineFixOf(entry()), "srv-new");
  assert.deepEqual(next?.entries.map((e) => [e.key, e.orderId]), [["k-r", "srv-new"]], "gone, and its round chained to the server's order");
  assert.equal(finishOfflineFix(next!, offlineFixOf(entry()), "srv-new"), null, "already gone: nothing to write");
});

test("a fix requested from Offline orders waits for the POS to take it, once", () => {
  let told = 0;
  const off = offlineFixes.subscribe(() => (told += 1));
  offlineFixes.request(entry());
  assert.equal(offlineFixes.pending()?.key, "k-old", "pending");
  assert.equal(offlineFixes.take()?.key, "k-old", "taken");
  assert.equal(offlineFixes.take(), null, "only once");
  assert.ok(told >= 2, "listeners told");
  off();
});
