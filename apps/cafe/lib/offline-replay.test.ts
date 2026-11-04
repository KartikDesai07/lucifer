// The replay runner (Printing Phase 5, spec 5.8; plan Task 13) over the real outbox store, fake storage and a fake
// server: oldest first, a round after its create (with the create's server id), each entry under its own key with the
// `offline` field; saved → the entry leaves and the answer's jobs are followed (never a new slip on the device); a
// refusal waits for staff while the others go on; no answer stops the run; an answer without the echo stops it too.

import { test } from "node:test";
import assert from "node:assert/strict";

import { ApiError } from "@pos/shared/api-client";
import { OUTBOX_KEY, emptyOutbox } from "@/lib/offline-outbox";
import type { OutboxEntry } from "@/lib/offline-outbox-schema";
import { createOutboxStore } from "@/lib/offline-outbox-store";
import { REPLAY_NO_ECHO_MESSAGE, offlineReplayBody, replayReady, runOfflineReplay, type ReplayAnswer } from "@/lib/offline-replay";

const DAY = "2026-11-04";
const entry = (over: Partial<OutboxEntry>): OutboxEntry => ({
  key: "k",
  ref: "O-1",
  at: 1_000,
  kind: "create",
  sale: false,
  uncertain: false,
  local: "offline-k",
  orderId: null,
  table: "T-1",
  body: { items: [{ productId: "p", qty: 1 }], total: 100 },
  shownTotal: 100,
  lines: [{ printerId: null, part: "-", outcome: "printed" }],
  state: "waiting",
  ...over,
});

function setup(entries: OutboxEntry[]) {
  const data = new Map<string, string>([[OUTBOX_KEY, JSON.stringify({ ...emptyOutbox(DAY), next: entries.length + 1, entries })]]);
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  const store = createOutboxStore({ storage: () => storage, locks: () => null, today: () => DAY, now: () => 1 });
  const record = () => JSON.parse(data.get(OUTBOX_KEY) ?? "null");
  return { store, record };
}

const saved = (id: string, e: OutboxEntry, over: Partial<ReplayAnswer> = {}): ReplayAnswer =>
  ({ _id: id, orderId: `ORD-${id}`, total: e.shownTotal, offline: { ref: e.ref, takenAtKept: true }, ...over }) as ReplayAnswer;

test("oldest first, a round after its create with the create's server id; saved entries leave; the jobs are followed", async () => {
  const create = entry({ key: "k1", ref: "O-1", local: "offline-k1" });
  const round = entry({ key: "k2", ref: "O-2", kind: "round", local: "offline-k1", body: { items: [] }, shownTotal: 150 });
  const other = entry({ key: "k3", ref: "O-3", local: "offline-k3" });
  const { store, record } = setup([create, round, other]);
  const sent: string[] = [];
  const followed: string[] = [];
  const result = await runOfflineReplay({
    update: store.update,
    printing: () => false,
    send: async (e) => {
      sent.push(`${e.key}:${e.kind === "round" ? e.orderId : "create"}`);
      return saved(e.kind === "create" ? `srv-${e.key}` : "srv-k1", e);
    },
    follow: (answer) => followed.push(answer._id),
  });
  assert.deepEqual(sent, ["k1:create", "k2:srv-k1", "k3:create"], "oldest first; the round went to its create's server id");
  assert.deepEqual(followed, ["srv-k1", "srv-k1", "srv-k3"], "each answer's jobs followed");
  assert.deepEqual([result.sent, result.stop], [3, "done"], "all sent");
  assert.equal(record().entries.length, 0, "the outbox is empty");
});

test("the body: the stored request, its key, and the offline note (a sale carries the total it took)", () => {
  const sale = entry({ key: "k9", ref: "O-9", sale: true, shownTotal: 236, at: 5_000, lines: [{ printerId: "p1", part: "st", outcome: "printed" }] });
  assert.deepEqual(offlineReplayBody(sale), {
    items: [{ productId: "p", qty: 1 }],
    total: 100,
    idemKey: "k9",
    offline: { ref: "O-9", takenAt: 5_000, total: 236, lines: [{ printerId: "p1", part: "st", outcome: "printed" }] },
  }, "a sale");
  assert.equal("total" in (offlineReplayBody(entry({})).offline as object), false, "a round or a held order carries no total");
});

test("a refused entry waits for staff with the server's words, and the others go on", async () => {
  const { store, record } = setup([entry({ key: "k1", ref: "O-1", local: "a" }), entry({ key: "k2", ref: "O-2", local: "b" })]);
  const result = await runOfflineReplay({
    update: store.update,
    printing: () => false,
    send: async (e) => {
      if (e.key === "k1") throw new ApiError("Masala Chai is out of stock.", "http", 409, true);
      return saved("srv-k2", e);
    },
    follow: () => undefined,
  });
  assert.equal(result.sent, 1, "the other one went");
  assert.equal(result.refused, 1, "the refusal is counted");
  const left = record().entries;
  assert.deepEqual([left.length, left[0].key, left[0].state, left[0].message], [1, "k1", "needs-staff", "Masala Chai is out of stock."], "waits with the server's words");
});

