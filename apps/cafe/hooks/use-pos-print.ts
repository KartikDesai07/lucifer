"use client";

import { useCallback, useState } from "react";

import { usePrintRouting } from "@/hooks/use-print-routing";
import { voidLineInstructionsWithRewardMarker } from "@/lib/print-routing";
import type { Order, OrderItem, OrderVoid } from "@/types";

export type KotVariant = "kot" | "void" | "moved" | "test";
/** The subset `KOTReceipt` itself renders. `"test"` is PH-5's provider-owned
 *  test slip, which renders its OWN component through the same bridge — it
 *  never reaches `KOTReceipt`, whose prop union is "kot"|"void"|"moved". */
export type KotReceiptVariant = Exclude<KotVariant, "test">;

// Print-signal state for the POS terminal, extracted out of usePosTab to keep
// that file under the line budget. Owns "what to print next" — the page reacts
// to shouldPrintReceipt / shouldPrintKot to drive react-to-print and clears the
// flags once fired (see pos/page.tsx's print-sequencing effects).
// PH-4: the queue functions this hook RETURNS are the routed wrappers from
// usePrintRouting — the local `const`s below are the no-host path they fall
// back to, and nothing outside this file calls them directly.
export function usePosPrint() {
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [kotRoundItems, setKotRoundItems] = useState<OrderItem[] | null>(null);
  const [kotRoundLabel, setKotRoundLabel] = useState<string | undefined>();
  // The number printed on the slip about to go out. Read off the ORDER (the
  // server allocated and stored it), never derived here — the same round
  // reprinted must show the ticket the kitchen is already holding.
  const [kotRoundNumber, setKotRoundNumber] = useState<number | undefined>();
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
  // `round` defaults to the order's OWN latest round, so every existing
  // 1-arg call site is unchanged. CR2.3 §20 — the diner self-order auto-print
  // path is the one caller that passes it explicitly: a staff round fired
  // inside the ≤20s pulse window can bump order.kotRounds past the accepted
  // self-order's own round, and without pinning to the round the auto-print
  // handler actually claimed, the printed slip would show the STAFF's round
  // while the diner's round never prints.
  const queueKotRound = useCallback((order: Order, round: number = order.kotRounds) => {
    setLastOrder(order);
    setKotRoundItems(order.items.filter((it) => it.kotRound === round));
    setKotRoundLabel(`Round ${round}`);
    // Round n's ticket number lives at kotNumbers[n-1]. Absent — or the 0 the
    // route stores for a round fired while numbering was off — means this round
    // was never numbered, and the slip simply carries no number line. Guarding
    // on > 0 keeps that sentinel off the paper as "#0".
    const ticket = order.kotNumbers?.[round - 1];
    setKotRoundNumber(ticket !== undefined && ticket > 0 ? ticket : undefined);
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
        // The size that was voided. Without it the slip reads "Sp. Coco" on a tab
        // holding both a Small and a Large, and the cook has to guess which cover
        // to stop — the same "name the exact cover" rule the modifiers/instructions
        // below already exist for (CR1.3).
        variation: entry.variation,
        price: entry.price,
        qty: entry.qty,
        modifiers: entry.modifiers ?? [],
        instructions: voidLineInstructionsWithRewardMarker(entry.instructions ?? "", entry.reward),
        kotRound: entry.kotRound,
        // CB-5B S14-remainder — same OMIT-EMPTY carry as print-routing.ts's
        // voidPrintJob twin, so the LOCAL print path also knows this line was
        // comped (KOTReceipt renders an OrderItem[], and OrderItem.reward is
        // the same flag a fired round's line already carries).
        ...(entry.reward ? { reward: true as const } : {}),
      },
    ]);
    setKotRoundLabel(`Round ${entry.kotRound}`);
    // A void slip carries its OWN ticket number, not the number of the round
    // that made the dish — it is a separate piece of paper the kitchen has to
    // reconcile. Absent when the cafe excludes voids from the series.
    setKotRoundNumber(entry.kotNumber);
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
    // Deliberately unnumbered: this slip lists EVERY item on the tab, so it
    // matches no single ticket the kitchen was ever handed. Stamping it with a
    // round's number would put that number on two different pieces of paper
    // listing different food.
    setKotRoundNumber(undefined);
    // A plain reprint must never inherit a void banner queued earlier.
    setKotVariant("kot");
    setVoidReason(undefined);
    setVoidedBy(undefined);
    setVoidedAt(undefined);
    setShouldPrintKot(true);
  }, []);

  // The customer bill for a just-settled / just-paid tab. Both confirmPayment
  // branches call this instead of hand-setting lastOrder + shouldPrintReceipt,
  // so the routing seam has ONE bill entry point to wrap.
  const queueReceipt = useCallback((order: Order) => {
    setLastOrder(order);
    setShouldPrintReceipt(true);
  }, []);

  // Stable so the page's print effects only re-run when a print signal flips.
  const clearPrintReceipt = useCallback(() => setShouldPrintReceipt(false), []);
  const clearPrintKot = useCallback(() => setShouldPrintKot(false), []);

  // Every queue function above is the LOCAL path. When a print host owns
  // printing, these enqueue instead — same signatures, so no call site changes.
  const routed = usePrintRouting({
    // `setLastOrder` travels too: the routed lane runs NONE of the four
    // functions above, and `lastOrder` is not a print signal — PosHeader gates
    // the KOT reprint button on it and `reprintKot` needs it to build a
    // payload, so a host-configured device must still record the tab.
    local: { queueKotRound, queueVoidSlip, reprintKot, queueReceipt, setLastOrder },
    lastOrder,
  });

  return {
    lastOrder,
    setLastOrder,
    kotRoundItems,
    kotRoundLabel,
    kotRoundNumber,
    kotVariant,
    voidReason,
    voidedBy,
    voidedAt,
    queueKotRound: routed.queueKotRound,
    queueVoidSlip: routed.queueVoidSlip,
    shouldPrintReceipt,
    setShouldPrintReceipt,
    clearPrintReceipt,
    shouldPrintKot,
    clearPrintKot,
    reprintKot: routed.reprintKot,
    queueReceipt: routed.queueReceipt,
    queueMovedSlip: routed.queueMovedSlip,
    hostConfigured: routed.hostConfigured,
  };
}
