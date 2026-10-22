"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { inr, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor } from "@/components/ui/popover";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { CartHead, type CartCellsProps } from "@/components/pos/CartHead";
import { CartLines } from "@/components/pos/CartLines";
import { CartFooterLinks } from "@/components/pos/CartFooterLinks";
import { CartBill } from "@/components/pos/CartBill";
import { BillOptionsPanel, BillOptionsSection } from "@/components/pos/BillOptionsPanel";
import { CartNotes } from "@/components/pos/CartNotes";
import { CartReward } from "@/components/pos/CartReward";
import { CartPromo } from "@/components/pos/CartPromo";
import { CartExtraCharges, type ExtraChargeEntry } from "@/components/pos/CartExtraCharges";
import { WriteNoticePanel } from "@/components/pos/WriteNotice";
import { CartUnavailableNotice, type CartMenuNoticeProps } from "@/components/pos/CartUnavailableNotice";
import { SendDiscard } from "@/components/pos/SendDiscard";
import type { WriteNotice } from "@/lib/pending-writes";
import { POS_CART_GST_BUTTON_CLASS, POS_PANEL_FIELD_CLASS } from "@/lib/pos-layout";
import { NO_NUMBER_SPINNER_CLASS } from "@/lib/payment-sheet";
import { footerLinks, promoOffered, rewardOffered, rewardSectionShown, type FooterLink } from "@/lib/pos-footer";
import { GST_DISCOUNT_LABEL } from "@/lib/constants";
import { PROMO_BLOCKS_GST_DISCOUNT_MESSAGE, REWARD_BLOCKS_GST_DISCOUNT_MESSAGE } from "@/lib/receipt";
import { rungWorthLabel, type RungOffer } from "@/lib/reward-rungs";
import type { CartItem } from "@/hooks/use-cart";
import type { CardOffer } from "@/lib/reward-card-offers";
import type { VoidLine } from "@/lib/pos-cart-view";
import type { DiscountUnit } from "@/lib/pos-cart-props";
import type { Order } from "@/types";

