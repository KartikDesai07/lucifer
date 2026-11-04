// The pure half of an offline send (Printing Phase 5, spec 5.2–5.6; plan Task 11). Inside the outbox lock the round
// is numbered (O-n), turned into the order the server would make of it, routed into its lines, and kept as an entry
// BEFORE any paper; its here lines are kept as "maybe" until their paper is known, so a page that dies mid-print
// leaves a labelled REPRINT on the server, never an unlabelled second KOT (S3). lib/offline-keep.ts runs it.

import { OFFLINE_LINES_MAX } from "@pos/shared/offline-kot";
import type { ProductKitchenFacts } from "@/lib/kitchen-lines";
import { addEntry, offlineRoundsOf, takeOfflineRef } from "@/lib/offline-outbox";
import type { OutboxEntry, OutboxRecord } from "@/lib/offline-outbox-schema";
import { isOfflineOrderId, offlineKotOrder, offlineRoundOf, type OfflineKotBody } from "@/lib/offline-kot-order";
import { offlineKotPlan, type OfflineLinePlan } from "@/lib/offline-lines";
import type { HostPrintResult } from "@/lib/print-host-outcomes";
import type { PrintRouting } from "@/lib/print-printer-routing";
import { printWriteOutcomeOf } from "@/lib/print-write-outcome";
import type { Order } from "@/types";

export const OFFLINE_FULL_MESSAGE = "Too many orders are waiting on this device. Connect to the internet to send them.";
/** A round on an order made offline that is no longer in the outbox (sent, or discarded by staff). */
export const OFFLINE_ORDER_SENT_MESSAGE = "This order is no longer on this device. Open it again from Open tabs.";

export type OfflineSlipOutcome = "printed" | "maybe" | "no";

/** What the bridge said about one slip: printed; nothing sent (the line waits for the server); or maybe (paper may be
 *  out: a watchdog's give-up says the bridge's generic sentence, which is not a "nothing sent" one). */
export function offlineSlipOutcomeOf(result: HostPrintResult): OfflineSlipOutcome {
  if (result.ok) return "printed";
  return printWriteOutcomeOf(result.error).sent === "no" ? "no" : "maybe";
}

export interface OfflineMenu {
  products: ReadonlyMap<string, ProductKitchenFacts>;
  skipCategoryIds: ReadonlySet<string>;
  categoryRanks: ReadonlyMap<string, number>;
}

/** The menu facts the server stamps a round with (lib/kitchen-lines-server.ts), from what the POS holds. */
export function offlineMenuOf(
  products: readonly { _id: string; categoryId?: string; noKot?: boolean }[],
  categories: readonly { _id: string; noKot?: boolean; kotOrder?: number }[],
): OfflineMenu {
  const facts = new Map<string, ProductKitchenFacts>(
    products.map((p): [string, ProductKitchenFacts] => [p._id, { ...(p.categoryId !== undefined ? { categoryId: p.categoryId } : {}), ...(p.noKot !== undefined ? { noKot: p.noKot } : {}) }]),
  );
  const categoryRanks = new Map<string, number>();
  for (const c of categories) if (typeof c.kotOrder === "number" && Number.isFinite(c.kotOrder)) categoryRanks.set(c._id, c.kotOrder);
  return { products: facts, skipCategoryIds: new Set(categories.filter((c) => c.noKot === true).map((c) => c._id)), categoryRanks };
}

export interface OfflineKeepRequest {
  /** The round's idemKey: the entry's key, sent with it later. */
  key: string;
  /** The tap's time (P5-9's taken time). */
  at: number;
  /** Pay Now. */
  sale: boolean;
  /** The tab this round adds to (a server tab, or an order made offline); null for a new order or sale. */
  base: Order | null;
  /** The body exactly as the online send posts it (a key inside it is dropped: the entry's key goes with it). */
  body: Record<string, unknown>;
  shownTotal: number;
  menu: OfflineMenu;
  routing: PrintRouting | null;
  hereIds: readonly string[];
  simple: { printsOwnSlips: boolean; canPrintNow: boolean };
  /** False: kept with no paper (a round on an order made offline sent while online: the server prints it). */
  print: boolean;
  /** A held send parked once offline (spec 5.7): it may already be on the server; the replay is its check. */
  uncertain?: boolean;
}

/** What the device needs to turn a round into its order and lines (spec 5.3). */
export type OfflinePlanContext = Pick<OfflineKeepRequest, "menu" | "routing" | "hereIds" | "simple">;

export type OfflineKeepPlan =
  | { ok: true; record: OutboxRecord; entry: OutboxEntry; plan: OfflineLinePlan[] }
  | { ok: false; reason: "full" | "duplicate" | "too-many-lines" | "number" | "order-sent" };

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const NO_SIMPLE = { printsOwnSlips: false, canPrintNow: false };

/** The round's order (the server's own stamp, numbered as the server will) and its routed lines. `earlierRounds`: the
 *  rounds of this order waiting before it on this device; an order made offline counts from its create (round 1). */
