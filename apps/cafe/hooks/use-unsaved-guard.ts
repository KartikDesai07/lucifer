"use client";

import { useEffect, useState } from "react";

import { holdUnsentWork, isDeliberateReload } from "@/lib/page-refresh";

// Warns before the browser tab/window is closed or reloaded while work would be
// LOST — unsent cart items, or a resumed open tab mid-edit on the POS. The
// staff POS holds this state in memory (unlike the diner /m cart, which
// persists to localStorage), so a stray Ctrl-W / window-X silently discards a
// half-built round. The browser's own "Leave site?" prompt is the only dialog
// available at unload time; a page cannot render its own there, and the prompt
// text is fixed by every modern browser (a non-empty returnValue just opts in).
//
// Armed ONLY while `dirty` — an empty New Order screen closes with no nag, so
// the prompt never cries wolf. A route change WITHIN the app does not fire
// beforeunload (Next soft-navigates), so this guards a real page teardown only,
// not tab switches inside the dashboard.
//
// The POS app's Refresh button (the release review's I1): the same dirty state
// is its own, so it asks in the page first; a refresh staff confirmed there is
// marked deliberate, and this prompt stays quiet (no second, native question).
export function useUnsavedGuard(dirty: boolean): void {
  const [token] = useState(() => Symbol("unsaved"));
  useEffect(() => {
    holdUnsentWork(token, dirty ? "changes" : null);
  }, [token, dirty]);
  useEffect(() => {
    return () => holdUnsentWork(token, null);
  }, [token]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (isDeliberateReload()) return;
      e.preventDefault();
      // Legacy opt-in some engines still require; the shown text is the
      // browser's own, never this string.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}
