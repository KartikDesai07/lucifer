"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

import { FLOOR_REVEAL_MARGIN, edgeFades, revealScrollLeft } from "@/lib/floor-layout";

// The Floor's sideways rows (U3 Task 2, owner Q4, design 6.3): the area tabs and the status pills scroll sideways when
// they do not fit, with a fade at each edge that hides something, and the chosen one scrolled into view on its own.

export interface ScrollFades {
  start: boolean;
  end: boolean;
}

const NO_FADES: ScrollFades = { start: false, end: false };

/**
 * Which edges of the row hide something, kept in step with it: on its scroll (a passive listener), when its box resizes
 * (a ResizeObserver: a rotation, a wider window) and after every render of its owner (new tabs, a count that gained a
 * digit). No fade before the first measure, so the server and the first paint draw none.
 */
export function useScrollFades(row: RefObject<HTMLElement | null>): ScrollFades {
  const [fades, setFades] = useState<ScrollFades>(NO_FADES);

  const sync = useCallback(() => {
    const el = row.current;
    if (!el) return;
    const next = edgeFades(el);
    setFades((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, [row]);

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    el.addEventListener("scroll", sync, { passive: true });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(sync) : null;
    observer?.observe(el);
    return () => {
      el.removeEventListener("scroll", sync);
      observer?.disconnect();
    };
  }, [row, sync]);

  // After every render: the row's content may have changed width without its box changing.
  useEffect(sync);

  return fades;
}

/**
 * On first paint and whenever `chosen` changes, the row's own scrollLeft shows its pressed button whole, clear of the
 * fades (revealScrollLeft). Never scrollIntoView: it would scroll the page and the shell too.
 */
export function useRevealPressed(row: RefObject<HTMLElement | null>, chosen: string): void {
  useEffect(() => {
    const el = row.current;
    const pressed = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!el || !pressed) return;
    const next = revealScrollLeft(el, pressed, FLOOR_REVEAL_MARGIN);
    if (next !== el.scrollLeft) el.scrollLeft = next;
  }, [row, chosen]);
}
