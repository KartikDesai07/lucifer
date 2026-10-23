"use client";

import type { Ref } from "react";

import type { OrdersDate } from "@/lib/orders-lanes";
import { cn } from "@/lib/utils";
import { OrdersDateBox } from "@/components/orders/OrdersDateBox";
import { ORDERS_FILTERS_PANEL_ID } from "@/components/orders/OrdersFiltersPanel";

// values 4.1: the row, 8px apart, wrapping.
const ROW_CLASS = "flex flex-wrap gap-2";
// The search box: flex 1 1 220px (0px on the phone), 40px, 0 10px, 1px --border, radius 9, on --surface; the 15px
// --text-3 magnifier 8px from the field, which is 14px (16px below 720px, ruling R36), no focus look on the box (the
// HTML's). The field is a plain text box, not type="search": Chrome wipes a search box on Escape, and with the Filters
// panel open one Escape would close the panel AND drop the typed phone (and the choice). The round ✕ clears it.
const SEARCH_CLASS =
  "flex h-10 min-w-0 flex-[1_1_220px] items-center gap-2 rounded-[9px] border border-border bg-card px-2.5 max-tab:basis-0";
const INPUT_CLASS =
  "min-w-0 flex-1 border-0 bg-transparent px-0.5 py-px text-[14px] leading-[normal] text-foreground outline-none placeholder:text-subtle-foreground max-tab:text-base";
const CLEAR_CLASS =
  "flex size-6 flex-none cursor-pointer items-center justify-center rounded-[50%] border-0 bg-surface-3 text-[11px] text-muted-foreground";
// The Filters button: 40px, 0 13px, radius 9, 13.5px 500, its border --text while the panel is open or a chip shows
// (else --border), --text-3 under a pointer; the word hidden on the phone; the count badge on --accent.
const FILTERS_CLASS =
  "flex h-10 flex-none cursor-pointer items-center gap-2 rounded-[9px] border bg-card px-[13px] text-[13.5px] font-medium text-foreground hover:border-subtle-foreground";
const COUNT_CLASS =
  "flex h-[19px] min-w-[19px] items-center justify-center rounded-[10px] bg-primary px-[5px] text-[11px] font-bold text-primary-foreground";

const SEARCH_WORDS = "Search by customer phone";

interface OrdersToolbarProps {
  /** The typed phone (the page searches it after its 350 ms wait). */
  phone: string;
  onPhone: (value: string) => void;
  /** The ✕: clears the typed and the searched phone at once. */
  onClearPhone: () => void;
  date: OrdersDate;
  onDate: (date: OrdersDate) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  /** The chips shown (the Filters button's badge). */
  count: number;
  /** The Filters button, so closing the panel can hand the focus back to it. */
  filtersRef?: Ref<HTMLButtonElement>;
}

/**
 * The owner's HTML toolbar (values 4; design 6.3): the phone-only search (owner Q4), the date box (owner Q5; hidden on
 * the phone, where the Filters panel leads with Date) and the Filters button.
 */
export function OrdersToolbar({
  phone,
  onPhone,
  onClearPhone,
  date,
  onDate,
  filtersOpen,
  onToggleFilters,
  count,
  filtersRef,
}: OrdersToolbarProps) {
  return (
    <div data-ui="orders-toolbar" className={ROW_CLASS}>
      <div data-ui="orders-search" className={SEARCH_CLASS}>
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
          type="text"
          inputMode="tel"
          enterKeyHint="search"
          autoComplete="off"
          data-ui="orders-search-input"
          value={phone}
          onChange={(e) => onPhone(e.target.value)}
          placeholder={SEARCH_WORDS}
          aria-label={SEARCH_WORDS}
          className={INPUT_CLASS}
        />
        {phone.trim() !== "" && (
          <button
            type="button"
            data-ui="orders-search-clear"
            title="Clear search"
            aria-label="Clear search"
            onClick={onClearPhone}
            className={CLEAR_CLASS}
          >
            ✕
          </button>
        )}
      </div>
      <OrdersDateBox date={date} onDate={onDate} />
      <button
        ref={filtersRef}
        type="button"
        data-ui="orders-filters-button"
        aria-expanded={filtersOpen}
        aria-controls={filtersOpen ? ORDERS_FILTERS_PANEL_ID : undefined}
        aria-label={count > 0 ? `Filters, ${count} applied` : "Filters"}
        onClick={onToggleFilters}
        className={cn(FILTERS_CLASS, filtersOpen || count > 0 ? "border-foreground" : "border-border")}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 6h16M7 12h10M10 18h4" />
        </svg>
        <span data-ui="orders-filters-label" className="max-tab:hidden">
          Filters
        </span>
        {count > 0 && (
          <span data-ui="orders-filters-count" className={COUNT_CLASS}>
            {count}
          </span>
        )}
      </button>
    </div>
  );
}
