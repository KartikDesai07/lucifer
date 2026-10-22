"use client";

import { useSyncExternalStore } from "react";

// The window's inner height, kept current on resize — the owner's HTML reads it as `s.h` (values 0.4 in
// docs/superpowers/specs/2026-10-20-pos-html-values.md): the /pos bill details start open from an 820px-tall window.
// The server has no window: 0 there, so the first paint matches and the real height follows at once.

function subscribe(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

const readHeight = () => window.innerHeight;
const serverHeight = () => 0;

export function useWindowHeight(): number {
  return useSyncExternalStore(subscribe, readHeight, serverHeight);
}
