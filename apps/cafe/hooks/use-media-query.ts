"use client";

import { useSyncExternalStore } from "react";

// Tailwind's `lg` breakpoint as a media query — the Items page's table/cards split (R14).
export const LG_UP_QUERY = "(min-width: 1024px)";

// One MediaQueryList per query, shared by every component that reads it, and one change listener that tells them all in
// the same call — so React re-renders every reader of a query in ONE pass, a parent before its children. With a list per
// reader the browser reports each list on its own, with a microtask between them, so a child could re-render alone first:
// on /orders the order detail opened its full-screen sheet for a moment on a first row the page was about to drop as the
// window crossed 1280px (U2 Task 5, ruling P9). A list lives as long as the page (a handful of queries).
const lists = new Map<string, { list: MediaQueryList; readers: Set<() => void> }>();

function sharedList(query: string) {
  let entry = lists.get(query);
  if (!entry) {
    const list = window.matchMedia(query);
    const readers = new Set<() => void>();
    list.addEventListener("change", () => {
      for (const tell of [...readers]) tell();
    });
    entry = { list, readers };
    lists.set(query, entry);
  }
  return entry;
}

// Width-keyed layout switch (never UA-sniffed — device-agnostic bar). Returns
// null when the width is not known (server render), so a caller can fall back
// to rendering both variants CSS-gated; once known, only the matching variant
// needs to mount (the Items page otherwise built 105 hidden table rows next to
// the cards on every phone).
export function useMediaQuery(query: string): boolean | null {
  return useSyncExternalStore(
    (onChange) => {
      const { readers } = sharedList(query);
      readers.add(onChange);
      return () => {
        readers.delete(onChange);
      };
    },
    () => sharedList(query).list.matches,
    () => null,
  );
}
