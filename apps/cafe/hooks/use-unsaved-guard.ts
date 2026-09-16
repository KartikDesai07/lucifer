"use client";

import { useEffect } from "react";

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
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy opt-in some engines still require; the shown text is the
      // browser's own, never this string.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}
