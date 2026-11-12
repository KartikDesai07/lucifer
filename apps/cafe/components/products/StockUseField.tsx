"use client";

import { useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";

import { STOCK_UNITS, STOCK_UNIT_LABEL, STOCK_USE_MAX_LINES, isStockUnit, type StockUnit } from "@pos/shared/inventory";
import { AppLink, closeOnPlainClick } from "@/components/layout/AppLink";
import { useAuth } from "@/hooks/use-auth";
import { useStockItems } from "@/hooks/use-inventory";
import { useSaveStockUse, useStockUse, useTrackOwnStock } from "@/hooks/use-stock-use";
import {
  buildStockUseInput,
  emptyRow,
  rowsFromDto,
  sameRows,
  type StockUseItemInfo,
  type StockUseRow,
} from "@/lib/inventory/stock-use-form";
import { MENU_EDITOR_ERROR_CLASS, MENU_EDITOR_HINT_CLASS, MENU_EDITOR_SELECT_CLASS } from "@/lib/menu-editor-layout";
import { MENU_SELECT_TRIGGER_CLASS } from "@/lib/menu-layout";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EditorField } from "@/components/products/EditorField";
import { StockUseRowEditor } from "@/components/products/StockUseRow";
import type { Product } from "@/types";

const DEFAULT_OWN_UNIT: StockUnit = "pcs";
const HINT = "What one sold item takes out of stock. Saved separately from the item details.";

interface Props {
  /** null = the editor is creating an item (it has no id to attach stock use to yet). */
  product: Product | null;
  /** Closes the editor sheet when its Inventory link opens the page here (R34: the sheet never covers the next screen). */
  onLeave: () => void;
}

// The "Stock use" section of the item editor (inventory lite, Slice 3). Admin only. It lives INSIDE the item form, so
// every button here is type="button" and Enter in a box never submits; it saves on its own button, separately.
export function StockUseField({ product, onLeave }: Props) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return null;
  return (
    <EditorField label="Stock use">
      <p className={MENU_EDITOR_HINT_CLASS}>{HINT}</p>
      {product === null ? (
        <p className={MENU_EDITOR_HINT_CLASS}>Save the item first, then set its stock use here.</p>
      ) : (
        // Keyed by item: half-typed rows of one item never carry over to another.
        <StockUseEditor key={product._id} product={product} onLeave={onLeave} />
      )}
    </EditorField>
  );
}

