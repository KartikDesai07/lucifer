// The offline outbox record (Printing Phase 5, spec 5.2): pure operations over a plain record, storage passed in.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OUTBOX_KEY, OUTBOX_MAX_ENTRIES, addEntry, addNote, emptyOutbox, outboxBadKey, patchEntry, readOutbox, removeEntry, removeNote,
  takeOfflineRef, writeOutbox,
} from "./offline-outbox";
import type { OutboxEntry, OutboxRecord } from "./offline-outbox-schema";

const entry = (key: string, extra: Partial<OutboxEntry> = {}): OutboxEntry => ({
  key, ref: "O-1", at: 1_000, kind: "create", sale: false, uncertain: false, local: `local-${key}`, orderId: null, table: "T1",
  body: { idemKey: key }, shownTotal: 100, lines: [{ printerId: "p1", part: "2 x Tea", outcome: "printed" }], state: "waiting", ...extra,
});
const storageOf = (value: string | null) => ({ getItem: (k: string) => (k === OUTBOX_KEY ? value : null) });
const DAY = "2026-11-04";

/** Adds entries one by one, failing the test if any is refused. */
function withEntries(...entries: OutboxEntry[]): OutboxRecord {
  return entries.reduce((record, e) => {
    const added = addEntry(record, e);
    assert.ok(added.ok, `entry ${e.key} fits`);
    return added.ok ? added.record : record;
  }, emptyOutbox(DAY));
}

test("an empty storage reads as an empty record", () => {
  const read = readOutbox(storageOf(null), DAY);
  assert.deepEqual(read, { ok: true, record: { v: 1, day: DAY, next: 1, entries: [], notes: [] } }, "no value is an empty record");
  assert.deepEqual(emptyOutbox(DAY), { v: 1, day: DAY, next: 1, entries: [], notes: [] }, "emptyOutbox matches");
});

test("a saved record reads back", () => {
  const record: OutboxRecord = { ...emptyOutbox(DAY), next: 3, entries: [entry("a", { message: "words" })], notes: [{ key: "a", ref: "O-1", text: "t", at: 5 }] };
  assert.deepEqual(readOutbox(storageOf(JSON.stringify(record)), DAY), { ok: true, record }, "round trip");
});

test("an unreadable record is reported, never overwritten", () => {
  const good = emptyOutbox(DAY);
  const bad = [
    "{not json",
    JSON.stringify({ ...good, v: 2 }),
    JSON.stringify({ ...good, extra: 1 }),
    JSON.stringify({ ...good, entries: [{ ...entry("a"), surprise: true }] }),
    JSON.stringify({ ...good, entries: [{ ...entry("a"), lines: [{ printerId: null, part: "x", outcome: "burnt" }] }] }),
  ];
  for (const raw of bad) assert.deepEqual(readOutbox(storageOf(raw), DAY), { ok: false, raw }, `kept as raw: ${raw.slice(0, 30)}`);
  assert.equal(outboxBadKey(1234), "pos.offline-outbox.v1.bad-1234", "the dated key the raw text is kept under (plan: .bad-<ms>)");
});

test("a failed write says so", () => {
  const values = new Map<string, string>();
  assert.equal(writeOutbox({ setItem: (k, v) => void values.set(k, v) }, emptyOutbox(DAY)), true, "a good write says true");
  assert.equal(values.get(OUTBOX_KEY), JSON.stringify(emptyOutbox(DAY)), "stored under the key");
  const full = {
    setItem: () => {
      throw new DOMException("full", "QuotaExceededError");
    },
  };
  assert.equal(writeOutbox(full, emptyOutbox(DAY)), false, "a throwing setItem says false");
});

test("offline numbers count per cafe day", () => {
  const first = takeOfflineRef(emptyOutbox(DAY));
  const second = takeOfflineRef(first.record);
  assert.deepEqual([first.ref, second.ref, second.record.next], ["O-1", "O-2", 3], "O-1, then O-2");
  const stored = JSON.stringify({ ...second.record, entries: withEntries(entry("a")).entries });
  const read = readOutbox(storageOf(stored), "2026-11-05");
  assert.ok(read.ok, "a stored record from an earlier day reads");
  if (!read.ok) return;
  assert.deepEqual([read.record.day, read.record.next, read.record.entries.length], ["2026-11-05", 1, 1], "a new day restarts at 1, entries kept");
  assert.equal(takeOfflineRef(read.record).ref, "O-1", "O-1 again");
});

test("the outbox holds at most 300 entries", () => {
  assert.equal(OUTBOX_MAX_ENTRIES, 300, "the ceiling");
  const record = withEntries(...Array.from({ length: OUTBOX_MAX_ENTRIES }, (_, i) => entry(`k${i}`)));
  assert.equal(record.entries.length, 300, "300 fit");
  assert.deepEqual(addEntry(record, entry("one-too-many")), { ok: false, reason: "full" }, "the 301st is refused");
  assert.equal(record.entries.length, 300, "the record is unchanged");
});

test("patch, remove and notes", () => {
  const base = withEntries(entry("a"), entry("b"));
  const patched = patchEntry(base, "a", { state: "needs-staff", message: "Table closed", uncertain: true });
  assert.deepEqual([patched.entries[0].state, patched.entries[0].message, patched.entries[0].uncertain], ["needs-staff", "Table closed", true], "the entry is patched");
  assert.deepEqual(patched.entries[1], base.entries[1], "the other entry is untouched");
  assert.equal(base.entries[0].state, "waiting", "the input record is not mutated");
  assert.deepEqual(patchEntry(base, "zzz", { state: "sending" }), base, "an unknown key changes nothing");
  assert.deepEqual(removeEntry(patched, "a").entries.map((e) => e.key), ["b"], "removed");
  const noted = addNote(patched, { key: "a", ref: "O-1", text: "Kept the server time", at: 9 });
  assert.equal(noted.notes.length, 1, "a note is added");
  assert.deepEqual(removeNote(noted, "a").notes, [], "the note is removed by its entry key");
});

test("an entry is never kept twice under one key", () => {
  // A second keep of the same send would print its KOT twice offline (the 5A review's m4).
  const one = addEntry(emptyOutbox(DAY), entry("k1"));
  assert.ok(one.ok, "the first entry is kept");
  if (!one.ok) return;
  const twice = addEntry(one.record, entry("k1"));
  assert.deepEqual(twice, { ok: false, reason: "duplicate" }, "the same key again is refused");
  assert.ok(addEntry(one.record, entry("k2")).ok, "another key is kept");
});
