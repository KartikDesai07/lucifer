"use client";

import type { ReactNode } from "react";
import { Controller, type Control } from "react-hook-form";

import { MenuSwitch } from "@/components/menu/MenuSwitch";
import { BoxIcon, QrIcon, TickIcon } from "@/components/menu/menu-icons";
import {
  MENU_EDITOR_CARD_CLASS,
  MENU_EDITOR_CARD_ROW_CLASS,
  MENU_EDITOR_ROW_LABEL_CLASS,
  MENU_EDITOR_ROW_SUB_CLASS,
  MENU_EDITOR_ROW_TEXT_CLASS,
  MENU_EDITOR_TILE_CLASS,
  MENU_EDITOR_TILE_TONES,
} from "@/lib/menu-editor-layout";
import { publicVisibleFromQr, qrVisibleOf } from "@/components/products/PublicVisibleField";
import type { ProductFormValues } from "@/lib/product-form-values";
import { cn } from "@/lib/utils";

/** One switch row (values 9.2 #4): the 34px tile, the 13.5px 600 label and the 12px --text-3 sub, the 40x24 switch. */
export function EditorSwitchRow({
  tone,
  icon,
  label,
  sub,
  checked,
  onCheckedChange,
}: {
  tone: "ok" | "accent";
  icon: ReactNode;
  label: string;
  sub: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className={MENU_EDITOR_CARD_ROW_CLASS}>
      <span aria-hidden="true" className={cn(MENU_EDITOR_TILE_CLASS, MENU_EDITOR_TILE_TONES[tone])}>
        {icon}
      </span>
      <span className={MENU_EDITOR_ROW_TEXT_CLASS}>
        <span className={MENU_EDITOR_ROW_LABEL_CLASS}>{label}</span>
        <span className={MENU_EDITOR_ROW_SUB_CLASS}>{sub}</span>
      </span>
      <MenuSwitch tone={tone} checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  );
}

interface ItemSwitchesCardProps {
  inStock: boolean;
  onInStock: (v: boolean) => void;
  qrVisible: boolean;
  onQrVisible: (v: boolean) => void;
}

// The HTML's switches card (values 9.2 #4): In stock (--ok tile) and Show on QR menu (--accent tile). The HTML's third row,
// Popular, has no data here and is not drawn. The two subs are the HTML's: both are true for us (an item off stock cannot
// be added at the POS; off on the QR menu hides it from guests only).
export function ItemSwitchesCard({ inStock, onInStock, qrVisible, onQrVisible }: ItemSwitchesCardProps) {
  return (
    <div data-ui="item-switches" className={MENU_EDITOR_CARD_CLASS}>
      <EditorSwitchRow
        tone="ok"
        icon={<BoxIcon size={17} />}
        label="In stock"
        sub="Off = sold out. Staff can’t add it to orders until it’s back."
        checked={inStock}
        onCheckedChange={onInStock}
      />
      <EditorSwitchRow
        tone="accent"
        icon={<QrIcon size={17} />}
        label="Show on QR menu"
        sub="Off = hidden from guests’ QR menu. Staff can still order it."
        checked={qrVisible}
        onCheckedChange={onQrVisible}
      />
    </div>
  );
}

/** "Modifiers come ticked" as the same kind of row (ours; design 6.9 #6), in its own one-row card. */
export function ModifiersTickedRow({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <div data-ui="item-modifiers-ticked" className={MENU_EDITOR_CARD_CLASS}>
      <EditorSwitchRow
        tone="accent"
        icon={<TickIcon size={17} />}
        label="Modifiers come ticked"
        sub="Staff untick what the customer does not want. The kitchen slip prints NO before it."
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

/** The card wired to the form: In stock is `available` (absent reads as available), Show on QR menu is `publicVisible` with its
 *  omit-empty rule (PublicVisibleField.tsx). */
export function ItemSwitchesField({ control }: { control: Control<ProductFormValues> }) {
  return (
    <Controller
      control={control}
      name="available"
      render={({ field: stock }) => (
        <Controller
          control={control}
          name="publicVisible"
          render={({ field: qr }) => (
            <ItemSwitchesCard
              inStock={stock.value ?? true}
              onInStock={stock.onChange}
              qrVisible={qrVisibleOf(qr.value)}
              onQrVisible={(visible) => qr.onChange(publicVisibleFromQr(visible))}
            />
          )}
        />
      )}
    />
  );
}
