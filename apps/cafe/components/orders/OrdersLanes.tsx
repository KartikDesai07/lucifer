"use client";

import { billPrintedNow } from "@/lib/dashboard/live-tables";
import {
  LANE_IDLE_LINES,
  ORDERS_LANES,
  laneSummary,
  type LaneSummary,
  type LaneTone,
  type OrdersFilterState,
  type OrdersLane,
} from "@/lib/orders-lanes";
import { recentOrderCode } from "@/lib/orders-row";
import { cn } from "@/lib/utils";
import type { Order } from "@/types";

interface OrdersLanesProps {
  filters: OrdersFilterState;
  /** The rows the list shows: the chosen lane's (laneRows), or every searched row while a phone is typed. */
  rows: Order[];
  /** More can be loaded (Load more): the numbers read "{n}+" / "₹x+" (Q1, Q10). */
  more: boolean;
  /** The list has loaded at least once; before that the chosen card shows no number. */
  loaded: boolean;
  /** The page's minute tick: the Open card's "{n} open 30+ min" line moves with it (no request). */
  now: Date;
  onLane: (lane: OrdersLane) => void;
  /** The strip's "Settle {code}": that order is chosen (design 6.2; its detail opens). */
  onChoose: (order: Order) => void;
}

const TONE_CLASS: Record<LaneTone, string> = {
  warn: "text-status-warn-ink",
  bill: "text-status-bill-ink",
  plain: "text-subtle-foreground",
};

// values 3.2: the cards (a list 560px or wider), five columns 8px apart (owner Q2).
const CARDS_CLASS = "hidden grid-cols-5 gap-2 @min-[560px]:grid";
const CARD_CLASS =
  "flex min-w-0 cursor-pointer flex-col items-start gap-[3px] rounded-[12px] border bg-card pt-[11px] px-3.5 pb-3 text-left text-foreground hover:border-subtle-foreground";
/** The chosen card: a 2px dark outline (its 1px --text border and a 1px --text ring). */
const CARD_ON_CLASS = "border-foreground [box-shadow:0_0_0_1px_var(--foreground)]";
const CARD_OFF_CLASS = "border-border";
const HEAD_CLASS = "flex items-center gap-[7px] text-[12.5px] font-medium text-muted-foreground";
/** The number row keeps its 28px on every card; only the chosen lane's is filled (owner Q1). */
const NUM_CLASS = "flex h-7 min-w-0 max-w-full items-baseline gap-2";
const COUNT_CLASS = "text-[22px] font-semibold tracking-[-0.02em]";
const AMOUNT_CLASS = "truncate font-mono text-[13px] text-muted-foreground";
const LINE_CLASS = "max-w-full truncate text-[12px]";

// values 3.3: the phone strip (a list narrower than 560px): five lane buttons over the current lane's row.
const STRIP_CLASS = "flex flex-col overflow-hidden rounded-[14px] border border-border bg-card @min-[560px]:hidden";
const TABS_CLASS = "grid grid-cols-5 border-b border-border-2";
const TAB_CLASS =
  "relative flex h-[50px] min-w-0 cursor-pointer flex-col items-center justify-center gap-0.5 border-0 px-0.5 py-0 text-foreground";
/** The tab's top keeps the count's 19px, so a tab showing its dot alone keeps its label where the chosen one has it. */
const TAB_TOP_CLASS = "flex h-[19px] items-center gap-[5px]";
const TAB_COUNT_CLASS = "text-[19px] font-semibold tracking-[-0.02em] leading-none text-foreground";
const TAB_LABEL_CLASS = "max-w-full truncate text-[11.5px]";
const TAB_BAR_CLASS = "absolute inset-x-[14%] bottom-0 h-[3px] rounded-t-[3px]";
const CURRENT_CLASS = "flex min-w-0 items-center gap-2.5 px-3 py-[7px]";
const CURRENT_AMOUNT_CLASS = "flex-none font-mono text-[17px] font-semibold tracking-[-0.02em] text-foreground";
const CURRENT_LINE_CLASS = "min-w-0 flex-1 truncate text-[12.5px] font-medium";
/** The HTML's --ink action, its text centred (design 8: the HTML's top-aligned text is not copied). */
const SETTLE_CLASS =
  "flex h-[30px] flex-none cursor-pointer items-center rounded-[8px] border-0 bg-ink px-[11px] text-[12.5px] font-semibold whitespace-nowrap text-on-ink";

