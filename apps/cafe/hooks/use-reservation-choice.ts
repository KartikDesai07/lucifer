"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { useMediaQuery } from "@/hooks/use-media-query";
import { ORDERS_XL_QUERY } from "@/lib/orders-layout";
import { engageResChoice, noResChoice, resChoiceKey, settleResChoice, tappedResChoice, type ResChoice } from "@/lib/reservations-choice";
import type { Reservation } from "@/types";

/**
 * The page's chosen booking (U6 Task 3; design B5; lib/reservations-choice.ts), settled during render and stored only on a
 * change, so no frame shows a stale or a popped-open choice. The detail follows the LIVE booking by id from the whole
 * unfiltered list (it stays on a booking that leaves the shown tab after Seat); a booking that is gone (a delete) drops the
 * choice, so from 1280px the column takes the new first row and the sheet closes. Nothing is chosen while the list is
 * pending, failed or offline (`answered` false). A press or focus in the detail makes an auto pick the operator's (`engage`).
 */
export function useReservationChoice(opts: { list: readonly Reservation[]; rows: readonly Reservation[]; answered: boolean; filterEdits: number; query: string }) {
  const { list, rows, answered, filterEdits, query } = opts;
  const key = resChoiceKey(filterEdits, query);
  const xl = useMediaQuery(ORDERS_XL_QUERY);
  const [held, setHeld] = useState<ResChoice>(() => noResChoice(key));
  let choice = settleResChoice(held, key, xl, answered ? rows[0]?._id : undefined);
  const selected = choice.id === null ? null : (list.find((r) => r._id === choice.id) ?? null);
  if (answered && choice.id !== null && selected === null) choice = noResChoice(key);
  if (choice !== held) setHeld(choice);
  const keyRef = useRef(key);
  useLayoutEffect(() => {
    keyRef.current = key;
  });
  return {
    selected,
    xl,
    choose: (id: string | null) => setHeld(tappedResChoice(id, keyRef.current)),
    engage: () => setHeld(engageResChoice),
  };
}
