// TYPE-ONLY: this module is imported by "use client" components, and a VALUE
// import of mongoose here pulls the driver into the client bundle (the
// client-graph guard fails on exactly that edge). `import type` erases at
// compile time, so the ObjectId shape stays available to the types below
// without any runtime import.
import type { Types } from "mongoose";
import { kotLineRef, orderItemLabel } from "@pos/shared/utils";
import { SELF_ORDER_SOURCE } from "@pos/shared/public";

// P4-A — pure board-builder for the kitchen line view. NO DB, NO React, NO
// fetch: the route calls this with plain data it already fetched, and the
// tests call it with fixtures. Keeping this pure is what makes the collision
// + partial-void-survival behaviour unit-testable without a live mongod.

// The stored-line shape this needs — mirrors order-void.ts's VoidableLine
// idiom: a lean Mongoose doc's productId may come back as a string or an
// ObjectId, so this stays widened and callers stringify at the point of use.
export interface FiredItem {
  productId: string | Types.ObjectId;
  name: string;
  qty: number;
  variation?: string;
  modifiers?: string[];
  instructions?: string;
  kotRound: number; // 0 = not yet fired / legacy — filtered out below
}

// The subset of an Order the board needs — deliberately narrow (matches the
// route's own `.select(...)`), so a caller cannot accidentally depend on a
// field this slice never asked for.
export interface KitchenOrderInput {
  _id: string | Types.ObjectId;
  // The HUMAN order number ("ORD-…") printed on the slip the kitchen is
  // holding. Distinct from `_id` (the hex key every tick is addressed by) —
  // the board shows this one and mutates with the other.
  orderId: string;
  items: FiredItem[];
  kotNumbers?: number[];
  kotFiredAt?: Date[];
  tableNo?: string;
  // P4-B — a takeaway order. A cook PACKS it instead of plating it, so the
  // board must say so outright; a missing tableNo cannot carry that meaning,
  // since a dine-in walk-in has no table either.
  parcel?: boolean;
  source?: string;
  createdAt: Date;
}

export interface KitchenRow {
  // The Mongo hex `_id` — what POST /api/kitchen and KotTick._id are keyed
  // on. NOT what a human reads; see `orderNo`.
  orderId: string;
  // The printed order number ("ORD-…"), so a cook can match a board line to
  // the paper ticket in hand. Ticket numbering is OPTIONAL per cafe
  // (printCfg.kot.showNumber), so `ticketNumber` alone cannot be the only
  // reference a row carries.
  orderNo: string;
  id: string; // `${orderId}:${ref}`
  ref: string;
  name: string;
  variation?: string;
  qty: number;
  modifiers: string[];
  instructions?: string;
  round: number;
  ticketNumber?: number;
  tableLabel: string;
  selfOrder: boolean;
  // ISO STRING, not a Date. This row crosses the wire: the route JSON-encodes
  // it and `apiGet`'s `unwrap` does a plain `res.json()` with no reviver, so a
  // `Date` here would arrive at the client as a string while the type still
  // claimed `Date` — `tsc` stays green (the generic is an unchecked assertion
  // over parsed JSON) and every row then throws `getTime is not a function` at
  // render. Every other client-facing date in @pos/shared/types is a string for
  // exactly this reason; renderers wrap with `new Date(...)` at the use site.
  firedAt: string;
  firedAtApprox: boolean;
  // P4-B — ticked lines now STAY on the board (they used to be dropped here),
  // so a card can show "2/5 done" and keep its Ready button. The card, not the
  // line, is what leaves — see lib/kitchen-cards.ts.
  done: boolean;
}

export interface KitchenAgeBand {
  key: "fresh" | "warn" | "late";
  icon: "none" | "Clock" | "AlertTriangle";
  label: string;
}

// Age thresholds — a cook's wall display reads these as colour AND icon AND
// text, never colour alone (cafe.md UI rule: curated pairs need contrast +
// non-empty guards; here the guard is "every band carries a label").
export const KITCHEN_AGE_WARN_MIN = 10;
export const KITCHEN_AGE_LATE_MIN = 20;
// A hard cap on rows returned to the client — this is a wall display, not a
// paginated list; 200 rows is far beyond what OPEN_TAB_LIMIT (100 tabs, each
// contributing at most a handful of fired lines) can plausibly produce, so
// the cap only guards against a pathological fixture/bug, not real service.
export const KITCHEN_ROW_LIMIT = 200;
// How stale the board's own snapshot may read before the freshness chip
// (a separate, UI-owned repaint clock — see KITCHEN_FRESHNESS_TICK_MS in
// @pos/shared/query) calls it "Stale".
export const KITCHEN_STALE_MS = 60_000;

const MINUTE_MS = 60_000;

