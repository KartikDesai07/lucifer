"use client";

// Send to Kitchen and Pay Now while offline (Printing Phase 5, spec 5.3–5.6; plan Task 11): the send controller's
// `keepOffline` port. It reads what the device holds at the tap (the menu, the last printers read with its stations,
// the printers this device can print now, the last pulse's host) and runs lib/offline-keep.ts: the entry first, then
// each here line through the page's one bridge. The paper prints behind the cart: the send answers once it is kept.

import { useCallback } from "react";
import { toast } from "sonner";

import { usePrintHostRouting } from "@/components/layout/PosPulseProvider";
import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { useDesktopPrinters, usePoolView, usePrintersRead } from "@/hooks/use-agent-printers";
import { useCategories } from "@/hooks/use-categories";
import { useProducts } from "@/hooks/use-products";
import { offlineHereOf, offlineSlipFor } from "@/lib/offline-here";
import { keepOfflineSend } from "@/lib/offline-keep";
import { offlineLineSlip, offlineRoutingOf } from "@/lib/offline-lines";
import { offlineOutbox } from "@/lib/offline-outbox-store";
import { offlineMenuOf } from "@/lib/offline-send";
import type { PosSendPorts, SendOfflineKept } from "@/lib/pos-send";
import { readDevicePrefs } from "@/lib/pos-device-prefs";
import { readyPrinterIds } from "@/lib/print-agent-seams";
import { shouldRoutePrint } from "@/lib/print-routing";
import { canPrintNow } from "@/lib/printer/print-lane";
import { serverReach } from "@/lib/server-reach";
import { cafeDateString } from "@/lib/utils";

/** A line's printer the device's last read does not name (an admin removed it meanwhile). */
const ANOTHER_PRINTER = "Another printer";

export function useOfflineSend(): NonNullable<PosSendPorts["keepOffline"]> {
  const products = useProducts().data;
  const categories = useCategories().data;
  const { deviceId, isHostDevice, queueOfflineSlip } = usePrintHostContext();
  const routing = usePrintHostRouting();
  const { printers, stations } = usePrintersRead(deviceId !== "");
  const desktop = useDesktopPrinters();
  const pool = usePoolView();
  return useCallback(
    async (job, key) => {
      const productList = products ?? [];
      const categoryList = categories ?? [];
      const here = offlineHereOf({ printers, deviceId, ready: readyPrinterIds(), desktop, pool });
      const result = await keepOfflineSend(
        {
          key,
          at: Date.now(),
          sale: job.kind === "pay",
          base: job.offline.base,
          body: job.offline.body,
          shownTotal: job.offline.shownTotal,
          menu: offlineMenuOf(productList, categoryList),
          routing: offlineRoutingOf({ printers, stations, products: productList, categories: categoryList }),
          hereIds: here.hereIds,
          // Simple mode prints here only when this device prints its own slips: no print host in the last pulse (an
          // unknown lane counts as one when this device has seen a host), or this device is the host.
          simple: { printsOwnSlips: isHostDevice || !shouldRoutePrint(routing, readDevicePrefs().printHostSeen), canPrintNow: canPrintNow() },
          // Only a send made while offline prints by itself (S3); a round on an order made offline sent online waits.
          print: serverReach.isOffline(),
        },
        {
          update: offlineOutbox.update,
          slipOf: (line, ref) => offlineSlipFor(offlineLineSlip(line, ref, cafeDateString()), line.printerId, here),
          print: (slip) => queueOfflineSlip(slip),
          nameOf: (printerId) => printers.find((printer) => printer.id === printerId)?.name ?? ANOTHER_PRINTER,
        },
      );
      return result.kept ? { kept: true, message: result.message } : { kept: false, message: result.message };
    },
    [products, categories, printers, stations, deviceId, isHostDevice, queueOfflineSlip, routing, desktop, pool],
  );
}

/** A kept send's end on the POS (spec 5.5–5.6): kept → its words, then `free` (the cart, the payment sheet); not kept →
 *  why, and the cart stays as it is. Already kept (no words): free only. */
export function offlineDone(free: () => void): (kept: SendOfflineKept) => void {
  return (kept) => {
    if (!kept.kept) return void toast.error(kept.message);
    if (kept.message !== null) toast.success(kept.message);
    free();
  };
}
