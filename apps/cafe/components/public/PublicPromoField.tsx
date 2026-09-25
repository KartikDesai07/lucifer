"use client";

import { useState } from "react";
import { Check } from "lucide-react";

import { cn, inr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PUBLIC_TOUCH_TARGET_CLASS } from "@/components/public/public-shell-layout";

// Shape-only bound, mirrors PROMO_CODE_PATTERN's own 16-char cap
// (packages/shared/src/public.ts) — same hardcoded 16 the create schema
// itself uses (public-order.schema.ts), never re-derived from the pattern.
const PROMO_CODE_INPUT_MAX_LEN = 16;

// CB-5D part 2 — the diner's assigned-reward list, as sent by
// GET /api/public/diner/me (DinerAssignedReward there). Declared structurally
// here rather than imported: an API route file is not a module this
// client component tree imports from elsewhere on this surface (every other
// diner component takes its server shape via a prop type declared where it's
// consumed, e.g. DinerStampCard is the one exception and that is a `lib/`
// file, not a `route.ts`) — importing across that boundary would also risk
// pulling the route's server-only imports into the client bundle.
export interface AssignedRewardOffer {
  code: string;
  at: number;
  kind: string;
  assignedAt: number;
  expiresAt?: number;
}

interface PublicPromoFieldProps {
  code: string | null;
  savedAmount: number;
  error: string | null;
  busy: boolean;
  onApply: (code: string) => void;
  onRemove: () => void;
  // Optional: absent on any surface that hasn't fetched diner/me (or for a
  // signed-out diner). When present and non-empty, and no code is applied
  // yet, the rewards render as a tap-to-apply list ahead of the free-text
  // entry point.
  rewards?: AssignedRewardOffer[];
}

// "Valid until 12 Oct" — plain English, no year (a reward's validDays window
// is always short). Display-only formatting, not day-key math, so this does
// NOT reuse cafeDateString (that is IST-fixed bucketing for server-side
// grouping, a different job from showing one date to one diner).
const EXPIRY_DATE_FORMAT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };

export function expiryLabel(expiresAtMs: number): string {
  return `Valid until ${new Intl.DateTimeFormat("en-IN", EXPIRY_DATE_FORMAT).format(new Date(expiresAtMs))}`;
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
  rewards,
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
        {/* lucide Check, never a glyph in the string — the diner surface is
            icons-only (emoji/dingbats render differently on every Android
            skin and cannot be themed; pinned dir-wide in CB-6C). */}
        <span className="flex min-w-0 items-center gap-1.5">
          <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0">
            {savedAmount > 0
              ? `${code} applied — you saved ${inr(savedAmount)}`
              : `${code} will be applied at the counter`}
          </span>
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
  const hasRewards = (rewards?.length ?? 0) > 0;

  if (!showInput) {
    // Assigned rewards take the front seat when there are any: a diner who
    // already has a code earned should tap it, not retype it. The free-text
    // entry point survives underneath as "Use a different code" — same
    // `expanded` state as the plain trigger below, no second mechanism.
    if (hasRewards) {
      return (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Your rewards</p>
          {rewards?.map((reward) => (
            <button
              key={reward.code}
              type="button"
              onClick={() => onApply(reward.code)}
              disabled={busy}
              className={cn(
                "flex w-full items-center justify-between rounded-lg border p-pub-pad text-left text-sm disabled:opacity-50",
                PUBLIC_TOUCH_TARGET_CLASS,
              )}
            >
              <span className="font-medium">{reward.code}</span>
              {reward.expiresAt !== undefined && (
                <span className="text-xs text-muted-foreground">{expiryLabel(reward.expiresAt)}</span>
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex min-h-11 items-center text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
          >
            Use a different code
          </button>
        </div>
      );
    }

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
