"use client";

import { useRef, useState, type ReactElement, type RefObject } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "@/lib/utils";
import { STATUS_CLASSES } from "@/lib/ui";
import { BREAKPOINT_DESK_PX } from "@/lib/pos-layout";
import {
  OPEN_ORDER_TABS,
  openOrderCounts,
  openOrderRows,
  openOrdersSummary,
  type OpenOrderRow,
  type OpenOrdersTab,
} from "@/lib/pos-open-orders";
import { useNow } from "@/hooks/use-now";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import type { Order } from "@/types";

// The Open orders panel (U1 Task 6; the owner's HTML, values 7 in docs/superpowers/specs/2026-10-20-pos-html-values.md;
// design 6.2; owner Q16, Q17): opened by the header's switch-order button (PosHeader.tsx), it lists our open tabs — the
// list the page already reads, searched on the device — in the tabs All · Tables · Walk-In, the tab on screen first.
// A tap resumes the tab through the page's requestResume (today's "Discard unsent items?" prompt when needed) and
// closes the panel. No "+ New …" footer (owner Q16); after this device printed or sent something (today's rule), the
// foot holds today's KOT reprint (owner Q17). A Radix dialog: focus trap, Escape and the scrim close it, and its
// role=dialog keeps F8 / F9 off while it is open (PosKeys).

/** The HTML's desk (values 0.2): the search is focused on open from 1100px only (no keyboard pops up on a tablet). */
const DESK_QUERY = `(min-width: ${BREAKPOINT_DESK_PX}px)`;
/** Rows re-read the minutes as often as the HTML (values 0.1: every 30 s). */
const AGE_TICK_MS = 30_000;

// The scrim (values 7.1, 0.3 opScrim/opAlign/opJustify/opPad): a 6% black veil with the panel at the top right under the
// header (62px 16px 16px); a phone: --scrim, the panel along the foot. z-index 44, over the phone's tab bar.
const SCRIM_CLASS =
  "fixed inset-0 z-[44] flex items-start justify-end bg-[rgba(0,0,0,0.06)] px-4 pt-[62px] pb-4 font-sans leading-[normal] text-foreground motion-safe:animate-scrim-in max-tab:items-end max-tab:justify-center max-tab:bg-scrim max-tab:p-0";
// The panel (values 7.1, 0.3 opW/opMaxH/opRadius): 420px, at most min(640px, 100dvh - 80px), radius 16; a phone: the
// full width, at most 86dvh, radius 18 18 0 0. The vh caps are the base, the dvh caps where they exist.
const PANEL_CLASS =
  "flex w-full max-w-[420px] flex-col overflow-hidden rounded-[16px] border border-border bg-card [box-shadow:var(--pop)] outline-none motion-safe:animate-html-sheet-in-op tab:max-h-[min(640px,calc(100vh-80px))] tab:supports-[height:1dvh]:max-h-[min(640px,calc(100dvh-80px))] max-tab:max-h-[86vh] max-tab:max-w-none max-tab:rounded-[18px_18px_0_0] max-tab:supports-[height:1dvh]:max-h-[86dvh]";
const HEAD_CLASS = "flex flex-none flex-col gap-2.5 border-b border-border-2 px-3.5 pt-3.5 pb-2.5";
// The search (values 7.1): 40px, radius 10, 0 12px, on --surface-2; the input 15px (16px below 720px, ruling R36).
const SEARCH_CLASS = "flex h-10 items-center gap-2 rounded-[10px] border border-border bg-surface-2 px-3";
const INPUT_CLASS =
  "min-w-0 flex-1 border-0 bg-transparent px-0.5 py-px text-[15px] leading-[normal] text-foreground outline-none placeholder:text-subtle-foreground max-tab:text-base";
