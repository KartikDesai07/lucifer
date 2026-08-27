import type { CartProps } from "@/components/pos/Cart";
import type { usePosTab } from "@/hooks/use-pos-tab";

type Pos = ReturnType<typeof usePosTab>;

// Builds the POS Cart panel's props from usePosTab's state — split out of
// pos/page.tsx (CR2.3 S2's own wiring pushed it past the ~300-line budget) so
// the desktop Cart and the MobileCartBar's sheet keep rendering the exact
// SAME object, by construction, wherever it's built. Pure derivation, no
// hooks of its own.
export function buildCartProps(pos: Pos, onVoidItem: () => void): CartProps {
  return {
    items: pos.cart,
    subtotal: pos.subtotal,
    discount: pos.discount,
    gstAmount: pos.gstAmount,
    gstRate: pos.gstRate,
    // Required, so the cart footer, the mobile sticky bar and the payment modal
    // are the SAME number by construction — they cannot drift again.
    total: pos.total,
    discountRaw: pos.discountRaw,
    discountUnit: pos.discountUnit,
    onDiscountRawChange: pos.setDiscountRaw,
    onDiscountUnitChange: pos.setDiscountUnit,
    charge: pos.charge,
    chargeLabel: pos.chargeLabel,
    entitledCharge: pos.entitledCharge,
    onChargeChange: pos.setChargeOverride,
    // undefined = "untouched", which puts the bill back on the table's own
    // charge (or the tab's snapshot) rather than pinning it to a number.
    onChargeReset: () => pos.setChargeOverride(undefined),
    onUpdateQty: pos.updateQty,
    onRemove: pos.removeFromCart,
    onClear: pos.clearCart,
    notes: pos.notes,
    onNotesChange: pos.setNotes,
    onSendToKitchen: pos.sendToKitchen,
    onPayNow: pos.payNow,
    onSettle: pos.settle,
    onCloseTab: pos.requestCloseTab,
    onVoidItem,
    resumedOrderId: pos.resumedOrder?.orderId,
    nextRound: (pos.resumedOrder?.kotRounds ?? 0) + 1,
    isBusy: pos.isBusy,
  };
}
