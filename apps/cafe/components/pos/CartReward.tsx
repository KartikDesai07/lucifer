"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { rungWorthLabel, type RungOffer } from "@/lib/reward-rungs";
import { rewardOffered, rewardSectionShown } from "@/lib/pos-footer";
import { POS_PANEL_PICK_CLASS, POS_PANEL_PICK_OFF_CLASS, POS_PANEL_PICK_ON_CLASS } from "@/lib/pos-layout";
import { CartRewardCards, type CartRewardCardsState } from "@/components/pos/CartRewardCards";

// CB-5B S9 — the STAFF counter's reward-redemption picker. Mirrors the
// diner-facing RewardClaimControl toggle idiom (components/public/
// PublicRewardsTab.tsx ~line 68): tap a rung to select it, tap the SAME rung
// again to deselect (onSelect(null)). Purely presentational — every figure
// (affordability, usability, worth) is decided upstream by lib/reward-rungs
// (which mirrors the server's RAW-stamps affordability test; see AFFORDABILITY
// RULE in the slice spec) and handed down as props, so this file never reads
// `stamps` against a milestone itself and can never drift from the server.
//
// U1 Task 5 (owner Q11; design 6.7): it renders as the Bill options panel's Reward section (the section carries the
// caption), the rungs as the HTML popover's pickup buttons, the picked rung's line on --accent-t in --accent-i.
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
  // CB-7 S5 — the diner's scratch cards, listed under the stamp rungs (see CartRewardCards).
  cards?: CartRewardCardsState;
  // P2 (UI) — why NO reward can be picked on this tab (it opened with a promo code); one plain line, null = free.
  blockedReason?: string | null;
  disabled?: boolean;
}

/** The picked rung's line (design 6.7): --accent-t in --accent-i, radius 8, 13px. */
const PICKED_LINE_CLASS =
  "flex min-w-0 items-center justify-between gap-2 rounded-[8px] bg-accent px-2.5 py-1.5 text-[13px] text-accent-foreground";

export function CartReward({
  customerSelected,
  loading,
  stamps,
  offers,
  selectedAt,
  locked = false,
  onSelect,
  manualDiscountActive,
  cards,
  blockedReason = null,
  disabled,
}: CartRewardProps) {
  // D9.3: the panel only exists once staff have picked a customer — no dead
  // chrome for an anonymous walk-in sale; and a cafe with no configured ladder
  // (this customer has never earned a stamp and holds no card) has nothing to
  // show here at all — unless a reward is picked or the tab's is locked (its
  // line below says so). One gate with the panel's Reward section, which the
  // footer's Reward link never outlives (lib/pos-footer.ts rewardSectionShown).
  const offered = rewardOffered({ customerSelected, offers: offers.length, stamps, cards: cards?.offers.length ?? 0 });
  if (!rewardSectionShown({ offered, picked: selectedAt !== null || (cards?.selectedId ?? null) !== null, locked })) return null;

  const selectedOffer = offers.find((o) => o.rung.at === selectedAt);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Loyalty reward</span>
        {loading ? (
          <span>Loading…</span>
        ) : (
          (offers.length > 0 || (stamps ?? 0) > 0) && <span>{stamps ?? 0} stamps</span>
        )}
      </div>

      {/* A tab that already carries a reward: show what was given, offer
          nothing. The stamps are spent and the order holds exactly one
          reward, so every other rung is unreachable until this bill closes. */}
      {locked ? (
        <>
          {selectedOffer ? (
            <div className={PICKED_LINE_CLASS}>
              <span className="min-w-0 flex-1 truncate">
                {selectedOffer.rung.at} stamps → {rungWorthLabel(selectedOffer.rung)}
              </span>
              <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
            </div>
          ) : (
            <p className="text-[13px] text-foreground">Reward applied to this bill.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Already applied to this bill. One reward per order.
          </p>
        </>
      ) : blockedReason !== null ? (
        <p className="text-xs text-muted-foreground">{blockedReason}</p>
      ) : /* A2/D6 mutual exclusion — the server fences this both ways already;
          this line is so staff never see an offer they cannot actually take. */
      manualDiscountActive ? (
        <p className="text-xs text-muted-foreground">
          Remove the discount to use a reward.
        </p>
      ) : (
        <>
          {selectedOffer && (
            <div className={PICKED_LINE_CLASS}>
              <span className="min-w-0 flex-1 truncate">
                {selectedOffer.rung.at} stamps → {rungWorthLabel(selectedOffer.rung)}
              </span>
              <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
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
          {cards && <CartRewardCards {...cards} disabled={disabled} />}
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
    <button
      type="button"
      aria-pressed={selected}
      aria-label={
        usable
          ? `${rung.at} stamps for ${rungWorthLabel(rung)}`
          : `${rung.at} stamps for ${rungWorthLabel(rung)} — ${reason ?? "not available"}`
      }
      disabled={disabled || !usable}
      onClick={handleClick}
      className={cn(
        POS_PANEL_PICK_CLASS,
        "flex-col items-start",
        selected ? POS_PANEL_PICK_ON_CLASS : POS_PANEL_PICK_OFF_CLASS,
        !usable && "opacity-60",
        BRAND_PRESS_CLASS,
      )}
    >
      <span className="min-w-0 max-w-full truncate">
        {rung.at} stamps → {rungWorthLabel(rung)}
      </span>
      {!usable && reason && (
        <span className="min-w-0 max-w-full truncate text-[11px] font-normal opacity-80">
          {reason}
        </span>
      )}
    </button>
  );
}
