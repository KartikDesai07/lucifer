"use client";

import { useCallback, useMemo, type MutableRefObject } from "react";

import { PRINT_HOST_MAX_AGE_MS } from "@pos/shared/print-job";
import { usePrintHostRouting } from "@/components/layout/PosPulseProvider";
import { useCanPrintNow } from "@/hooks/use-device-printer";
import { useHostRouting } from "@/hooks/use-host-routing";
import { useNativeHostBackground } from "@/hooks/use-native-host";
import { usePrintAgent } from "@/hooks/use-print-agent";
import { usePrintHostBeat } from "@/hooks/use-print-host-beat";
import { usePrintHostDrainLock } from "@/hooks/use-print-host-lock";
import { usePrintHostPrinterBeat } from "@/hooks/use-print-host-printer-beat";
import { usePrintHostWakeLock } from "@/hooks/use-print-host-wake-lock";
import { useSelfOrderAutoPrint } from "@/hooks/use-self-order-auto-print";
import { printJobRefOf } from "@/lib/print-agent-calls";
import type { HostPrintDone } from "@/lib/print-host-outcomes";
import type { HostPrintSlip } from "@/lib/print-host-slips";
import { kotPrintJob } from "@/lib/print-routing";
import type { Order } from "@/types";

interface PrintHostDrainProps {
  /** `isHostDevice && surfacesMounted` — this device is the print host, and its print surfaces exist. */
  enabled: boolean;
  /** The print surfaces exist. With no host, every device is the agent for its own line (spec §6.6). */
  surfacesMounted: boolean;
  deviceId: string;
  tabId: string;
  busy: boolean;
  claimLockRef: MutableRefObject<boolean>;
  onSlip: (slip: HostPrintSlip, done?: HostPrintDone) => void;
  onDemoted: () => void;
}

// Print-host plan §B5/§B6 (PH-5), Phase 1 Session 1C — the print agent and the host's own lanes in one
// null-rendering child of PrintHostProvider, so a payload-changing tick re-renders THIS and nothing on
// screen. The agent (hooks/use-print-agent.ts) leases this device's line, prints through the provider's
// bridge, then acks: the host leases for the whole cafe, and with no host every device leases its own
// slips (spec §6.6, R6). It replaces the claim drain and the host's GET wake poll, which stay in the
// codebase for one release, unused here (a tab from before Phase 1 still runs them itself). The
// heartbeat, the wake lock, the app's background service and the self-order lane stay host-only.
export function PrintHostDrain({ enabled, surfacesMounted, deviceId, tabId, busy, claimLockRef, onSlip, onDemoted }: PrintHostDrainProps) {
  // Written as host/unknown checks (D-11): an unknown lane waits for the pulse rather than guess.
  const routing = usePrintHostRouting();
  const isAgent = enabled || (surfacesMounted && deviceId !== "" && routing !== "host" && routing !== "unknown");
  // Exactly one draining window per device (MERGED-23), asked for only by a window that can print right
  // now: a printer that is off, or open in another tab, hands the lock on, so a line is never leased
  // for a printer that cannot print (the owner's rule after Session 1B).
  const canPrint = useCanPrintNow();
  const holdsLock = usePrintHostDrainLock(isAgent && canPrint);
  const drains = isAgent && holdsLock;
  const hostDrains = enabled && holdsLock;

  usePrintHostWakeLock(enabled);
  usePrintHostBeat({ enabled, deviceId, onDemoted });
  usePrintHostPrinterBeat({ enabled, deviceId, onDemoted });
  useNativeHostBackground(enabled);

  // The host's self-order lane hands a claimed KOT to the agent (ruling R4, job-aware lane): the claim
  // made it a print job, or, when the answer names none, the routed enqueue makes it one under the
  // same key. Never a local print outside the queue, so it can never print twice.
  const { routePrint } = useHostRouting();
  const queueKotRound = useCallback(
    (order: Order, round: number = order.kotRounds) =>
      routePrint(() => kotPrintJob(order, round), () => undefined, printJobRefOf(order, "kot")),
    [routePrint],
  );
  const hostLane = useMemo(() => ({ claimLock: claimLockRef, maxAgeMs: PRINT_HOST_MAX_AGE_MS }), [claimLockRef]);
  useSelfOrderAutoPrint({ enabled: hostDrains, busy, queueKotRound, hostLane });

  usePrintAgent({ enabled: drains, isHost: enabled, deviceId, tabId, busy, queueSlip: onSlip });

  return null;
}
