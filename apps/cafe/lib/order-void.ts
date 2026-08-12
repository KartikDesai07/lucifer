import { orderLineKey } from "@pos/shared/utils";
import { computeOrderTotals, type GstConfig, type OrderTotals } from "@/lib/receipt";
import type { IOrderVoid } from "@/models/Order";

// Item-level void on an open tab (CR1.3), as one pure function — the route stays a
// thin orchestrator (auth, the conditional write, the print signal), exactly like
// resolveSettleMoney does for settlement. Everything here is decidable from the
// order's OWN stored state, so it is unit-testable without a DB.
//
// A void is only ever needed for a line the kitchen has already been told to make:
// unfired cart lines live client-side and are simply removed there. So this always
// reduces or removes a line that exists in the order's stored items[], recomputes
// the bill from what REMAINS (using the tab's GST snapshot, never live settings),
// and returns the trail entry to append.

// The stored-line shape this needs. Generic over the caller's row type so a lean
// Mongoose doc goes in and the SAME shape comes back out in `nextItems` — the route
// writes those rows straight back, modifiers/instructions intact.
export interface VoidableLine {
  productId: string;
  name: string;
  price: number;
  qty: number;
  kotRound?: number;
  instructions?: string;
  modifiers?: string[];
}

export interface ItemVoidRequest {
  index: number; // position in the order's stored items[] (embedded rows carry no _id)
  lineKey: string; // orderLineKey echo of the line the operator was looking at
  qty: number; // how many to void OFF the line (== line.qty voids the whole line)
  reason: string;
  voidedBy: string; // resolved from the session by the route, never the client
  at: Date;
}

// A tab must always keep at least one line, so the LAST remaining line cannot be
// voided — that is a cancellation, which is an admin action with its own route.
// Exported so the dialog can disable the option up front instead of letting the
// cashier discover it through a rejection they have no way to act on.
export function isLastLine(items: ReadonlyArray<{ qty: number }>, index: number, qty: number) {
  return items.length === 1 && index === 0 && qty >= (items[0]?.qty ?? 0);
}

export interface ItemVoidInput<T extends VoidableLine> {
  items: readonly T[];
  request: ItemVoidRequest;
  discount: number; // the tab's current order-level discount (re-clamped on recompute)
  gstCfg: GstConfig; // the TAB's snapshot config, from gstConfigFromOrder
}

export type ItemVoidResolution<T> =
  | { nextItems: T[]; totals: OrderTotals; entry: IOrderVoid }
  | { error: string; status: 400 | 409 };

// Lines on an open tab are always stamped with the round that fired them (POST
// /api/orders stamps 1, /items stamps the next). A 0 here means a legacy/never-sent
// row, which must not be voidable — there is no kitchen ticket to cancel.
const MIN_FIRED_ROUND = 1;

// The compare-and-set term that serializes two concurrent voids on the same tab.
// The /items route can guard on `kotRounds` because firing a round bumps it; a void
// bumps nothing, and a qty-reduce need not even change the item COUNT — so the
// trail's own length is the only reliable discriminator: whoever writes first makes
// the other's `$size` miss, and the loser 409s instead of clobbering the write.
// `voids` is ABSENT (not `[]`) until the first `$push`, so a first void has to
// accept both shapes — `{$size: 0}` alone would never match a missing field.
// Exported so the route and the live-leg verifier guard on the SAME filter.
export function voidGuardFilter(voidCount: number): Record<string, unknown> {
  return voidCount === 0
    ? { $or: [{ voids: { $exists: false } }, { voids: { $size: 0 } }] }
    : { voids: { $size: voidCount } };
}

export function resolveItemVoid<T extends VoidableLine>(
  input: ItemVoidInput<T>,
): ItemVoidResolution<T> {
  const { items, request } = input;
  const line = items[request.index];

  // Index out of range, or the line at that position is not the one the operator was
  // looking at: their view of the tab is stale (another device fired a round, or
  // voided a line and shifted everything after it down). Compared on the WHOLE line
  // identity, not just the product — two covers of the same dish are different lines,
  // and a product-only echo let a shifted index void the wrong one. 409, not 400:
  // nothing is wrong with the request, it just no longer describes this tab.
  if (!line || orderLineKey(line) !== request.lineKey) {
    return { error: "Tab changed — reopen it and try again", status: 409 };
  }
  if ((line.kotRound ?? 0) < MIN_FIRED_ROUND) {
    return {
      error: "That item hasn't been sent to the kitchen — remove it from the cart instead",
      status: 400,
    };
  }
  if (request.qty > line.qty) {
    return { error: "Cannot void more than the quantity on that line", status: 400 };
  }

  const nextItems =
    request.qty === line.qty
      ? items.filter((_, i) => i !== request.index)
      : items.map((it, i) =>
          i === request.index ? { ...it, qty: it.qty - request.qty } : it,
        );

  // An order must always have at least one line (the model requires items, and the
  // create schema a non-empty array), so emptying a tab this way is not a void —
  // it's a cancellation. The message names who can do it, because cancelling is
  // admin-only: telling a cashier to "cancel the order instead" pointed them at an
  // action they cannot perform, with no way forward (CR1.3 review).
  if (nextItems.length === 0) {
    return {
      error: "A tab must keep at least one item — ask an admin to cancel the order",
      status: 400,
    };
  }

  return {
    nextItems,
    // Recompute from what REMAINS using the tab's own GST snapshot; computeOrderTotals
    // re-clamps the order-level discount to the smaller subtotal, so a discount that
    // now exceeds the bill can't drive the total negative.
    totals: computeOrderTotals(nextItems, input.discount, input.gstCfg),
    // Snapshot what left the bill — readable forever, even though `line` itself is
    // now reduced or gone. `qty` is the quantity VOIDED, not what remains. The
    // preparation fields ride along (omitted when empty, per the omit-empty storage
    // discipline) because the kitchen's slip has to identify WHICH cover to stop.
    entry: {
      productId: line.productId,
      name: line.name,
      price: line.price,
      qty: request.qty,
      kotRound: line.kotRound ?? 0,
      ...(line.instructions ? { instructions: line.instructions } : {}),
      ...(line.modifiers?.length ? { modifiers: [...line.modifiers] } : {}),
      reason: request.reason,
      voidedBy: request.voidedBy,
      at: request.at,
    },
  };
}
