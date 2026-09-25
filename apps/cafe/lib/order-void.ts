import { Types } from "mongoose";
import { orderLineKey } from "@pos/shared/utils";
import { computeOrderTotals, type GstConfig, type OrderTotals } from "@/lib/receipt";
import type { DiscountKind } from "@/lib/constants";
import type { RedeemedReward } from "@pos/shared/reward-redemption";
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
  // CB-DL-2: Order.items[].productId is now a stored ObjectId, but a lean
  // Mongoose doc and a plain test fixture can both flow through here — widened
  // to accept either, never behaviour-changing (orderLineKey/IOrderVoid still
  // want a definite type, so callers below stringify/cast at the point of use).
  productId: string | Types.ObjectId;
  name: string;
  price: number;
  qty: number;
  kotRound?: number;
  instructions?: string;
  modifiers?: string[];
  variation?: string;
  // CB-5B S14 — the voided line was a loyalty reward (a free dish claimed off
  // the stamp ladder). `price` above still carries the dish's REAL value (same
  // snapshot discipline as every other field here); this flag is the only way
  // the void trail can say the line was comped rather than sold.
  reward?: boolean;
}

export interface ItemVoidRequest {
  index: number; // position in the order's stored items[] (embedded rows carry no _id)
  lineKey: string; // orderLineKey echo of the line the operator was looking at
  qty: number; // how many to void OFF the line (== line.qty voids the whole line)
  reason: string;
  voidedBy: string; // resolved from the session by the route, never the client
  at: Date;
}

// Lives in lib/order-void-rules.ts (client-safe — no mongoose). Re-exported so
// existing server-side importers keep working; CLIENT components must import it
// from the rules module directly, or they pull this file's `mongoose` value
// import into the browser bundle.
export { isLastLine } from "@/lib/order-void-rules";

export interface ItemVoidInput<T extends VoidableLine> {
  items: readonly T[];
  request: ItemVoidRequest;
  discount: number; // the tab's current order-level discount (re-clamped on recompute)
  discountKind: DiscountKind | undefined; // the tab's stored kind, carried through — a GST preset must shrink with the bill
  // CB-5B — the reward the tab is carrying, rebuilt from its OWN stored
  // snapshot. REQUIRED (not optional) for the same reason `charge` above is:
  // every writer that re-prices a bill must state out loud what happens to it,
  // and the type checker is the guard. Omitting it would be silent and costly —
  // `discountKind` can be "reward" here, and rewardDiscountAmount fails CLOSED
  // at 0 for a missing reward, so a void would quietly strip a discount the
  // diner already spent stamps on while the snapshot still claimed it.
  reward: RedeemedReward | undefined;
  charge: number; // the tab's snapshotted TABLE charge only — carried, never re-derived
  // CB-CHG — the tab's snapshotted EXTRA charges' total, carried through
  // unchanged (a void never touches charges, table or extra). Kept SEPARATE
  // from `charge` above for the same reason computeOrderTotals splits them:
  // the table charge stays clamped at TABLE_CHARGE_MAX, extras ride on top
  // uncapped (decision 8) — summing them first would risk silently capping a
  // legitimate bill. OPTIONAL (unlike `charge`), defaulting to 0: every caller
  // that predates extras has none to carry, and the omission fails SAFE
  // (no extra added) rather than forcing an unrelated-widening edit onto
  // every existing call site.
  extraCharge?: number;
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
  if (!line || orderLineKey({ ...line, productId: String(line.productId) }) !== request.lineKey) {
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
    // now exceeds the bill can't drive the total negative. The table charge rides
    // through unchanged — voiding a dish does not un-seat the customer.
    totals: computeOrderTotals({
      items: nextItems,
      discount: input.discount,
      discountKind: input.discountKind,
      reward: input.reward,
      charge: input.charge,
      extraCharge: input.extraCharge,
      cfg: input.gstCfg,
    }),
    // Snapshot what left the bill — readable forever, even though `line` itself is
    // now reduced or gone. `qty` is the quantity VOIDED, not what remains. The
    // preparation fields ride along (omitted when empty, per the omit-empty storage
    // discipline) because the kitchen's slip has to identify WHICH cover to stop —
    // `variation` joins them for the same reason: a tab holding a Small and a Large
    // of the same dish needs the void slip to say WHICH size to stop making.
    entry: {
      // The order's OWN stored productId value, carried straight through
      // (never re-derived) — cast to satisfy IOrderVoid's ObjectId type,
      // since a caller's T may still carry it as a plain (already-valid) hex
      // string; Mongoose would cast it anyway on save.
      productId: new Types.ObjectId(String(line.productId)),
      name: line.name,
      price: line.price,
      qty: request.qty,
      kotRound: line.kotRound ?? 0,
      ...(line.instructions ? { instructions: line.instructions } : {}),
      ...(line.modifiers?.length ? { modifiers: [...line.modifiers] } : {}),
      ...(line.variation ? { variation: line.variation } : {}),
      // "synthesized print lines need every new field" — IOrderVoid.reward was
      // declared and schema-backed (models/Order.ts:67) but never WRITTEN, so a
      // voided reward line could not tell the kitchen or the trail-reader what
      // it was. Normalised to a literal `true` (never the field's own truthy
      // value) because the stored model field is boolean, not just truthy.
      ...(line.reward ? { reward: true } : {}),
      reason: request.reason,
      voidedBy: request.voidedBy,
      at: request.at,
    },
  };
}
