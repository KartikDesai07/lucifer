import { maskMobile } from "@pos/shared/utils";
import type {
  IOrderRequest,
  IOrderRequestItem,
  OrderRequestStatus,
  OrderRequestTargetKind,
} from "@/models/OrderRequest";
import { canSeeFullMobile } from "@/lib/customer-privacy";

// CR2.2 SLICE 6 — the staff-facing OrderRequest projection, shared by all
// three app/api/order-requests/** routes (list, accept, reject) so the tray
// shape lives in exactly ONE place. Never carries acceptedOrderNo — removed
// from the model entirely (see order-request-accept-core.ts's finalizeAccept
// comment): orderId is the repo's only order identity.

export interface TrayRequest {
  id: string;
  shortCode: string;
  status: OrderRequestStatus;
  targetKind: OrderRequestTargetKind;
  tableNo?: string;
  items: IOrderRequestItem[];
  quotedSubtotal: number;
  quotedCharge: number;
  quotedChargeLabel?: string;
  quotedTotal: number;
  promoCode?: string;
  quotedDiscount?: number;
  note?: string;
  name: string;
  mobile: string;
  createdAt: Date;
  rejectedReason?: string;
  actor?: string;
  acceptedOrderId?: string;
}

// Structural input, not IOrderRequest itself: satisfied equally by a .lean()
// list row (the GET route) and a full Mongoose document (accept/reject hand
// one back) — only the fields the tray actually shows are named, `_id` widened
// since a lean row's is a plain ObjectId and a document's is Document's own.
type TrayRequestSource = Pick<
  IOrderRequest,
  | "shortCode"
  | "status"
  | "targetKind"
  | "tableNo"
  | "items"
  | "quotedSubtotal"
  | "quotedCharge"
  | "quotedChargeLabel"
  | "quotedTotal"
  | "promoCode"
  | "quotedDiscount"
  | "note"
  | "name"
  | "mobile"
  | "createdAt"
  | "rejectedReason"
  | "actor"
  | "acceptedOrderId"
> & { _id: unknown };

// A fresh literal, never the source doc echoed back — mirrors
// lib/customer-privacy.ts's maskCustomer discipline: the diner's mobile
// number is customer PII, so only an admin sees it in full here; staff get
// the same masked form the customer list already shows them.
export function toTrayRequest(
  doc: TrayRequestSource,
  role: string | undefined,
): TrayRequest {
  return {
    id: String(doc._id),
    shortCode: doc.shortCode,
    status: doc.status,
    targetKind: doc.targetKind,
    tableNo: doc.tableNo,
    items: doc.items,
    quotedSubtotal: doc.quotedSubtotal,
    quotedCharge: doc.quotedCharge,
    quotedChargeLabel: doc.quotedChargeLabel,
    quotedTotal: doc.quotedTotal,
    promoCode: doc.promoCode,
    quotedDiscount: doc.quotedDiscount,
    note: doc.note,
    name: doc.name,
    // CR2.2 fix round — defensive `?? ""`: finalizeAccept's own synthesized
    // fallback (order-request-accept-core.ts, used when a resolved request
    // row was pruned mid-flight) is cast past the type system, so a future
    // gap there must not make maskMobile throw on an undefined input.
    mobile: canSeeFullMobile(role) ? doc.mobile : maskMobile(doc.mobile ?? ""),
    createdAt: doc.createdAt,
    rejectedReason: doc.rejectedReason,
    actor: doc.actor,
    acceptedOrderId: doc.acceptedOrderId,
  };
}

// Every response under /api/order-requests is live state (a diner may be
// waiting on this exact answer) — never cached, same discipline as orders.
// Mutates + returns the SAME response object, mirroring
// app/api/public/table/[token]/route.ts's noStore helper.
export function noStore<T extends { headers: Headers }>(res: T): T {
  res.headers.set("Cache-Control", "no-store");
  return res;
}
