// Kitchen cards for the header's tests (U4 Task 2): a card fired `ageMin` minutes before the HTML's fixed clock (the
// Kitchen values 0.1: Monday 19 October 2026, 9:30 PM IST), with only what the header and the filter read set on purpose.
import type { KitchenOrderCard } from "./kitchen-cards";

export const KITCHEN_NOW = Date.parse("2026-10-19T21:30:00+05:30");
const MIN = 60_000;
let seq = 0;

export function kitchenCard(tableLabel: string, ageMin: number, extra: Partial<KitchenOrderCard> = {}): KitchenOrderCard {
  const firedAt = new Date(KITCHEN_NOW - ageMin * MIN).toISOString();
  seq += 1;
  return {
    orderId: `order-${seq}`,
    orderNo: `ORD-20261019-${String(seq).padStart(3, "0")}`,
    tableLabel,
    parcel: false,
    selfOrder: false,
    ticketNumbers: [],
    lines: [],
    doneCount: 0,
    totalCount: 1,
    allDone: false,
    cardFiredAt: firedAt,
    cardFiredAtApprox: false,
    newestFiredAt: firedAt,
    ...extra,
  };
}