/**
 * The owner's HTML lanes (values 3.2, 3.3; design 6.2): five cards when the list is 560px or wider, else the phone strip.
 * The chosen lane shows its count, ₹ total and line from the rows loaded for it (owner Q1: no request for the others,
 * which show their name, dot and a fixed line); while a phone is typed no lane is lit (owner Q4). On Open with a printed
 * bill (owner Q11) the strip offers "Settle {code}", which chooses that order.
 */
export function OrdersLanes({ filters, rows, more, loaded, now, onLane, onChoose }: OrdersLanesProps) {
  const searching = filters.phone !== "";
  const chosen = searching ? null : filters.lane;
  const summary: LaneSummary | null = chosen && loaded ? laneSummary(chosen, rows, more, filters.date, now) : null;
  const settle = chosen === "open" && summary ? rows.find((o) => billPrintedNow(o)) : undefined;
  const current = searching
    ? { amount: `${rows.length}${more ? "+" : ""} found`, line: "Searching all orders", tone: "plain" as const }
    : { amount: summary?.amount ?? "", line: summary?.line ?? LANE_IDLE_LINES[filters.lane], tone: summary?.tone ?? "plain" };

  return (
    <div data-ui="orders-lanes" className="@container">
      <div data-ui="orders-lane-cards" className={CARDS_CLASS}>
        {ORDERS_LANES.map((lane) => {
          const shown = lane.key === chosen ? summary : null;
          return (
            <button
              key={lane.key}
              type="button"
              data-ui="orders-lane-card"
              data-lane={lane.key}
              aria-pressed={lane.key === chosen}
              onClick={() => onLane(lane.key)}
              className={cn(CARD_CLASS, lane.key === chosen ? CARD_ON_CLASS : CARD_OFF_CLASS)}
            >
              <span data-ui="orders-lane-head" className={HEAD_CLASS}>
                <span data-ui="orders-lane-dot" aria-hidden className={cn("size-2 rounded-[50%]", lane.dot)} />
                {lane.label}
              </span>
              <span data-ui="orders-lane-num" className={NUM_CLASS}>
                {shown && (
                  <>
                    <span data-ui="orders-lane-count" className={COUNT_CLASS}>
                      {shown.count}
                    </span>
                    <span data-ui="orders-lane-amount" className={AMOUNT_CLASS}>
                      {shown.amount}
                    </span>
                  </>
                )}
              </span>
              <span
                data-ui="orders-lane-line"
                className={cn(LINE_CLASS, TONE_CLASS[shown ? shown.tone : "plain"])}
              >
                {shown ? shown.line : LANE_IDLE_LINES[lane.key]}
              </span>
            </button>
          );
        })}
      </div>

      <div data-ui="orders-lane-strip" className={STRIP_CLASS}>
        {/* The lanes as plain buttons with aria-pressed, as the cards: an ARIA tablist would promise arrow keys and tab
            panels this strip does not have. */}
        <div data-ui="orders-lane-tabs" role="group" aria-label="Lanes" className={TABS_CLASS}>
          {ORDERS_LANES.map((lane) => {
            const on = lane.key === chosen;
            return (
              <button
                key={lane.key}
                type="button"
                aria-pressed={on}
                data-ui="orders-lane-tab"
                data-lane={lane.key}
                onClick={() => onLane(lane.key)}
                className={cn(TAB_CLASS, on ? "bg-card" : "bg-surface-2")}
              >
                <span data-ui="orders-lane-tab-top" className={TAB_TOP_CLASS}>
                  <span data-ui="orders-lane-tab-dot" aria-hidden className={cn("size-[7px] rounded-[50%]", lane.dot)} />
                  {on && summary && (
                    <span data-ui="orders-lane-tab-count" className={TAB_COUNT_CLASS}>
                      {summary.count}
                    </span>
                  )}
                </span>
                <span
                  data-ui="orders-lane-tab-label"
                  className={cn(TAB_LABEL_CLASS, on ? "font-semibold text-foreground" : "font-medium text-subtle-foreground")}
                >
                  {lane.label}
                </span>
                {on && <span data-ui="orders-lane-tab-bar" aria-hidden className={cn(TAB_BAR_CLASS, lane.dot)} />}
              </button>
            );
          })}
        </div>
        <div data-ui="orders-lane-current" className={CURRENT_CLASS}>
          <span data-ui="orders-lane-current-amount" className={CURRENT_AMOUNT_CLASS}>
            {current.amount}
          </span>
          <span data-ui="orders-lane-current-line" className={cn(CURRENT_LINE_CLASS, TONE_CLASS[current.tone])}>
            {current.line}
          </span>
          {settle && (
            <button type="button" data-ui="orders-lane-settle" onClick={() => onChoose(settle)} className={SETTLE_CLASS}>
              {`Settle ${recentOrderCode(settle)}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
