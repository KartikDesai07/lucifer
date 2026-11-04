// What the POS shows of the outbox (Printing Phase 5, spec 5.5, 5.8; plan Task 14): an order made offline is an open
// tab ("Offline · O-3") whose table reads taken; Offline orders lists every entry with what staff can do, and the notes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyOutbox } from "@/lib/offline-outbox";
import type { OutboxEntry, OutboxRecord } from "@/lib/offline-outbox-schema";
import {
  OFFLINE_DISCARD_KEPT,
  OFFLINE_DISCARD_SALE,
  offlineChipOf,
  offlineCountOf,
  offlineDiscard,
  offlineRowsOf,
  offlineSendAgain,
  withOfflineTables,
  withOfflineTabs,
} from "@/lib/offline-orders-view";
import { SEND_DISCARD_KITCHEN } from "@/lib/pos-send";
import type { Order, Table } from "@/types";

const item = (name: string) => ({ productId: `p-${name}`, name, price: 100, qty: 1, modifiers: [], instructions: "" });
const entry = (over: Partial<OutboxEntry>): OutboxEntry => ({
  key: "k1",
  ref: "O-3",
  at: Date.parse("2026-11-04T09:30:00.000Z"),
  kind: "create",
  sale: false,
  uncertain: false,
  local: "offline-k1",
  orderId: null,
  table: "T-2",
  body: { customerName: "Walk-In", tableNo: "T-2", items: [item("Tea")], discount: 0 },
  shownTotal: 100,
  lines: [{ printerId: null, part: "-", outcome: "printed" }],
  state: "waiting",
  ...over,
});
const record = (entries: OutboxEntry[], notes: OutboxRecord["notes"] = []): OutboxRecord => ({ ...emptyOutbox("2026-11-04"), entries, notes });

test("an order made offline is an open tab: its rounds' lines, the total it showed last, its table; a sale is not", () => {
  const rec = record([
    entry({}),
    entry({ key: "k2", ref: "O-4", kind: "round", body: { items: [item("Cake")] }, shownTotal: 250 }),
    entry({ key: "k3", ref: "O-5", local: "offline-k3", sale: true, table: "" }),
  ]);
  const server = [{ _id: "srv", orderId: "ORD-1", tableNo: "T-9" } as Order];
  const tabs = withOfflineTabs(server, rec) ?? [];
  assert.equal(tabs.length, 2, "the server's tab and the one made offline; the sale is not open");
  const local = tabs[1];
  assert.deepEqual([local._id, local.orderId, local.tableNo, local.total, local.status, local.payment], ["offline-k1", "O-3", "T-2", 250, "Pending", "Unpaid"], "its facts");
  assert.deepEqual(local.items.map((l) => [l.name, l.kotRound]), [["Tea", 1], ["Cake", 2]], "each round's lines, numbered");
  assert.equal(offlineChipOf(local), "Offline · O-3", "the chip");
  assert.equal(offlineChipOf(server[0]), null, "no chip on a server tab");
  assert.equal(withOfflineTabs(undefined, record([])), undefined, "a list still loading stays loading");
});

test("its table reads taken on the POS's table choice", () => {
  const tables = [{ _id: "t2", tableNo: "T-2", status: "Available" }, { _id: "t3", tableNo: "T-3", status: "Available" }] as Table[];
  const shown = withOfflineTables(tables, record([entry({})])) ?? [];
  assert.deepEqual(shown.map((t) => t.status), ["Occupied", "Available"], "T-2 taken");
  assert.equal(withOfflineTables(tables, record([])), tables, "nothing offline: the same list");
});

test("the rows: what each entry says and what staff can do", () => {
  const rec = record([
    entry({}),
    entry({ key: "k2", ref: "O-4", local: "x", state: "needs-staff", message: "Masala Chai is out of stock." }),
    entry({ key: "k3", ref: "O-5", local: "y", uncertain: true, lines: [{ printerId: null, part: "-", outcome: "later" }] }),
    entry({ key: "k4", ref: "O-6", local: "z", state: "sending" }),
  ]);
  const rows = offlineRowsOf(rec);
  assert.deepEqual(rows.map((r) => [r.ref, r.actions.fix, r.actions.again, r.actions.discard, r.actions.printHere]), [
    ["O-3", false, false, true, false],
    ["O-4", true, true, true, false],
    ["O-5", false, false, true, true],
    ["O-6", false, false, false, false],
  ], "Fix and send / Send again after a refusal only; Print KOT here for a held send; nothing while sending");
  assert.equal(rows[1].status, "Needs staff: Masala Chai is out of stock.", "the server's words");
  assert.equal(rows[0].discardWords, OFFLINE_DISCARD_KEPT, "its KOT is in the kitchen");
  assert.equal(rows[2].discardWords, SEND_DISCARD_KITCHEN, "a held send not answered yet: today's words (the review's I7)");
  assert.equal(OFFLINE_DISCARD_KEPT, "Its KOT is already in the kitchen. Nothing is saved for it.", "spec 5.8");
  const sale = offlineRowsOf(record([entry({ sale: true })]))[0];
  assert.equal(sale.discardWords, `${OFFLINE_DISCARD_KEPT} ${OFFLINE_DISCARD_SALE}`, "a discarded sale says the money is not recorded");
  assert.equal(OFFLINE_DISCARD_SALE, "The money taken for it is not recorded.", "spec 5.8");
});

