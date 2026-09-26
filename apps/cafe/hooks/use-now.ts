"use client";

import { useEffect, useState } from "react";

/** One second: minute rollovers land exactly, with no drift maths. */
export const NOW_TICK_MS = 1_000;

/**
 * The current time, re-read on an interval — or `null` until mounted.
 *
 * The null is load-bearing. The server does not know what time it is on THIS
 * device, so anything rendered from a server-side Date would hydrate with a
 * different minute than the browser's first paint (a hydration mismatch).
 * Callers render a same-sized placeholder while it is null.
 */
export function useNow(tickMs: number = NOW_TICK_MS): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), tickMs);
    return () => clearInterval(timer);
  }, [tickMs]);
  return now;
}