function StockUseEditor({ product, onLeave }: { product: Product; onLeave: () => void }) {
  const productId = product._id;
  const sizeNames = useMemo(() => product.variations?.map((v) => v.name) ?? [], [product.variations]);
  const stock = useStockUse(productId, true);
  const items = useStockItems();
  const save = useSaveStockUse(productId);
  const own = useTrackOwnStock(productId);
  // null = untouched: the rows are the saved answer. A save or the one tap puts the answer back in charge.
  const [edited, setEdited] = useState<StockUseRow[] | null>(null);
  const [error, setError] = useState("");
  const [ownUnit, setOwnUnit] = useState<StockUnit>(DEFAULT_OWN_UNIT);
  const keyCounter = useRef(0);

  const baseline = useMemo(() => (stock.data ? rowsFromDto(stock.data, sizeNames) : []), [stock.data, sizeNames]);
  const rows = edited ?? baseline;
  const active = useMemo(() => items.data ?? [], [items.data]);
  const itemsById = useMemo(() => {
    const map = new Map<string, StockUseItemInfo>();
    for (const line of stock.data?.lines ?? []) map.set(line.itemId, { name: line.name, unit: line.unit, archived: line.archived });
    for (const item of active) map.set(item.id, { name: item.name, unit: item.unit });
    return map;
  }, [stock.data, active]);

  const busy = save.isPending || own.isPending;
  const update = (next: StockUseRow[]) => {
    setEdited(next);
    setError("");
  };
  const reset = () => {
    setEdited(null);
    setError("");
  };
  const patchRow = (key: string, patch: Partial<StockUseRow>) => update(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const optionsFor = (row: StockUseRow) => {
    const elsewhere = new Set(rows.filter((r) => r.key !== row.key && r.itemId !== "").map((r) => r.itemId));
    const options = active.filter((i) => !elsewhere.has(i.id)).map((i) => ({ id: i.id, name: i.name, unit: i.unit }));
    const pick = row.itemId === "" || options.some((o) => o.id === row.itemId) ? undefined : itemsById.get(row.itemId);
    return pick ? [...options, { id: row.itemId, ...pick }] : options;
  };
  const addRow = () => {
    keyCounter.current += 1;
    update([...rows, emptyRow(`new-${keyCounter.current}`)]);
  };
  const submit = () => {
    const built = buildStockUseInput(rows, sizeNames, itemsById);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setError("");
    save.mutate(built.input, { onSuccess: reset });
  };

  if (stock.isError || items.isError) {
    return (
      <div className="grid justify-items-start gap-2">
        <p className={MENU_EDITOR_ERROR_CLASS}>Could not load this item&apos;s stock use.</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void stock.refetch();
            void items.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }
  if (stock.isPending || items.isPending) {
    return (
      <div className="grid gap-2" aria-busy="true">
        <Skeleton className="h-[42px] w-full rounded-[10px]" />
        <Skeleton className="h-9 w-40" />
      </div>
    );
  }

  const nothingLeft = active.every((i) => rows.some((r) => r.itemId === i.id));
  const emptyState = active.length === 0 && rows.length === 0;
  const canTrackOwn = stock.data.lines.length === 0 && rows.length === 0;

  return (
    <div className="grid min-w-0 gap-2.5">
      {emptyState && (
        <p className={MENU_EDITOR_HINT_CLASS}>
          No stock items yet. Add them on the{" "}
          <AppLink
            href="/inventory"
            onClick={(e) => closeOnPlainClick(e, onLeave)}
            className="font-semibold text-foreground underline"
          >
            Inventory page
          </AppLink>
          .
        </p>
      )}
      {rows.map((row, index) => (
        <StockUseRowEditor
          key={row.key}
          row={row}
          index={index}
          options={optionsFor(row)}
          picked={itemsById.get(row.itemId)}
          sizeNames={sizeNames}
          onChange={(patch) => patchRow(row.key, patch)}
          onRemove={() => update(rows.filter((r) => r.key !== row.key))}
        />
      ))}
      {!emptyState && (
        <Button
          type="button"
          variant="outline"
          className="justify-self-start"
          disabled={busy || rows.length >= STOCK_USE_MAX_LINES || nothingLeft}
          onClick={addRow}
        >
          <Plus aria-hidden="true" />
          Add stock item
        </Button>
      )}
      {canTrackOwn && (
        <div className="grid min-w-0 gap-1.5 rounded-[10px] border border-dashed border-border p-3">
          <span className="text-[13px] font-semibold text-foreground">Track this item&apos;s own stock</span>
          <p className={MENU_EDITOR_HINT_CLASS}>For items you sell as they are, like a bottle or a packet. One sold takes 1 from stock.</p>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
            <Select value={ownUnit} onValueChange={(next) => isStockUnit(next) && setOwnUnit(next)}>
              <SelectTrigger aria-label="Count this item in" className={cn(MENU_SELECT_TRIGGER_CLASS, MENU_EDITOR_SELECT_CLASS, "h-[42px]")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STOCK_UNITS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {STOCK_UNIT_LABEL[u]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" className="h-[42px]" disabled={busy} onClick={() => own.mutate({ unit: ownUnit }, { onSuccess: reset })}>
              Track own stock
            </Button>
          </div>
        </div>
      )}
      {error !== "" && (
        <p role="alert" className={MENU_EDITOR_ERROR_CLASS}>
          {error}
        </p>
      )}
      <Button type="button" className="justify-self-start" disabled={busy || sameRows(rows, baseline)} onClick={submit}>
        Save stock use
      </Button>
    </div>
  );
}
