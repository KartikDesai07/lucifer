"use client";

import { useState } from "react";

import { inr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Shape-only bound, mirrors PROMO_CODE_PATTERN's own 16-char cap
// (packages/shared/src/public.ts) — same hardcoded 16 the create schema
// itself uses (public-order.schema.ts), never re-derived from the pattern.
const PROMO_CODE_INPUT_MAX_LEN = 16;

interface PublicPromoFieldProps {
  code: string | null;
  savedAmount: number;
  error: string | null;
  busy: boolean;
  onApply: (code: string) => void;
  onRemove: () => void;
}

// The diner-facing promo control (CR2.2c, phase-CR2-public-ordering.md §17.E)
// — shared by the cart (create) and the pending-edit status page. Collapsed
// by default (Baymard: an always-visible field makes diners stop and hunt
// for a code); tapping "Have a promo code?" expands an Input + an explicit
// Apply button (never auto-apply on blur — a diner mid-typo must not get a
// premature rejection).
//
// The applied code and its saved amount are OWNED by the parent (the server
// is the source of both — this component never computes money); it owns
// ONLY its own expanded/collapsed + typed-text state. That split is what
// lets a rejected code survive: the parent reverts `code` to null and passes
// `error`, and because this component never cleared its own `inputText` on
// Apply, the diner still sees exactly what they typed instead of a blank box.
export function PublicPromoField({
  code,
  savedAmount,
  error,
  busy,
  onApply,
  onRemove,
}: PublicPromoFieldProps) {
  const [expanded, setExpanded] = useState(false);
  const [inputText, setInputText] = useState("");

  function handleApply() {
    const trimmed = inputText.trim();
    if (!trimmed) return;
    onApply(trimmed);
  }

  function handleRemove() {
    setInputText("");
    setExpanded(false);
    onRemove();
  }

  if (code) {
    return (
      <div className="flex items-center justify-between gap-2 text-sm">
        {/* savedAmount is only ever non-zero once the SERVER has confirmed a
            discount — until then (create's pre-submit window, or an edit
            whose PATCH response carries no discount figure) this never
            fabricates a ₹ figure. */}
        <span>
          {savedAmount > 0
            ? `✓ ${code} applied — you saved ${inr(savedAmount)}`
            : `✓ ${code} will be applied at the counter`}
        </span>
        <button
          type="button"
          onClick={handleRemove}
          disabled={busy}
          className="shrink-0 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
        >
          Remove
        </button>
      </div>
    );
  }

  // An error means the diner's last Apply-then-Send/Save was rejected for a
  // promo reason — force the input open (even if they had collapsed it) so
  // they can fix the typo without retyping from scratch.
  const showInput = expanded || error !== null;

  if (!showInput) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex min-h-11 items-center text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
      >
        Have a promo code?
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Input
          value={inputText}
          onChange={(e) => setInputText(e.target.value.toUpperCase())}
          maxLength={PROMO_CODE_INPUT_MAX_LEN}
          className="text-base"
          autoCapitalize="characters"
          autoCorrect="off"
          placeholder="Promo code"
          aria-label="Promo code"
        />
        <Button
          type="button"
          onClick={handleApply}
          disabled={busy || inputText.trim().length === 0}
          className="h-11 shrink-0"
        >
          Apply
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