export function offlineRoundPlan(
  input: { key: string; ref: string; at: number; base: Order | null; body: Record<string, unknown>; earlierRounds: number },
  ctx: OfflinePlanContext,
): { plan: OfflineLinePlan[]; tableNo: string | undefined } {
  const { base, body } = input;
  const roundBase = base !== null && isOfflineOrderId(base._id) ? { ...base, kotRounds: 1 } : base;
  const round = offlineRoundOf(roundBase, input.earlierRounds);
  const tableNo = str(body.tableNo) ?? base?.tableNo;
  const kotBody: OfflineKotBody = {
    customerName: str(body.customerName) ?? base?.customerName ?? "",
    ...(tableNo !== undefined ? { tableNo } : {}),
    ...(str(body.receiver) !== undefined ? { receiver: str(body.receiver) } : {}),
    ...(str(body.notes) !== undefined ? { notes: str(body.notes) } : {}),
    items: (Array.isArray(body.items) ? body.items : []) as OfflineKotBody["items"],
  };
  const order = offlineKotOrder({ key: input.key, ref: input.ref, round, nowIso: new Date(input.at).toISOString(), base, body: kotBody, ...ctx.menu });
  return { plan: offlineKotPlan({ order, round, routing: ctx.routing, hereIds: ctx.hereIds, simple: ctx.simple }), tableNo };
}

export function planOfflineKeep(record: OutboxRecord, req: OfflineKeepRequest): OfflineKeepPlan {
  const { base } = req;
  const local = base === null ? `offline-${req.key}` : base._id;
  const madeOffline = base !== null && isOfflineOrderId(base._id);
  // A round on an order made offline goes to the server id its create gets; with its create gone from the outbox (sent
  // already), that id is not known here, and the round would wait for ever.
  const siblings = record.entries.filter((e) => e.local === local);
  if (madeOffline && siblings.length === 0) return { ok: false, reason: "order-sent" };
  let ref: string;
  let numbered: OutboxRecord;
  try {
    ({ ref, record: numbered } = takeOfflineRef(record));
  } catch {
    return { ok: false, reason: "number" };
  }
  const { idemKey: _key, ...body } = req.body;
  void _key;
  const { plan: planned, tableNo } = offlineRoundPlan({ key: req.key, ref, at: req.at, base, body, earlierRounds: offlineRoundsOf(record, local) }, req.print ? req : { ...req, hereIds: [], simple: NO_SIMPLE });
  if (planned.length > OFFLINE_LINES_MAX) return { ok: false, reason: "too-many-lines" };
  const entry: OutboxEntry = {
    key: req.key,
    ref,
    at: req.at,
    kind: base === null ? "create" : "round",
    sale: req.sale,
    uncertain: req.uncertain === true,
    local,
    orderId: base === null ? null : madeOffline ? (siblings.find((e) => e.orderId !== null)?.orderId ?? null) : base._id,
    table: tableNo ?? "",
    body,
    shownTotal: req.shownTotal,
    lines: planned.map((line) => ({ printerId: line.printerId, part: line.part, outcome: line.here ? "maybe" : "later" })),
    state: "waiting",
  };
  const added = addEntry(numbered, entry);
  if (!added.ok) return { ok: false, reason: added.reason };
  return { ok: true, record: added.record, entry, plan: planned };
}

function namesOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The toast (spec 5.5–5.6's words). */
export function offlineKeptMessage(input: { ref: string; sale: boolean; plan: readonly OfflineLinePlan[]; print: boolean; nameOf: (printerId: string | null) => string }): string {
  const { ref, plan } = input;
  if (!input.print) return `Round ${ref} is kept on this device. It is sent with its order.`;
  if (plan.length === 0) return `Offline: order ${ref} is kept on this device. It is sent when the internet is back.`;
  if (!plan.some((line) => line.here)) {
    return input.sale
      ? `Offline: order ${ref} is kept on this device. The sale is saved and its KOT and bill print when the internet is back.`
      : `Offline: order ${ref} is kept on this device. It prints when the internet is back.`;
  }
  const waiting = [...new Set(plan.filter((line) => !line.here).map((line) => input.nameOf(line.printerId)))];
  const later = waiting.length === 0 ? "" : ` ${namesOf(waiting)} ${waiting.length === 1 ? "prints" : "print"} when the internet is back.`;
  if (input.sale) return `Offline: KOT ${ref} printed. The sale is saved and its bill prints when the internet is back.${later}`;
  return `Offline: KOT ${ref} printed here.${later === "" ? " It is sent when the internet is back." : later}`;
}

/** The review's I3: after the paper, the here lines that did not print (nothing sent, or maybe), named; null when every
 *  one printed. Either way the server prints them when the internet is back (a maybe one labelled REPRINT). */
export function offlineMissedMessage(ref: string, plan: readonly OfflineLinePlan[], outcomes: ReadonlyMap<number, OfflineSlipOutcome>, nameOf: (printerId: string | null) => string): string | null {
  const missed = [...new Set(plan.flatMap((line, index) => (line.here && outcomes.get(index) !== "printed" ? [nameOf(line.printerId)] : [])))];
  if (missed.length === 0) return null;
  return `Offline: KOT ${ref} did not print on ${namesOf(missed)}. It prints there when the internet is back.`;
}

/** Prints each here line's copies one after another (spec 5.3: each copy a write). A first copy that sent nothing is
 *  "no" (the line waits for the server); a later copy that failed may have put paper out: "maybe". */
export async function printOfflineLines(plan: readonly OfflineLinePlan[], printCopy: (index: number) => Promise<OfflineSlipOutcome>): Promise<Map<number, OfflineSlipOutcome>> {
  const outcomes = new Map<number, OfflineSlipOutcome>();
  for (const [index, line] of plan.entries()) {
    if (!line.here) continue;
    let outcome: OfflineSlipOutcome = "printed";
    for (let copy = 1; copy <= Math.max(1, line.copies); copy++) {
      const result = await printCopy(index);
      if (result === "printed") continue;
      outcome = copy === 1 ? result : "maybe";
      break;
    }
    outcomes.set(index, outcome);
  }
  return outcomes;
}
