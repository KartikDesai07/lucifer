// What the POS shows of the outbox (Printing Phase 5, spec 5.5, 5.7, 5.8; plan Task 14). Pure. An order made offline
// (a create that is not a sale) is an open tab like any other ("Offline · O-3"): its lines are its rounds' lines, its
// total the one the device showed last (its order object carries no server money), its table reads taken. Offline
// orders lists every entry with its state and what staff can do, and the notes.

import { isOfflineOrderId } from "@/lib/offline-kot-order";
import type { OutboxEntry, OutboxRecord } from "@/lib/offline-outbox-schema";
import { patchEntry } from "@/lib/offline-outbox";
import { OUTBOX_UNREADABLE_MESSAGE } from "@/lib/offline-outbox-store";
import { REPLAY_NO_ECHO_MESSAGE, REPLAY_WAITING_MESSAGE } from "@/lib/offline-replay";
import { SEND_DISCARD_KITCHEN, SEND_DISCARD_PAY } from "@/lib/pos-send";
import type { Order, OrderItem, Table } from "@/types";

export const OFFLINE_CHIP_PREFIX = "Offline · ";
export const OFFLINE_DISCARD_KEPT = "Its KOT is already in the kitchen. Nothing is saved for it.";
export const OFFLINE_DISCARD_SALE = "The money taken for it is not recorded.";
/** Spec 5.7's Print KOT here warning. */
export const OFFLINE_PRINT_HERE_WARNING = "If this order reached the server before the internet went, the kitchen may get it twice. This copy says OFFLINE.";
/** An entry whose paper did not print here: Discard drops it with nothing in the kitchen. */
const OFFLINE_DISCARD_UNPRINTED = "Nothing is saved for it.";

const bodyOf = (entry: OutboxEntry): Record<string, unknown> => (entry.body ?? {}) as Record<string, unknown>;
const itemsOf = (entry: OutboxEntry): OrderItem[] => (Array.isArray(bodyOf(entry).items) ? (bodyOf(entry).items as OrderItem[]) : []);
const str = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

export function offlineChipOf(order: Pick<Order, "_id" | "orderId">): string | null {
  return isOfflineOrderId(order._id) ? `${OFFLINE_CHIP_PREFIX}${order.orderId}` : null;
}

/** The orders made offline, as the POS lists an open tab. */
export function offlineOrdersOf(record: OutboxRecord | null): Order[] {
  if (record === null) return [];
  return record.entries
    .filter((entry) => entry.kind === "create" && !entry.sale)
    .map((create) => {
      const rounds = record.entries.filter((e) => e.local === create.local && e.kind === "round");
      const body = bodyOf(create);
      const items = [create, ...rounds].flatMap((e, index) => itemsOf(e).map((line) => ({ ...line, kotRound: index + 1 })));
      const last = rounds[rounds.length - 1] ?? create;
      const at = new Date(create.at).toISOString();
      return {
        _id: create.local,
        orderId: create.ref,
        customerName: str(body.customerName) ?? "Walk-In",
        ...(str(body.customerId) !== undefined ? { customerId: str(body.customerId) } : {}),
        ...(create.table !== "" ? { tableNo: create.table } : {}),
        ...(str(body.receiver) !== undefined ? { receiver: str(body.receiver) } : {}),
        items,
        subtotal: last.shownTotal,
        discount: typeof body.discount === "number" ? body.discount : 0,
        total: last.shownTotal,
        paidAmount: 0,
        payment: "Unpaid",
        status: "Pending",
        kotRounds: 1 + rounds.length,
        createdAt: at,
        updatedAt: at,
      } as Order;
    });
}

/** The open tabs with the orders made offline after them. A list still loading stays loading. */
export function withOfflineTabs(tabs: Order[] | undefined, record: OutboxRecord | null): Order[] | undefined {
  const local = offlineOrdersOf(record);
  if (tabs === undefined || local.length === 0) return tabs;
  return [...tabs, ...local];
}

/** The tables with an order made offline read taken (the server does not know it yet). */
export function withOfflineTables(tables: Table[] | undefined, record: OutboxRecord | null): Table[] | undefined {
  const taken = new Set(offlineOrdersOf(record).flatMap((order) => (order.tableNo !== undefined ? [order.tableNo] : [])));
  if (tables === undefined || taken.size === 0) return tables;
  return tables.map((table) => (taken.has(table.tableNo) && table.status === "Available" ? { ...table, status: "Occupied" as const } : table));
}

export const offlineCountOf = (record: OutboxRecord | null): number => (record === null ? 0 : record.entries.length + record.notes.length);

export interface OfflineRow {
  key: string;
  ref: string;
  title: string;
  detail: string;
  status: string;
  state: OutboxEntry["state"];
  actions: { fix: boolean; again: boolean; discard: boolean; printHere: boolean };
  discardWords: string;
}

