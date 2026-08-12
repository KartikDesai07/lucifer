"use client";

import { useCallback, useState } from "react";

import type { Order, OrderItem, OrderVoid } from "@/types";

export type KotVariant = "kot" | "void";

// Print-signal state for the POS terminal, extracted out of usePosTab to keep
// that file under the line budget. Owns "what to print next" — the page reacts
// to shouldPrintReceipt / shouldPrintKot to drive react-to-print and clears the
// flags once fired (see pos/page.tsx's print-sequencing effects).
export function usePosPrint() {
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [kotRoundItems, setKotRoundItems] = useState<OrderItem[] | null>(null);
  const [kotRoundLabel, setKotRoundLabel] = useState<string | undefined>();
  // "void" swaps KOTReceipt's header for the cancellation banner; must never
  // survive past the slip it was queued for (see the two resets below).
  const [kotVariant, setKotVariant] = useState<KotVariant>("kot");
  const [voidReason, setVoidReason] = useState<string | undefined>();
  // Who voided the line and when it happened — a void slip identifies the
  // person who acted and the moment, not the tab's opener/open-time (CR1.3
  // review). Reset alongside voidReason so neither a fresh round nor a plain
  // reprint can inherit an earlier void's attribution.
  const [voidedBy, setVoidedBy] = useState<string | undefined>();
  const [voidedAt, setVoidedAt] = useState<string | undefined>();
  const [shouldPrintReceipt, setShouldPrintReceipt] = useState(false);
  const [shouldPrintKot, setShouldPrintKot] = useState(false);

  // Queue the kitchen ticket for one fired round of an order — used both after
  // a fresh fire (applyTabUpdate) and after a counter sale (confirmPayment's
  // Pay Now branch), since POST /api/orders stamps every opening line with
  // kotRound: 1 too, making a counter sale a real KOT round server-side.
  const queueKotRound = useCallback((order: Order) => {
    setLastOrder(order);
    setKotRoundItems(order.items.filter((it) => it.kotRound === order.kotRounds));
    setKotRoundLabel(`Round ${order.kotRounds}`);
    // A real round must never inherit a void banner queued by an earlier print.
    setKotVariant("kot");
    setVoidReason(undefined);
    setVoidedBy(undefined);
    setVoidedAt(undefined);
    setShouldPrintKot(true);
  }, []);

  // Queue the kitchen's VOID slip for one void-trail entry. The synthesized
  // line carries the VOIDED qty (not what remains on the line) plus the
  // preparation fields snapshotted onto the entry, so on a tab holding two
  // covers of the same dish made differently the kitchen can tell WHICH one to
  // stop (CR1.3 review) — never hardcode these to ""/[] again.
  // voidedBy/voidedAt travel too, and the slip prints THEM rather than the tab's
  // opener and open time: the kitchen needs to know who cancelled the dish just now.
  const queueVoidSlip = useCallback((order: Order, entry: OrderVoid) => {
    setLastOrder(order);
    setKotRoundItems([
      {
        productId: entry.productId,
        name: entry.name,
        price: entry.price,
        qty: entry.qty,
        modifiers: entry.modifiers ?? [],
        instructions: entry.instructions ?? "",
        kotRound: entry.kotRound,
      },
    ]);
    setKotRoundLabel(`Round ${entry.kotRound}`);
    setKotVariant("void");
    setVoidReason(entry.reason);
    setVoidedBy(entry.voidedBy);
    setVoidedAt(entry.at);
    setShouldPrintKot(true);
  }, []);

  // Reprint the whole current order's KOT (no round filter).
  const reprintKot = useCallback(() => {
    setKotRoundItems(null);
    setKotRoundLabel(undefined);
    // A plain reprint must never inherit a void banner queued earlier.
    setKotVariant("kot");
    setVoidReason(undefined);
    setVoidedBy(undefined);
    setVoidedAt(undefined);
    setShouldPrintKot(true);
  }, []);

  // Stable so the page's print effects only re-run when a print signal flips.
  const clearPrintReceipt = useCallback(() => setShouldPrintReceipt(false), []);
  const clearPrintKot = useCallback(() => setShouldPrintKot(false), []);

  return {
    lastOrder,
    setLastOrder,
    kotRoundItems,
    kotRoundLabel,
    kotVariant,
    voidReason,
    voidedBy,
    voidedAt,
    queueKotRound,
    queueVoidSlip,
    shouldPrintReceipt,
    setShouldPrintReceipt,
    clearPrintReceipt,
    shouldPrintKot,
    clearPrintKot,
    reprintKot,
  };
}
