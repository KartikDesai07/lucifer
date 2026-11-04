// Which outbox entry goes to the server next, and how a saved create hands its order id to its rounds (spec 5.2).

import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyOutbox, nextSendable, offlineRoundsOf, patchEntry, resumeSending, settleCreate } from "./offline-outbox";
import type { OutboxEntry, OutboxRecord } from "./offline-outbox-schema";

const entry = (key: string, extra: Partial<OutboxEntry> = {}): OutboxEntry => ({
  key, ref: "O-1", at: 1_000, kind: "create", sale: false, uncertain: false, local: `local-${key}`, orderId: null, table: "T1",
  body: {}, shownTotal: 0, lines: [], state: "waiting", ...extra,
});
const recordOf = (...entries: OutboxEntry[]): OutboxRecord => ({ ...emptyOutbox("2026-11-04"), entries });

test("rounds of an order made offline wait for its create", () => {
  const record = recordOf(entry("r1", { kind: "round", local: "L" }), entry("c", { local: "L" }));
  assert.equal(nextSendable(record)?.key, "c", "the create goes first though the round is older");
  assert.equal(nextSendable(recordOf(entry("r1", { kind: "round", local: "L" }))), null, "a round with no order id alone is not sendable");
});

test("a create saved fills its rounds' order id", () => {
  const record = recordOf(entry("c", { local: "L" }), entry("r1", { kind: "round", local: "L" }), entry("x", { local: "other" }));
  const settled = settleCreate(record, "L", "srv-1");
  assert.deepEqual(settled.entries.map((e) => e.orderId), ["srv-1", "srv-1", null], "every entry of that local order, nobody else");
  assert.equal(record.entries[0].orderId, null, "the input record is not mutated");
  assert.equal(nextSendable(patchEntry(settled, "c", { state: "sending" }))?.key, "r1", "the round is sendable once the create is out");
});

test("oldest first", () => {
  const record = recordOf(entry("a"), entry("b"), entry("c"));
  assert.equal(nextSendable(record)?.key, "a", "the first in order");
  assert.equal(nextSendable(patchEntry(record, "a", { state: "sending" }))?.key, "b", "a sending entry is not picked again");
  assert.equal(nextSendable(recordOf()), null, "an empty outbox has nothing");
});

test("a round on a server tab is sendable at once", () => {
  const record = recordOf(entry("c", { local: "L", state: "needs-staff" }), entry("r", { kind: "round", local: "server-tab", orderId: "srv-9" }));
  assert.equal(nextSendable(record)?.key, "r", "known order id, sent without any create");
});

test("an entry that needs staff is skipped, and so are the rounds of its order", () => {
  const record = recordOf(
    entry("c", { local: "L", state: "needs-staff" }),
    entry("r1", { kind: "round", local: "L", orderId: "srv-1" }),
    entry("other", { local: "M" }),
  );
  assert.equal(nextSendable(record)?.key, "other", "the blocked order's round is skipped, the next order goes");
  const lone = recordOf(entry("c", { local: "L", state: "needs-staff" }), entry("r1", { kind: "round", local: "L", orderId: "srv-1" }));
  assert.equal(nextSendable(lone), null, "nothing else is sendable");
});

test("offlineRoundsOf counts an order's offline rounds", () => {
  const record = recordOf(entry("c", { local: "L" }), entry("r1", { kind: "round", local: "L" }), entry("r2", { kind: "round", local: "L" }), entry("o", { local: "M" }));
  // Its create is not counted: it is round 1 of the order the next round is built on (offlineRoundOf adds the base's
  // own kotRounds), exactly as for a tab the server already has.
  assert.equal(offlineRoundsOf(record, "L"), 2, "both rounds of L, not its create");
  assert.equal(offlineRoundsOf(record, "M"), 0, "an order made offline with no round yet");
  assert.equal(offlineRoundsOf(recordOf(entry("t1", { kind: "round", local: "srv-9", orderId: "srv-9" })), "srv-9"), 1, "a round on a server tab");
  assert.equal(offlineRoundsOf(record, "none"), 0, "none for an unknown order");
});

test("a send cut by a reload is sent again", () => {
  // Every send runs under the Web Lock, so an entry still "sending" when the lock is taken is a send whose page died
  // before its answer (the 5A review's I2): it is waiting again, under its own key (a replay can never send it twice).
  const record = recordOf(entry("c", { local: "L", state: "sending" }), entry("r", { kind: "round", local: "L" }), entry("x", { state: "needs-staff", message: "Out of stock" }));
  assert.equal(nextSendable(record), null, "a stuck send holds its order's rounds back");
  const resumed = resumeSending(record);
  assert.deepEqual(resumed.entries.map((e) => e.state), ["waiting", "waiting", "needs-staff"], "only the sending entry moves; staff's entries stay");
  assert.equal(nextSendable(resumed)?.key, "c", "the cut send goes first again");
  assert.equal(record.entries[0].state, "sending", "the input record is not mutated");
  // The pre-deploy review: its POST may have landed before the page died, so its Discard never says nothing is saved.
  assert.deepEqual(resumed.entries.map((e) => e.uncertain), [true, false, false], "the cut send is uncertain; the others keep theirs");
  const quiet = recordOf(entry("a"));
  assert.equal(resumeSending(quiet), quiet, "nothing to resume: the same record");
});
