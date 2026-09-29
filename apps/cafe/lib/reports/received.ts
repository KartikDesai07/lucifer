import type { SettlementPayMode } from "@/lib/constants";
import type { ReceivedSplit } from "@/types/reports";

// Where a bill's money went the moment it was settled (the Batch-1 plan's
// money rule, restated exactly): paid = paidAmount ?? 0.
//   Cash   -> cash = paid
//   Online -> online = paid
//   Split  -> cash = splitCash ?? 0, online = splitOnline ?? 0, other = paid - cash - online
//   anything else (Due/Credit/Unpaid/legacy) -> other = paid
//   credit = total - paid (what the customer still owes on THIS bill)
// Identity, exact per bill and so per day and per range:
//   cash + online + other + credit === total
// Pure (no DB) — the twin below ($group-ready) computes the same numbers
// inside the sales-pipelines aggregate; the live leg proves they agree.
// Named, not positional (SETTLEMENT_PAY_MODES[n]) — a re-ordering of that
// tuple must never silently swap which mode this rule branches on.
const CASH_MODE: SettlementPayMode = "Cash";
const ONLINE_MODE: SettlementPayMode = "Online";
const SPLIT_MODE: SettlementPayMode = "Split";

export interface ReceivedOfOrder {
  payment?: string;
  total?: number;
  paidAmount?: number;
  splitCash?: number;
  splitOnline?: number;
}

export function receivedOf(order: ReceivedOfOrder): ReceivedSplit {
  const total = order.total ?? 0;
  const paid = order.paidAmount ?? 0;
  let cash = 0;
  let online = 0;
  let other = 0;

  if (order.payment === CASH_MODE) {
    cash = paid;
  } else if (order.payment === ONLINE_MODE) {
    online = paid;
  } else if (order.payment === SPLIT_MODE) {
    cash = order.splitCash ?? 0;
    online = order.splitOnline ?? 0;
    other = paid - cash - online;
  } else {
    other = paid;
  }

  return { cash, online, other, credit: total - paid };
}

// ── Mongo $group-ready expression twins (money-breakdown.ts's own idiom) ───
// Field-for-field the same branching as receivedOf, evaluated per un-unwound
// Order document with $ifNull standing in for the `?? 0` defaults above.
const PAID_EXPR = { $ifNull: ["$paidAmount", 0] };
const SPLIT_CASH_EXPR = { $ifNull: ["$splitCash", 0] };
const SPLIT_ONLINE_EXPR = { $ifNull: ["$splitOnline", 0] };

export const CASH_EXPR = {
  $switch: {
    branches: [
      { case: { $eq: ["$payment", CASH_MODE] }, then: PAID_EXPR },
      { case: { $eq: ["$payment", SPLIT_MODE] }, then: SPLIT_CASH_EXPR },
    ],
    default: 0,
  },
};

export const ONLINE_EXPR = {
  $switch: {
    branches: [
      { case: { $eq: ["$payment", ONLINE_MODE] }, then: PAID_EXPR },
      { case: { $eq: ["$payment", SPLIT_MODE] }, then: SPLIT_ONLINE_EXPR },
    ],
    default: 0,
  },
};

export const OTHER_EXPR = {
  $switch: {
    branches: [
      { case: { $eq: ["$payment", CASH_MODE] }, then: 0 },
      { case: { $eq: ["$payment", ONLINE_MODE] }, then: 0 },
      {
        case: { $eq: ["$payment", SPLIT_MODE] },
        then: { $subtract: [PAID_EXPR, { $add: [SPLIT_CASH_EXPR, SPLIT_ONLINE_EXPR] }] },
      },
    ],
    default: PAID_EXPR,
  },
};

export const CREDIT_EXPR = { $subtract: [{ $ifNull: ["$total", 0] }, PAID_EXPR] };
