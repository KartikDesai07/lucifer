"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { inr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TABLE_CHARGE_LABEL_MAX_LEN } from "@pos/shared/constants";

// CB-CHG (plan §5C) — the POS cart's "additional charge" control: a takeaway
// bill has no table but can still carry a staff-entered charge (packing,
// delivery, a private event add-on). Modeled on CartPromo/CartReward's
// collapsed-trigger/expanded-form idiom. INTENT ONLY: this component never
// computes a bill total (pinned — lib/receipt.test.ts's "cart does no
// arithmetic" pin extends to this file) and never calls the server itself —
// the extras array rides the create/add-round/settle payload
// (use-pos-tab.ts), replacing the whole set on Send/Settle (decision 6).
export interface ExtraChargeEntry {
  label: string;
  amount: number;
}

interface CartExtraChargesProps {
  extras: ExtraChargeEntry[];
  onAdd: (entry: ExtraChargeEntry) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}

// Validation is SHAPE ONLY, never size (owner decision 8, 2026-09-25:
// "hame hamari panel me aesi koi limitation nahi rakhni hai") — label
// non-empty after trim, amount a whole number >= 1. Do NOT add a max amount
// or a max count here: the server (orderChargeInputSchema) carries none
// either, and this mirrors it deliberately.
function validationError(label: string, amountText: string): string | null {
  if (label.trim().length === 0) return "Name the charge";
  const amount = Number(amountText);
  if (amountText.trim().length === 0 || Number.isNaN(amount)) {
    return "Enter an amount";
  }
  if (!Number.isInteger(amount) || amount < 1) {
    return "Amount must be a whole rupee, at least 1";
  }
  return null;
}

// D9.8 (2026-09-26) — the APPLIED charges, rendered on their own so they can
// stay in the always-visible footer while the ADD form moves into the More
// menu. What the customer is actually being charged must never sit behind a
// tap: the same rule CartNotes set in D9.7 for a collapsed note, and money
// raises the stakes (an operator could otherwise hand over a bill carrying a
// packing fee with nothing on screen naming it). Renders nothing when empty,
// so an ordinary sale still costs zero footer height.
export function CartExtraChargeRows({
  extras,
  onRemove,
  disabled,
}: {
  extras: ExtraChargeEntry[];
  onRemove: (index: number) => void;
  disabled?: boolean;
}) {
  if (extras.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {extras.map((entry, i) => (
        <div key={`${entry.label}-${i}`} className="flex items-center justify-between gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={entry.label}>
            {entry.label} · {inr(entry.amount)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0"
            onClick={() => onRemove(i)}
            disabled={disabled}
            aria-label={"Remove " + entry.label}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}

export function CartExtraCharges({ extras, onAdd, onRemove, disabled }: CartExtraChargesProps) {
  const [expanded, setExpanded] = useState(false);
  const [label, setLabel] = useState("");
  const [amountText, setAmountText] = useState("");

  const error = expanded ? validationError(label, amountText) : null;

  const reset = () => {
    setLabel("");
    setAmountText("");
    setExpanded(false);
  };

  const handleAdd = () => {
    if (error) return;
    onAdd({ label: label.trim(), amount: Math.round(Number(amountText)) });
    reset();
  };

  return (
    <div className="space-y-1.5">
      {extras.map((entry, i) => (
        <div key={`${entry.label}-${i}`} className="flex items-center justify-between gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={entry.label}>
            {entry.label} · {inr(entry.amount)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0"
            onClick={() => onRemove(i)}
            disabled={disabled}
            aria-label={"Remove " + entry.label}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}

      {!expanded ? (
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 w-full justify-start px-2 text-sm font-medium text-muted-foreground"
          onClick={() => setExpanded(true)}
          disabled={disabled}
        >
          <Plus className="mr-1.5 h-4 w-4" /> Add additional charge
        </Button>
      ) : (
        <div className="space-y-1.5 rounded-md border p-2">
          <div className="flex items-center gap-1.5">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={TABLE_CHARGE_LABEL_MAX_LEN}
              placeholder="e.g. Packing charge"
              aria-label="Charge name"
              disabled={disabled}
              className="min-h-11 flex-1"
            />
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder="Amount"
              aria-label="Charge amount"
              disabled={disabled}
              className="min-h-11 w-24"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-1.5">
            <Button
              type="button"
              size="sm"
              className="min-h-11 flex-1"
              onClick={handleAdd}
              disabled={disabled || error !== null}
            >
              Add
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 flex-1"
              onClick={reset}
              disabled={disabled}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
