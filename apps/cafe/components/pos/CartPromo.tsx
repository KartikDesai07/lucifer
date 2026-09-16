"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
}

// CB-5D part 2 — the COUNTER's promo-code control, modeled closely on
// CartReward (the sibling cart-level money control): collapsed by default
// behind a trigger, expands to an Input + Apply, and shows the applied code
// with a Remove affordance once set. INTENT ONLY — this component never
// computes or shows a discount figure of its own; the server resolves the
// code and returns 400/409 with a message on refusal (surfaced by the
// existing create-order toast, not from here).
export function CartPromo({ code, onApply, onRemove, rewardActive, disabled }: CartPromoProps) {
  const [expanded, setExpanded] = useState(false);
  const [inputText, setInputText] = useState("");

  // COURTESY exclusion only (see rewardActive doc above) — the server is the
  // real fence. Once a reward is selected, hide the promo control entirely
  // rather than show a control staff cannot actually use.
  if (rewardActive && !code) return null;

  if (code) {
    return (
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate">Promo {code} applied</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => {
            setInputText("");
            setExpanded(false);
            onRemove();
          }}
          disabled={disabled}
          aria-label="Remove promo code"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        disabled={disabled}
        className="text-left text-xs font-medium text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
      >
        Add promo code
      </button>
    );
  }

  const trimmed = inputText.trim();

  return (
    <div className="flex items-center gap-1">
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
        className="h-8 text-sm"
      />
      <Button
        type="button"
        size="sm"
        onClick={() => trimmed && onApply(trimmed)}
        disabled={disabled || trimmed.length === 0}
      >
        Apply
      </Button>
    </div>
  );
}
