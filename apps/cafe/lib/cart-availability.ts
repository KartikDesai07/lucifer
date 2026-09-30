import { inr } from "@/lib/utils";
import {
  MENU_REFUSAL_NAMES_SHOWN,
  menuIssueAction,
  menuIssueSentences,
  menuLineIssues,
  type MenuLineIssue,
} from "@/lib/order-availability";
import type { CartItem, UseCart } from "@/hooks/use-cart";
import type { Product } from "@/types";

// Menu B2 — which lines in the New Order cart the menu can no longer sell as
// they stand. PURE and client-safe. The verdict comes from the SAME
// menuLineIssues the server's 409 uses (lib/order-availability.ts), so the
// notice here and the refusal there can never disagree — this file holds no
// price rule and no copy of its own.

type AddOpts = NonNullable<Parameters<UseCart["addToCart"]>[1]>;

/** A line the menu cannot sell any more (out of stock, archived, size gone). */
export interface CartUnavailableLine {
  lineId: string;
  label: string;
}

/** A line still on the menu but at another price and/or under another name. */
export interface CartChangedLine {
  lineId: string;
  label: string;
  fromPrice: number;
  /** Set only when the price changed. */
  toPrice?: number;
  /** Set only when the menu's name differs from the line's. */
  toName?: string;
  line: CartItem;
  /** The menu's current row — what "Update them" re-adds from. */
  product: Product;
}

export interface CartMenuNotice {
  sentences: string[];
  action: string;
  unavailable: CartUnavailableLine[];
  changed: CartChangedLine[];
}

/** The line's own options, exactly, for re-adding it from the fresh product. */
export function reAddOptsOf(line: CartItem): AddOpts {
  return {
    qty: line.qty,
    variation: line.variation,
    modifiers: line.modifiers,
    removedModifiers: line.removedModifiers,
    instructions: line.instructions,
  };
}

function changedLine(line: CartItem, issue: MenuLineIssue, product: Product): CartChangedLine {
  return {
    lineId: line.lineId,
    label: issue.label,
    fromPrice: line.price,
    ...(issue.reason === "price" && issue.expectedPrice !== undefined
      ? { toPrice: issue.expectedPrice }
      : {}),
    ...(product.name !== line.name ? { toName: product.name } : {}),
    line,
    product,
  };
}

/**
 * Null = nothing to say: no menu yet (`undefined` — still loading, never a
 * verdict), an empty list (a list that arrived empty is a failed read, not a
 * menu where everything was archived), or every line is fine. Only UNSENT
 * lines are judged: a sent line is already on the kitchen ticket and the
 * server never re-judges it, and a reward line is server-built.
 */
export function cartMenuIssues(
  cart: readonly CartItem[],
  menu?: readonly Product[],
): CartMenuNotice | null {
  if (!menu || menu.length === 0) return null;
  const unsent = cart.filter((line) => line.kotRound === 0 && !line.reward);
  const issues = menuLineIssues(menu, unsent);
  if (issues.length === 0) return null;

  const byId = new Map(menu.map((p) => [p._id, p]));
  const unavailable: CartUnavailableLine[] = [];
  const changed: CartChangedLine[] = [];
  for (const issue of issues) {
    const line = unsent[issue.index];
    const product = byId.get(line.productId);
    if (issue.reason === "gone" || issue.reason === "out" || !product) {
      unavailable.push({ lineId: line.lineId, label: issue.label });
    } else {
      changed.push(changedLine(line, issue, product));
    }
  }
  return {
    sentences: menuIssueSentences(issues),
    action: menuIssueAction(issues),
    unavailable,
    changed,
  };
}

/** One notice row: "Latte (Large): ₹150 → ₹160" / "Cold Coffee → Iced Coffee". */
export function changedRowText(row: CartChangedLine): string {
  const renamed = row.toName === undefined ? row.label : `${row.label} → ${row.toName}`;
  return row.toPrice === undefined
    ? renamed
    : `${renamed}: ${inr(row.fromPrice)} → ${inr(row.toPrice)}`;
}

/** The rows the notice lists (the first few) and how many were left out. */
export function changedRowsShown(rows: readonly CartChangedLine[]): {
  shown: CartChangedLine[];
  more: number;
} {
  return {
    shown: rows.slice(0, MENU_REFUSAL_NAMES_SHOWN),
    more: Math.max(0, rows.length - MENU_REFUSAL_NAMES_SHOWN),
  };
}

type CartEditor = Pick<UseCart, "removeFromCart" | "addToCart">;

/**
 * "Remove them" / "Update them". Update = remove the lines, then add each back
 * from the fresh product with the line's own options, so qty, size, modifiers,
 * removed modifiers and instructions survive and only the price and the name
 * change. Uses the cart's existing mutators — each is a no-op while a send is
 * in flight, and the buttons are disabled then too.
 */
export function cartMenuActions(notice: CartMenuNotice, cart: CartEditor) {
  return {
    onRemoveUnavailable: () => {
      for (const { lineId } of notice.unavailable) cart.removeFromCart(lineId);
    },
    onUpdateChanged: () => {
      // ALL removals first: addToCart folds into any unsent line that shares its
      // key (use-cart.ts), and a legacy "#i:" line and a local line can share one -
      // re-adding one before the other is removed would merge into it, then the
      // later removal would drop that quantity at the old price.
      for (const { lineId } of notice.changed) cart.removeFromCart(lineId);
      for (const { line, product } of notice.changed) cart.addToCart(product, reAddOptsOf(line));
    },
  };
}
