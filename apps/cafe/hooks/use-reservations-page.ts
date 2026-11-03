"use client";

import { useCallback, useMemo, useState } from "react";
import { cafeDateString } from "@pos/shared/utils";

import { useNow } from "@/hooks/use-now";
import { useReservations } from "@/hooks/use-reservations";
import { useTables } from "@/hooks/use-tables";
import {
  headerLine,
  listRows,
  resolveDay,
  tabCounts,
  type ResDayChoice,
  type ResTab,
} from "@/lib/reservations-view";
import type { Reservation } from "@/types";

/** The page's clock tick: Late, Due now and "in 12 min" move once a minute (a state change, never a request). */
export const MINUTE_TICK_MS = 60_000;
const NO_BOOKINGS: Reservation[] = [];

/**
 * The Reservations page's state (U6 Task 1; ruling U2: it lives here so page.tsx stays small): the day (held as null =
 * today, so a tab left open past midnight shows the new day, B12), the status tab, the typed search, and everything the page
 * derives from the ONE list (`useReservations({})`, today's unfiltered key, design 11: the day, the tab and the search never
 * send a request): the rows, the select's counts and the header line, memoised on the list's identity (B25). `useTables()`
 * is read once here (always mounted, as today's hidden form: the same 30s poll), for the rows, the detail and the seat
 * dialog. `filterEdits` counts each day / tab / search change for the chosen booking's key (B5, Task 3).
 */
export function useReservationsPage() {
  const status = useReservations({});
  const tables = useTables();
  const [renderNow] = useState(() => Date.now());
  const ticked = useNow(MINUTE_TICK_MS);
  // useNow is null until mounted: the render clock stands in until then.
  const nowMs = ticked ? ticked.getTime() : renderNow;
  const today = cafeDateString(new Date(nowMs));

  const [day, setDayState] = useState<ResDayChoice>(null);
  const [tab, setTabState] = useState<ResTab>("upcoming");
  const [query, setQueryState] = useState("");
  const [filterEdits, setFilterEdits] = useState(0);
  const edited = useCallback(() => setFilterEdits((n) => n + 1), []);

  // The day, Today, a calendar pick and ‹ › : today is held as null; each also clears the search (values 3, 9.3).
  const setDay = useCallback(
    (next: ResDayChoice) => {
      setDayState(next === today ? null : next);
      setQueryState("");
      edited();
    },
    [today, edited],
  );
  const setTab = useCallback(
    (next: ResTab) => {
      setTabState(next);
      setQueryState("");
      edited();
    },
    [edited],
  );
  const setQuery = useCallback(
    (next: string) => {
      setQueryState(next);
      edited();
    },
    [edited],
  );

  const data = status.data;
  const list = data ?? NO_BOOKINGS;
  const shownDay: string | "all" = day === "all" ? "all" : resolveDay(day, today);
  const rows = useMemo(() => listRows(list, { day, tab, query, nowMs, today }), [list, day, tab, query, nowMs, today]);
  const counts = useMemo(() => tabCounts(list, shownDay), [list, shownDay]);
  const header = useMemo(
    () => (data === undefined ? undefined : headerLine(data, { day, query, nowMs, today })),
    [data, day, query, nowMs, today],
  );

  return { list, tables: tables.data, status, day, setDay, tab, setTab, query, setQuery, rows, counts, header, nowMs, today, filterEdits };
}