// Session 5C Task 20 (found on fake printers, the server stopped): a round refused because its tab was closed on another
// device meanwhile left the POS's tab list as it was (nothing was sent, so nothing was read again), and Fix and send
// opened it on that closed tab again. A refusal is proof the server's tabs differ from this page's: the lists are read.
test("a run that sent or refused anything reads the lists again; one that did neither does not", async () => {
  const { replayRefreshesLists } = await import("./offline-replay");
  assert.equal(replayRefreshesLists({ sent: 0, refused: 1 }), true, "a refusal alone reads the lists again");
  assert.equal(replayRefreshesLists({ sent: 2, refused: 0 }), true, "a sent entry reads them again (as before)");
  assert.equal(replayRefreshesLists({ sent: 0, refused: 0 }), false, "a miss or an empty run reads nothing");
  const { store } = setup([entry({ key: "k1", ref: "O-1", local: "a" })]);
  const result = await runOfflineReplay({
    update: store.update,
    printing: () => false,
    send: async () => {
      throw new ApiError("Can only add items to an open tab", "http", 409, true);
    },
    follow: () => undefined,
  });
  assert.deepEqual([result.sent, result.refused, result.stop], [0, 1, "done"], "the only entry refused: the run is done with one refusal");
});

test("no answer stops the run: the entry waits again and nothing more is sent before the next tick", async () => {
  const { store, record } = setup([entry({ key: "k1", local: "a" }), entry({ key: "k2", local: "b" })]);
  let sends = 0;
  const result = await runOfflineReplay({
    update: store.update,
    printing: () => false,
    send: async () => {
      sends += 1;
      throw new ApiError("Saved; its slips are not made yet.", "http", 503, true);
    },
    follow: () => undefined,
  });
  assert.equal(sends, 1, "one try, then stop (never a tight loop)");
  assert.equal(result.stop, "miss", "a miss");
  assert.deepEqual(record().entries.map((e: OutboxEntry) => e.state), ["waiting", "waiting"], "both wait");
});

test("an answer without the offline echo stops the run (an older server dropped the field)", async () => {
  const { store, record } = setup([entry({ key: "k1", local: "a" }), entry({ key: "k2", local: "b" })]);
  let sends = 0;
  const result = await runOfflineReplay({
    update: store.update,
    printing: () => false,
    send: async (e) => {
      sends += 1;
      return saved("srv", e, { offline: undefined });
    },
    follow: () => undefined,
  });
  assert.deepEqual([sends, result.stop], [1, "no-echo"], "stopped at the first");
  assert.equal(REPLAY_NO_ECHO_MESSAGE, "This POS's server did not take the offline note. Nothing more is sent until it is updated.", "spec 5.8's words");
  assert.equal(record().entries.length, 2, "nothing removed");
});

test("a total difference and a time not kept become notes (no time note for a held order); the echo never reaches the follow", async () => {
  const round = entry({ key: "k1", ref: "O-4", kind: "round", local: "srv-tab", orderId: "srv-tab", shownTotal: 240 });
  const held = entry({ key: "k2", ref: "O-5", local: "x", uncertain: true });
  const { store, record } = setup([round, held]);
  const answers: ReplayAnswer[] = [];
  await runOfflineReplay({
    update: store.update,
    printing: () => false,
    send: async (e) => saved(e.key === "k1" ? "srv-tab" : "srv-x", e, { total: e.key === "k1" ? 260 : 100, offline: { ref: e.ref, takenAtKept: false } }),
    follow: (answer) => answers.push(answer),
  });
  assert.deepEqual(record().notes.map((n: { text: string }) => n.text), [
    "O-4 saved at ₹260; this device showed ₹240",
    "O-4 was saved at the time it was sent, not the time it was taken.",
  ], "the round's notes; none about time for the held order");
  assert.ok(answers.every((a) => !("offline" in a)), "the echo is stripped before anything else sees the order");
});

test("an entry left sending by a page that died is sent again; one whose paper is still printing waits", async () => {
  const { store, record } = setup([entry({ key: "k1", local: "a", state: "sending" }), entry({ key: "k2", local: "b" })]);
  const sent: string[] = [];
  await runOfflineReplay({
    update: store.update,
    printing: (key) => key === "k2",
    send: async (e) => {
      sent.push(e.key);
      return saved("srv", e);
    },
    follow: () => undefined,
  });
  assert.deepEqual(sent, ["k1"], "resumed and sent; the printing one waits");
  assert.equal(record().entries[0].key, "k2", "still kept");
});

test("replayReady: online, the server says it takes offline replays, something to send, and the backoff passed", () => {
  const base = { offline: false, offlineReplay: true, sendable: true, nowMs: 100, retryAfter: 0, blocked: false };
  assert.equal(replayReady(base), true, "ready");
  assert.equal(replayReady({ ...base, offlineReplay: false }), false, "the runner waits without offlineReplay");
  assert.equal(replayReady({ ...base, offline: true }), false, "offline");
  assert.equal(replayReady({ ...base, sendable: false }), false, "nothing to send");
  assert.equal(replayReady({ ...base, retryAfter: 200 }), false, "a miss waits a pulse tick");
  assert.equal(replayReady({ ...base, blocked: true }), false, "a server that dropped the note");
});

test("fix wave C1: an entry a dead page left sending wakes the runner (it is resumed under the lock)", async () => {
  const { replaySendable } = await import("@/lib/offline-replay");
  const rec = (entries: OutboxEntry[]) => ({ ...emptyOutbox(DAY), entries });
  assert.equal(replaySendable(rec([entry({ state: "sending" })])), true, "only a sending entry: the runner must start (resumeSending runs inside it)");
  assert.equal(replaySendable(rec([])), false, "nothing");
  assert.equal(replaySendable(rec([entry({ state: "needs-staff" })])), false, "staff first");
  assert.equal(replaySendable(null), false, "no record yet");
});

test("fix wave m: a total difference is compared in paise (float residue is not a note)", async () => {
  const { store, record } = setup([entry({ key: "k1", kind: "round", local: "t", orderId: "t", shownTotal: 100.1 + 1e-9 })]);
  await runOfflineReplay({ update: store.update, printing: () => false, send: async (e) => saved("t", e, { total: 100.1 }), follow: () => undefined });
  assert.deepEqual(record().notes, [], "no note");
});
