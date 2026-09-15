"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { PrintHostDrain } from "@/components/print/PrintHostDrain";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { useClaimPrintJob } from "@/hooks/use-print-host";
import { usePrintHostBridge, type HostPrintCurrent } from "@/hooks/use-print-host-bridge";
import { mintTabId, readDeviceId } from "@/lib/pos-device-id";
import { readDevicePrefs, writeDevicePrefs } from "@/lib/pos-device-prefs";
import { PRINT_HOST_PRINT_FAILED_MESSAGE, hostPrintSlipOf } from "@/lib/print-host-slips";
import { cafeDateString } from "@/lib/utils";

// Print-host plan §B5 (PH-5) — the layout-level host provider. Mounted once,
// inside <PosPulseProvider>, on EVERY dashboard screen (owner Q7). Owns this
// device's host identity (`isHostDevice`), the ONE cross-lane claim lock
// (MERGED-05), the per-mount `tabId` half of `claimedBy` (MERGED-23), and the
// single bridge every host-side print goes through (use-print-host-bridge).
// The drain, the self-order lane and the heartbeat run in <PrintHostDrain>, a
// null-rendering child placed AFTER `children` — so its per-tick re-renders
// never touch the screen, and its effects register after the page's own.
// DARK until PH-7 writes `printHost: true` into a device's prefs: with the pref
// false nothing here beats, locks, claims or prints.

export interface PrintHostContextValue {
  /** This device holds the `printHost` pref — hydration-safe: false on the
   *  server pass and the first client render, seeded post-mount. */
  isHostDevice: boolean;
  /** This device's opaque id — "" on the server pass and until the post-mount
   *  read (F8). Exposed so consumers compare against the pulse's host binding
   *  without a second storage read of their own. */
  deviceId: string;
  tabId: string;
  /** What the bridge is printing right now, or null when idle. */
  current: HostPrintCurrent | null;
  kotRef: RefObject<HTMLDivElement | null>;
  receiptRef: RefObject<HTMLDivElement | null>;
  eodRef: RefObject<HTMLDivElement | null>;
  /** PrintHostEodSource's readiness report for the current eod slip. */
  setEodReady: (ready: boolean) => void;
  /** PH-7's "Test print": resolves with trigger→onAfterPrint ms (§B7). */
  queueTestSlip: () => Promise<number>;
  /** PH-7 calls this after writing the `printHost` pref so the lanes arm
   *  without a reload; the beat's demotion path clears it the same way. */
  syncHostPref: () => void;
  /** PH-8's host-only band "Print" for a STALE row (§B7, MERGED-06): claim it
   *  with THIS device's `deviceId:tabId`, then hand the bridge the slip. Resolves
   *  once the claim has answered (won, lost, or thrown) — never rejects. */
  printQueuedJob: (id: string) => Promise<void>;
  /** `PrintHostPrintSources` reports its mount/unmount here (2026-09-11). The
   *  drain claims nothing and the bridge dispatches nothing until the DOM the
   *  three refs point at actually exists — a job claimed while the sources sat
   *  behind MasterDataProvider's first-load placeholder burned its claim and
   *  wedged the bridge for the rest of the tab's life. */
  reportSurfacesMounted: (mounted: boolean) => void;
}

const PrintHostContext = createContext<PrintHostContextValue | null>(null);

export function usePrintHostContext(): PrintHostContextValue {
  const ctx = useContext(PrintHostContext);
  if (!ctx) {
    throw new Error("usePrintHostContext must be used inside <PrintHostProvider>");
  }
  return ctx;
}

