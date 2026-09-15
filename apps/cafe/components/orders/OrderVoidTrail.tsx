"use client";

import { orderItemLabel } from "@pos/shared/utils";
import { inr, formatDate } from "@/lib/utils";
import type { OrderVoid } from "@/types";

interface OrderVoidTrailProps {
  voids: OrderVoid[];
}

// Read-only record of lines taken OFF an open tab after the kitchen had already
// been told to make them (CR1.3 item-level void). Split out of OrderDetailSheet
// to keep that file under the line ceiling — this trail is append-only server
// side ($push, voidGuardFilter) so there is nothing here to edit or undo.
export function OrderVoidTrail({ voids }: OrderVoidTrailProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase text-muted-foreground">
        Voided after the kitchen was notified
      </p>
      <div className="space-y-2 rounded-md border border-dashed p-2">
        {voids.map((v, i) => (
          <div key={i} className="text-xs">
            <div className="flex justify-between">
              <span className="font-medium">
                {v.qty} × {orderItemLabel(v)}
                {v.kotRound > 0 && ` · round ${v.kotRound}`}
              </span>
              {/* CB-5B — the voided line was a comped reward dish. Same
                  struck-through-worth + FREE treatment as the bill and the
                  other staff surfaces (OrderReceipt/OrderDetailSheet/
                  VoidItemDialog): its `price` is the dish's real value, but no
                  cash is coming back off this bill, so an unmarked amount here
                  reads as a refund that never happened. */}
              {v.reward ? (
                <span className="whitespace-nowrap">
                  <span className="line-through opacity-60">{inr(v.price * v.qty)}</span> FREE
                </span>
              ) : (
                <span>{inr(v.price * v.qty)}</span>
              )}
            </div>
            <div className="text-muted-foreground">
              {v.reason} — {v.voidedBy}, {formatDate(v.at)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