export interface CartProps {
  items: CartItem[];
  // Every line's quantity (sent and new) and the unsent lines' quantity (usePosTab's count / newCount): the bill's
  // "Subtotal · {n} items" and the HTML's "Send KOT · {n}".
  count: number;
  newCount: number;
  subtotal: number;
  discount: number; // computed flat amount (for display)
  gstAmount?: number; // > 0 only when exclusive GST is enabled
  gstRate?: number;
  // The amount payable, taken from usePosTotals — NOT recomputed here. This
  // panel used to derive its own `subtotal - discount + gstAmount`, which is
  // how the table charge came to be printed as a row and then left out of the
  // very total beneath it. One figure, computed once, shown everywhere.
  total: number;
  discountRaw: number;
  discountUnit: DiscountUnit;
  onDiscountRawChange: (value: number) => void;
  onDiscountUnitChange: (unit: DiscountUnit) => void;
  canGstDiscount?: boolean; // the cafe charges GST, so the preset has something to discount — the button is hidden otherwise
  // The selected table's extra charge for this bill. `chargeLabel` is the
  // cafe's own name for it — the product never supplies a default, so an
  // unnamed charge simply does not render. `onChargeChange` writes the
  // operator's deliberate override (0 = waived); `onChargeReset` puts the bill
  // back on whatever it is entitled to.
  charge: number;
  chargeLabel: string;
  entitledCharge: number;
  onChargeChange: (value: number) => void;
  onChargeReset: () => void;
  // CB-CHG (plan §5C) — the staff-entered extra charges for this bill (e.g. a
  // takeaway's packing fee). Independent of the table charge above: a
  // walk-in with no table can still carry one. See CartExtraCharges.
  extraCharges: ExtraChargeEntry[];
  onAddExtraCharge: (entry: ExtraChargeEntry) => void;
  onRemoveExtraCharge: (index: number) => void;
  onUpdateQty: (lineId: string, qty: number) => void;
  onRemove: (lineId: string) => void;
  onClear: () => void;
  // Order-level note for a brand-new sale — never shown while resuming (see
  // below), since a resumed tab's add-round payload carries no notes field.
  notes: string;
  onNotesChange: (value: string) => void;
  // CB-5B S9 — the loyalty reward picker (D9.3: appears once a customer is
  // selected). All optional/defaulted so a caller that predates this slice
  // (or the mobile-sheet mount, before it is wired) still mounts safely with
  // the panel simply rendering nothing.
  customerSelected?: boolean;
  rewardLoading?: boolean;
  stamps?: number;
  rewardOffers?: RungOffer[];
  selectedRewardAt?: number | null;
  // The resumed tab already carries a reward: the picker shows it, read-only.
  rewardLocked?: boolean;
  onSelectReward?: (at: number | null) => void;
  // CB-7 S5 — scratch cards (picked like a rung); P2: a promo-opened resumed tab blocks the pickers and the GST preset.
  cardOffers?: CardOffer[];
  selectedCardId?: string | null;
  onSelectCard?: (id: string | null) => void;
  rewardBlockedReason?: string | null;
  promoLocked?: boolean;
  // A2/D6: true while a manual ₹/%/GST discount is active — mutually
  // exclusive with a reward claim (both sides fence this; see CartReward).
  manualDiscountActive?: boolean;
  // CB-5D part 2 — the COUNTER's promo-code intent (see CartPromo). All
  // optional/defaulted for the same reason as the reward props above: a
  // caller that predates this slice still mounts safely with the control
  // simply rendering nothing.
  promoCode?: string | null;
  onApplyPromo?: (code: string) => void;
  onRemovePromo?: () => void;
  // Actions — which render depends on tab state (see below).
  onSendToKitchen?: () => void; // fire new items (creates a tab or adds a round)
  onPayNow?: () => void; // immediate full payment (new order only)
  onSettle?: () => void; // settle a resumed open tab
  onCloseTab?: () => void; // leave resume mode without settling
  // Open the void dialog on an already-fired line (owner Q10: the selected sent line's "Void"; null = the stored
  // order no longer holds that line, so the dialog opens with nothing picked).
  onVoidItem?: (line: VoidLine | null) => void;
  // Resume context — present only when editing a live open tab.
  resumedOrderId?: string;
  // The tab on screen (null for a new order): the head's title, meta and Table cell, and the Void action's address.
  resumedOrder: Order | null;
  // The head's two cells (owner Q9): the table and customer, and what their dialogs need.
  cells: CartCellsProps;
  isBusy?: boolean; // disable actions while a mutation is in flight
  sending?: boolean; // a Send to Kitchen is in flight — its button reads "Sending…"
  sendNotice?: WriteNotice | null; // an unanswered send: "Couldn't confirm" + Send again
  onDiscardSend?: () => void; // drop that unanswered send and the whole order (confirmed first)
  menuNotice?: CartMenuNoticeProps; // unsent lines the menu can no longer sell as they stand (Menu B2)
  className?: string;
  // Rendered only by the mobile sheet — a way back to the menu that does not
  // fight the header's own Clear/Close controls.
  onBack?: () => void;
}

/** The HTML's footer (values 5.5): sticky at the cart's foot over its lines, 12px 16px 14px (12px on a phone), a rule
 *  and a soft lift above it; the links, the bill and the buttons 10px apart. The cart's foot is the window's foot in
 *  both mounts (the full-screen sheet below 1280px, the column from 1280px), so the bottom padding adds the safe-area
 *  inset at every width (ruling P49; 14px / 12px at inset 0). */
const FOOTER_CLASS =
  "sticky bottom-0 z-[2] flex flex-none flex-col gap-2.5 border-t border-border bg-card px-4 pt-3 pb-[calc(14px+env(safe-area-inset-bottom))] leading-[normal] [box-shadow:0_-10px_24px_rgba(0,0,0,.04)] max-tab:pb-[calc(12px+env(safe-area-inset-bottom))]";

/** The ₹ / % switch in the HTML's segmented look (U0 values SEG_ON / SEG_OFF; values 5.3's segments): a --surface-3
 *  track, radius 8, 2px inset and gap; 30px segments, radius 6, 13px 500; the chosen one on --seg with its lift. */
const SEG_TRACK_CLASS = "inline-grid flex-none grid-cols-2 gap-0.5 rounded-[8px] bg-surface-3 p-0.5";
const SEG_CLASS = cn("h-[30px] min-w-[34px] cursor-pointer rounded-[6px] px-2 text-[13px] font-medium text-foreground", BRAND_PRESS_CLASS);
const SEG_ON_CLASS = "bg-seg [box-shadow:var(--seg-sh)]";

