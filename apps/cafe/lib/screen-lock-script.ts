// The screen lock's no-flash pieces, with no imports at all: the dashboard layout is a server component, and
// lib/screen-lock.ts (which re-exports these) reaches a "use client" module, so the layout reads only this file.

export const SCREEN_LOCK_STORAGE_KEY = "pos.lock.v1";
export const LOCK_ATTR = "data-pos-locked";
export const LOCK_READY_ATTR = "data-pos-lock-ready";

// A CONSTANT STRING (no interpolation) run in a plain script before first paint, so a reload never flashes the
// dashboard: it sets LOCK_ATTR on <html> when the stored state says locked. It has none of the three characters
// React escapes in a script child, and uses nested ifs rather than a logical-and. localStorage and document are
// free names so a test can run it with fakes.
export const SCREEN_LOCK_SCRIPT =
  "try{" +
  'var s=JSON.parse(localStorage.getItem("pos.lock.v1"));' +
  "if(s){" +
  "if(s.locked===true){" +
  'document.documentElement.setAttribute("data-pos-locked","");' +
  "}" +
  "}" +
  "}catch(e){}";
