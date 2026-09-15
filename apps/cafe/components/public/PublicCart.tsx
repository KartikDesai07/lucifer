"use client";

import { publicCartTotals, type PublicGstConfig } from "@pos/shared/public";
import { inr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { PublicPromoField, type AssignedRewardOffer } from "@/components/public/PublicPromoField";
import { PublicCartLine } from "@/components/public/PublicCartLine";
import { PublicCartBill } from "@/components/public/PublicCartBill";
import { PublicSuggestionChips } from "@/components/public/PublicSuggestionChips";
import type { TablePick } from "@/components/public/TableChooser";
import type { PublicMenuProduct } from "@/components/public/PublicMenuItem";
import type { CartLine } from "@/components/public/public-cart-store";
import { usePublicCartSubmit } from "@/components/public/use-public-cart-submit";

interface PublicCartProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cart: CartLine[];
  onUpdateQty: (lineId: string, qty: number) => void;
  onRemove: (lineId: string) => void;
  // Present only on /m/<token> — the proven target for this order.
  token?: string;
  // The /m (no-token) name-based pick, owned by PublicOrderFlow.
  pickedTable: TablePick | null;
  tableCharge: { amount: number; label: string } | null;
  // CR2.2c §17.E — the raw signal behind tableCharge above (which folds
  // chargeApplies:false down to null). A promo is only offered on a table's
  // first order of a session; true (the default, and always true off /m with
  // no token) means the promo control is shown.
  chargeApplies: boolean;
  // FIX1 — live GST config off the menu payload, for a total matching the bill.
  gst: PublicGstConfig;
  // FIX2 — fires on a confirmed 201 so the parent clears its IN-MEMORY cart
  // (clearCart() below only wipes localStorage) before navigation.
  onSubmitted: () => void;
  // S4 — up to 3 top-sellers not already in the cart (owned/derived by
  // PublicOrderFlow); an empty array renders no section at all.
  suggestions?: PublicMenuProduct[];
  onAddSuggestion?: (item: PublicMenuProduct) => void;
  // CB-5D part 2 — the codes a milestone claim has ASSIGNED to this diner,
  // sourced from GET /api/public/diner/me by the shell and passed straight
  // through. Absent for a signed-out diner or a surface that never fetched
  // it, which is exactly when the promo field falls back to free text only.
  rewards?: AssignedRewardOffer[];
}

// The diner's review-and-send screen: line list, the table-charge disclosure
// (§1 — the price shown here is the price consented to), a note, identity,
// and one Send button. Builds the request body EXACTLY to
// createPublicOrderRequestSchema's .strict() shape — items carry no
// price/name, the server derives both from the live product.
export function PublicCart({
  open,
  onOpenChange,
  cart,
  onUpdateQty,
  onRemove,
  token,
  pickedTable,
  tableCharge,
  chargeApplies,
  gst,
  onSubmitted,
  suggestions,
  rewards,
  onAddSuggestion,
}: PublicCartProps) {
  const {
    note,
    setNote,
    mobile,
    setMobile,
    name,
    setName,
    hp,
    setHp,
    submitted,
    isSubmitting,
    error,
    promoCode,
    promoError,
    requestedRewardAt,
    rewardError,
    blockedReason,
    handleApplyPromo,
    handleRemovePromo,
    handleRemoveReward,
    handleSubmit,
  } = usePublicCartSubmit({ cart, token, pickedTable, onSubmitted, open });

  const subtotal = cart.reduce((sum, line) => sum + line.price * line.qty, 0);
  const chargeAmount = tableCharge?.amount ?? 0;
  // FIX1 — the ONE totals computation on this screen; every displayed figure
  // (the GST line below, the Total row, and the Send button's own amount)
  // reads off this SAME result, never a hand `subtotal + charge` sum.
  const { gstAmount, total } = publicCartTotals(subtotal, chargeAmount, gst);

  return (
    // repositionInputs={false}: vaul's keyboard repositioning is the documented
    // cause of the drawer/page blanking or shooting off-screen when a diner
    // focuses an input on a real phone (vaul#619/#294/#255/#216 — field report
    // 2026-08-20). With it off, the browser's native scroll-into-view works
    // because everything between header and footer scrolls (single container,
    // dvh-capped so the on-screen keyboard shrinks it instead of hiding it).
    <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <DrawerContent className="mx-auto max-w-lg">
        <DrawerHeader>
          <DrawerTitle>Your order</DrawerTitle>
        </DrawerHeader>

        <div className="max-h-[65dvh] space-y-3 overflow-y-auto overscroll-contain">
          <div className="space-y-3 px-4">
            {cart.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Your cart is empty.</p>
            ) : (
              cart.map((line) => (
                <PublicCartLine key={line.lineId} line={line} onUpdateQty={onUpdateQty} onRemove={onRemove} />
              ))
            )}
          </div>

          {suggestions && onAddSuggestion && (
            <PublicSuggestionChips suggestions={suggestions} onAdd={onAddSuggestion} />
          )}

          <PublicCartBill
            subtotal={subtotal}
            tableCharge={tableCharge}
            gstAmount={gstAmount}
            gstRate={gst.rate}
            total={total}
            note={note}
            onNoteChange={setNote}
            mobile={mobile}
            name={name}
            onMobileChange={setMobile}
            onNameChange={setName}
            submitted={submitted}
            hp={hp}
            onHpChange={setHp}
            blockedReason={blockedReason}
            error={error}
          >
            {/* CB-5B S8 / owner decision D6-A2 — reward and promo are
                mutually exclusive, so at most ONE of these two controls is
                ever interactable at a time. A reward selected on the Rewards
                tab takes the promo field's place here entirely (never just
                visually disabled) so there is nothing left to tap into. */}
            {requestedRewardAt !== null ? (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>Reward selected — applied when the cafe accepts this order</span>
                <button
                  type="button"
                  onClick={handleRemoveReward}
                  disabled={isSubmitting}
                  className="shrink-0 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            ) : (
              // §17.E — a promo on a second round of the SAME table session is
              // a race remnant, not a normal path; hidden once chargeApplies
              // says this table's session is already open.
              chargeApplies && (
                <PublicPromoField
                  code={promoCode}
                  // Never known until the server answers (no validate endpoint,
                  // and the client never computes money) — the field itself
                  // renders the "will be applied at the counter" copy for 0.
                  savedAmount={0}
                  error={promoError}
                  busy={isSubmitting}
                  onApply={handleApplyPromo}
                  onRemove={handleRemovePromo}
                  rewards={rewards}
                />
              )
            )}
            {rewardError && <p className="text-sm text-destructive">{rewardError}</p>}
          </PublicCartBill>
        </div>

        <DrawerFooter>
          <Button onClick={handleSubmit} disabled={isSubmitting || cart.length === 0 || blockedReason !== null}>
            {isSubmitting ? "Sending…" : `Send order — ${inr(total)}`}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
