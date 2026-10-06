"use client";

import { useRef } from "react";
import { useReactToPrint } from "react-to-print";

import { slipPrintOptions } from "@/lib/desktop-shell";
import type { PaperWidth } from "@/lib/constants";
import { receiptPageStyle } from "@/lib/print";
import { tokenPrintJob } from "@/lib/print-routing";
import type { PrintRoutingHost } from "@/hooks/use-host-routing";
import type { Order } from "@/types";

interface UseTokenPrintArgs {
  /** The order the sheet shows; the token button is rendered only for one that holds a token number. */
  order: Order | null;
  /** The sheet's own routing primitive, so the token joins its single serialized chain and `enqueuePending`. */
  routePrint: PrintRoutingHost["routePrint"];
  /** The sheet's guard that keeps a deferred local fallback from printing a different order. */
  localPrintOf: (target: Order, trigger: () => void) => () => void;
  /** The token prints at the BILL's paper width, wherever the bill prints. */
  billPaperWidth: PaperWidth;
}

/** The Orders sheet's token reprint: its own react-to-print job on an off-screen `TokenSlip`, routed through
 *  the lanes the bill uses. Staff asked for it, so it is always `reprint: true` (a DUPLICATE; without the flag
 *  the job would collide with the token the POS already printed and appear nowhere). */
export function useTokenPrint({ order, routePrint, localPrintOf, billPaperWidth }: UseTokenPrintArgs) {
  const tokenRef = useRef<HTMLDivElement>(null);
  const print = useReactToPrint(slipPrintOptions({
    contentRef: tokenRef,
    documentTitle: order ? `TOKEN-${order.orderId}` : "token",
    pageStyle: receiptPageStyle(billPaperWidth),
  }));

  const printToken = () => {
    if (!order) return;
    routePrint(() => tokenPrintJob(order, { reprint: true }), localPrintOf(order, print));
  };

  return { tokenRef, printToken };
}
