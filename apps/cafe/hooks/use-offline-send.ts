"use client";

// Send to Kitchen and Pay Now while offline (Printing Phase 5, spec 5.3–5.7; plan Tasks 11–12): the send controller's
// `keepOffline` and `parkHeld` ports, and Offline orders' "Print KOT here". Each reads what the device holds at the tap
// (the menu, the last printers read with its stations, the printers this device can print now, the last pulse's host)
// and runs lib/offline-keep.ts: the entry first, then each here line through the page's one bridge.

import { useCallback, useMemo } from "react";
import { toast } from "sonner";

import { usePrintHostRouting } from "@/components/layout/PosPulseProvider";
import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { useDesktopPrinters, usePoolView, usePrintersRead } from "@/hooks/use-agent-printers";
import { useCategories } from "@/hooks/use-categories";
import { useProducts } from "@/hooks/use-products";
import { offlineHereOf, offlineSlipFor } from "@/lib/offline-here";
import { keepOfflineSend, printEntryHere, type OfflineKeepDeps } from "@/lib/offline-keep";
import { offlineLineSlip, offlineRoutingOf } from "@/lib/offline-lines";
import { offlineOutbox } from "@/lib/offline-outbox-store";
import { offlineMenuOf, type OfflinePlanContext } from "@/lib/offline-send";
import type { PosSendPorts, SendOfflineKept } from "@/lib/pos-send";
import { readDevicePrefs } from "@/lib/pos-device-prefs";
import { readyPrinterIds } from "@/lib/print-agent-seams";
import { shouldRoutePrint } from "@/lib/print-routing";
import { canPrintNow } from "@/lib/printer/print-lane";
import { serverReach } from "@/lib/server-reach";
import { cafeDateString } from "@/lib/utils";
import type { Order } from "@/types";

export { useOfflineFix } from "@/hooks/use-offline-fix";

/** A line's printer the device's last read does not name (an admin removed it meanwhile). */
const ANOTHER_PRINTER = "Another printer";

export interface OfflineSendPorts {
  keep: NonNullable<PosSendPorts["keepOffline"]>;
  park: NonNullable<PosSendPorts["parkHeld"]>;
}

/** What this device can do offline, read at call time (a function: the menu and the printers change). */
function useOfflineDevice(): () => { ctx: OfflinePlanContext; deps: OfflineKeepDeps } {
  const products = useProducts().data;
  const categories = useCategories().data;
  const { deviceId, isHostDevice, queueOfflineSlip } = usePrintHostContext();
  const routing = usePrintHostRouting();
  const { printers, stations } = usePrintersRead(deviceId !== "");
  const desktop = useDesktopPrinters();
  const pool = usePoolView();
  return useCallback(() => {
    const productList = products ?? [];
    const categoryList = categories ?? [];
    const here = offlineHereOf({ printers, deviceId, ready: readyPrinterIds(), desktop, pool });
    return {
      ctx: {
        menu: offlineMenuOf(productList, categoryList),
        routing: offlineRoutingOf({ printers, stations, products: productList, categories: categoryList }),
        hereIds: here.hereIds,
        // Simple mode prints here only when this device prints its own slips: no print host in the last pulse (an
        // unknown lane counts as one when this device has seen a host), or this device is the host.
        simple: { printsOwnSlips: isHostDevice || !shouldRoutePrint(routing, readDevicePrefs().printHostSeen), canPrintNow: canPrintNow() },
      },
      deps: {
        update: offlineOutbox.update,
        slipOf: (line, ref) => offlineSlipFor(offlineLineSlip(line, ref, cafeDateString()), line.printerId, here),
        print: (slip) => queueOfflineSlip(slip),
        nameOf: (printerId) => printers.find((printer) => printer.id === printerId)?.name ?? ANOTHER_PRINTER,
      },
    };
  }, [products, categories, printers, stations, deviceId, isHostDevice, queueOfflineSlip, routing, desktop, pool]);
}

export function useOfflineSend(): OfflineSendPorts {
  const device = useOfflineDevice();
  const keep = useCallback<OfflineSendPorts["keep"]>(
    async (job, key) => {
      const { ctx, deps } = device();
      const facts = job.offline;
      // Only a send made while offline prints by itself (S3); a round on an order made offline sent online waits.
      const request = { key, at: Date.now(), sale: job.kind === "pay", base: facts.base, body: facts.body, shownTotal: facts.shownTotal, print: serverReach.isOffline(), ...ctx };
      const result = await keepOfflineSend(request, deps);
      return result.kept ? { kept: true, message: result.message } : { kept: false, message: result.message };
    },
    [device],
  );
  // Spec 5.7: a held send parked once offline is uncertain and prints nothing by itself (Print KOT here does).
  const park = useCallback<OfflineSendPorts["park"]>(
    async (held) => {
      const { ctx, deps } = device();
      const facts = held.offline;
      const request = { key: held.key, at: held.at, sale: held.kind === "pay", base: facts.base, body: facts.body, shownTotal: facts.shownTotal, print: false, uncertain: true, ...ctx };
      return (await keepOfflineSend(request, deps)).kept;
    },
    [device],
  );
  return useMemo(() => ({ keep, park }), [keep, park]);
}

/** Offline orders' "Print KOT here" (spec 5.7): `base` is the tab a round was added to (null for a new order). */
export function useOfflinePrintHere(): (key: string, base: Order | null) => Promise<void> {
  const device = useOfflineDevice();
  return useCallback(
    async (key, base) => {
      const { ctx, deps } = device();
      const result = await printEntryHere(key, { ...ctx, base }, deps);
      if (result.printed) toast.success(result.message);
      else toast.error(OFFLINE_PRINT_HERE_REFUSED);
    },
    [device],
  );
}

/** Print KOT here found nothing to print here (its paper printed, it is being sent, or no printer here can print it). */
export const OFFLINE_PRINT_HERE_REFUSED = "Nothing to print here for this order.";

/** A kept send's end on the POS (spec 5.5–5.7): kept → its words, then `free` (the cart, the payment sheet); not kept →
 *  why, and the cart stays as it is. Already kept (no words): free only. */
export function offlineDone(free: () => void): (kept: SendOfflineKept) => void {
  return (kept) => {
    if (!kept.kept) return void toast.error(kept.message);
    if (kept.message !== null) toast.success(kept.message);
    free();
  };
}
