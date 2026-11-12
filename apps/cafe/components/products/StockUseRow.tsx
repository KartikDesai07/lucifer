"use client";

import type { KeyboardEvent } from "react";
import { Trash2 } from "lucide-react";

import { STOCK_UNIT_LABEL, compatibleUnits, type StockUnit } from "@pos/shared/inventory";
import type { StockUseItemInfo, StockUseRow as Row } from "@/lib/inventory/stock-use-form";
import { MENU_EDITOR_INPUT_CLASS, MENU_EDITOR_LABEL_CLASS, MENU_EDITOR_SELECT_CLASS } from "@/lib/menu-editor-layout";
import { MENU_SELECT_TRIGGER_CLASS } from "@/lib/menu-layout";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const SELECT_TRIGGER = cn(MENU_SELECT_TRIGGER_CLASS, MENU_EDITOR_SELECT_CLASS);

/** Enter in an amount box must never submit the item form this field sits inside. */
export const blockEnter = (e: KeyboardEvent<HTMLInputElement>): void => {
  if (e.key === "Enter") e.preventDefault();
};

export interface StockUseRowProps {
  row: Row;
  index: number;
  /** Every stock item this row may show: the active ones not picked in other rows, plus its own pick (even archived). */
  options: Array<{ id: string } & StockUseItemInfo>;
  /** What the row's own pick is (for names and the unit group), archived or not. */
  picked: StockUseItemInfo | undefined;
  sizeNames: string[];
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
}

// One stock link: the stock item, the amount one sold item takes, the unit it is typed in, and (only for an item with
// sizes) a "Different amount per size" switch that gives each size its own amount.
export function StockUseRowEditor({ row, index, options, picked, sizeNames, onChange, onRemove }: StockUseRowProps) {
  const units: StockUnit[] = picked ? compatibleUnits(picked.unit) : [];
  const unitLabel = row.unit === "" ? "" : STOCK_UNIT_LABEL[row.unit];
  const pickItem = (itemId: string) => {
    const next = options.find((o) => o.id === itemId);
    if (!next) return;
    const keep = row.unit !== "" && compatibleUnits(next.unit).includes(row.unit);
    onChange({ itemId, unit: keep ? row.unit : next.unit });
  };
  const name = picked?.name ?? "stock item";
  // Turning sizes on starts every size at the row's amount, so only the sizes that differ need typing.
  const togglePerSize = (perSize: boolean) => {
    if (!perSize) return onChange({ perSize });
    const sizeAmounts = Object.fromEntries(sizeNames.map((s) => [s, row.sizeAmounts[s] || row.amount]));
    onChange({ perSize, sizeAmounts });
  };

  return (
    <div data-ui="stock-use-row" className="grid min-w-0 gap-2.5 rounded-[10px] border border-border p-3">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <Select value={row.itemId} onValueChange={pickItem}>
            <SelectTrigger aria-label={`Stock item ${index + 1}`} className={SELECT_TRIGGER}>
              <SelectValue placeholder="Pick a stock item" />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.archived ? `${o.name} (archived)` : o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${name}`} className="size-[38px] flex-none" onClick={onRemove}>
          <Trash2 aria-hidden="true" />
        </Button>
      </div>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-2">
        <Input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="Amount"
          aria-label={`Amount of ${name}`}
          value={row.amount}
          className={MENU_EDITOR_INPUT_CLASS}
          onKeyDown={blockEnter}
          onChange={(e) => onChange({ amount: e.target.value })}
        />
        <Select value={row.unit} onValueChange={(next) => onChange({ unit: units.find((u) => u === next) ?? row.unit })} disabled={!picked}>
          <SelectTrigger aria-label={`Unit of ${name}`} className={cn(SELECT_TRIGGER, "h-[42px]")}>
            <SelectValue placeholder="Unit" />
          </SelectTrigger>
          <SelectContent>
            {units.map((u) => (
              <SelectItem key={u} value={u}>
                {STOCK_UNIT_LABEL[u]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {sizeNames.length > 0 && (
        <div className="grid min-w-0 gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className={MENU_EDITOR_LABEL_CLASS}>Different amount per size</span>
            <Switch checked={row.perSize} aria-label={`Different amount per size for ${name}`} onCheckedChange={togglePerSize} />
          </div>
          {row.perSize && (
            <div className="grid min-w-0 grid-cols-1 items-start gap-2 min-[480px]:grid-cols-2">
              {sizeNames.map((size, sizeIndex) => (
                <div key={size} className="grid min-w-0 gap-1.5">
                  <label className="text-[12.5px] text-muted-foreground [overflow-wrap:anywhere]" htmlFor={`stock-use-${row.key}-${sizeIndex}`}>
                    {unitLabel === "" ? size : `${size} (${unitLabel})`}
                  </label>
                  <Input
                    id={`stock-use-${row.key}-${sizeIndex}`}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    value={row.sizeAmounts[size] ?? ""}
                    className={MENU_EDITOR_INPUT_CLASS}
                    onKeyDown={blockEnter}
                    onChange={(e) => onChange({ sizeAmounts: { ...row.sizeAmounts, [size]: e.target.value } })}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
