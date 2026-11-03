"use client";

import {
  RES_EMPTY_BOX_CLASS,
  RES_EMPTY_BUTTON_CLASS,
  RES_EMPTY_TEXT_CLASS,
  RES_EMPTY_TILE_CLASS,
  RES_EMPTY_TITLE_CLASS,
  RES_LIST_CARD_CLASS,
  RES_SKELETON_ROW_CLASS,
} from "@/lib/reservations-layout";
import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_ROWS = 5;

/** Loading (design 6.5): the list card with five 60px rows of bars (our skeleton in the HTML's card). */
export function ReservationsSkeleton() {
  return (
    <div data-ui="reservations-skeleton" aria-hidden="true" className={RES_LIST_CARD_CLASS}>
      {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
        <div key={i} className={RES_SKELETON_ROW_CLASS}>
          <Skeleton className="h-4 w-14 flex-none" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-[22px] w-16 flex-none rounded-full" />
        </div>
      ))}
    </div>
  );
}

interface ReservationsEmptyProps {
  title: string;
  text: string;
  onNew: () => void;
}

/** The HTML's empty box (values 9.1): the dashed box, the 46px reserved-tint tile with the 22px calendar, the title, the
 *  line and "+ New reservation". The words come from emptyWords (lib/reservations-view.ts). */
export function ReservationsEmpty({ title, text, onNew }: ReservationsEmptyProps) {
  return (
    <div data-ui="reservations-empty" className={RES_EMPTY_BOX_CLASS}>
      <span className={RES_EMPTY_TILE_CLASS}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 5h16v16H4zM4 10h16M8 3v4M16 3v4" />
        </svg>
      </span>
      <p className={RES_EMPTY_TITLE_CLASS}>{title}</p>
      <p className={RES_EMPTY_TEXT_CLASS}>{text}</p>
      <button type="button" data-ui="reservations-empty-new" onClick={onNew} className={RES_EMPTY_BUTTON_CLASS}>
        + New reservation
      </button>
    </div>
  );
}
