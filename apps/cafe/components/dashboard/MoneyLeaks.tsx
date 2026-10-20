import Link from "next/link";
import { cn, inr } from "@/lib/utils";
import { STATUS_CLASSES } from "@/lib/ui";
import { plural } from "@/lib/dashboard/format";
import { DASH_PILL_CLASS } from "@/components/dashboard/DashCard";
import { DashGlyph } from "@/components/dashboard/DashGlyph";
import type { DashboardLeaks } from "@/types/dashboard";

// Where money did not come in: cancelled bills, dishes taken back off a tab, discounts and rewards — four separate
// lines, as the owner's HTML card (values 3.11): a 32px tile with the HTML's glyph, the label and its count, the amount
// lost. The head's pill adds the four up ("₹X lost", ruling R17), as the HTML's does.

interface LeakRow {
  key: string;
  /** The HTML's glyph (values 5): a 24x24 outline path. */
  glyph: string;
  label: string;
  detail: string;
  amount: number;
  href?: string;
}

export const MONEY_LEAK_ROWS = 4;
/** A row (values 3.11): 9px + the 34px label and count + 9px, over its 1px rule. */
export const LEAK_ROW_PX = 53;

// The HTML's glyphs (values 5): a circle with a diagonal slash, the undo arrow, the price tag with its hole, the gift box.
const GLYPH = {
  cancelled: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8",
  voids: "M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  discounts: "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01",
  rewards: "M20 12v9H4v-9M2 7h20v5H2zM12 21V7",
};

function rowsOf(leaks: DashboardLeaks): LeakRow[] {
  return [
    {
      key: "cancelled",
      glyph: GLYPH.cancelled,
      label: "Cancelled orders",
      detail: plural(leaks.cancelled.count, "order"),
      amount: leaks.cancelled.value,
      href: "/orders?status=Cancelled",
    },
    { key: "voids", glyph: GLYPH.voids, label: "Voided items", detail: plural(leaks.voids.qty, "item"), amount: leaks.voids.value },
    {
      key: "discounts",
      glyph: GLYPH.discounts,
      label: "Discounts given",
      detail: plural(leaks.discounts.orders, "order"),
      amount: leaks.discounts.amount,
    },
    { key: "rewards", glyph: GLYPH.rewards, label: "Rewards given", detail: plural(leaks.rewards.orders, "order"), amount: leaks.rewards.amount },
  ];
}

/** The head's pill (values 3.11): "₹X lost" in bad-t / bad-i, or "Nothing lost" in ok-t / ok-i. It sits in the head,
 *  outside the card's body, so it dims with the body while the next range loads (`updating`). */
export function MoneyLeaksTotal({ leaks, updating }: { leaks: DashboardLeaks; updating?: boolean }) {
  const total = rowsOf(leaks).reduce((sum, r) => sum + r.amount, 0);
  return (
    <span
      data-ui="leak-pill"
      className={cn(
        DASH_PILL_CLASS,
        "whitespace-nowrap transition-opacity duration-200",
        STATUS_CLASSES[total > 0 ? "bad" : "ok"].pill,
        updating && "opacity-55",
      )}
    >
      {total > 0 ? `${inr(total)} lost` : "Nothing lost"}
    </span>
  );
}

const ROW_CLASS = "flex items-center gap-3 border-t border-border-2 py-[9px]";

export function MoneyLeaks({ leaks }: { leaks: DashboardLeaks }) {
  return (
    <ul className="flex flex-col">
      {rowsOf(leaks).map((r) => {
        const lost = r.amount > 0;
        const body = (
          <>
            <span
              data-ui="leak-tile"
              aria-hidden
              className={cn(
                "flex size-8 flex-none items-center justify-center rounded-[9px]",
                lost ? STATUS_CLASSES.bad.pill : "bg-surface-3 text-subtle-foreground",
              )}
            >
              <DashGlyph d={r.glyph} />
            </span>
            <span className="min-w-0 flex-1">
              <span data-ui="leak-label" className={cn("block text-[13.5px] font-medium", r.href && "group-hover:underline")}>
                {r.label}
              </span>
              <span data-ui="leak-sub" className="block text-[12px] text-subtle-foreground">
                {r.detail}
              </span>
            </span>
            <span
              data-ui="leak-amount"
              className={cn("font-mono text-[13.5px] font-semibold", lost ? STATUS_CLASSES.bad.ink : "text-subtle-foreground")}
            >
              {lost ? `− ${inr(r.amount)}` : "₹0"}
            </span>
          </>
        );
        return (
          <li key={r.key} className="flex flex-col">
            {r.href ? (
              // Our one link here (the cancelled orders): the row keeps the HTML's box; hovering underlines its label.
              <Link
                href={r.href}
                data-ui="leak-row"
                className={cn(ROW_CLASS, "group text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring")}
              >
                {body}
              </Link>
            ) : (
              <div data-ui="leak-row" className={ROW_CLASS}>
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
