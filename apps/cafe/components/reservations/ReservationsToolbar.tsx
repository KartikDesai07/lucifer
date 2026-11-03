"use client";

import { useRef, useState } from "react";

import { cn } from "@/lib/utils";
import {
  RES_SEARCH_CLASS,
  RES_SEARCH_CLEAR_CLASS,
  RES_SEARCH_INPUT_CLASS,
  RES_SEARCH_TOGGLE_CLASS,
  RES_STATUS_SELECT_CLASS,
  RES_TOOLBAR_CLASS,
} from "@/lib/reservations-layout";
import { tabOptions, type ResDayChoice, type ResTab } from "@/lib/reservations-view";
import { MagnifierIcon } from "@/components/menu/menu-icons";
import { MenuSelect } from "@/components/menu/MenuSelect";
import { ReservationsDayBox } from "@/components/reservations/ReservationsDayBox";

interface ReservationsToolbarProps {
  day: ResDayChoice;
  today: string;
  onDay: (day: ResDayChoice) => void;
  tab: ResTab;
  onTab: (tab: ResTab) => void;
  counts: Record<ResTab, number>;
  query: string;
  onQuery: (query: string) => void;
}

/**
 * The toolbar (values 3, 4, 9.2; design 6.2, B3, B23): one wrapping row that scrolls with the list — the day box, the status
 * select (the kit's dropdown in the HTML's 38px look: "Upcoming (4)" ... "All statuses (8)", the shown day's counts) and the
 * search ("Search name, phone or table"; it finds every date, so the day, the select and ✕ clear it). From 720px the
 * search box shares the row; on a phone a 38px "Search" toggle opens it on a row of its own and pressing it again closes
 * and clears it. The select keeps a 116.81px floor there: when the day group, the select and the toggle do not fit, the
 * select and the toggle wrap to a second row (B3).
 */
export function ReservationsToolbar({ day, today, onDay, tab, onTab, counts, query, onQuery }: ReservationsToolbarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  // The clear ✕ unmounts itself once the search is empty, so it hands the focus back to the input (never body).
  const inputRef = useRef<HTMLInputElement>(null);
  // The HTML's qD: the box shows from 720px, while the toggle is open, or while any query exists (a phone keeps filtering by it).
  const filled = query !== "";
  const boxShown = searchOpen || filled;

  const toggleSearch = () => {
    if (boxShown) onQuery("");
    setSearchOpen(!boxShown);
  };

  return (
    <div data-ui="reservations-toolbar" className={RES_TOOLBAR_CLASS}>
      <ReservationsDayBox day={day} today={today} onDay={onDay} />
      <MenuSelect
        dataUi="reservations-status"
        className={RES_STATUS_SELECT_CLASS}
        ariaLabel="Filter by status"
        value={tab}
        onValueChange={(value) => onTab(value as ResTab)}
        options={tabOptions(counts)}
      />
      <button
        type="button"
        data-ui="reservations-search-toggle"
        title="Search"
        aria-label="Search"
        aria-expanded={boxShown}
        onClick={toggleSearch}
        className={cn(RES_SEARCH_TOGGLE_CLASS, boxShown ? "border-foreground" : "border-border")}
      >
        <MagnifierIcon size={16} strokeWidth={1.9} />
      </button>
      <label data-ui="reservations-search" className={cn(RES_SEARCH_CLASS, !boxShown && "max-tab:hidden")}>
        <span className="flex flex-none text-subtle-foreground">
          <MagnifierIcon />
        </span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search name, phone or table"
          aria-label="Search name, phone or table"
          autoComplete="off"
          className={RES_SEARCH_INPUT_CLASS}
        />
        {filled && (
          <button
            type="button"
            data-ui="reservations-search-clear"
            title="Clear search"
            aria-label="Clear search"
            onClick={() => {
              onQuery("");
              inputRef.current?.focus();
            }}
            className={RES_SEARCH_CLEAR_CLASS}
          >
            ✕
          </button>
        )}
      </label>
    </div>
  );
}