// The tabs (owner Q16; values 7.1 type tabs): a --surface-3 track, radius 8, 2px inset and gap; 30px segments, radius 6,
// 12.5px 500; the chosen one on --seg with its lift (SEG_ON), the count in --text-3.
const TABS_CLASS = "grid grid-cols-3 gap-0.5 rounded-[8px] bg-surface-3 p-0.5";
const TAB_CLASS = "h-[30px] cursor-pointer whitespace-nowrap rounded-[6px] border-0 text-[12.5px] font-medium text-foreground";
const TAB_ON_CLASS = "bg-seg [box-shadow:var(--seg-sh)]";
const TAB_OFF_CLASS = "bg-transparent";
// A row (values 7.1): 9px 10px, radius 10, 12px apart, rising in turn; the current tab on --accent-t; the others take
// the design's --surface-2 hover (the HTML's own hover rule is empty, values 0.5).
const ROW_CLASS =
  "flex w-full cursor-pointer items-center gap-3 rounded-[10px] border-0 px-2.5 py-[9px] text-left text-foreground motion-safe:animate-html-rise-row disabled:cursor-not-allowed disabled:opacity-50";
const ROW_CURRENT_CLASS = "bg-accent";
const ROW_OTHER_CLASS = "bg-transparent not-disabled:hover:bg-surface-2";
// The row's tile: 36px, radius 10, 12px 700; the current one --accent / --on-accent, the others --surface-3 / --text; the
// 10px dot in a 2px ring, --ok (every open tab is in the kitchen).
const TILE_CLASS = "relative flex size-9 flex-none items-center justify-center rounded-[10px] text-[12px] font-bold";
const EMPTY_CLASS = "px-3 py-9 text-center text-[13.5px] text-muted-foreground";
// The foot (values 7.1 footer, with our one button, owner Q17): 10px 12px and the safe area, a --border-2 rule; the
// HTML's 40px outline button, radius 10, 13px 600, hover --accent rule and --accent-i words.
const FOOT_CLASS = "flex-none border-t border-border-2 px-3 pt-2.5 pb-[calc(12px+env(safe-area-inset-bottom))]";
const FOOT_BUTTON_CLASS =
  "h-10 w-full cursor-pointer truncate rounded-[10px] border border-border bg-card px-3 text-[13px] font-semibold text-foreground not-disabled:hover:border-primary not-disabled:hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50";

interface OpenTabsButtonProps {
  tabs: Order[];
  /** The tab on screen (lit, first), if any. */
  currentId: string | undefined;
  onResume: (order: Order) => void;
  /** The last order this device printed or sent (today's rule for the KOT reprint), or none. */
  lastOrder: Order | null;
  onReprintKot: () => void;
  /** A send is in flight: the rows (a resume) and the reprint lock; the panel still opens. */
  isBusy: boolean;
  /** The button it opens from: the header's switch-order button. */
  trigger: ReactElement;
}

