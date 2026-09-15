"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { POS_HEADER_CONTROL_CLASS } from "@/lib/pos-layout";
import { cn } from "@/lib/utils";

// CB-4 — the counter-side PIN reset, as a row inside the customer edit sheet.
//
// This IS the recovery story for a forgotten diner PIN (CB-4 ships no OTP —
// SMS OTP in India needs DLT registration at Rs 5,000-10,000/yr per client).
// A diner says "I forgot my PIN" at the counter, staff tap this, and the diner
// sets a fresh one from their own phone.
//
// Two-step confirm rather than a Dialog: this sheet is already a form, and a
// nested dialog on a tablet is a worse experience than an inline "are you
// sure". Mirrors the print-host card's own inline-confirm pattern.

interface DinerPinResetRowProps {
  customerId: string;
}

export function DinerPinResetRow({ customerId }: DinerPinResetRowProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function reset() {
    setBusy(true);
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}/diner-pin`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error("Couldn't reset the PIN. Please try again.");
        return;
      }
      setDone(true);
      setConfirming(false);
      toast.success("PIN cleared. Ask the customer to set a new PIN on their phone.");
    } catch {
      toast.error("Couldn't reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5 rounded-md border p-3">
      <p className="text-sm font-medium">QR menu PIN</p>
      <p className="text-xs text-muted-foreground">
        {done
          ? "PIN cleared. The customer can now set a new PIN from the QR menu on their phone."
          : "If this customer has forgotten their PIN, clear it here. They can then set a new one from the QR menu on their phone. Clearing also signs them out everywhere."}
      </p>
      {!done &&
        (confirming ? (
          <div className="flex gap-2 pt-1">
            {/* type="button" on BOTH: this row lives inside the customer form,
                and a bare <button> would submit that form instead. */}
            <Button
              type="button"
              variant="destructive"
              // The staff COMFORT tier (40px on a coarse pointer, shrinking to
              // the compact look only on a fine pointer at xl+): this is a
              // DESTRUCTIVE control on a counter tablet, and shadcn's size="sm"
              // is 32px — under every comfort bar this repo sets (CB-1d.1 V3).
              className={cn(POS_HEADER_CONTROL_CLASS, "px-3")}
              onClick={reset}
              disabled={busy}
            >
              {busy ? "Clearing…" : "Yes, clear it"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={cn(POS_HEADER_CONTROL_CLASS, "px-3")}
              onClick={() => setConfirming(false)}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className={cn(POS_HEADER_CONTROL_CLASS, "mt-1 px-3")}
            onClick={() => setConfirming(true)}
          >
            Clear PIN
          </Button>
        ))}
    </div>
  );
}
