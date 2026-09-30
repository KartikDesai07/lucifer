"use client";

import { priceDisplayOf, itemSubLine, isOutOfStock, isHiddenFromQr } from "@/lib/menu-items";
import { categoryNameOf } from "@/lib/category-map";
import { inr, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { BRAND_CHECKBOX_SQUARE_CLASS } from "@/components/brand/brand-classes";
import { ItemArt } from "@/components/menu/ItemArt";
import { ItemRowMenu } from "@/components/menu/ItemRowMenu";
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
  onArchive: (product: Product) => void;
  onRestore: (product: Product) => void;
  onToggleAvailable: (id: string, available: boolean) => void;
  pendingAvailabilityId?: string;
}

// Below-lg surface (R14). R13: admin tap opens the editor, or toggles
// selection while Select mode is on; each admin card also carries the ⋯ menu
// (Edit + Archive, or Edit + Restore when archived) so an admin on a phone
// can reach everything the table offers. Staff: a tap does nothing OUTSIDE
// Select mode (only the In stock switch works); in Select mode a tap toggles
// selection so the two staff bulk actions stay reachable (G4) — the ⋯ menu
// itself stays admin-only either way.
export function ItemCards({
  products,
  archived,
  isAdmin,
  categoryMap,
  selectMode,
  selected,
  onToggleSelect,
  onEdit,
  onArchive,
  onRestore,
  onToggleAvailable,
  pendingAvailabilityId,
}: ItemCardsProps) {
  return (
    <div className="flex flex-col gap-2">
      {products.map((product) => {
        const available = product.available !== false;
        const subLine = itemSubLine(product);
        const price = priceDisplayOf(product);
        const isSelected = selected.has(product._id);

        // G4 — Select mode toggles selection for EVERY role (staff need it to
        // reach the two stock bulk actions); outside Select mode only an
        // admin tap opens the editor, and a staff tap is a no-op. Pointer-only
        // convenience (N5, a11y): the card is NOT role="button"/tabIndex/
        // onKeyDown — nesting an implicit-role interactive card around a real
        // Checkbox and Switch is a nested-interactive violation, and now that
        // staff reach it too the audience is bigger. Keyboard users select via
        // the Checkbox and edit via the ⋯ menu's Edit item instead.
        const tappable = selectMode || isAdmin;
        const handleTap = () => {
          if (selectMode) {
            onToggleSelect(product._id);
            return;
          }
          if (isAdmin) onEdit(product);
        };

        return (
          <div
            key={product._id}
            onClick={handleTap}
            className={cn(
              "flex items-center gap-3 rounded-lg border bg-card p-3",
              tappable && "cursor-pointer hover:bg-accent/50",
              isSelected && "border-primary bg-primary/5",
            )}
          >
            {selectMode && (
              <Checkbox
                className={BRAND_CHECKBOX_SQUARE_CLASS}
                checked={isSelected}
                onCheckedChange={() => onToggleSelect(product._id)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Select ${product.name}`}
              />
            )}
            <ItemArt name={product.name} image={product.image} icon={product.icon} size={56} className="rounded-lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{product.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {categoryNameOf(categoryMap, product.categoryId)}
                {subLine && ` · ${subLine}`}
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                {/* G11 — the struck-through raw price on a discount, same rule
                    as ItemsTable's PriceCell (R11). */}
                <span className="text-sm font-semibold tabular-nums">
                  {price.hasRange ? `${inr(price.min)} – ${inr(price.max)}` : inr(price.min)}
                </span>
                {price.discount > 0 && (
                  <span className="text-xs tabular-nums text-muted-foreground line-through">
                    {price.hasRange ? `${inr(price.raw.min)} – ${inr(price.raw.max)}` : inr(price.raw.min)}
                  </span>
                )}
                {isOutOfStock(product) && (
                  <Badge variant="destructive" className="text-[10px]">Out of stock</Badge>
                )}
                {isHiddenFromQr(product) && (
                  <Badge variant="outline" className="text-[10px]">Hidden from QR</Badge>
                )}
                {archived && <Badge variant="outline" className="text-[10px]">Archived</Badge>}
              </div>
            </div>
            {!archived && (
              <Switch
                checked={available}
                disabled={pendingAvailabilityId === product._id}
                onCheckedChange={(v) => onToggleAvailable(product._id, v)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`In stock: ${product.name}`}
              />
            )}
            {isAdmin && !selectMode && (
              <ItemRowMenu product={product} archived={archived} onEdit={onEdit} onArchive={onArchive} onRestore={onRestore} />
            )}
          </div>
        );
      })}
    </div>
  );
}
