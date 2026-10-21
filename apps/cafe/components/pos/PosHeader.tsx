"use client";

import { memo } from "react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";
import { STATUS_CLASSES } from "@/lib/ui";
import { switchView, type SwitchDot, type SwitchView } from "@/lib/pos-open-orders";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { PageHeader } from "@/components/shared/PageHeader";
import { OpenTabsButton } from "@/components/pos/OpenTabsButton";
import { PosTableHandoff } from "@/components/pos/PosTableHandoff";
import type { Order } from "@/types";

interface PosHeaderProps {
  lastOrder: Order | null;
  onReprintKot: () => void;
  openTabs: Order[];
  onResumeTab: (order: Order) => void;
  resumedOrder: Order | null;
  isBusy: boolean;
  // The Floor hand-off below selects a table through this (the Table cell itself lives in the cart head now).
  onTableChange: (tableNo: string | undefined) => void;
  /** The order on screen, for the switch button's words (values 1.3): its customer's name, its quantities (all of them,
   *  and those not sent yet) and its total. Plain values, so the memo still bails out on an unrelated render. */
  customerName: string | undefined;
  count: number;
  newCount: number;
  total: number;
}

// The HTML's Switch order button (values 1.2): 42px, radius 12, 0 10px 0 6px, 10px apart, at most 340px and shrinking
// (a phone: no cap, it fills the row), the surface with a 1px rule; hover: the --text-3 rule and a soft shadow. Its
// focus ring is drawn inside (the header's actions box scrolls sideways, so it clips anything outside the button).
const SWITCH_CLASS =
  "flex h-[42px] min-w-0 max-w-[340px] flex-[0_1_auto] cursor-pointer items-center gap-2.5 rounded-[12px] border border-border bg-card py-0 pl-1.5 pr-2.5 text-left leading-[normal] text-foreground hover:border-subtle-foreground hover:[box-shadow:0_4px_14px_rgba(0,0,0,0.06)] focus-visible:ring-inset max-tab:max-w-none max-tab:flex-1";
// The code tile: 30px, radius 8, --ink with --on-ink, 11.5px 700, -0.01em.
const CODE_CLASS =
  "relative flex size-[30px] flex-none items-center justify-center rounded-[8px] bg-ink text-[11.5px] font-bold tracking-[-0.01em] text-on-ink";
// Its 9px dot on the corner in a 2px ring of the surface: grey with no items, orange while one is not sent, green.
const DOT_RING_CLASS = "absolute -right-[3px] -top-[3px] size-[9px] rounded-[50%] [box-shadow:0_0_0_2px_var(--card)]";
const DOT_CLASS: Record<SwitchDot, string> = {
  empty: STATUS_CLASSES.neutral.dot,
  unsent: STATUS_CLASSES.warn.dot,
  sent: STATUS_CLASSES.ok.dot,
};
// The "{N} open" pill: 22px, 0 8px, round, --surface-3 with --text-2, 11.5px 600.
const COUNT_CLASS =
  "flex h-[22px] flex-none items-center whitespace-nowrap rounded-[999px] bg-surface-3 px-2 text-[11.5px] font-semibold text-muted-foreground";

/** The switch button for the order on screen (values 1.2, 1.3; design 6.2). The Open orders panel's trigger: Radix
 *  hands it its open state and handlers, spread onto the button. */
function SwitchOrderButton({ view, className, ...props }: { view: SwitchView } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      title="Switch order"
      data-ui="pos-switch"
      className={cn(SWITCH_CLASS, BRAND_PRESS_CLASS, className)}
      {...props}
    >
      <span aria-hidden="true" data-ui="pos-switch-code" className={CODE_CLASS}>
        {view.code}
        <span data-ui="pos-switch-dot" className={cn(DOT_RING_CLASS, DOT_CLASS[view.dot])} />
      </span>
      <span data-ui="pos-switch-text" className="flex min-w-0 flex-1 flex-col">
        <span data-ui="pos-switch-title" className="truncate text-[14px] font-semibold leading-[1.2]">
          {view.title}
        </span>
        <span data-ui="pos-switch-sub" className="truncate text-[11.5px] leading-[1.3] text-muted-foreground">
          {view.sub}
        </span>
      </span>
      <span data-ui="pos-switch-count" className={COUNT_CLASS}>
        {view.count}
      </span>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        data-ui="pos-switch-chevron"
        className="flex-none text-subtle-foreground"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
}

// The /pos header's own part (U1 Task 6; values 1.2-1.4, 7; design 6.1, 6.2; owner Q3, Q16, Q17): the HTML's switch-order
// button, handed to the shell header's actions box at every width (PageHeader's phoneActions; no New button, owner Q3),
// opening the Open orders panel (our open tabs; its foot holds today's KOT reprint, owner Q17). Nothing of it sits in
// the page's flow, and the Floor hand-off renders nothing, so the page draws no control row any more. Pure props in,
// callbacks out; memoized (CB-1d.3c): the page passes latched callbacks and plain values.
export const PosHeader = memo(function PosHeader({
  lastOrder,
  onReprintKot,
  openTabs,
  onResumeTab,
  resumedOrder,
  isBusy,
  onTableChange,
  customerName,
  count,
  newCount,
  total,
}: PosHeaderProps) {
  const view = switchView({ resumedOrder, customerName, count, newCount, total }, openTabs);
  return (
    <>
      <PageHeader
        title="POS Terminal"
        phoneActions={
          <OpenTabsButton
            tabs={openTabs}
            currentId={resumedOrder?._id}
            onResume={onResumeTab}
            lastOrder={lastOrder}
            onReprintKot={onReprintKot}
            isBusy={isBusy}
            trigger={<SwitchOrderButton view={view} />}
          />
        }
      />
      {/* Applies the table handed over from the Tables floor; renders nothing. */}
      <PosTableHandoff resumedOrder={resumedOrder} onResume={onResumeTab} onSelect={onTableChange} />
    </>
  );
});
