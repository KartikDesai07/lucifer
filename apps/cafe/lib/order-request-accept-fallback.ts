import type { IOrder } from "@/models/Order";
import type { IOrderRequest } from "@/models/OrderRequest";

// CR2.3 §20 mechanical split — order-request-accept-core.ts crossed the
// ~300-line budget after the D9 acceptedKotRound stamp landed, so this ONE
// self-contained builder moved out verbatim (zero behavior change). It stays
// a fourth+ sibling of order-request-accept.ts/-write.ts/-promo.ts; core.ts's
// finalizeAccept is still the only caller and imports it back in.

// `acceptedOrderId` carries the "ORD-YYYYMMDD-NNN" `orderId` string — the
// repo's ONLY order identity (every cross-reference, Table.currentOrderId
// included, uses it); there is no separate numeric order number to record.
// CR2.2 fix round — pure builder for finalizeAccept's synthesized-request
// fallback (used when the resolved row was pruned mid-flight), split out so
// it's directly unit-testable without a DB, mirroring this file's own PURE/
// async split. Carries every field toTrayRequest (lib/order-request-tray.ts)
// reads, never leaving one undefined; quoted totals/targetKind/tableNo are
// derived from the ORDER itself (the only truth left once the request row is
// gone).
export function buildFallbackRequest(
  order: IOrder,
  requestId: string,
  actor: string,
  now: Date,
): IOrderRequest {
  return {
    _id: requestId,
    shortCode: "",
    status: "accepted",
    targetKind: order.tableNo ? "table" : "parcel",
    ...(order.tableNo ? { tableNo: order.tableNo } : {}),
    items: [],
    quotedSubtotal: order.subtotal,
    quotedCharge: order.chargeAmount ?? 0,
    ...(order.chargeLabel ? { quotedChargeLabel: order.chargeLabel } : {}),
    quotedTotal: order.total,
    note: undefined,
    mobile: "",
    name: "",
    acceptedOrderId: order.orderId,
    acceptedAt: now,
    actor,
    createdAt: now,
    updatedAt: now,
  } as unknown as IOrderRequest;
}
