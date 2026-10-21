// The /pos item card's buying rules (U1 Task 3; owner Q5, design 6.4; values 4.1-4.2 in
// docs/superpowers/specs/2026-10-20-pos-html-values.md). Pure, so the card's price buttons, the add a tap makes and the
// tag line under the name are unit-tested without a renderer (lib/pos-price-buttons.test.ts).
//
// A tap on a price adds at once: an item sold one way has one "Add" button; an item with one to three variations has one
// button per variation (the HTML's short size words, values 4.2); beyond three, one "Choose" button shows the price range
// and opens the options modal, whose required chooser picks the size. The add is exactly what the options modal adds
// when nothing in it is changed (defaultAddOptions), so a direct add and an untouched modal add make the same line and
// merge into one.
import { effectiveUnitPrice } from "@pos/shared/public";
import { inr } from "@/lib/utils";
import { initialSelected, pickModifierResult } from "@/lib/modifier-picker";
import type { AddToCartOpts } from "@/components/pos/ModifierModal";
import type { Product } from "@/types";

/** One button of the card's price strip. `variation` is the variation it adds (none for an item sold one way);
 *  `opensOptions` marks the "Choose" button, whose `price`..`priceMax` is the item's range (ruling P2). */
export interface PriceButton {
  label: string;
  price: number;
  priceMax?: number;
  variation?: string;
  opensOptions: boolean;
}

/** The most variations that get a button each; more share one "Choose" button (owner Q5). */
export const MAX_PRICE_BUTTONS = 3;

/** The HTML's short size words (values 4.2 `short`); "Standard" (and an empty name) reads "Add". */
const SHORT_SIZE: Readonly<Record<string, string>> = { Regular: "Reg", Medium: "Med", Large: "Lrg", Standard: "" };

/** A variation's label on its price button: the HTML's short word, else the name as it is. */
export function shortSize(name: string): string {
  return (SHORT_SIZE[name] ?? name) || "Add";
}

/** The card's price buttons, each at the price the line bills (after the item's % discount, as the cart prices it). */
export function priceButtonsFor(product: Pick<Product, "price" | "discount" | "variations">): PriceButton[] {
  const priceOf = (price: number) => effectiveUnitPrice(price, product.discount ?? 0);
  const variations = product.variations ?? [];
  if (variations.length === 0) return [{ label: "Add", price: priceOf(product.price), opensOptions: false }];
  if (variations.length <= MAX_PRICE_BUTTONS) {
    return variations.map((v) => ({ label: shortSize(v.name), price: priceOf(v.price), variation: v.name, opensOptions: false }));
  }
  const prices = variations.map((v) => priceOf(v.price));
  return [{ label: "Choose", price: Math.min(...prices), priceMax: Math.max(...prices), opensOptions: true }];
}

/** A button's price as shown: "₹229", or the Choose button's "₹90–₹171". */
export function priceText(button: Pick<PriceButton, "price" | "priceMax">): string {
  return button.priceMax === undefined ? inr(button.price) : `${inr(button.price)}–${inr(button.priceMax)}`;
}

/** A price button's title (ruling P9: not the HTML's "Add {label}", which reads "Add Add" on a plain item): "Add
 *  {item}", "Add {item} ({variation})" with the variation's full name, and "Pick a variation" on the Choose button. */
export function priceButtonTitle(productName: string, button: Pick<PriceButton, "variation" | "opensOptions">): string {
  if (button.opensOptions) return "Pick a variation";
  return button.variation === undefined ? `Add ${productName}` : `Add ${productName} (${button.variation})`;
}

/** What a price button adds: exactly the options modal's add when nothing in it is changed — it opens with the item's
 *  initial ticks (none, or every modifier for a "modifiers come ticked" item), no note and qty 1 — with the button's
 *  variation (components/pos/ModifierModal.tsx; lib/pos-tile-paths.test.ts pins that the modal still builds it so). */
export function defaultAddOptions(product: Pick<Product, "modifiers" | "modifiersPreselected">, variation?: string): AddToCartOpts {
  return { ...pickModifierResult(product, initialSelected(product)), instructions: "", qty: 1, variation };
}

/** The tag line's no-break space: the 16px line stays on every card, so every card is the same height (values 4.2). */
export const NO_TAG = " ";

export interface CardTag {
  text: string;
  tone: "bad" | "plain";
}

/** The line under the name (design 6.4): "Unavailable" (in --bad-i) when out of stock, else "{n}% off", else
 *  "Customisable" (an item with add-ons), else the category's name (the Normal layout with All items, as today), else
 *  blank. */
export function cardTag(
  product: Pick<Product, "available" | "discount" | "modifiers">,
  opts: { showCategory: boolean; categoryLabel: string },
): CardTag {
  if (product.available === false) return { text: "Unavailable", tone: "bad" };
  if ((product.discount ?? 0) > 0) return { text: `${product.discount}% off`, tone: "plain" };
  if (product.modifiers.length > 0) return { text: "Customisable", tone: "plain" };
  if (opts.showCategory && opts.categoryLabel !== "") return { text: opts.categoryLabel, tone: "plain" };
  return { text: NO_TAG, tone: "plain" };
}
