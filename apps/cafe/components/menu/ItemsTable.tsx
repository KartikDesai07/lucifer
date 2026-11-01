"use client";

import { categoryNameOf } from "@/lib/category-map";
import { cn } from "@/lib/utils";
import { isHiddenFromQr } from "@/lib/menu-items";
import { menuItemBadges, menuPriceText, menuSizesText } from "@/lib/menu-view";
import type { ProductSort, ProductSortKey } from "@/lib/products-sort";
import {
  MENU_ARCHIVED_CLASS,
  MENU_CATEGORY_CELL_CLASS,
  MENU_CATEGORY_DOT_CLASS,
  MENU_EDIT_CLASS,
  MENU_LINE2_CATEGORY_CLASS,
  MENU_LINE2_CLASS,
  MENU_NAME_BLOCK_CLASS,
  MENU_NAME_BOX_CLASS,
  MENU_NAME_BUTTON_CLASS,
  MENU_NAME_CLASS,
  MENU_PRICE_CELL_CLASS,
  MENU_PRICE_STRUCK_CLASS,
  MENU_QR_WORDS_CLASS,
  MENU_ROWS_CLASS,
  MENU_ROW_CLASS,
  MENU_ROW_GRID_CLASS,
  MENU_ROW_GRID_NO_CATEGORY_CLASS,
  MENU_ROW_SELECTED_CLASS,
  MENU_SIZES_CLASS,
  MENU_SWITCH_CELL_CLASS,
} from "@/lib/menu-list-layout";
import { ItemArt } from "@/components/menu/ItemArt";
import { ItemBadges } from "@/components/menu/ItemBadges";
import { ItemsTableHead } from "@/components/menu/ItemsTableHead";
import { MenuCheck } from "@/components/menu/MenuCheck";
import { MenuSwitch } from "@/components/menu/MenuSwitch";
import { PencilIcon } from "@/components/menu/menu-icons";
import { itemSkipsKitchen } from "@/components/menu/NoKotTag";
import type { Category, Product } from "@/types";

interface ItemsTableProps {
  products: Product[];
  archived: boolean;
  isAdmin: boolean;
  categoryMap: Map<string, Category>;
  /** Each category's dot hue by _id (the rail's, lib/pos-categories.ts). */
  hues: Map<string, string>;
  /** A category is picked: no Category column (values 5.1). */
  categoryPicked: boolean;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  onEdit: (product: Product) => void;
  onToggleAvailable: (id: string, available: boolean) => void;
  onToggleQrVisible: (id: string, visible: boolean) => void;
  pendingAvailabilityId?: string;
  pendingQrId?: string;
  sort: ProductSort;
  onSortChange: (key: ProductSortKey) => void;
}

