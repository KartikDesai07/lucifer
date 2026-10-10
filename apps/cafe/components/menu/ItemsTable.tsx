"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import { categoryNameOf } from "@/lib/category-map";
import { priceDisplayOf, itemSubLine, isOutOfStock, isHiddenFromQr } from "@/lib/menu-items";
import { inr, cn } from "@/lib/utils";
import type { ProductSort, ProductSortKey } from "@/lib/products-sort";
import { Checkbox } from "@/components/ui/checkbox";
import { BRAND_CHECKBOX_SQUARE_CLASS } from "@/components/brand/brand-classes";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ItemArt } from "@/components/menu/ItemArt";
import { ItemRowMenu } from "@/components/menu/ItemRowMenu";
import { NoKotTag, itemSkipsKitchen } from "@/components/menu/NoKotTag";
import type { Category, Product } from "@/types";

interface ItemsTableProps {
  products: Product[];
  archived: boolean;
  isAdmin: boolean;
  categoryMap: Map<string, Category>;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onEdit: (product: Product) => void;
  onArchive: (product: Product) => void;
  onRestore: (product: Product) => void;
  onToggleAvailable: (id: string, available: boolean) => void;
  onToggleQrVisible: (id: string, visible: boolean) => void;
  pendingAvailabilityId?: string;
  pendingQrId?: string;
  sort: ProductSort;
  onSortChange: (key: ProductSortKey) => void;
}

function SortableHead({
  label,
  sortKey,
  sort,
  onSortChange,
  className,
}: {
  label: string;
  sortKey: ProductSortKey;
  sort: ProductSort;
  onSortChange: (key: ProductSortKey) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSortChange(sortKey)}
        className={cn(
          "inline-flex min-h-9 items-center gap-1 rounded-md font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        <Icon className={cn("h-3.5 w-3.5", active ? "opacity-100" : "opacity-50")} aria-hidden="true" />
      </button>
    </TableHead>
  );
}

function PriceCell({ product }: { product: Product }) {
  const p = priceDisplayOf(product);
  const struckThrough = p.discount > 0;
  return (
    <div>
      <p className="tabular-nums">
        {p.hasRange ? (
          <>
            {inr(p.min)} – {inr(p.max)}
          </>
        ) : (
          inr(p.min)
        )}
      </p>
      {struckThrough && (
        <p className="text-xs tabular-nums text-muted-foreground line-through">
          {p.hasRange ? (
            <>
              {inr(p.raw.min)} – {inr(p.raw.max)}
            </>
          ) : (
            inr(p.raw.min)
          )}
        </p>
      )}
    </div>
  );
}

// Dense table (R14 — lg and up only; below lg the page renders ItemCards
// instead). Lives inside the caller's overflow-x-auto [contain:inline-size]
// scroll wrapper (the ReportTable.tsx precedent).
export function ItemsTable({
  products,
  archived,
  isAdmin,
  categoryMap,
  selected,
  onToggleSelect,
  onEdit,
  onArchive,
  onRestore,
  onToggleAvailable,
  onToggleQrVisible,
  pendingAvailabilityId,
  pendingQrId,
  sort,
  onSortChange,
}: ItemsTableProps) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            {/* G4 — staff select too (the two stock bulk actions must stay
                reachable for them); ⋯/QR-switch stay admin-only below. */}
            <TableHead className="w-10" />
            <TableHead className="w-14" />
            <SortableHead label="Name" sortKey="name" sort={sort} onSortChange={onSortChange} />
            <SortableHead label="Category" sortKey="category" sort={sort} onSortChange={onSortChange} />
            <SortableHead label="Price" sortKey="price" sort={sort} onSortChange={onSortChange} className="text-right" />
            <SortableHead label="In stock" sortKey="available" sort={sort} onSortChange={onSortChange} className="w-28 text-right" />
            <TableHead className="w-28 text-right">QR menu</TableHead>
            {isAdmin && <TableHead className="w-12 text-right" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => {
            const available = product.available !== false;
            const qrVisible = !isHiddenFromQr(product);
            const subLine = itemSubLine(product);
            return (
              <TableRow key={product._id}>
                <TableCell>
                  <Checkbox
                    className={BRAND_CHECKBOX_SQUARE_CLASS}
                    checked={selected.has(product._id)}
                    onCheckedChange={() => onToggleSelect(product._id)}
                    aria-label={`Select ${product.name}`}
                  />
                </TableCell>
                <TableCell>
                  <ItemArt name={product.name} image={product.image} icon={product.icon} size={40} className="rounded-md" />
                </TableCell>
                <TableCell className="font-medium">
                  <p>{product.name}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {subLine && <span className="text-xs font-normal text-muted-foreground">{subLine}</span>}
                    {isOutOfStock(product) && (
                      <Badge variant="destructive" className="text-[10px]">Out of stock</Badge>
                    )}
                    {isHiddenFromQr(product) && (
                      <Badge variant="outline" className="text-[10px]">Hidden from QR</Badge>
                    )}
                    <NoKotTag skips={itemSkipsKitchen(product, categoryMap)} />
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {categoryNameOf(categoryMap, product.categoryId)}
                </TableCell>
                <TableCell className="text-right">
                  <PriceCell product={product} />
                </TableCell>
                <TableCell className="text-right">
                  {archived ? (
                    <Badge variant="outline">Archived</Badge>
                  ) : (
                    <Switch
                      checked={available}
                      disabled={pendingAvailabilityId === product._id}
                      onCheckedChange={(v) => onToggleAvailable(product._id, v)}
                      aria-label={`In stock: ${product.name}`}
                    />
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {isAdmin ? (
                    <Switch
                      checked={qrVisible}
                      disabled={pendingQrId === product._id}
                      onCheckedChange={(v) => onToggleQrVisible(product._id, v)}
                      aria-label={`Shown on QR menu: ${product.name}`}
                    />
                  ) : (
                    // R20 — staff get a read-only label, not a disabled switch
                    // (a `title` tooltip never surfaces on a touch device).
                    <span className="text-sm text-muted-foreground">{qrVisible ? "Shown" : "Hidden"}</span>
                  )}
                </TableCell>
                {isAdmin && (
                  <TableCell className="text-right">
                    <ItemRowMenu product={product} archived={archived} onEdit={onEdit} onArchive={onArchive} onRestore={onRestore} />
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