// Colour + icon + TEXT for a line's age, given its fire time. Boundaries are
// `>=`: a line at exactly 10:00 is "warn", not "fresh".
// `firedAt` is the row's ISO string (see KitchenRow.firedAt) — parsed here at
// the use site, the same way every other renderer in this app wraps a
// client-facing date.
export function kitchenAgeBand(firedAt: string, now: Date): KitchenAgeBand {
  const ageMin = (now.getTime() - new Date(firedAt).getTime()) / MINUTE_MS;
  if (ageMin >= KITCHEN_AGE_LATE_MIN) {
    return { key: "late", icon: "AlertTriangle", label: "Late" };
  }
  if (ageMin >= KITCHEN_AGE_WARN_MIN) {
    return { key: "warn", icon: "Clock", label: "Waiting" };
  }
  return { key: "fresh", icon: "none", label: "Fresh" };
}

interface BuildKitchenRowsInput {
  orders: KitchenOrderInput[];
  /** Apply KITCHEN_ROW_LIMIT. See the parameter's comment — the card view opts
   *  out so a card can never carry a truncated, wrong `totalCount`. */
  capRows?: boolean;
  ticksByOrder: Record<string, string[]>; // orderId -> done refs
  // Kept on the input (callers pass a server clock) even though the builder
  // itself needs no clock: ageing is derived at RENDER from the row's
  // firedAt, so a row is not stale the moment it is built. Leaving the
  // field here keeps the injectable-clock seam for any future
  // server-derived age band without changing every call site.
  now?: Date;
}

// One row per (order, kotLineRef) — collapsing rows that collide on the same
// ref (same product+round+instructions+modifier-set+variation) into ONE row
// with the summed qty, because those rows are interchangeable by construction
// (utils.ts's own orderLineKey comment says so) and a cook must see "3 x
// Masala Chai", not three separate un-ticked rows for the same dish.
export function buildKitchenRows({
  orders,
  ticksByOrder,
  // P4-B — the CARD view passes false. A flat list can be cut anywhere without
  // lying, but cutting a card's lines mid-order would leave that card showing
  // "2/3 done" for an order that actually fired more food than the card admits.
  // The card builder bounds itself by CARDS instead, which can never split an
  // order. Defaults true so the shipped line-list behaviour is unchanged.
  capRows = true,
}: BuildKitchenRowsInput): KitchenRow[] {
  const rows: KitchenRow[] = [];

  for (const order of orders) {
    const orderId = String(order._id);
    const doneRefs = new Set(ticksByOrder[orderId] ?? []);
    // ref -> row, so later items on the same order collapse into the first
    // row's identity (name/variation/modifiers/instructions kept from it).
    const byRef = new Map<string, KitchenRow>();

    for (const item of order.items) {
      if (!item.kotRound || item.kotRound < 1) continue; // unfired / legacy

      const ref = kotLineRef({
        productId: String(item.productId),
        kotRound: item.kotRound,
        instructions: item.instructions,
        modifiers: item.modifiers,
        variation: item.variation,
      });
      // P4-B — NOT dropped any more. `done` is a property of the REF, so the
      // collapse below (which sums qty onto the first row for that ref) carries
      // the right flag by construction: every item sharing a ref shares its
      // tick state.
      const done = doneRefs.has(ref);

      const existing = byRef.get(ref);
      if (existing) {
        existing.qty += item.qty;
        continue;
      }

      const round = item.kotRound;
      const stamped = order.kotFiredAt?.[round - 1];
      const firedAt = stamped ?? order.createdAt;

      byRef.set(ref, {
        orderId,
        orderNo: order.orderId,
        id: `${orderId}:${ref}`,
        ref,
        name: orderItemLabel(item),
        variation: item.variation,
        qty: item.qty,
        modifiers: [...(item.modifiers ?? [])],
        instructions: item.instructions || undefined,
        round,
        ticketNumber: order.kotNumbers?.[round - 1],
        tableLabel: order.tableNo ?? "Walk-In",
        selfOrder: order.source === SELF_ORDER_SOURCE,
        firedAt: firedAt.toISOString(),
        firedAtApprox: stamped === undefined,
        done,
      });
    }

    rows.push(...byRef.values());
  }

  // Oldest fired line first; ties broken by orderId then ref so the render
  // order is deterministic across otherwise-identical fire times.
  rows.sort((a, b) => {
    // `firedAt` is an ISO-8601 UTC string (always `toISOString()`, fixed width,
    // always `Z`), so a lexicographic compare IS the chronological compare —
    // no Date round-trip needed on a list this hot.
    const byAge = a.firedAt.localeCompare(b.firedAt);
    if (byAge !== 0) return byAge;
    const byOrder = a.orderId.localeCompare(b.orderId);
    if (byOrder !== 0) return byOrder;
    return a.ref.localeCompare(b.ref);
  });

  return capRows ? rows.slice(0, KITCHEN_ROW_LIMIT) : rows;
}
