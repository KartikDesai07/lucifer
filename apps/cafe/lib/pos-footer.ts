// U1 Task 5 (2026-10-21): what the /pos cart footer's links row says (owner Q11; design 6.7; values 5.5 links in
// docs/superpowers/specs/2026-10-20-pos-html-values.md): "Discount · Promo code · Reward · Extra charge · Note". The
// first four open the one Bill options panel at their own section; Note opens the order note. An applied one names its
// value in place of its word ("Discount · 10%", "Promo · SAVE10", …), so nothing applied is ever hidden behind a tap —
// the rule today's three-dot More menu carried on its dot and aria-label (D9.8), now on the links themselves.
// Pure: no React; read off the same props the panel's controls render from, so a link can never drift from its control.
import { inr } from "@pos/shared/utils";
import type { DiscountUnit } from "@/components/pos/Cart";

/** A section of the Bill options panel (in the panel: today's More-menu order, reward, promo, discount, charges). */
export type BillSection = "reward" | "promo" | "discount" | "charges";

export interface FooterLink {
  key: BillSection | "note";
  /** The link's own word, also its section's name. */
  label: string;
  /** What is applied, shown in place of the word (--accent-i 600); null when nothing is. */
  applied: string | null;
}

export interface FooterView {
  /** A resumed tab: no Note link (an add-round carries no order note). */
  resuming: boolean;
  /** The customer has stamps, rungs or cards (rewardOffered below): the Reward link shows. */
  rewardOffered: boolean;
  /** The discount the operator entered (the GST preset derives its own amount). */
  discountRaw: number;
  discountUnit: DiscountUnit;
  promoCode: string | null;
  /** What the picked rung or card is worth; null while none is picked. */
  rewardWorth: string | null;
  /** How many staff-entered extra charges the bill carries. */
  extraCount: number;
  notes: string;
}

/** How much of the order note the Note link previews. */
export const NOTE_PREVIEW_CHARS = 24;

/** CartReward's own gate: a customer is selected and has stamps, a rung of the ladder or a scratch card to show. */
export function rewardOffered(input: { customerSelected: boolean; offers: number; stamps: number | undefined; cards: number }): boolean {
  return input.customerSelected && (input.offers > 0 || (input.stamps ?? 0) > 0 || input.cards > 0);
}

/** CartPromo's own gate: a picked reward stands the promo control down (one reward per bill) unless a code is set. */
export function promoOffered(input: { rewardPicked: boolean; promoCode: string | null }): boolean {
  return !input.rewardPicked || !!input.promoCode;
}

function discountApplied(view: FooterView): string | null {
  if (view.discountUnit === "GST") return "GST Discount";
  if (view.discountRaw > 0) {
    return view.discountUnit === "%" ? `Discount · ${view.discountRaw}%` : `Discount · ${inr(view.discountRaw)}`;
  }
  return null;
}

function noteApplied(notes: string): string | null {
  const text = notes.replace(/\s+/g, " ").trim();
  if (text === "") return null;
  const preview = text.length > NOTE_PREVIEW_CHARS ? `${text.slice(0, NOTE_PREVIEW_CHARS)}…` : text;
  return `Note · ${preview}`;
}

/** The links row, in the design's order; a link the bill cannot use right now is left out. */
export function footerLinks(view: FooterView): FooterLink[] {
  const links: FooterLink[] = [{ key: "discount", label: "Discount", applied: discountApplied(view) }];
  if (promoOffered({ rewardPicked: view.rewardWorth !== null, promoCode: view.promoCode })) {
    links.push({ key: "promo", label: "Promo code", applied: view.promoCode ? `Promo · ${view.promoCode}` : null });
  }
  // A picked reward keeps its link even when the offers are gone, so it can still be seen and removed.
  if (view.rewardOffered || view.rewardWorth !== null) {
    links.push({ key: "reward", label: "Reward", applied: view.rewardWorth !== null ? `Reward · ${view.rewardWorth}` : null });
  }
  links.push({ key: "charges", label: "Extra charge", applied: view.extraCount > 0 ? `Extra charge · ${view.extraCount}` : null });
  if (!view.resuming) links.push({ key: "note", label: "Note", applied: noteApplied(view.notes) });
  return links;
}
