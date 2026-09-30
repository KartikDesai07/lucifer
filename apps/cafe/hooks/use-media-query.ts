"use client";

import { useSyncExternalStore } from "react";

// Tailwind's `lg` breakpoint as a media query — the Items page's table/cards split (R14).
export const LG_UP_QUERY = "(min-width: 1024px)";

// Width-keyed layout switch (never UA-sniffed — device-agnostic bar). Returns
// null when the width is not known (server render), so a caller can fall back
// to rendering both variants CSS-gated; once known, only the matching variant
// needs to mount (the Items page otherwise built 105 hidden table rows next to
// the cards on every phone).
export function useMediaQuery(query: string): boolean | null {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => null,
  );
}
