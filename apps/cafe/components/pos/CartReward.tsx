"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { rungWorthLabel, type RungOffer } from "@/lib/reward-rungs";

// CB-5B S9 — the STAFF counter's reward-redemption picker. Mirrors the
// diner-facing RewardClaimControl toggle idiom (components/public/
// PublicRewardsTab.tsx ~line 68): tap a rung to select it, tap the SAME rung
// again to deselect (onSelect(null)). Purely presentational — every figure
// (affordability, usability, worth) is decided upstream by lib/reward-rungs
// (which mirrors the server's RAW-stamps affordability test; see AFFORDABILITY
// RULE in the slice spec) and handed down as props, so this file never reads
// `stamps` against a milestone itself and can never drift from the server.
interface CartRewardProps {
  customerSelected: boolean;
  loading: boolean;
  stamps: number | undefined;
  offers: RungOffer[];
  selectedAt: number | null;
  // The tab already carries a granted reward (D9: one per order, and the
  // add-round route 409s a second claim). The panel then shows WHAT was given
  // and offers nothing else — the alternatives are genuinely unreachable, so
  // rendering them as tappable chips would make a silent no-op look like a
  // switch that worked.
  locked?: boolean;
  onSelect: (at: number | null) => void;
  manualDiscountActive: boolean;
  disabled?: boolean;
}

export function CartReward({
  customerSelected,
  loading,
  stamps,
  offers,
  selectedAt,
  locked = false,
  onSelect,
  manualDiscountActive,
  disabled,
}: CartRewardProps) {
  // D9.3: the panel only exists once staff have picked a customer — no dead
  // chrome for an anonymous walk-in sale.
  if (!customerSelected) return null;
  // A cafe with no configured ladder (and this customer has never earned a
  // stamp) has nothing to show here at all.
  if (offers.length === 0 && (stamps ?? 0) === 0) return null;

  const selectedOffer = offers.find((o) => o.rung.at === selectedAt);

  return (
    <div className="space-y-1.5 rounded-md border p-2">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Loyalty reward</span>
        {loading ? (
          <span>Loading…</span>
        ) : (
          <span>{stamps ?? 0} stamps</span>
        )}
      </div>

      {/* A tab that already carries a reward: show what was given, offer
          nothing. The stamps are spent and the order holds exactly one
          reward, so every other rung is unreachable until this bill closes. */}
      {locked ? (
        <>
          {selectedOffer ? (
            <div className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-primary/5 px-2 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {selectedOffer.rung.at} stamps → {rungWorthLabel(selectedOffer.rung)}
              </span>
              <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            </div>
          ) : (
            <p className="text-sm">Reward applied to this bill.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Already applied to this bill. One reward per order.
          </p>
        </>
      ) : /* A2/D6 mutual exclusion — the server fences this both ways already;
          this line is so staff never see an offer they cannot actually take. */
      manualDiscountActive ? (
        <p className="text-xs text-muted-foreground">
          Remove the discount to use a reward.
        </p>
      ) : (
        <>
          {selectedOffer && (
            <div className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-primary/5 px-2 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {selectedOffer.rung.at} stamps → {rungWorthLabel(selectedOffer.rung)}
              </span>
              <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {offers
              .filter((offer) => offer.rung.at !== selectedAt)
              .map((offer) => (
                <RungButton
                  key={offer.rung.at}
                  offer={offer}
                  selected={false}
                  disabled={disabled}
                  onSelect={onSelect}
                />
              ))}
          </div>
          {/* The selected rung itself, rendered as a real toggle button too
              (in addition to the confirm-time line above) so a tap can
              deselect it — the line above is display, this is the control. */}
          {selectedOffer && (
            <RungButton
              offer={selectedOffer}
              selected
              disabled={disabled}
              onSelect={onSelect}
            />
          )}
        </>
      )}
    </div>
  );
}

// One rung as a tappable chip. `usable: false` renders non-selectable with its
// reason — and the onClick handler ITSELF early-returns on `!usable`, because
// `disabled` alone is not a fence (standing repo lesson: a control's disabled
// attribute gates only the pointer, never the reader that would otherwise
// still call onSelect on a stray Enter/Space key event or a future caller
// that stops passing `disabled` through).
function RungButton({
  offer,
  selected,
  disabled,
  onSelect,
}: {
  offer: RungOffer;
  selected: boolean;
  disabled?: boolean;
  onSelect: (at: number | null) => void;
}) {
  const { rung, usable, reason } = offer;

  const handleClick = () => {
    if (!usable) return;
    onSelect(selected ? null : rung.at);
  };

  return (
    <Button
      type="button"
      size="sm"
      variant={selected ? "default" : "outline"}
      aria-pressed={selected}
      aria-label={
        usable
          ? `${rung.at} stamps for ${rungWorthLabel(rung)}`
          : `${rung.at} stamps for ${rungWorthLabel(rung)} — ${reason ?? "not available"}`
      }
      disabled={disabled || !usable}
      onClick={handleClick}
      className={cn("h-auto min-w-0 max-w-full flex-col items-start gap-0 px-2 py-1 text-left", !usable && "opacity-60")}
    >
      <span className="min-w-0 max-w-full truncate text-xs font-medium">
        {rung.at} stamps → {rungWorthLabel(rung)}
      </span>
      {!usable && reason && (
        <span className="min-w-0 max-w-full truncate text-[10px] font-normal text-muted-foreground">
          {reason}
        </span>
      )}
    </Button>
  );
}
