"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { promoOffered } from "@/lib/pos-footer";
import {
  POS_BILL_LABEL_CLASS,
  POS_BILL_LINK_CLASS,
  POS_PANEL_FIELD_CLASS,
  POS_PANEL_LINK_CLASS,
  POS_PANEL_PRIMARY_CLASS,
} from "@/lib/pos-layout";

// CB-5D part 2 — shape-only bound, mirrors PROMO_CODE_PATTERN's own 16-char
// cap (packages/shared/src/public-promo.ts) — same hardcoded 16 the diner
// field uses (components/public/PublicPromoField.tsx's
// PROMO_CODE_INPUT_MAX_LEN), never re-derived from the pattern here.
const PROMO_CODE_INPUT_MAX_LEN = 16;

interface CartPromoProps {
  code: string | null;
  onApply: (code: string) => void;
  onRemove: () => void;
  // A2/D6-style mutual exclusion, COURTESY ONLY — the server is the real
  // fence (400 REWARD_PROMO_EXCLUSIVE / the promo branch replacing a manual
  // discount figure). Mirrors exactly how CartReward reads
  // `manualDiscountActive`: no second mechanism, just the same flag read from
  // the other side.
  rewardActive: boolean;
  disabled?: boolean;
  /** Open with the field showing (the panel was opened from the "Promo code" link, so the operator came to type). */
  defaultExpanded?: boolean;
}

// CB-5D part 2 — the COUNTER's promo-code control, modeled closely on
// CartReward (the sibling cart-level money control): collapsed by default
// behind a trigger, expands to an Input + Apply, and shows the applied code
// with a Remove affordance once set. INTENT ONLY — this component never
// computes or shows a discount figure of its own; the server resolves the
// code and returns 400/409 with a message on refusal (surfaced by the
// existing create-order toast, not from here).
//
// U1 Task 5 (owner Q11; design 6.7): the Bill options panel's Promo code section — the panel's 34px field and ink
// "Apply", the applied code with a "Remove" link; words, rules and aria-labels as before.
export function CartPromo({ code, onApply, onRemove, rewardActive, disabled, defaultExpanded = false }: CartPromoProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [inputText, setInputText] = useState("");

  // COURTESY exclusion only (see rewardActive doc above) — the server is the
  // real fence. Once a reward is selected, hide the promo control entirely
  // rather than show a control staff cannot actually use.
  if (!promoOffered({ rewardPicked: rewardActive, promoCode: code })) return null;

  if (code) {
    return (
      <div className={cn(POS_BILL_LABEL_CLASS, "min-h-[34px] text-[13px]")}>
        <span className="min-w-0 truncate">Promo {code} applied</span>
        <button
          type="button"
          className={cn(POS_BILL_LINK_CLASS, BRAND_PRESS_CLASS)}
          onClick={() => {
            setInputText("");
            setExpanded(false);
            onRemove();
          }}
          disabled={disabled}
          aria-label="Remove promo code"
        >
          Remove
        </button>
      </div>
    );
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        disabled={disabled}
        className={cn(POS_PANEL_LINK_CLASS, BRAND_PRESS_CLASS)}
      >
        Add promo code
      </button>
    );
  }

  const trimmed = inputText.trim();

  return (
    <div className="flex items-center gap-2">
      {/* Uppercase-normalised as the operator types — the server does the
          same transform (createOrderSchema's promoCode field), so what
          staff see here is exactly what gets sent and checked. */}
      <Input
        value={inputText}
        onChange={(e) => setInputText(e.target.value.toUpperCase())}
        maxLength={PROMO_CODE_INPUT_MAX_LEN}
        placeholder="Promo code"
        aria-label="Promo code"
        disabled={disabled}
        className={POS_PANEL_FIELD_CLASS}
      />
      <button
        type="button"
        className={cn(POS_PANEL_PRIMARY_CLASS, BRAND_PRESS_CLASS)}
        onClick={() => trimmed && onApply(trimmed)}
        disabled={disabled || trimmed.length === 0}
      >
        Apply
      </button>
    </div>
  );
}
