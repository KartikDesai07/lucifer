// The offline outbox (Printing Phase 5, spec 5.2): pure operations over one plain record. Storage is passed in and
// the Web Lock that keeps two tabs apart is the caller's (5B), so nothing here touches `window`.

import { offlineRefOf } from "@pos/shared/offline-kot";

import { outboxRecordSchema, type OutboxEntry, type OutboxNote, type OutboxRecord } from "./offline-outbox-schema";

export const OUTBOX_KEY = "pos.offline-outbox.v1";
/** About 300 KB of localStorage. */
export const OUTBOX_MAX_ENTRIES = 300;

/** Where an unreadable record is kept, dated, so it is never overwritten. */
export const outboxBadKey = (nowMs: number): string => `${OUTBOX_KEY}.bad-${nowMs}`;

export const emptyOutbox = (day: string): OutboxRecord => ({ v: 1, day, next: 1, entries: [], notes: [] });

export function readOutbox(storage: Pick<Storage, "getItem">, day: string): { ok: true; record: OutboxRecord } | { ok: false; raw: string } {
  const raw = storage.getItem(OUTBOX_KEY);
  if (raw === null) return { ok: true, record: emptyOutbox(day) };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, raw };
  }
  const parsed = outboxRecordSchema.safeParse(json);
  if (!parsed.success) return { ok: false, raw };
  // Offline numbers restart each cafe day; the waiting entries do not.
  return { ok: true, record: parsed.data.day === day ? parsed.data : { ...parsed.data, day, next: 1 } };
}

/** False when the storage refused (full, or blocked): the caller must not tell staff the round is kept. */
export function writeOutbox(storage: Pick<Storage, "setItem">, record: OutboxRecord): boolean {
  try {
    storage.setItem(OUTBOX_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function takeOfflineRef(record: OutboxRecord): { record: OutboxRecord; ref: string } {
  return { ref: offlineRefOf(record.next), record: { ...record, next: record.next + 1 } };
}

/** "duplicate": this send is already kept (a second keep would print its KOT twice offline). */
export function addEntry(record: OutboxRecord, entry: OutboxEntry): { ok: true; record: OutboxRecord } | { ok: false; reason: "full" | "duplicate" } {
  if (record.entries.some((e) => e.key === entry.key)) return { ok: false, reason: "duplicate" };
  if (record.entries.length >= OUTBOX_MAX_ENTRIES) return { ok: false, reason: "full" };
  return { ok: true, record: { ...record, entries: [...record.entries, entry] } };
}

export function patchEntry(
  record: OutboxRecord,
  key: string,
  patch: Partial<Pick<OutboxEntry, "state" | "message" | "orderId" | "lines" | "uncertain">>,
): OutboxRecord {
  return { ...record, entries: record.entries.map((e) => (e.key === key ? { ...e, ...patch } : e)) };
}

export const removeEntry = (record: OutboxRecord, key: string): OutboxRecord => ({ ...record, entries: record.entries.filter((e) => e.key !== key) });

/** The create was saved: its rounds can now be posted to the server's order. */
export function settleCreate(record: OutboxRecord, local: string, orderId: string): OutboxRecord {
  return { ...record, entries: record.entries.map((e) => (e.local === local ? { ...e, orderId } : e)) };
}

/** Every send runs under the Web Lock, so an entry still "sending" when the lock is taken is one whose page died
 *  before its answer: waiting again, sent again under its own key (a replay is never a second order or round). The
 *  runner applies this when it takes the lock, before nextSendable. The same record when nothing was sending. */
export function resumeSending(record: OutboxRecord): OutboxRecord {
  if (!record.entries.some((e) => e.state === "sending")) return record;
  return { ...record, entries: record.entries.map((e) => (e.state === "sending" ? { ...e, state: "waiting" } : e)) };
}

/** The oldest waiting entry the server can take now. Entries are kept oldest first. A round needs its order's id,
 *  and an entry that needs staff holds back the later rounds of its order (they would land out of order). */
export function nextSendable(record: OutboxRecord): OutboxEntry | null {
  const blocked = new Set(record.entries.filter((e) => e.state === "needs-staff").map((e) => e.local));
  return record.entries.find((e) => e.state === "waiting" && !blocked.has(e.local) && (e.kind === "create" || e.orderId !== null)) ?? null;
}

export const addNote = (record: OutboxRecord, note: OutboxNote): OutboxRecord => ({ ...record, notes: [...record.notes, note] });

export const removeNote = (record: OutboxRecord, key: string): OutboxRecord => ({ ...record, notes: record.notes.filter((n) => n.key !== key) });

/** The rounds of this order still waiting on this device, its create not counted (that is round 1 of the order the
 *  next round is built on): offlineRoundOf(base, offlineRoundsOf(record, local)) numbers the next round as the server
 *  will, oldest first. */
export const offlineRoundsOf = (record: OutboxRecord, local: string): number => record.entries.filter((e) => e.local === local && e.kind === "round").length;