function statusOf(entry: OutboxEntry): string {
  if (entry.state === "sending") return "Sending…";
  if (entry.state === "needs-staff") return `Needs staff: ${entry.message ?? ""}`.trim();
  return entry.uncertain ? "May already be on the server: it is sent by itself to check" : "Waiting: it is sent by itself";
}

function discardWordsOf(entry: OutboxEntry): string {
  // A held send not answered yet may already be on the server (the review's I7): today's words.
  if (entry.uncertain && entry.state !== "needs-staff") return entry.sale ? SEND_DISCARD_PAY : SEND_DISCARD_KITCHEN;
  const kept = entry.lines.some((line) => line.outcome !== "later") ? OFFLINE_DISCARD_KEPT : OFFLINE_DISCARD_UNPRINTED;
  return entry.sale ? `${kept} ${OFFLINE_DISCARD_SALE}` : kept;
}

/** `offline`: this device is offline now: Fix and send (an online send) is not offered (the final review's m5). */
export function offlineRowsOf(record: OutboxRecord | null, view: { offline?: boolean } = {}): OfflineRow[] {
  if (record === null) return [];
  return record.entries.map((entry) => {
    const lines = itemsOf(entry).reduce((sum, line) => sum + (typeof line.qty === "number" ? line.qty : 1), 0);
    const kind = entry.sale ? "Sale" : entry.kind === "create" ? "New order" : "Round";
    const refused = entry.state === "needs-staff";
    return {
      key: entry.key,
      ref: entry.ref,
      title: `${entry.ref} · ${entry.table !== "" ? entry.table : "Walk-In"}`,
      detail: `${kind} · ${lines} ${lines === 1 ? "item" : "items"}`,
      status: statusOf(entry),
      state: entry.state,
      actions: {
        fix: refused && view.offline !== true,
        again: refused,
        discard: entry.state !== "sending",
        printHere: entry.uncertain && entry.state !== "sending" && entry.lines.every((line) => line.outcome === "later"),
      },
      discardWords: discardWordsOf(entry),
    };
  });
}

/** The 5C review's I1: an entry the runner is sending (or an order made offline one of whose rounds it is sending) is
 *  never discarded: the server may save it this moment, and staff told "Nothing is saved" would ring it again. */
export const OFFLINE_DISCARD_SENDING = "This order is being sent now: it cannot be discarded.";

const discardedBy = (entry: OutboxEntry, key: string) => (e: OutboxEntry) => e.key === key || (entry.kind === "create" && e.local === entry.local && e.kind === "round");

/** Why Discard cannot take this entry now; null when it can. Read inside the outbox lock. */
export function offlineDiscardRefusal(record: OutboxRecord, key: string): string | null {
  const entry = record.entries.find((e) => e.key === key);
  if (entry === undefined) return null;
  return record.entries.some((e) => discardedBy(entry, key)(e) && e.state === "sending") ? OFFLINE_DISCARD_SENDING : null;
}

/** Discard (staff, on purpose: S2): the entry, and for an order made offline every round added to it. */
export function offlineDiscard(record: OutboxRecord, key: string): OutboxRecord {
  const entry = record.entries.find((e) => e.key === key);
  if (entry === undefined || offlineDiscardRefusal(record, key) !== null) return record;
  const gone = discardedBy(entry, key);
  return { ...record, entries: record.entries.filter((e) => !gone(e)) };
}

/** Send again (the same key, for a refusal that may have cleared); an entry being sent is left as it is. */
export function offlineSendAgain(record: OutboxRecord, key: string): OutboxRecord {
  if (record.entries.some((e) => e.key === key && e.state === "sending")) return record;
  const next = patchEntry(record, key, { state: "waiting" });
  return { ...next, entries: next.entries.map((e) => (e.key === key ? omitMessage(e) : e)) };
}

function omitMessage(entry: OutboxEntry): OutboxEntry {
  const copy = { ...entry };
  delete copy.message;
  return copy;
}

/** The sheet's line while the device is offline (spec 5.10's sentence, for the list). */
export const OFFLINE_SHEET_OFFLINE = "This device is offline. These orders are sent when the internet is back.";

/** Why the entries wait, most important first; null when nothing needs saying. */
export function offlineBannerOf(input: { offline: boolean; offlineReplay: boolean; pulseKnown: boolean; blocked: boolean; unreadable: boolean; entries: number }): string | null {
  if (input.unreadable) return OUTBOX_UNREADABLE_MESSAGE;
  if (input.entries === 0) return null;
  if (input.blocked) return REPLAY_NO_ECHO_MESSAGE;
  if (input.offline) return OFFLINE_SHEET_OFFLINE;
  if (input.pulseKnown && !input.offlineReplay) return REPLAY_WAITING_MESSAGE;
  return null;
}