test("Discard takes the entry and, for an order made offline, the rounds added to it; Send again waits it again", () => {
  const rec = record([entry({}), entry({ key: "k2", kind: "round", ref: "O-4" }), entry({ key: "k9", local: "other", ref: "O-9" })]);
  assert.deepEqual(offlineDiscard(rec, "k1").entries.map((e) => e.key), ["k9"], "the create and its round go together");
  assert.deepEqual(offlineDiscard(rec, "k2").entries.map((e) => e.key), ["k1", "k9"], "a round alone");
  const refused = record([entry({ state: "needs-staff", message: "No." })]);
  const again = offlineSendAgain(refused, "k1").entries[0];
  assert.deepEqual([again.state, again.message], ["waiting", undefined], "waiting again, the words cleared");
});

// Session 5C review I1: the runner can take an entry ("sending") between the Discard tap and its confirm; a discard
// then would tell staff "Nothing is saved for it" while the server saves it, and they would ring it again.
test("Discard and Send again never touch an entry that is being sent; the sheet says so", async () => {
  const { offlineDiscardRefusal, OFFLINE_DISCARD_SENDING } = await import("@/lib/offline-orders-view");
  const sending = record([entry({ state: "sending" }), entry({ key: "k9", local: "other", ref: "O-9" })]);
  assert.equal(offlineDiscard(sending, "k1"), sending, "the entry on the wire stays");
  assert.equal(offlineSendAgain(sending, "k1"), sending, "Send again leaves it too");
  assert.equal(offlineDiscardRefusal(sending, "k1"), OFFLINE_DISCARD_SENDING, "the words for staff");
  assert.equal(OFFLINE_DISCARD_SENDING, "This order is being sent now: it cannot be discarded.", "plain words");
  const roundSending = record([entry({}), entry({ key: "k2", kind: "round", ref: "O-4", state: "sending" })]);
  assert.equal(offlineDiscard(roundSending, "k1"), roundSending, "an order made offline stays while one of its rounds is on the wire");
  assert.equal(offlineDiscardRefusal(roundSending, "k1"), OFFLINE_DISCARD_SENDING, "said for its rounds too");
  assert.equal(offlineDiscardRefusal(sending, "k9"), null, "another entry discards as before");
});

// The final review's m5: Fix and send goes online only, so offline it is not offered (a refusal is only ever answered
// online; Send again and Discard stay).
test("offline, a refused entry offers Send again and Discard, not Fix and send", () => {
  const refused = record([entry({ state: "needs-staff", message: "No." })]);
  assert.equal(offlineRowsOf(refused)[0].actions.fix, true, "online: Fix and send");
  const offline = offlineRowsOf(refused, { offline: true })[0].actions;
  assert.deepEqual([offline.fix, offline.again, offline.discard], [false, true, true], "offline: no Fix and send");
});

test("the chip counts every entry and note", () => {
  assert.equal(offlineCountOf(null), 0, "none");
  assert.equal(offlineCountOf(record([entry({})], [{ key: "k0", ref: "O-1", text: "x", at: 1 }])), 2, "one entry, one note");
});

test("the sheet's one line on top says why the entries wait", async () => {
  const { offlineBannerOf, OFFLINE_SHEET_OFFLINE } = await import("@/lib/offline-orders-view");
  const { REPLAY_NO_ECHO_MESSAGE, REPLAY_WAITING_MESSAGE } = await import("@/lib/offline-replay");
  const { OUTBOX_UNREADABLE_MESSAGE } = await import("@/lib/offline-outbox-store");
  const base = { offline: false, offlineReplay: true, pulseKnown: true, blocked: false, unreadable: false, entries: 2 };
  assert.equal(offlineBannerOf(base), null, "online, the server takes them: nothing to say");
  assert.equal(offlineBannerOf({ ...base, offline: true }), OFFLINE_SHEET_OFFLINE, "offline");
  assert.equal(offlineBannerOf({ ...base, offlineReplay: false }), REPLAY_WAITING_MESSAGE, "an older server (spec §6)");
  assert.equal(offlineBannerOf({ ...base, offlineReplay: false, pulseKnown: false }), null, "no pulse answer yet: no claim");
  assert.equal(offlineBannerOf({ ...base, blocked: true }), REPLAY_NO_ECHO_MESSAGE, "a server that dropped the note");
  assert.equal(offlineBannerOf({ ...base, unreadable: true, blocked: true }), OUTBOX_UNREADABLE_MESSAGE, "an unreadable record first");
  assert.equal(offlineBannerOf({ ...base, entries: 0, offline: true }), null, "notes only: nothing waits");
});
