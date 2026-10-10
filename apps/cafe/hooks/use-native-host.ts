"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { usePrintCapabilities } from "@/hooks/use-device-printer";
import { REFETCH_INTERVALS } from "@/lib/query";
import { nativeOn, nativeRequest } from "@/lib/printer/native-bridge";

// Bluetooth-print plan W4 — the POS app side of being the print host. While
// this device is the host and the app is on screen, ask the app to keep the
// printing service alive in the background (its notification reads "<label>
// prints all slips."); say so again whenever the page becomes visible, and let
// go on cleanup. The app's wake event (the screen came back, the network
// returned) refreshes the feeds ONCE -- it is a nudge on the existing pulse,
// never a new poll, and skipped while the pulse is fresher than one poll interval
// (a wake that lands right after a poll would just stack a second fetch on it). The app owns the printer link itself, so nothing else is
// done here, and a failed request is silent: the next visibility change retries.
export const NATIVE_HOST_FALLBACK_LABEL = "This device";

function tell(active: boolean): void {
  const params = active ? { active, label: NATIVE_HOST_FALLBACK_LABEL } : { active };
  nativeRequest("host.background", params).catch(() => undefined);
}

// Phase 3 Session 3D (spec §9.5): the POS app keeps this device's wish to print across restarts, so a page that KNOWS
// this device prints nothing for the cafe (`decided`: its role and the printers are known) says so once: a wish an
// earlier page left (the device stopped printing while its page reloaded) is dropped, with no notice and no service.
// Turning it off is a local call and always safe, even while hidden; a page that does not know yet says nothing.
export function useNativeHostBackground(enabled: boolean, decided: boolean): void {
  const qc = useQueryClient();
  // Reactive: an old WebView can get its bridge after the first scripts ran.
  const hasBridge = usePrintCapabilities().native;

  useEffect(() => {
    if (!enabled || !hasBridge) return;
    const announce = (): void => {
      if (document.visibilityState === "visible") tell(true);
    };
    announce();
    document.addEventListener("visibilitychange", announce);
    const offWake = nativeOn("app.wake", () => {
      const updatedAt = qc.getQueryState(POS_PULSE_KEYS.all)?.dataUpdatedAt ?? 0;
      if (Date.now() - updatedAt <= REFETCH_INTERVALS.POS_PULSE) return;
      void qc.invalidateQueries({ queryKey: POS_PULSE_KEYS.all });
    });
    return () => {
      document.removeEventListener("visibilitychange", announce);
      offWake();
      tell(false);
    };
  }, [enabled, hasBridge, qc]);

  useEffect(() => {
    if (!hasBridge || enabled || !decided) return;
    tell(false);
  }, [enabled, hasBridge, decided]);
}
