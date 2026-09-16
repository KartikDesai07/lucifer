"use client";

import { useEffect } from "react";
import { SESSION_KEEPALIVE_SECONDS } from "@/lib/constants";

// CB-U1 — the 30-day session is ROLLING (@auth/core 0.41.2 re-signs on every
// GET /api/auth/session); a POS tab parked on /pos never navigates and /api
// is outside the middleware matcher, so nothing else rolls it. This raw fetch
// lets the response's Set-Cookie do the roll WITHOUT touching next-auth's
// client state — SessionProvider's own refetchInterval was rejected because
// fetchData() turns any transient failure into a null session (client shows
// "unauthenticated", interval stops). Offline ticks are skipped; failures are
// ignored (the next tick retries). Mounted in the dashboard layout only
// (staff screens).
const SESSION_ENDPOINT = "/api/auth/session";
const MS_PER_SECOND = 1000;

export function SessionKeepalive() {
  useEffect(() => {
    const id = window.setInterval(() => {
      if (navigator.onLine === false) return;
      void fetch(SESSION_ENDPOINT, { credentials: "same-origin", cache: "no-store" }).catch(() => undefined);
    }, SESSION_KEEPALIVE_SECONDS * MS_PER_SECOND);
    return () => window.clearInterval(id);
  }, []);
  return null;
}
