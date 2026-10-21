"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { inr, cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { TABLE_CHARGE_LABEL_MAX_LEN } from "@pos/shared/constants";
import {
  POS_BILL_LABEL_CLASS,
  POS_BILL_LINK_CLASS,
  POS_BILL_ROW_CLASS,
  POS_BILL_VALUE_CLASS,
  POS_PANEL_BUTTON_CLASS,
  POS_PANEL_FIELD_CLASS,
  POS_PANEL_LINK_CLASS,
  POS_PANEL_PRIMARY_CLASS,
} from "@/lib/pos-layout";

// CB-CHG (plan §5C) — the POS cart's "additional charge" control: a takeaway
// bill has no table but can still carry a staff-entered charge (packing,
// delivery, a private event add-on). Modeled on CartPromo/CartReward's
// collapsed-trigger/expanded-form idiom. INTENT ONLY: this component never
// computes a bill total (pinned — lib/receipt.test.ts's "cart does no
// arithmetic" pin extends to this file) and never calls the server itself —
// the extras array rides the create/add-round/settle payload
// (use-pos-tab.ts), replacing the whole set on Send/Settle (decision 6).
//
// U1 Task 5 (owner Q11, Q12; design 6.7, 6.8): the form is the Bill options
// panel's Extra charges section (the panel's 34px fields, the ink Add); the
// applied charges are rows of the HTML's bill block, its charge-row look: the
// name and a "Remove" link, the amount on the right. Words, rules, validation
// and aria-labels as before.
export interface ExtraChargeEntry {
  label: string;
  amount: number;
}

interface CartExtraChargesProps {
  extras: ExtraChargeEntry[];
  onAdd: (entry: ExtraChargeEntry) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
  /** Open with the form showing (the panel was opened from the "Extra charge" link). */
  defaultExpanded?: boolean;
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

/** One applied charge: its name and "Remove", the amount on the right (the HTML's charge row). */
function ChargeRow({
  entry,
  onRemove,
  disabled,
}: {
  entry: ExtraChargeEntry;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <div className={POS_BILL_ROW_CLASS}>
      <span className={POS_BILL_LABEL_CLASS}>
        <span className="min-w-0 truncate" title={entry.label}>
          {entry.label}
        </span>
        <button
          type="button"
          className={cn(POS_BILL_LINK_CLASS, BRAND_PRESS_CLASS)}
          onClick={onRemove}
          disabled={disabled}
          aria-label={"Remove " + entry.label}
        >
          Remove
        </button>
      </span>
      <span className={POS_BILL_VALUE_CLASS}>{inr(entry.amount)}</span>
    </div>
  );
}

// D9.8 (2026-09-26) — the APPLIED charges, rendered on their own so they can
// stay in the always-visible bill while the ADD form sits in the Bill options
// panel. What the customer is actually being charged must never sit behind a
// tap: the same rule CartNotes set in D9.7 for a note, and money raises the
// stakes (an operator could otherwise hand over a bill carrying a packing fee
// with nothing on screen naming it). Renders nothing when empty, so an
// ordinary sale still costs zero height; the rows are the bill's own (a
// fragment), 5px apart like the rest.
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
    <>
      {extras.map((entry, i) => (
        <ChargeRow key={`${entry.label}-${i}`} entry={entry} onRemove={() => onRemove(i)} disabled={disabled} />
      ))}
    </>
  );
}

export function CartExtraCharges({ extras, onAdd, onRemove, disabled, defaultExpanded = false }: CartExtraChargesProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
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
    <div className="flex flex-col gap-2 text-[13px] text-muted-foreground">
      {extras.map((entry, i) => (
        <ChargeRow key={`${entry.label}-${i}`} entry={entry} onRemove={() => onRemove(i)} disabled={disabled} />
      ))}

      {!expanded ? (
        <button
          type="button"
          className={cn(POS_PANEL_LINK_CLASS, BRAND_PRESS_CLASS)}
          onClick={() => setExpanded(true)}
          disabled={disabled}
        >
          <Plus className="h-4 w-4 shrink-0" aria-hidden="true" /> Add additional charge
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={TABLE_CHARGE_LABEL_MAX_LEN}
              placeholder="e.g. Packing charge"
              aria-label="Charge name"
              disabled={disabled}
              className={cn(POS_PANEL_FIELD_CLASS, "min-w-0 flex-1")}
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
              className={cn(POS_PANEL_FIELD_CLASS, "w-24 flex-none")}
            />
          </div>
          {error && <p className="text-xs text-status-bad-ink">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              className={cn(POS_PANEL_PRIMARY_CLASS, "flex-1", BRAND_PRESS_CLASS)}
              onClick={handleAdd}
              disabled={disabled || error !== null}
            >
              Add
            </button>
            <button
              type="button"
              className={cn(POS_PANEL_BUTTON_CLASS, "flex-1", BRAND_PRESS_CLASS)}
              onClick={reset}
              disabled={disabled}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
