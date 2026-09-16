// Void RULES that both the counter UI and the server writer need — split out of
// lib/order-void.ts so a client component can import them WITHOUT dragging that
// module's `mongoose` value import (and the whole driver) into the POS bundle.
//
// lib/order-void.ts stays server-only: it builds the stored IOrderVoid trail
// entry, whose `productId` is a real `Types.ObjectId`. Nothing here touches the
// database or any model, so this file is safe on both sides of the wire.

// A tab must always keep at least one line, so the LAST remaining line cannot be
// voided — that is a cancellation, which is an admin action with its own route.
// Exported so the dialog can disable the option up front instead of letting the
// cashier discover it through a rejection they have no way to act on.
export function isLastLine(items: ReadonlyArray<{ qty: number }>, index: number, qty: number) {
  return items.length === 1 && index === 0 && qty >= (items[0]?.qty ?? 0);
}
