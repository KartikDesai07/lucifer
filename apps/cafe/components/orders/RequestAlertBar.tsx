"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Volume2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { usePosPulseContext, usePrintReadback } from "@/components/layout/PosPulseProvider";
import { PrintHostBandSection } from "@/components/orders/PrintHostBandSection";
import { readDevicePrefs, type PosDevicePrefs } from "@/lib/pos-device-prefs";
import { printBandVisible, printHostNoteOf } from "@/lib/print-readback";
import { alertBarSuppressedForPath, alertDetailForPath } from "@/lib/alert-bar-scope";
import { SELF_ORDER_ALERT_LIMITATION } from "@pos/shared/self-order-alert";
import { POS_ALERT_HEIGHT_VAR } from "@/lib/pos-layout";

const REQUESTS_PATH = "/requests";
const TRUNCATED_LABEL = "50+";
const DEFAULT_PREFS: PosDevicePrefs = { autoPrintSelfOrders: false, alertSound: true, printHost: false, printHostSeen: false };

// CR2.3 §20 — the compact, always-mounted staff-attention bar: rendered once in
// the dashboard layout, under the header, above every screen. `null` when there
// is nothing to say (no open requests, no unprinted self-order, and — PH-8 §B7 —
// no host warning / stale backlog / own outstanding job; that section renders
// INSIDE bandRef so the published height covers it). CB-UI2 scoping (the
// print-host block, the routing note, and POS): lib/alert-bar-scope.ts.
export function RequestAlertBar() {
  const { pulse, soundUnlocked, unlock, printHandler } = usePosPulseContext();
  const readback = usePrintReadback();
  const [prefs, setPrefs] = useState<PosDevicePrefs>(DEFAULT_PREFS);
  // Requests whose Print button was tapped and hasn't left the payload yet
  // (review C5): a round-trip plus one tick pass before a printed row drops.
  const [tappedIds, setTappedIds] = useState<ReadonlySet<string>>(new Set());

  // Re-read the device pref on mount and on a pulse shape change — self-
  // corrects within one tick (~20s) after a /requests toggle.
  useEffect(() => {
    setPrefs(readDevicePrefs());
  }, [pulse?.openRev, pulse?.selfOrders.length]);

  const openCount = pulse?.openCount ?? 0;
  const unprinted = pulse?.selfOrders.filter((row) => !row.printed) ?? [];

  // A printed/expired row leaves the payload on the next tick — dropping its id
  // re-enables nothing (the button is gone) and bounds the set across a shift.
  useEffect(() => {
    setTappedIds((prev) => {
      const live = new Set(unprinted.map((row) => row.requestId));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
    // unprinted is derived fresh each render — key on the pulse tick instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulse?.selfOrders]);

  const pathname = usePathname() ?? "";
  const onDashboard = alertDetailForPath(pathname);
  // MERGED-18: another device's in-flight job never flips this band; own work
  // does. CB-UI2: POS shows NO band — folding that into `visible` also drops
  // the published height, so the terminal reclaims the space.
  const visible = !alertBarSuppressedForPath(pathname) && (openCount > 0 || unprinted.length > 0 || printBandVisible(pulse, readback));
  const hostNote = printHostNoteOf(pulse, prefs.printHostSeen);
  const bandRef = useRef<HTMLDivElement | null>(null);
  // Publish the band's height for the POS root (POS_ALERT_HEIGHT_VAR) in a
  // layout effect so the first frame is right, then via ResizeObserver as the
  // content wraps. Never unmounts, so cleanup keys off `visible`.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const el = bandRef.current;
    if (!visible || !el) {
      root.style.removeProperty(POS_ALERT_HEIGHT_VAR);
      return;
    }
    const publish = () => root.style.setProperty(POS_ALERT_HEIGHT_VAR, `${el.offsetHeight}px`);
    publish();
    if (typeof ResizeObserver === "undefined") {
      return () => root.style.removeProperty(POS_ALERT_HEIGHT_VAR);
    }
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty(POS_ALERT_HEIGHT_VAR);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      ref={bandRef}
      className="flex flex-wrap items-center gap-3 border-b bg-amber-50 px-4 py-2 text-sm dark:bg-amber-950/40"
    >
      {openCount > 0 && (
        <Link href={REQUESTS_PATH} className="font-medium underline-offset-2 hover:underline">
          {pulse?.openTruncated ? TRUNCATED_LABEL : openCount} new order request
          {openCount === 1 ? "" : "s"}
        </Link>
      )}

      {unprinted.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">
            {unprinted.length} unprinted self-order{unprinted.length === 1 ? "" : "s"}
          </span>
          {printHandler ? (
            unprinted.map((row) => (
              <Button
                key={row.requestId}
                size="sm"
                variant="outline"
                disabled={tappedIds.has(row.requestId)}
                onClick={() => {
                  setTappedIds((prev) => new Set(prev).add(row.requestId));
                  printHandler(row.requestId);
                }}
              >
                Print round {row.kotRound}
              </Button>
            ))
          ) : (
            <Link href={REQUESTS_PATH} className="text-xs underline">
              Open requests to print
            </Link>
          )}
          {pulse?.selfOrdersTruncated && (
            <span className="text-xs text-muted-foreground">
              — more exist; reprint older ones from Orders
            </span>
          )}
        </div>
      )}

      <PrintHostBandSection pulse={pulse} readback={readback} />

      {!soundUnlocked && prefs.alertSound && (
        <Button size="sm" variant="ghost" onClick={unlock}>
          <Volume2 className="mr-1" /> Enable sound
        </Button>
      )}

      {onDashboard && <p className="ml-auto text-xs text-muted-foreground">{hostNote ?? SELF_ORDER_ALERT_LIMITATION}</p>}
    </div>
  );
}
