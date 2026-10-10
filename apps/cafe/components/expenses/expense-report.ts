// Pure figures for the Expenses report page: a category's share of the total
// and the "Sales − expenses" guide. Money is integer PAISE except the Sales
// report's own figure, which arrives in whole rupees and is converted once.
import { rupeesToPaise } from "@pos/shared/codec";

const PERCENT = 100;
const SHARE_DECIMALS = 10; // one decimal place for the bar, whole numbers for the label

/** 0..100 with one decimal — the width of a category's bar. */
export function sharePercent(partPaise: number, totalPaise: number): number {
  if (totalPaise <= 0 || partPaise <= 0) return 0;
  return Math.min(PERCENT, Math.round((partPaise / totalPaise) * PERCENT * SHARE_DECIMALS) / SHARE_DECIMALS);
}

/** "42%" — and "<1%" for something small but not nothing. */
export function shareLabel(partPaise: number, totalPaise: number): string {
  const percent = sharePercent(partPaise, totalPaise);
  if (percent === 0) return "0%";
  return percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}

/** The Sales report's rupee figure minus the expenses, in paise (negative when more was spent than sold). */
export function salesMinusExpensesPaise(salesRupees: number, expensePaise: number): number {
  return rupeesToPaise(salesRupees) - expensePaise;
}
