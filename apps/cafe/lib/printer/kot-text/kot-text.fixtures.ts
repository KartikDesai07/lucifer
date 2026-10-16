import { KOT_PROP_SETS } from "../../print-template-golden.fixtures"; // FIRST: React's production build
import type { HostKotSlip } from "@/lib/print-host-slips";

// The text KOT tests' slips (printing Phase 4): the Classic golden's KOT prop sets as the print bridge hands them over
// (print-host-slips.ts HostKotSlip), so the text side and the picture side read the same orders.

/** A golden prop set as the print bridge's slip. Throws for a set with no order (the bridge never has one). */
export function slipOf(id: string, over: Partial<HostKotSlip> = {}): HostKotSlip {
  const set = KOT_PROP_SETS.find((s) => s.id === id);
  if (set === undefined || set.order === null) throw new Error(`prop set ${id} has no order`);
  const e = set.extra;
  return {
    surface: "kot",
    order: set.order,
    kotRoundItems: e.roundItems,
    kotRoundLabel: e.roundLabel,
    kotRoundNumber: e.roundNumber,
    kotVariant: e.variant ?? "kot",
    voidReason: e.reason,
    voidedBy: e.voidedBy,
    voidedAt: e.voidedAt,
    movedFrom: e.movedFrom,
    movedBy: e.movedBy,
    movedAt: e.movedAt,
    banner: e.banner,
    documentTitle: `kot-${set.order.orderId}`,
    ...over,
  };
}

/** Each printed piece as `<size><B><I><align>|text|`, or `feed n`: a golden line list. */
export function shownPieces(pieces: ReadonlyArray<{ text: string; size: string; bold: boolean; invert: boolean; align: string } | { feedDots: number }>): string[] {
  return pieces.map((p) =>
    "text" in p ? `${p.size.padEnd(6)}${p.bold ? "B" : " "}${p.invert ? "I" : " "}${p.align[0]}|${p.text}|` : `feed ${p.feedDots}`,
  );
}
