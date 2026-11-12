"use client";

import { MENU_EDITOR_CELL_RIGHT_CLASS, MENU_EDITOR_NUMBER_CLASS, MENU_EDITOR_PRICE_BOX_CLASS } from "@/lib/menu-editor-layout";

interface QtyBoxProps {
  id: string;
  value: string;
  onChange: (text: string) => void;
  unitCode: string;
  invalid: boolean;
}

// A typed quantity with the item's unit after it (the Discount field's "%" box). Text, not a number input: the
// form turns it into milli-units itself, so "1.5", ".5" and "2" all work and a mouse wheel never nudges it.
export function QtyBox({ id, value, onChange, unitCode, invalid }: QtyBoxProps) {
  return (
    <div className={MENU_EDITOR_PRICE_BOX_CLASS}>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        value={value}
        aria-invalid={invalid}
        className={MENU_EDITOR_NUMBER_CLASS}
        onChange={(e) => onChange(e.target.value)}
      />
      <span aria-hidden="true" className={MENU_EDITOR_CELL_RIGHT_CLASS}>
        {unitCode}
      </span>
    </div>
  );
}