export function OpenTabsButton({ tabs, currentId, onResume, lastOrder, onReprintKot, isBusy, trigger }: OpenTabsButtonProps) {
  const [open, setOpen] = useState(false);
  // The tab persists between openings, as the HTML's; the search starts empty each time (the body mounts on open).
  const [tab, setTab] = useState<OpenOrdersTab>("All");
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const resume = (order: Order) => {
    onResume(order);
    setOpen(false);
  };
  // The search takes focus from 1100px (values 7: the HTML focuses it on desk only); below, the panel itself does.
  const focusOnOpen = (e: Event) => {
    e.preventDefault();
    (window.matchMedia(DESK_QUERY).matches ? inputRef.current : contentRef.current)?.focus();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-ui="pos-open-orders" className={SCRIM_CLASS}>
          <DialogPrimitive.Content
            ref={contentRef}
            data-ui="pos-open-orders-panel"
            onOpenAutoFocus={focusOnOpen}
            className={PANEL_CLASS}
          >
            <OpenOrdersBody
              tabs={tabs}
              currentId={currentId}
              tab={tab}
              onTab={setTab}
              inputRef={inputRef}
              isBusy={isBusy}
              resume={resume}
            />
            {lastOrder && (
              <div data-ui="pos-open-orders-foot" className={FOOT_CLASS}>
                <button
                  type="button"
                  onClick={onReprintKot}
                  disabled={isBusy}
                  aria-label={`Print kitchen ticket for ${lastOrder.orderId}`}
                  title={`Print kitchen ticket for ${lastOrder.orderId}`}
                  className={cn(FOOT_BUTTON_CLASS, BRAND_PRESS_CLASS)}
                >
                  Print kitchen ticket · {lastOrder.orderId}
                </button>
              </div>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

interface OpenOrdersBodyProps {
  tabs: Order[];
  currentId: string | undefined;
  tab: OpenOrdersTab;
  onTab: (tab: OpenOrdersTab) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  isBusy: boolean;
  resume: (order: Order) => void;
}

/** The head (title, summary, search, tabs) and the list: mounted while the panel is open, so the search starts empty and
 *  the minutes tick only then. */
function OpenOrdersBody({ tabs, currentId, tab, onTab, inputRef, isBusy, resume }: OpenOrdersBodyProps) {
  const [q, setQ] = useState("");
  // Until the hook's first tick the rows read this render's own time (the panel opens on a tap: the client's clock).
  const now = useNow(AGE_TICK_MS) ?? new Date();
  const rows = openOrderRows(tabs, currentId, q, tab, now);
  const counts = openOrderCounts(tabs);

  return (
    <>
      <div data-ui="pos-open-orders-head" className={HEAD_CLASS}>
        <div className="flex items-baseline justify-between">
          <DialogPrimitive.Title className="text-[16px] font-semibold">Open orders</DialogPrimitive.Title>
          <span data-ui="pos-open-orders-summary" className="text-[12.5px] text-muted-foreground">
            {openOrdersSummary(tabs)}
          </span>
        </div>
        <DialogPrimitive.Description className="sr-only">Resume a running order to add items or settle it.</DialogPrimitive.Description>
        <label data-ui="pos-open-orders-search" className={SEARCH_CLASS}>
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
            className="flex-none text-subtle-foreground"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Table, customer, phone or order #"
            aria-label="Search open orders"
            autoComplete="off"
            spellCheck={false}
            className={INPUT_CLASS}
          />
        </label>
        <div data-ui="pos-open-orders-tabs" className={TABS_CLASS}>
          {OPEN_ORDER_TABS.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={t === tab}
              onClick={() => onTab(t)}
              className={cn(TAB_CLASS, t === tab ? TAB_ON_CLASS : TAB_OFF_CLASS)}
            >
              {t} <span className="text-subtle-foreground">{counts[t]}</span>
            </button>
          ))}
        </div>
      </div>
      <div data-ui="pos-open-orders-list" className="min-h-0 flex-1 overflow-auto p-1.5 last:pb-[calc(6px+env(safe-area-inset-bottom))]">
        {rows.map((row) => (
          <OpenOrderRowButton key={row.key} row={row} isBusy={isBusy} resume={resume} />
        ))}
        {rows.length === 0 &&
          (q.trim() ? (
            <div className={EMPTY_CLASS}>No open orders match “{q.trim()}”</div>
          ) : (
            <div className={EMPTY_CLASS}>
              <p className="font-medium text-foreground">No open tabs</p>
              <p className="mt-1">Orders you send to the kitchen appear here until settled.</p>
            </div>
          ))}
      </div>
    </>
  );
}

function OpenOrderRowButton({ row, isBusy, resume }: { row: OpenOrderRow; isBusy: boolean; resume: (order: Order) => void }) {
  return (
    <button
      type="button"
      data-ui="pos-open-order"
      aria-current={row.current ? "true" : undefined}
      onClick={() => resume(row.tab)}
      disabled={isBusy}
      style={{ animationDelay: row.delay }}
      className={cn(ROW_CLASS, row.current ? ROW_CURRENT_CLASS : ROW_OTHER_CLASS)}
    >
      <span
        aria-hidden="true"
        className={cn(TILE_CLASS, row.current ? "bg-primary text-primary-foreground" : "bg-surface-3 text-foreground")}
      >
        {row.code}
        <span className={cn("absolute -right-[3px] -top-[3px] size-2.5 rounded-[50%] [box-shadow:0_0_0_2px_var(--card)]", STATUS_CLASSES.ok.dot)} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold">{row.id}</span>
        <span className="block truncate text-[12px] text-muted-foreground">{row.sub}</span>
      </span>
      <span className="flex flex-none flex-col items-end">
        <span className="text-[14px] font-semibold">{row.total}</span>
        <span className={cn("text-[11.5px] font-medium", STATUS_CLASSES.ok.ink)}>{row.status}</span>
      </span>
    </button>
  );
}
