"use client";

import { Copy } from "lucide-react";

import { categoryNameOf } from "@/lib/category-map";
import { cn } from "@/lib/utils";
import { menuItemBadges, menuPriceText } from "@/lib/menu-view";
import {
  MENU_ARCHIVED_CLASS,
  MENU_CARD_BADGES_CLASS,
  MENU_CARD_BLOCK_CLASS,
  MENU_CARD_BUTTON_CLASS,
  MENU_CARD_CLASS,
  MENU_CARD_COPY_CLASS,
  MENU_CARD_NAME_CLASS,
  MENU_CARD_PRICE_CLASS,
  MENU_CARD_STOCK_CLASS,
  MENU_CARD_STOCK_LABEL_CLASS,
  MENU_CARD_STRUCK_CLASS,
  MENU_CARD_SUB_CLASS,
  MENU_CARD_TAPPABLE_CLASS,
  MENU_ROWS_CLASS,
  MENU_ROW_SELECTED_CLASS,
} from "@/lib/menu-list-layout";
import { ItemArt } from "@/components/menu/ItemArt";
import { ItemBadges } from "@/components/menu/ItemBadges";
import { MenuCheck } from "@/components/menu/MenuCheck";
import { MenuSwitch } from "@/components/menu/MenuSwitch";
import { itemSkipsKitchen } from "@/components/menu/NoKotTag";
import type { Category, Product } from "@/types";

interface ItemCardsProps {
  products: Product[];
  archived: boolean;
  isAdmin: boolean;
  categoryMap: Map<string, Category>;
  selectMode: boolean;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onEdit: (product: Product) => void;
  /** Opens the item form filled from this item (create mode). */
  onCopy: (product: Product) => void;
  onToggleAvailable: (id: string, available: boolean) => void;
  pendingAvailabilityId?: string;
}

// Below 816px (U5 Task 2; values 6, design 6.5): the HTML's card rows in the page's white list. R13: an admin's tap opens
// the editor, or toggles the selection while Select mode is on. Staff: a tap does nothing OUTSIDE Select mode (only the
// stock switch works); in Select mode a tap toggles for every role so the two staff bulk actions stay reachable (G4).
// The row Edit pencil is the table's (the HTML has none on a card: the name block is the way in).
export function ItemCards({
  products,
  archived,
  isAdmin,
  categoryMap,
  selectMode,
  selected,
  onToggleSelect,
  onEdit,
  onCopy,
  onToggleAvailable,
  pendingAvailabilityId,
}: ItemCardsProps) {
  return (
    <div data-ui="menu-cards" className={MENU_ROWS_CLASS}>
      {products.map((product) => {
        const available = product.available !== false;
        const price = menuPriceText(product);
        const isSelected = selected.has(product._id);
        const sizes = product.variations?.length ?? 0;
        const badges = menuItemBadges(product, { archived, skipsKitchen: itemSkipsKitchen(product, categoryMap) });

        // G4 — Select mode toggles selection for EVERY role; outside Select mode only an admin tap opens the editor, and a
        // staff tap is a no-op. Pointer-only convenience (N5, a11y): the card is NOT role="button"/tabIndex/onKeyDown —
        // its keyboard way in is the name block's real <button> (its Enter / Space click bubbles to this handler), and the
        // select box and switch inside it are their own controls.
        const tappable = selectMode || isAdmin;
        const handleTap = () => {
          if (selectMode) {
            onToggleSelect(product._id);
            return;
          }
          if (isAdmin) onEdit(product);
        };

        const text = (
          <>
            <ItemArt name={product.name} image={product.image} icon={product.icon} size={34} />
            <span className="min-w-0 flex-1">
              <span className={MENU_CARD_NAME_CLASS}>{product.name}</span>
              <span className={MENU_CARD_SUB_CLASS}>
                <span className={MENU_CARD_PRICE_CLASS}>{price.text}</span>
                {price.struck && <span className={cn(MENU_CARD_STRUCK_CLASS, "ml-1")}>{price.struck}</span>}
                {` · ${categoryNameOf(categoryMap, product.categoryId)}`}
                {sizes > 1 && ` · ${sizes} sizes`}
              </span>
              {/* Always drawn, as the HTML's (an empty one still carries its 4px: a card without a badge is 66px). */}
              <span className={MENU_CARD_BADGES_CLASS}>
                <ItemBadges badges={badges} size="card" />
              </span>
            </span>
          </>
        );

        return (
          <div
            key={product._id}
            data-ui="menu-card"
            onClick={handleTap}
            className={cn(MENU_CARD_CLASS, tappable && MENU_CARD_TAPPABLE_CLASS, isSelected && MENU_ROW_SELECTED_CLASS, archived && MENU_ARCHIVED_CLASS)}
          >
            {selectMode && <MenuCheck state={isSelected ? "on" : "off"} label={`Select ${product.name}`} onToggle={() => onToggleSelect(product._id)} stopClick />}
            {tappable ? (
              <button type="button" className={cn(MENU_CARD_BLOCK_CLASS, MENU_CARD_BUTTON_CLASS)}>
                {text}
              </button>
            ) : (
              <div className={MENU_CARD_BLOCK_CLASS}>{text}</div>
            )}
            {isAdmin && !selectMode && (
              // A sibling of the name button (never inside it); the stop keeps the card's tap-to-edit from also firing.
              // Hidden in Select mode, where a tap selects (G4).
              <button
                type="button"
                title="Copy item"
                aria-label={`Copy ${product.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onCopy(product);
                }}
                className={MENU_CARD_COPY_CLASS}
              >
                <Copy size={18} strokeWidth={1.9} aria-hidden="true" />
              </button>
            )}
            {!archived && (
              <div className={MENU_CARD_STOCK_CLASS} onClick={(e) => e.stopPropagation()}>
                <span className={MENU_CARD_STOCK_LABEL_CLASS}>{available ? "In stock" : "Sold out"}</span>
                <MenuSwitch
                  tone="ok"
                  checked={available}
                  disabled={pendingAvailabilityId === product._id}
                  onCheckedChange={(v) => onToggleAvailable(product._id, v)}
                  aria-label={`In stock: ${product.name}`}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
