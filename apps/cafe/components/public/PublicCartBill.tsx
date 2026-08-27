import type { ReactNode } from "react";

import { PUBLIC_NOTE_MAX_LEN } from "@pos/shared/public";
import { inr } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PublicIdentityForm } from "@/components/public/PublicIdentityForm";

interface PublicCartBillProps {
  subtotal: number;
  tableCharge: { amount: number; label: string } | null;
  // FIX1 — both already derived by the caller via the ONE publicCartTotals
  // call; this component only ever renders figures it was handed.
  gstAmount: number;
  gstRate: number;
  total: number;
  note: string;
  onNoteChange: (note: string) => void;
  mobile: string;
  name: string;
  onMobileChange: (mobile: string) => void;
  onNameChange: (name: string) => void;
  submitted: boolean;
  hp: string;
  onHpChange: (hp: string) => void;
  blockedReason: string | null;
  error: string | null;
  // The promo control (§17.E) slot — rendered here so it stays sandwiched
  // between the Total row and the note input exactly as before the split;
  // owned/constructed by PublicCart.tsx so its own JSX literal (and the
  // pin that checks for it) stays there.
  children?: ReactNode;
}

// The review-screen's whole non-list body, extracted out of PublicCart.tsx
// (CR2.2d split D4) to keep that component under this repo's ~300-line
// budget — bill rows, the note input, identity, honeypot, and the
// blocked-target/send-error text. Purely presentational: every figure and
// piece of state here is computed/owned by the caller.
export function PublicCartBill({
  subtotal,
  tableCharge,
  gstAmount,
  gstRate,
  total,
  note,
  onNoteChange,
  mobile,
  name,
  onMobileChange,
  onNameChange,
  submitted,
  hp,
  onHpChange,
  blockedReason,
  error,
  children,
}: PublicCartBillProps) {
  return (
    <>
      <div className="space-y-3 px-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="font-medium">{inr(subtotal)}</span>
        </div>
        {tableCharge && tableCharge.amount > 0 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{tableCharge.label}</span>
            <span>{inr(tableCharge.amount)}</span>
          </div>
        )}
        {/* FIX1 — exclusive-mode GST only; inclusive/disabled show nothing extra. */}
        {gstAmount > 0 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>GST {gstRate}%</span>
            <span>{inr(gstAmount)}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-base font-semibold">
          <span>Total</span>
          <span>{inr(total)}</span>
        </div>

        {/* §17.E — a promo on a second round of the SAME table session is a
            race remnant, not a normal path; hidden once chargeApplies says
            this table's session is already open (decided by the caller). */}
        {children}

        <div className="space-y-1">
          <Label htmlFor="public-cart-note">Note for the kitchen (optional)</Label>
          <Input
            id="public-cart-note"
            className="text-base"
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            maxLength={PUBLIC_NOTE_MAX_LEN}
          />
        </div>
      </div>

      <div className="space-y-3 px-4 pb-2">
        <PublicIdentityForm
          mobile={mobile}
          name={name}
          onMobileChange={onMobileChange}
          onNameChange={onNameChange}
          submitted={submitted}
        />

        {/* Honeypot — off-screen (never display:none/visibility:hidden, so
            a naive bot's autofill still finds it), unlabeled, never
            tab-reachable. A real diner's browser never touches this. */}
        <input
          type="text"
          name="hp"
          value={hp}
          onChange={(e) => onHpChange(e.target.value)}
          aria-hidden="true"
          tabIndex={-1}
          autoComplete="off"
          style={{ position: "absolute", left: "-9999px", top: 0, width: 1, height: 1 }}
        />

        {blockedReason && <p className="text-sm text-destructive">{blockedReason}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </>
  );
}
