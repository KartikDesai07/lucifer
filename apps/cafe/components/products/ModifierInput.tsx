"use client";

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MENU_EDITOR_INPUT_CLASS } from "@/lib/menu-editor-layout";
import { setAddOnAmount } from "@/lib/product-form-values";
import type { ProductModifierPrice } from "@/types";

interface ModifierInputProps {
  /** The input's id, so the field's label names it. */
  id?: string;
  value: string[];
  onChange: (next: string[]) => void;
  /** Priced add-ons: the amount each add-on charges (absent = free). Omit with `onPricesChange` for names only. */
  prices?: ProductModifierPrice[];
  onPricesChange?: (next: ProductModifierPrice[]) => void;
  /** "Modifiers come ticked" is on: add-ons there are included in the price, so no amount boxes (D3). */
  ticked?: boolean;
}

// The amount box beside a chip: small, plain digits (whole rupees; never a native number picker — owner rule).
const AMOUNT_BOX_CLASS =
  "h-8 w-24 min-w-0 rounded-[8px] border border-border bg-card px-2 py-0 text-[13px] text-foreground placeholder:text-subtle-foreground max-tab:text-base";
const NOTE_CLASS = "mt-2 text-[12.5px] text-muted-foreground";
const WARN_CLASS = "mt-2 text-[12.5px] font-semibold text-status-warn-ink";
const CLEAR_CLASS = "cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-semibold underline";

// Type a modifier + Enter (or comma) to add it; click × to remove. With amounts on, each chip has an optional "extra
// amount" box (empty = free); removing an add-on drops its amount.
export function ModifierInput({ id, value, onChange, prices, onPricesChange, ticked = false }: ModifierInputProps) {
  const [text, setText] = useState("");
  const pricing = onPricesChange !== undefined;
  const amounts = prices ?? [];
  const amountOf = (tag: string) => amounts.find((p) => p.name === tag)?.price;

  const add = () => {
    const tag = text.trim();
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setText("");
  };

  const remove = (tag: string) => {
    onChange(value.filter((t) => t !== tag));
    onPricesChange?.(amounts.filter((p) => p.name !== tag));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !text && value.length) {
      remove(value[value.length - 1]);
    }
  };

  return (
    <div>
      <Input
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
        className={MENU_EDITOR_INPUT_CLASS}
        placeholder="e.g. Extra cheese — type and press Enter"
      />
      {value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <div key={tag} className="flex items-center gap-1.5">
              <Badge variant="secondary" className="gap-1">
                {tag}
                <button
                  type="button"
                  aria-label={`Remove ${tag}`}
                  onClick={() => remove(tag)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
              {pricing && !ticked && (
                <Input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label={`Extra amount for ${tag}`}
                  placeholder="Free"
                  value={amountOf(tag)?.toString() ?? ""}
                  onChange={(e) => onPricesChange?.(setAddOnAmount(amounts, tag, e.target.value))}
                  className={AMOUNT_BOX_CLASS}
                />
              )}
            </div>
          ))}
        </div>
      )}
      {pricing && !ticked && value.length > 0 && (
        <p className={NOTE_CLASS}>Optional: type an amount in rupees to charge extra for an add-on. Empty means free.</p>
      )}
      {pricing && ticked && amounts.length > 0 && (
        <p role="status" className={WARN_CLASS}>
          Add-on amounts cannot be kept while add-ons come ticked. Clear them to save, or turn that off.{" "}
          <button type="button" onClick={() => onPricesChange?.([])} className={CLEAR_CLASS}>
            Clear amounts
          </button>
        </p>
      )}
    </div>
  );
}
