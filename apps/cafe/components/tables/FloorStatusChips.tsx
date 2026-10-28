"use client";

import { useRef } from "react";

import { useRevealPressed, useScrollFades } from "@/hooks/use-scroll-fades";
import {
  FLOOR_FADE_PILLS,
  FLOOR_FADE_WRAP_CLASS,
  FLOOR_FILTER_DOT,
  FLOOR_PILLS_ROW_CLASS,
  FLOOR_PILL_CLASS,
  FLOOR_PILL_COUNT_OFF_CLASS,
  FLOOR_PILL_COUNT_ON_CLASS,
  FLOOR_PILL_DOT_CLASS,
  FLOOR_PILL_OFF_CLASS,
  FLOOR_PILL_ON_CLASS,
} from "@/lib/floor-layout";
import { FLOOR_FILTERS, type FloorFilter } from "@/lib/floor-tiles";
import { cn } from "@/lib/utils";

interface FloorStatusChipsProps {
  counts: Record<FloorFilter, number>;
  value: FloorFilter;
  /** The area shown: a change of it (a user choice) re-reveals the chosen pill, whose neighbours' counts change width.
   *  A count change alone (a poll) never does: it would undo the user's swipe. */
  revealKey: string;
  onChange: (next: FloorFilter) => void;
}

// The HTML's status pills (U3 Task 2; values 2.4, design 6.3): All, Available, Occupied, Bill printed, Reserved, each
// with its count over the area shown; they filter the grid and are its colour legend (each dot the state's colour, each
// word its name). The chosen one is the ink pill. On a narrow screen the row scrolls sideways with a fade at the edge
// that hides a pill, and the chosen pill is scrolled into view on its own (owner Q4).
export function FloorStatusChips({ counts, value, revealKey, onChange }: FloorStatusChipsProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const fades = useScrollFades(rowRef);
  useRevealPressed(rowRef, `${value}|${revealKey}`);

  return (
    <div className={FLOOR_FADE_WRAP_CLASS}>
      <div ref={rowRef} role="group" aria-label="Filter tables by status" data-ui="floor-pills" className={FLOOR_PILLS_ROW_CLASS}>
        {FLOOR_FILTERS.map(({ key, label }) => {
          const on = key === value;
          return (
            <button
              key={key}
              type="button"
              data-ui="floor-pill"
              aria-pressed={on}
              onClick={() => onChange(key)}
              className={cn(FLOOR_PILL_CLASS, on ? FLOOR_PILL_ON_CLASS : FLOOR_PILL_OFF_CLASS)}
            >
              {key !== "all" && <span aria-hidden data-ui="floor-pill-dot" className={cn(FLOOR_PILL_DOT_CLASS, FLOOR_FILTER_DOT[key])} />}
              {label}
              <span data-ui="floor-pill-count" className={on ? FLOOR_PILL_COUNT_ON_CLASS : FLOOR_PILL_COUNT_OFF_CLASS}>
                {counts[key]}
              </span>
            </button>
          );
        })}
      </div>
      {fades.start && <span aria-hidden data-ui="floor-fade-start" className={FLOOR_FADE_PILLS.start} />}
      {fades.end && <span aria-hidden data-ui="floor-fade-end" className={FLOOR_FADE_PILLS.end} />}
    </div>
  );
}
