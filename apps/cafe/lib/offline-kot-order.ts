import { offlineBannerOf } from "@pos/shared/offline-kot";
import { stampKitchenFlags, type ProductKitchenFacts } from "@/lib/kitchen-lines";
import { kotRoundSlip, type HostKotSlip } from "@/lib/print-host-slips";
import type { CreateOrderInput, Order, OrderItem } from "@/types";

// Printing Phase 5 (spec 2026-11-03 §5.4): the KOT of a round taken while the server cannot be reached, made on the
// device from the cart. It is the order the server would make of the same send (the lines stamped by the server's own
// pure stamp, the round numbered as the server numbers it), so it prints as today's KOT and routes as the server
// routes it (lib/offline-lines.ts). It lacks only what the server alone gives: an order number of its own, KOT
// numbers and a token. PURE: Session 5B's send path calls it.

/** The local id of an order or round the server has not saved yet: `offline-<key>`. */
const OFFLINE_ID_PREFIX = "offline-";

/** An order made offline that the server has not saved yet (its id is the device's own). */
export const isOfflineOrderId = (id: string): boolean => id.startsWith(OFFLINE_ID_PREFIX);
const FIRST_ROUND = 1;

/** A new order before the server prices it. The KOT prints none of these; the outbox entry keeps the total the device
 *  showed (spec §5.2). */
const UNPRICED_NEW_ORDER: Pick<Order, "subtotal" | "discount" | "total" | "paidAmount" | "payment" | "status" | "receiver"> = {
  subtotal: 0,
  discount: 0,
  total: 0,
  paidAmount: 0,
  payment: "Unpaid",
  status: "Pending",
  receiver: "",
};

/** The round this send fires: 1 for a new order; on a tab, its rounds, then the rounds of it still waiting on this
 *  device, then this one (the server numbers the replayed rounds the same way, oldest first). */
export function offlineRoundOf(base: Order | null, earlierOfflineRounds: number): number {
  return base === null ? FIRST_ROUND : base.kotRounds + earlierOfflineRounds + 1;
}

export interface OfflineKotBody {
  customerName: string;
  tableNo?: string;
  receiver?: string;
  notes?: string;
  items: CreateOrderInput["items"];
}

/** The server's numbers never ride an offline KOT: its tickets and token are drawn when it saves the round. */
function withoutServerNumbers(order: Order): Order {
  const copy = { ...order };
  delete copy.kotNumbers;
  delete copy.tokenNumber;
  return copy;
}

export function offlineKotOrder(input: {
  key: string;
  ref: string;
  round: number;
  nowIso: string;
  base: Order | null;
  body: OfflineKotBody;
  products: ReadonlyMap<string, ProductKitchenFacts>;
  skipCategoryIds: ReadonlySet<string>;
  categoryRanks: ReadonlyMap<string, number>;
}): Order {
  const { base, body } = input;
  // optimisticOrder's mapping (hooks/use-orders.ts): each cart line as sent, fired in this round.
  const fired: OrderItem[] = body.items.map((it) => ({ ...it, kotRound: input.round }));
  // As the server stamps a send: only the new lines (app/api/orders/[id]/items/route.ts stamps the new slice), so the
  // tab's lines keep the stamps the server gave them.
  const { lines } = stampKitchenFlags(fired, input.products, input.skipCategoryIds, input.categoryRanks);
  // A round keeps its order's own number: a tab the server already has its server number (the kitchen holds its first
  // KOT under it, spec §5.4), an order made offline its create's O-n (the owner's ruling 13 (b), 2026-11-04: the banner
  // keeps the round's own O-n). A new order reads this round's offline number.
  return withoutServerNumbers({
    ...(base ?? UNPRICED_NEW_ORDER),
    _id: `${OFFLINE_ID_PREFIX}${input.key}`,
    orderId: base !== null ? base.orderId : input.ref,
    customerName: body.customerName,
    ...(body.tableNo !== undefined ? { tableNo: body.tableNo } : {}),
    ...(body.receiver !== undefined ? { receiver: body.receiver } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
    items: [...(base?.items ?? []), ...lines],
    kotRounds: input.round,
    // Every KOT prints the order's createdAt as its Time: a new order is taken now; a round keeps its tab's open time,
    // exactly as an online round's KOT prints it.
    createdAt: base?.createdAt ?? input.nowIso,
    updatedAt: input.nowIso,
  });
}

/** The paper (spec §5.4, P5-5): today's round KOT with the inverted banner "OFFLINE · O-3". No number box: it needs a
 *  server number, and every renderer leaves it out when there is none. */
export function offlineKotSlip(order: Order, round: number, ref: string): HostKotSlip {
  const slip: HostKotSlip = { ...kotRoundSlip(order, round), banner: offlineBannerOf(ref) };
  delete slip.kotRoundNumber;
  return slip;
}
