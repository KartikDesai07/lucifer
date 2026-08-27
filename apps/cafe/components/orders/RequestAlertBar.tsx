"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Volume2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { usePosPulseContext } from "@/components/layout/PosPulseProvider";
import { readDevicePrefs, type PosDevicePrefs } from "@/lib/pos-device-prefs";
import { SELF_ORDER_ALERT_LIMITATION } from "@pos/shared/self-order-alert";

const REQUESTS_PATH = "/requests";
const TRUNCATED_LABEL = "50+";
const DEFAULT_PREFS: PosDevicePrefs = { autoPrintSelfOrders: false, alertSound: true };

// CR2.3 §20 — the compact, always-mounted staff-attention bar: rendered once
// in the dashboard layout, under the header, above every screen. `null` when
// there's nothing to say (no open requests AND no unprinted self-order) —
// this must stay slim, it sits above whatever the operator is doing.
export function RequestAlertBar() {
  const { pulse, soundUnlocked, unlock, printHandler } = usePosPulseContext();
  const [prefs, setPrefs] = useState<PosDevicePrefs>(DEFAULT_PREFS);
  // Requests whose Print button was tapped and hasn't left the payload yet
  // (review C5): the claim round-trip plus one pulse tick pass before a
  // printed row drops out, and an un-disabled button double-taps into a
  // misleading "already printed" race.
  const [tappedIds, setTappedIds] = useState<ReadonlySet<string>>(new Set());

  // Re-read the device pref on mount and again whenever the pulse's own
  // shape changes meaningfully — self-corrects within one tick (~20s) if a
  // toggle on /requests (DeviceAlertSettings) changed it while this bar
  // stayed mounted across the route change.
  useEffect(() => {
    setPrefs(readDevicePrefs());
  }, [pulse?.openRev, pulse?.selfOrders.length]);

  const openCount = pulse?.openCount ?? 0;
  const unprinted = pulse?.selfOrders.filter((row) => !row.printed) ?? [];

  // A printed/expired row leaves the payload on the next tick — dropping its
  // id re-enables nothing (the button is gone) and keeps the set from
  // growing across a whole shift.
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

  if (openCount === 0 && unprinted.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 border-b bg-amber-50 px-4 py-2 text-sm dark:bg-amber-950/40">
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

      {!soundUnlocked && prefs.alertSound && (
        <Button size="sm" variant="ghost" onClick={unlock}>
          <Volume2 className="mr-1" /> Enable sound
        </Button>
      )}

      <p className="ml-auto text-xs text-muted-foreground">{SELF_ORDER_ALERT_LIMITATION}</p>
    </div>
  );
}