/** The footer link (or none) whose panel is open: one of the Bill options sections, or the order note. */
type OpenPanel = FooterLink["key"] | null;

// Cart panel: the owner's HTML cart (U1 Tasks 4–5) — the head and lines (CartHead, CartLines), then the footer: the
// links row (CartFooterLinks), the bill behind "Total · Details" (CartBill), the notices and the two buttons. The
// links open the one Bill options panel (the More menu's controls, owner Q11) or the order note, both hanging from the
// footer. Discount is controlled by the parent so the panel can be mounted twice (desktop column + mobile sheet)
// without diverging. When resuming an open tab, already-fired lines come first, locked, marked "Sent to kitchen"; the
// buttons switch between send / pay / settle.
export function Cart({
  items,
  count,
  newCount,
  subtotal,
  discount,
  gstAmount = 0,
  gstRate,
  total,
  discountRaw,
  discountUnit,
  onDiscountRawChange,
  onDiscountUnitChange,
  canGstDiscount,
  charge,
  chargeLabel,
  entitledCharge,
  onChargeChange,
  onChargeReset,
  extraCharges,
  onAddExtraCharge,
  onRemoveExtraCharge,
  onUpdateQty,
  onRemove,
  onClear,
  notes,
  onNotesChange,
  customerSelected = false,
  rewardLoading = false,
  stamps,
  rewardOffers = [],
  selectedRewardAt = null,
  rewardLocked = false,
  onSelectReward,
  cardOffers = [],
  selectedCardId = null,
  onSelectCard,
  rewardBlockedReason = null,
  promoLocked = false,
  manualDiscountActive = false,
  promoCode = null,
  onApplyPromo,
  onRemovePromo,
  onSendToKitchen,
  onPayNow,
  onSettle,
  onCloseTab,
  onVoidItem,
  resumedOrderId,
  resumedOrder,
  cells,
  isBusy,
  sending = false,
  sendNotice = null,
  onDiscardSend,
  menuNotice,
  className,
  onBack,
}: CartProps) {
  const resuming = !!resumedOrderId;
  const gstActive = discountUnit === "GST";
  const hasNew = items.some((it) => it.kotRound === 0);

  // The cart the footer's panels must stay inside (each mount: the column, or the sheet).
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  // The open footer panel. Nothing in it may act while a send flies (plan Review Focus 1), so a busy cart closes it;
  // a tab carries no order note, so resuming one closes the note.
  const [panel, setPanel] = useState<OpenPanel>(null);
  if (isBusy && panel !== null) setPanel(null);
  if (resuming && panel === "note") setPanel(null);
  // A second tap on the open link closes its panel; another link moves the open panel to its own section.
  const togglePanel = (key: FooterLink["key"]) => setPanel((open) => (open === key ? null : key));
  const closePanel = () => setPanel(null);

  // What the picked reward is worth, for its link and the bill's row: the rung, else the scratch card. A tab whose
  // stored reward is no longer on the ladder still says one is applied.
  const selectedOffer = rewardOffers.find((o) => o.rung.at === selectedRewardAt);
  const selectedCard = cardOffers.find((o) => o.card.id === selectedCardId);
  const rewardPicked = selectedRewardAt !== null || selectedCardId !== null;
  const rewardWorth = selectedOffer ? rungWorthLabel(selectedOffer.rung) : selectedCard ? selectedCard.card.label : rewardPicked ? "applied" : null;
  // The same gates the Reward and Promo code controls apply to themselves, so a link never opens an empty section.
  const rewardShown = rewardOffered({ customerSelected, offers: rewardOffers.length, stamps, cards: cardOffers.length });
  const promoShown = promoOffered({ rewardPicked, promoCode });

  // D9.8 → owner Q11: every adjustment the panel holds names itself on its link ("Discount · 10%", "Promo · SAVE10",
  // …), read off the SAME props the controls render from, so a link can never drift from its control. Keyed on the
  // operator's INTENT (discountRaw / the GST preset), not the derived `discount`: usePosTotals returns 0 while the
  // subtotal is 0, so a discount that survived Clear would otherwise report nothing at all.
  const links = footerLinks({
    resuming,
    rewardOffered: rewardShown,
    discountRaw,
    discountUnit,
    promoCode,
    rewardWorth,
    extraCount: extraCharges.length,
    notes,
  });

  return (
    // The panel itself scrolls (both mounts), as the HTML's cart column does (values 5.1): when the column or sheet is
    // shorter than the head + the lines' floor + the footer, the footer stays at the cart's foot (sticky) and the lines
    // scroll under it. The column (POS_CART_CLASS) draws its left rule; the cart has no card frame.
    <div
      ref={setRoot}
      data-ui="pos-cart-body"
      className={cn(
        "flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden overscroll-contain bg-card",
        className,
      )}
    >
      <CartHead
        hasItems={items.length > 0}
        resumedOrder={resumedOrder}
        isBusy={isBusy}
        onClear={onClear}
        onCloseTab={onCloseTab}
        onBack={onBack}
        cells={cells}
      />

      <CartLines
        items={items}
        resumedOrder={resumedOrder}
        isBusy={isBusy}
        onUpdateQty={onUpdateQty}
        onRemove={onRemove}
        onVoidItem={onVoidItem}
      />

      {/* D9.8c — the links are locked ONLY while busy, never on an empty cart: onClear is clearCart (items only), so a
          discount, promo, reward or extra charge SURVIVES Clear, and the operator must still be able to see and remove
          it. The controls inside keep their own empty-cart gates, so SETTING a new adjustment on an empty cart is
          still refused; only SEEING and REMOVING one stays reachable. */}
      <Popover open={panel !== null} onOpenChange={(open) => !open && setPanel(null)}>
        <PopoverAnchor asChild>
          <div data-ui="pos-cart-footer" className={FOOTER_CLASS}>
            <CartFooterLinks links={links} openKey={panel} onOpen={togglePanel} disabled={isBusy} />
            <CartBill
              count={count}
              subtotal={subtotal}
              discount={discount}
              gstActive={gstActive}
              gstAmount={gstAmount}
              gstRate={gstRate}
              total={total}
              promoCode={promoCode}
              onRemovePromo={onRemovePromo ?? (() => {})}
              selectedReward={selectedOffer}
              rewardLocked={rewardLocked}
              onClearReward={() => onSelectReward?.(null)}
              selectedCard={selectedCard}
              onClearCard={() => onSelectCard?.(null)}
              charge={charge}
              chargeLabel={chargeLabel}
              entitledCharge={entitledCharge}
              onChargeChange={onChargeChange}
              onChargeReset={onChargeReset}
              extraCharges={extraCharges}
              onRemoveExtraCharge={onRemoveExtraCharge}
              isBusy={isBusy}
            />
            <CartUnavailableNotice notice={menuNotice} disabled={isBusy} />
            <WriteNoticePanel notice={sendNotice} />
            <CartActions
              resuming={resuming}
              hasItems={items.length > 0}
              hasNew={hasNew}
              newCount={newCount}
              total={total}
              busy={!!isBusy}
              sending={sending}
              notice={sendNotice}
              onDiscard={onDiscardSend}
              onSendToKitchen={onSendToKitchen}
              onPayNow={onPayNow}
              onSettle={onSettle}
            />
          </div>
        </PopoverAnchor>

        {panel === "note" ? (
          <CartNotes value={notes} onChange={onNotesChange} disabled={isBusy} boundary={root} onDone={closePanel} />
        ) : panel !== null ? (
          <BillOptionsPanel section={panel} boundary={root} onDone={closePanel}>
            {/* Owner decision, binding (kept): the reward sits directly above Discount so the two money decisions
                (reward vs. manual discount, mutually exclusive — see CartReward) read as one group. */}
            {/* Shown whenever the Reward link can open it: offered, picked, or a tab's locked reward (its line). */}
            {rewardSectionShown({ offered: rewardShown, picked: rewardPicked, locked: rewardLocked }) && (
              <BillOptionsSection id="reward" caption="Reward">
                <CartReward
                  customerSelected={customerSelected}
                  loading={rewardLoading}
                  stamps={stamps}
                  offers={rewardOffers}
                  selectedAt={selectedRewardAt}
                  locked={rewardLocked}
                  onSelect={onSelectReward ?? (() => {})}
                  manualDiscountActive={manualDiscountActive}
                  cards={{ offers: cardOffers, selectedId: selectedCardId, onSelect: onSelectCard ?? (() => {}) }}
                  blockedReason={rewardBlockedReason}
                  disabled={items.length === 0 || isBusy}
                />
              </BillOptionsSection>
            )}

            {/* CB-5D part 2 — in the same money group as the reward just above it. COURTESY exclusion only: hidden
                while a reward is selected (rewardActive) — the server is the actual fence. */}
            {promoShown && (
              <BillOptionsSection id="promo" caption="Promo code">
                <CartPromo
                  code={promoCode}
                  onApply={onApplyPromo ?? (() => {})}
                  onRemove={onRemovePromo ?? (() => {})}
                  rewardActive={selectedRewardAt !== null || selectedCardId !== null}
                  disabled={items.length === 0 || isBusy}
                  defaultExpanded={panel === "promo"}
                />
              </BillOptionsSection>
            )}

            <BillOptionsSection id="discount" caption="Discount">
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  readOnly={gstActive}
                  value={gstActive ? discount : discountRaw === 0 ? "" : discountRaw}
                  onChange={(e) => onDiscountRawChange(Math.max(0, Number(e.target.value) || 0))}
                  placeholder="0"
                  disabled={items.length === 0}
                  className={cn(POS_PANEL_FIELD_CLASS, NO_NUMBER_SPINNER_CLASS, "min-w-0 flex-1 text-right")}
                  aria-label="Discount value"
                />
                <div className={SEG_TRACK_CLASS}>
                  {(["₹", "%"] as DiscountUnit[]).map((u) => (
                    <button
                      key={u}
                      type="button"
                      aria-pressed={discountUnit === u}
                      onClick={() => onDiscountUnitChange(u)}
                      className={cn(SEG_CLASS, discountUnit === u && SEG_ON_CLASS)}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>

              {/* One tap discounts the GST component so the customer pays the pre-tax figure; derived in usePosTotals
                  and re-derived server-side — this panel only shows it. */}
              {canGstDiscount && (
                <Button
                  type="button"
                  variant={gstActive ? "default" : "outline"}
                  className={POS_CART_GST_BUTTON_CLASS}
                  aria-pressed={gstActive}
                  disabled={items.length === 0 || ((rewardLocked || promoLocked) && !gstActive)}
                  onClick={() => onDiscountUnitChange(gstActive ? "₹" : "GST")}
                >
                  {GST_DISCOUNT_LABEL}
                </Button>
              )}
              {/* P4 + O2 — a resumed tab's reward or promo owns the bill's one discount; the server 409s a GST preset
                  on it, so the button says no first and this line says why. A preset already ON stays tappable, only
                  to turn it off. */}
              {canGstDiscount && (rewardLocked || promoLocked) && (
                <p className="text-xs text-muted-foreground">
                  {rewardLocked ? REWARD_BLOCKS_GST_DISCOUNT_MESSAGE : PROMO_BLOCKS_GST_DISCOUNT_MESSAGE}
                </p>
              )}
            </BillOptionsSection>

            {/* CB-CHG (plan §5C) — the staff-entered extra charges. A takeaway bill has no table but can still carry
                one, so unlike the table charge this is always offered. Its APPLIED rows stay OUTSIDE the panel (the
                bill's own rows): what a customer is being charged is never hidden behind a tap. */}
            <BillOptionsSection id="charges" caption="Extra charges">
              <CartExtraCharges
                extras={extraCharges}
                onAdd={onAddExtraCharge}
                onRemove={onRemoveExtraCharge}
                disabled={isBusy}
                defaultExpanded={panel === "charges"}
              />
            </BillOptionsSection>
          </BillOptionsPanel>
        ) : null}
      </Popover>
    </div>
  );
}

/** Send KOT (values 5.5): 50px, a 1px --ink rule on --surface, radius 10, 14.5px 600, the UA's 1px 6px; hover --hover;
 *  "All sent" (nothing new) at .5. The HTML's press (BRAND_PRESS_CLASS). Also the frozen send's "Discard". */
const SEND_LOOK =
  "flex h-[50px] cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-ink bg-card px-1.5 py-px text-[14.5px] font-semibold text-foreground not-disabled:hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50";
/** Pay (values 5.5): 50px, --accent, --on-accent, radius 10, 15px 600; hover --accent-h; an empty cart at .4. Also the
 *  frozen send's "Send again" (the one action its notice asks for). */
const PAY_LOOK =
  "flex h-[50px] cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[10px] [border:0] bg-primary px-1.5 py-px text-[15px] font-semibold text-primary-foreground not-disabled:hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40";
const SEND_BUTTON_CLASS = cn(SEND_LOOK, BRAND_PRESS_CLASS);
const PAY_BUTTON_CLASS = cn(PAY_LOOK, BRAND_PRESS_CLASS);
/** The key chips (values 5.5, owner Q13): Geist Mono 11px, radius 4, 0 4px, line-height 16, a 1px rule; from 720px. */
const SEND_CHIP_CLASS =
  "hidden rounded-[4px] border border-border px-1 font-mono text-[11px] leading-4 text-muted-foreground tab:inline";
const PAY_CHIP_CLASS =
  "hidden rounded-[4px] border border-[rgba(255,255,255,.5)] px-1 font-mono text-[11px] leading-4 tab:inline";

// The HTML's two buttons (values 5.5; design 6.8): "Send KOT · {new qty}" | "Pay ₹{total}" with their F8 / F9 chips,
// for a new order and a resumed tab alike. Nothing new → "All sent"; an empty cart → Pay off. A tab with new items
// cannot be paid until they are sent (today's rule: otherwise they'd be dropped from both the bill and the kitchen).
function CartActions({
  resuming,
  hasItems,
  hasNew,
  newCount,
  total,
  busy,
  sending,
  notice,
  onDiscard = () => {},
  onSendToKitchen,
  onPayNow,
  onSettle,
}: {
  resuming: boolean;
  hasItems: boolean;
  hasNew: boolean;
  newCount: number;
  total: number;
  busy: boolean;
  sending: boolean;
  notice: WriteNotice | null;
  onDiscard?: () => void;
  onSendToKitchen?: () => void;
  onPayNow?: () => void;
  onSettle?: () => void;
}) {
  const inFlight = sending && (
    <>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Sending…
    </>
  );
  // An unanswered send (its notice sits above) freezes the cart: the ways on
  // are Send again — the same request and key, never twice — or Discard.
  if (notice?.action === "send-again") {
    return (
      <div className="grid grid-cols-2 gap-2" data-ui="pos-cart-actions">
        <button type="button" className={PAY_BUTTON_CLASS} disabled={sending} onClick={onSendToKitchen}>
          {inFlight || "Send again"}
        </button>
        <SendDiscard kind="kitchen" disabled={sending} onDiscard={onDiscard} className={SEND_BUTTON_CLASS} />
      </div>
    );
  }
  // Send KOT fires the unsent lines: a new order's first round, or a tab's next one.
  const send = (
    <button
      type="button"
      data-ui="pos-send"
      aria-keyshortcuts="F8"
      className={SEND_BUTTON_CLASS}
      disabled={busy || newCount === 0}
      onClick={onSendToKitchen}
    >
      {inFlight || <span>{newCount > 0 ? `Send KOT · ${newCount}` : "All sent"}</span>}
      <span aria-hidden="true" className={SEND_CHIP_CLASS}>F8</span>
    </button>
  );
  if (resuming) {
    // A tab's Pay settles it (the payment sheet's settle). Blocked while there are unsent items — otherwise they'd be
    // dropped from both the bill and the kitchen. Send them first.
    return (
      <>
        <div className="grid grid-cols-[1fr_1.4fr] gap-2" data-ui="pos-cart-actions">
          {send}
          <button
            type="button"
            data-ui="pos-pay"
            aria-keyshortcuts="F9"
            className={PAY_BUTTON_CLASS}
            disabled={busy || !hasItems || hasNew}
            onClick={onSettle}
          >
            <span>Pay {inr(total)}</span>
            <span aria-hidden="true" className={PAY_CHIP_CLASS}>F9</span>
          </button>
        </div>
        {hasNew && (
          <p className="text-center text-[12px] text-muted-foreground">Send the new items to the kitchen before settling.</p>
        )}
      </>
    );
  }
  // A new order: Send KOT opens a tab, Pay takes the whole payment now (the payment sheet's pay).
  return (
    <div className="grid grid-cols-[1fr_1.4fr] gap-2" data-ui="pos-cart-actions">
      {send}
      <button
        type="button"
        data-ui="pos-pay"
        aria-keyshortcuts="F9"
        className={PAY_BUTTON_CLASS}
        disabled={busy || !hasItems}
        onClick={onPayNow}
      >
        <span>Pay {inr(total)}</span>
        <span aria-hidden="true" className={PAY_CHIP_CLASS}>F9</span>
      </button>
    </div>
  );
}