export function PrintHostProvider({ children }: { children: ReactNode }) {
  // Per-mount, never persisted: two windows of one PC share a deviceId and
  // differ only here, so live legs can tell them apart in `claimedBy`.
  const [tabId] = useState(mintTabId);
  // localStorage reads happen in effects only (fresh-eyes F8): the server has
  // no window, and a first paint that disagrees with hydration is a mismatch.
  const [deviceId, setDeviceId] = useState("");
  const [prefHost, setPrefHost] = useState(false);
  useEffect(() => {
    setDeviceId(readDeviceId());
    setPrefHost(readDevicePrefs().printHost);
  }, []);

  const syncHostPref = useCallback(() => setPrefHost(readDevicePrefs().printHost), []);

  // The `isHost:false` beat answer / a `not-host` claim refusal (§B3, D-5):
  // this device is no longer the host, so clear the pref (read-modify-write,
  // never clobbering a concurrent alert toggle) and stop every lane at once.
  const demote = useCallback(() => {
    const prefs = readDevicePrefs();
    if (prefs.printHost) writeDevicePrefs({ ...prefs, printHost: false });
    setPrefHost(false);
  }, []);

  // "" means storage gave us no identity — the claim and beat CASes would be
  // refused outright, so the lanes stay off rather than POSTing blindly.
  const isHostDevice = prefHost && deviceId !== "";

  // ONE lock shared by both claiming lanes (self-order + print-job): set
  // synchronously before either `.mutate`, released in that mutation's
  // onSettled — after onSuccess has raised `busy`, so the other lane re-gates
  // on busy (§B5, MERGED-05).
  const claimLockRef = useRef(false);

  // Whether the print surfaces' DOM exists right now (see the context field).
  const [surfacesMounted, setSurfacesMounted] = useState(false);
  const reportSurfacesMounted = useCallback((mounted: boolean) => setSurfacesMounted(mounted), []);

  const bridge = usePrintHostBridge({ surfacesMounted });
  const { current, busy, kotRef, receiptRef, eodRef, setEodReady, queueSlip, queueKotRound, queueTestSlip } = bridge;

  // The band's manual print of a stale row lives HERE, not in the band: the
  // band section unmounts the moment its last row leaves the feed, and a
  // claim whose continuation died with it would burn the CAS (row `printed`)
  // without ever handing the bridge a slip. This provider never unmounts. Same
  // lock discipline as the manual self-order path (held around the claim so
  // the drain cannot claim in the same window); the bridge's FIFO absorbs a
  // tap that lands mid-print. The drain never touches D2, so without this the
  // >30-min backlog could only ever be dismissed.
  const { mutateAsync: claimAsync } = useClaimPrintJob();
  const qc = useQueryClient();
  const printQueuedJob = useCallback(
    async (id: string) => {
      if (deviceId === "") return;
      claimLockRef.current = true;
      try {
        let result: Awaited<ReturnType<typeof claimAsync>>;
        try {
          result = await claimAsync({ id, deviceId, tabId });
        } catch {
          // The claim hook's own onError toasted; nothing was handed to the bridge.
          return;
        }
        if (!result.claimed) {
          // `raced` / `not-found` / `not-eligible` / `invalid-payload`: the row
          // leaves the feed on the next tick — silent, exactly like the drain.
          if (result.reason === "not-host") demote();
          return;
        }
        // The claim is WON (the row is `printed`) — from here a throw is a
        // burned claim with no paper, so it must be said out loud, not swallowed
        // by the claim's own catch above (adapter is pure over a payload the
        // claim path already Zod-validated; deploy-skew is the only way in).
        try {
          queueSlip(hostPrintSlipOf(result.job.payload, cafeDateString()));
        } catch {
          toast.error(PRINT_HOST_PRINT_FAILED_MESSAGE);
        }
      } finally {
        claimLockRef.current = false;
        // Refresh the feeds now rather than on the 20s tick: the row leaves the
        // band, and — the drain effect keys on the FEED, not on this ref — a
        // changed feed is what wakes the automatic drain after the lock drops.
        void qc.invalidateQueries({ queryKey: POS_PULSE_KEYS.all });
      }
    },
    [claimAsync, deviceId, tabId, queueSlip, demote, qc],
  );

  const value = useMemo<PrintHostContextValue>(
    () => ({ isHostDevice, deviceId, tabId, current, kotRef, receiptRef, eodRef, setEodReady, queueTestSlip, syncHostPref, printQueuedJob, reportSurfacesMounted }),
    [isHostDevice, deviceId, tabId, current, kotRef, receiptRef, eodRef, setEodReady, queueTestSlip, syncHostPref, printQueuedJob, reportSurfacesMounted],
  );

  // The lanes arm only once the surfaces exist: a claim is a CAS that marks the
  // row printed, so it must never be won before there is a place to print it.
  return (
    <PrintHostContext.Provider value={value}>
      {children}
      <PrintHostDrain
        enabled={isHostDevice && surfacesMounted}
        deviceId={deviceId}
        tabId={tabId}
        busy={busy}
        claimLockRef={claimLockRef}
        onSlip={queueSlip}
        onKotRound={queueKotRound}
        onDemoted={demote}
      />
    </PrintHostContext.Provider>
  );
}
