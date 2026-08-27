"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";

import { usePendingOrderRequests, useAcceptOrderRequest } from "@/hooks/use-order-requests";
import { usePosPrint } from "@/hooks/use-pos-print";
import { useKotPrintBridge } from "@/hooks/use-kot-print-bridge";
import { useSelfOrderAutoPrint } from "@/hooks/use-self-order-auto-print";
import { useSettings } from "@/hooks/use-settings";
import { printConfigOf } from "@/lib/print";
import { RequestsBoard } from "@/components/orders/RequestsBoard";
import { DeviceAlertSettings } from "@/components/orders/DeviceAlertSettings";
import { PrintSources } from "@/components/pos/PrintSources";
import { Button } from "@/components/ui/button";
import type { Order } from "@/types";

// Full-screen order-requests page (owner's ask — replaces the POS-screen
// tray; the sidebar's "Order Requests" entry opens this). Owns its own slice
// of the POS page's print bridge: KOT only, never the customer receipt (an
// accept never collects money) — the ref/effect pair below mirrors
// pos/page.tsx's own KOT sequencing (see its print-effects comment) for the
// one job this page needs.
export default function RequestsPage() {
  const settings = useSettings();
  const requests = usePendingOrderRequests(true);

  // ONE shared mutation instance for the whole page (never per-card) — its
  // hook-level onSettled always clears acceptingId even if the accepting
  // card has already dropped out of the list by the time the mutation
  // settles (hooks/use-order-requests.ts's own comment explains why a
  // per-call onSettled stranded this lock in the tray this page replaces).
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const acceptRequest = useAcceptOrderRequest({ onSettled: () => setAcceptingId(null) });

  const print = usePosPrint();
  const { lastOrder, shouldPrintKot, clearPrintKot, queueKotRound } = print;
  const printCfg = printConfigOf(settings.data);

  // Same guard-ref/fixed-id-iframe discipline as pos/page.tsx's own (lib/
  // print.ts's print-chain note, CR1.2) — collapsed onto the shared hook.
  // This page never fires a receipt job (an accept never collects money), so
  // `receipt` is omitted entirely.
  const { kotRef, printBusy } = useKotPrintBridge({
    lastOrder,
    shouldPrintKot,
    clearPrintKot,
    kotPaperWidth: printCfg.kot.paperWidth,
  });

  // CR2.3 §20 — this page owns the print bridge whenever it's mounted (the
  // sidebar's ONLY way in now that the POS-screen tray is gone), so it
  // registers auto-print too. Busy mirrors OrderRequestCard's own
  // acceptDisabled gate (OrderRequestCard.tsx:71) — a queued print job OR any
  // card mid-accept is not a safe moment to claim/print another ticket.
  useSelfOrderAutoPrint({
    enabled: true,
    busy: printBusy || acceptingId !== null,
    queueKotRound,
  });

  const handleAccepted = (order: Order) => {
    queueKotRound(order);
    // The mutation's own onSettled already invalidates ORDER_REQUEST_KEYS;
    // this refetch just picks that up sooner while staff are on this screen.
    requests.refetch();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Order requests</h2>
          <p className="text-sm text-muted-foreground">
            Accept a request to fire it to the kitchen, or reject it with a reason.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => requests.refetch()}
          disabled={requests.isFetching}
        >
          <RefreshCw className={requests.isFetching ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
          Refresh
        </Button>
      </div>

      <DeviceAlertSettings />

      <RequestsBoard
        requests={requests.data ?? []}
        isLoading={requests.isLoading}
        onAccepted={handleAccepted}
        acceptingId={acceptingId}
        onAcceptingChange={setAcceptingId}
        printBusy={shouldPrintKot}
        acceptMutate={acceptRequest.mutate}
      />

      <PrintSources
        order={print.lastOrder}
        settings={settings.data}
        kotRef={kotRef}
        kotRoundItems={print.kotRoundItems}
        kotRoundLabel={print.kotRoundLabel}
        kotRoundNumber={print.kotRoundNumber}
        kotVariant={print.kotVariant}
        voidReason={print.voidReason}
        voidedBy={print.voidedBy}
        voidedAt={print.voidedAt}
      />
    </div>
  );
}
