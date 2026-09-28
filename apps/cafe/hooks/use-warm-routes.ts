"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { WARM_ROUTES_INTERVAL_MS, warmRoutes } from "@/lib/warm-routes";

// Keeps `hrefs` fully prefetched while this component is mounted, so a click
// on one of them renders from the router cache instead of waiting for the
// network (the rule and its reasons: lib/warm-routes.ts). Re-offers them on a
// short beat and whenever the tab comes back into view; a hidden or offline
// tab sends nothing. Prefetching is a no-op in `next dev` (Next skips it
// there), so this only has an effect in a production build.
export function useWarmRoutes(hrefs: readonly string[]): void {
  const router = useRouter();
  // A stable string key: the caller may rebuild the array every render.
  const key = hrefs.join("\n");

  useEffect(() => {
    const list = key ? key.split("\n") : [];
    if (list.length === 0) return;
    const tick = () =>
      warmRoutes(list, (href) => router.prefetch(href), {
        visible: document.visibilityState === "visible",
        online: navigator.onLine !== false,
      });
    tick();
    const timer = window.setInterval(tick, WARM_ROUTES_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", tick);
    };
  }, [router, key]);
}
