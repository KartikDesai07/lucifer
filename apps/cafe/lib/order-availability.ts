import { derivedLinePrice } from "@/lib/public-pricing";
import type { ProductVariation } from "@/types";

// Menu B2 — the ONE rule for "may this POS line still be sold as sent?".
// PURE and DB-free (no mongoose, models or db import — the POS cart imports
// this file too, lib/cart-availability.ts): both staff order-write routes
// (POST /api/orders, POST /api/orders/[id]/items) pass the product rows they
// already read, and the New Order cart passes its menu list, so the server's
// 409 and the cart's notice can never disagree about which lines are stale.
//
// A line is judged against its product, first match wins:
//   gone    — no product doc, archived (isActive === false), or a size the
//             product no longer has (derivedLinePrice → null)
//   out     — out of stock (available === false)
//   price   — the line's price is not what the menu charges now
//   renamed — the line's name is not the product's name now (the POS copies
//             product.name verbatim, hooks/use-cart.ts, so only a rename or a
//             hand-built payload differs — the kitchen ticket and the bill
//             print the LINE's name, so a swapped name would print one dish at
//             another dish's price)
// `=== false` keeps a legacy doc with no `available` / `isActive` sellable.
// `publicVisible` is never read: an item hidden from the QR menu stays
// sellable at the counter (lib/order-request-accept.ts). Modifier text is not
// judged — it carries no price (accepted, not part of the price fence).
// The price comes from derivedLinePrice (lib/public-pricing.ts), the same
// rule the QR path and the reward dish bill at — never a second copy.

/** HTTP status of a menu refusal — a conflict with the menu as it is now. */
export const MENU_REFUSAL_STATUS = 409;
/** Item names listed per reason before "and N more". */
export const MENU_REFUSAL_NAMES_SHOWN = 3;

export type MenuIssueReason = "gone" | "out" | "price" | "renamed";

/** The product fields the rule reads — a lean() row or a client Product. */
export interface MenuProductSource {
  _id: unknown; // stringified via String(); never assumed to already be a string
  name: string;
  price: number;
  discount?: number; // lean() does not fill schema defaults — absent reads as 0
  available?: boolean;
  isActive?: boolean;
  variations?: ProductVariation[];
}

/** The line fields the rule reads — an order-body line or a cart line. */
export interface MenuCheckedLine {
  productId: string;
  name: string;
  price: number;
  variation?: string;
}

export interface MenuLineIssue {
  /** Index of the line in the array that was judged. */
  index: number;
  reason: MenuIssueReason;
  /** The line as the cashier saw it: "Latte (Large)". */
  label: string;
  /** reason "price": what the menu charges for this line now. */
  expectedPrice?: number;
  /** reason "renamed": what the menu calls this item now. */
  currentName?: string;
}

export const lineLabel = (line: MenuCheckedLine): string =>
  line.variation ? `${line.name} (${line.variation})` : line.name;

function judgeLine(
  p: MenuProductSource | undefined,
  line: MenuCheckedLine,
): Omit<MenuLineIssue, "index" | "label"> | null {
  if (!p || p.isActive === false) return { reason: "gone" };
  const expected = derivedLinePrice(
    {
      _id: p._id,
      name: p.name,
      price: p.price,
      discount: p.discount ?? 0,
      available: p.available !== false,
      modifiers: [],
      variations: p.variations,
    },
    line.variation,
  );
  if (expected === null) return { reason: "gone" };
  if (p.available === false) return { reason: "out" };
  if (line.price !== expected) return { reason: "price", expectedPrice: expected };
  if (line.name !== p.name) return { reason: "renamed", currentName: p.name };
  return null;
}

/** Every line that may not be sold as sent, in line order (empty = all fine). */
export function menuLineIssues(
  products: readonly MenuProductSource[],
  lines: readonly MenuCheckedLine[],
): MenuLineIssue[] {
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const issues: MenuLineIssue[] = [];
  lines.forEach((line, index) => {
    const verdict = judgeLine(byId.get(line.productId), line);
    if (verdict) issues.push({ index, label: lineLabel(line), ...verdict });
  });
  return issues;
}

// Sentence order is fixed: what cannot be sold first, then what changed.
const SENTENCES: ReadonlyArray<readonly [MenuIssueReason, string]> = [
  ["out", "Out of stock now"],
  ["gone", "No longer on the menu"],
  ["price", "Price changed"],
  ["renamed", "Renamed on the menu"],
];

function namesText(labels: readonly string[]): string {
  const shown = labels.slice(0, MENU_REFUSAL_NAMES_SHOWN).join(", ");
  const more = labels.length - MENU_REFUSAL_NAMES_SHOWN;
  return more > 0 ? `${shown} and ${more} more` : shown;
}

/** One sentence per reason present, e.g. "Out of stock now: Tea, Cake." */
export function menuIssueSentences(issues: readonly MenuLineIssue[]): string[] {
  const out: string[] = [];
  for (const [reason, prefix] of SENTENCES) {
    const labels = [...new Set(issues.filter((i) => i.reason === reason).map((i) => i.label))];
    if (labels.length > 0) out.push(`${prefix}: ${namesText(labels)}.`);
  }
  return out;
}

/** What the cashier should do next — neutral, so it reads right on Pay Now too. */
export function menuIssueAction(issues: readonly MenuLineIssue[]): string {
  const unavailable = issues.some((i) => i.reason === "out" || i.reason === "gone");
  const changed = issues.some((i) => i.reason === "price" || i.reason === "renamed");
  if (unavailable && changed) return "Remove or update them and try again.";
  return unavailable ? "Remove them and try again." : "Update them and try again.";
}

/** The full refusal copy — the server's 409 message and the cart notice's text. */
export function menuRefusalMessage(issues: readonly MenuLineIssue[]): string {
  return [...menuIssueSentences(issues), menuIssueAction(issues)].join(" ");
}

/** The routes' one call: the 409 message, or null when every line may be sold. */
export function orderLinesRefusal(
  products: readonly MenuProductSource[],
  lines: readonly MenuCheckedLine[],
): string | null {
  const issues = menuLineIssues(products, lines);
  return issues.length > 0 ? menuRefusalMessage(issues) : null;
}