// The table from 816px (U5 Task 2; values 5, design 6.4): the HTML's grid rows in the page's white list, which the caller
// draws. G4: every role selects (staff reach the two stock bulk actions through the check); the QR switch and the Edit
// pencil are admin-only, staff read "Shown" / "Hidden" (R20) and the name is plain text.
export function ItemsTable({
  products,
  archived,
  isAdmin,
  categoryMap,
  hues,
  categoryPicked,
  selected,
  onToggleSelect,
  onToggleAll,
  onEdit,
  onToggleAvailable,
  onToggleQrVisible,
  pendingAvailabilityId,
  pendingQrId,
  sort,
  onSortChange,
}: ItemsTableProps) {
  const ticked = products.filter((p) => selected.has(p._id)).length;
  const allState = ticked === 0 ? "off" : ticked === products.length ? "on" : "some";
  const grid = categoryPicked ? MENU_ROW_GRID_NO_CATEGORY_CLASS : MENU_ROW_GRID_CLASS;
  return (
    <div role="table" aria-label="Menu items" data-ui="menu-table">
      <ItemsTableHead allState={allState} onToggleAll={onToggleAll} categoryPicked={categoryPicked} sort={sort} onSortChange={onSortChange} />
      <div role="rowgroup" className={MENU_ROWS_CLASS}>
        {products.map((product) => {
          const isSelected = selected.has(product._id);
          const qrVisible = !isHiddenFromQr(product);
          const categoryName = categoryNameOf(categoryMap, product.categoryId);
          const price = menuPriceText(product);
          const badges = menuItemBadges(product, { archived, skipsKitchen: itemSkipsKitchen(product, categoryMap) });
          const text = (
            <>
              <span className={MENU_NAME_CLASS}>{product.name}</span>
              <span className={MENU_LINE2_CLASS}>
                <ItemBadges badges={badges} size="table" />
                <span data-ui="menu-sizes" className={MENU_SIZES_CLASS}>
                  {!categoryPicked && <span className={MENU_LINE2_CATEGORY_CLASS}>{categoryName} · </span>}
                  {menuSizesText(product)}
                </span>
              </span>
            </>
          );
          return (
            <div
              key={product._id}
              role="row"
              data-ui="menu-row"
              className={cn(grid, MENU_ROW_CLASS, isSelected && MENU_ROW_SELECTED_CLASS, archived && MENU_ARCHIVED_CLASS)}
            >
              <div role="cell" className="flex">
                <MenuCheck state={isSelected ? "on" : "off"} label={`Select ${product.name}`} onToggle={() => onToggleSelect(product._id)} />
              </div>
              <div role="cell" className="min-w-0">
                {isAdmin ? (
                  <button type="button" onClick={() => onEdit(product)} className={cn(MENU_NAME_BOX_CLASS, MENU_NAME_BUTTON_CLASS)}>
                    <ItemArt name={product.name} image={product.image} icon={product.icon} size={34} />
                    <span className={MENU_NAME_BLOCK_CLASS}>{text}</span>
                  </button>
                ) : (
                  <div className={MENU_NAME_BOX_CLASS}>
                    <ItemArt name={product.name} image={product.image} icon={product.icon} size={34} />
                    <div className={MENU_NAME_BLOCK_CLASS}>{text}</div>
                  </div>
                )}
              </div>
              {!categoryPicked && (
                <div role="cell" className={MENU_CATEGORY_CELL_CLASS}>
                  <span className={MENU_CATEGORY_DOT_CLASS} style={{ background: hues.get(product.categoryId) ?? "var(--border)" }} aria-hidden="true" />
                  <span className="min-w-0 truncate">{categoryName}</span>
                </div>
              )}
              <div role="cell" className={MENU_PRICE_CELL_CLASS}>
                {price.text}
                {price.struck && <span className={MENU_PRICE_STRUCK_CLASS}>{price.struck}</span>}
              </div>
              <div role="cell" className={MENU_SWITCH_CELL_CLASS}>
                {!archived && (
                  <MenuSwitch
                    tone="ok"
                    checked={product.available !== false}
                    disabled={pendingAvailabilityId === product._id}
                    onCheckedChange={(v) => onToggleAvailable(product._id, v)}
                    aria-label={`In stock: ${product.name}`}
                  />
                )}
              </div>
              <div role="cell" className={MENU_SWITCH_CELL_CLASS}>
                {isAdmin ? (
                  <MenuSwitch
                    tone="accent"
                    checked={qrVisible}
                    disabled={pendingQrId === product._id}
                    onCheckedChange={(v) => onToggleQrVisible(product._id, v)}
                    aria-label={`Shown on QR menu: ${product.name}`}
                  />
                ) : (
                  // R20 — staff get a read-only label, not a disabled switch (a `title` never surfaces on touch).
                  <span className={MENU_QR_WORDS_CLASS}>{qrVisible ? "Shown" : "Hidden"}</span>
                )}
              </div>
              <div role="cell" className="flex justify-center">
                {isAdmin && (
                  <button type="button" title="Edit item" aria-label={`Edit ${product.name}`} onClick={() => onEdit(product)} className={MENU_EDIT_CLASS}>
                    <PencilIcon size={16} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
