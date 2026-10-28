"use client";

import { useRef } from "react";

import { useRevealPressed, useScrollFades } from "@/hooks/use-scroll-fades";
import type { FloorAreaTab } from "@/lib/floor-areas";
import {
  FLOOR_FADE_TABS,
  FLOOR_FADE_WRAP_CLASS,
  FLOOR_TABS_TRACK_CLASS,
  FLOOR_TAB_CLASS,
  FLOOR_TAB_OFF_CLASS,
  FLOOR_TAB_ON_CLASS,
} from "@/lib/floor-layout";
import { cn } from "@/lib/utils";

interface FloorAreaTabsProps {
  tabs: readonly FloorAreaTab[];
  /** The area the page shows (effectiveArea): a choice no tab has any more lights none. */
  value: string;
  onChange: (key: string) => void;
}

// The HTML's area segmented control (U3 Task 2; values 2.3, design 6.3): "All" and one tab per area that holds a table,
// the chosen one on the white chip. A client-side filter: no request. When the track is wider than the screen it scrolls
// sideways with a fade at the edge that hides a tab, and the chosen tab is scrolled into view on its own (owner Q4).
export function FloorAreaTabs({ tabs, value, onChange }: FloorAreaTabsProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const fades = useScrollFades(rowRef);
  useRevealPressed(rowRef, value);

  return (
    <div className={FLOOR_FADE_WRAP_CLASS}>
      <div ref={rowRef} role="group" aria-label="Filter tables by area" data-ui="floor-area-tabs" className={FLOOR_TABS_TRACK_CLASS}>
        {tabs.map((tab) => {
          const on = tab.key === value;
          return (
            <button
              key={tab.key}
              type="button"
              data-ui="floor-area-tab"
              aria-pressed={on}
              onClick={() => onChange(tab.key)}
              className={cn(FLOOR_TAB_CLASS, on ? FLOOR_TAB_ON_CLASS : FLOOR_TAB_OFF_CLASS)}
            >
              {tab.name}
            </button>
          );
        })}
      </div>
      {fades.start && <span aria-hidden data-ui="floor-fade-start" className={FLOOR_FADE_TABS.start} />}
      {fades.end && <span aria-hidden data-ui="floor-fade-end" className={FLOOR_FADE_TABS.end} />}
    </div>
  );
}
