"use client";

import { useSyncExternalStore } from "react";

// Whether the browser says it is online (navigator.onLine), kept fresh by the window's online / offline events: the
// sign-in and lock screens' "Online" chip (the owner's HTML, values 4.2). No request and no timer: the browser's own
// flag only. A server render (and the first hydration pass) reads online.

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

const readOnline = (): boolean => navigator.onLine;
const serverOnline = (): boolean => true;

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, readOnline, serverOnline);
}
