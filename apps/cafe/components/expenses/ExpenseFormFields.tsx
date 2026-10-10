"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { BRAND_BUTTON_CLASS, BRAND_FIELD_ERROR_CLASS, BRAND_LABEL_CLASS } from "@/components/brand/brand-classes";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// A Select trigger styled like the sheet's inputs (h-11, brand field border); items are 44 px on touch.
const SELECT_TRIGGER_CLASS =
  "h-11 border-brand-field bg-brand-slip px-3.5 text-base text-brand-ink shadow-none data-[placeholder]:text-brand-muted focus:ring-[3px] focus:ring-brand-accent/25 md:text-[15px]";
const SELECT_ITEM_CLASS = "pointer-coarse:min-h-11";
// The Date field's calendar trigger, dressed like the inputs and Selects above (never the native date popup).
export const DATE_TRIGGER_CLASS = "h-11 border-brand-field bg-brand-slip px-3.5 text-base text-brand-ink shadow-none md:text-[15px]";
// Same 48 px / rounding as the primary button beside it; wraps its words on a narrow phone.
const ADD_ANOTHER_CLASS =
  "h-12 w-full whitespace-normal rounded-md border-brand-field text-[15px] font-semibold leading-tight text-brand-ink shadow-none hover:bg-brand-wash";

export interface SelectOption {
  value: string;
  label: string;
}

// Which footer button was pressed: "Add expense" closes, "Save & add another" keeps the sheet open.
export type SaveMode = "close" | "again";

/** A label, its control, and the field's own error line. */
export function ExpenseField({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className={BRAND_LABEL_CLASS}>
        {label}
      </Label>
      {children}
      {error && (
        <p role="alert" className={BRAND_FIELD_ERROR_CLASS}>
          {error}
        </p>
      )}
    </div>
  );
}

interface ExpenseSelectFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  /** Shown while nothing is picked. */
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  /** Shown under the trigger (the reason a list is empty). */
  hint?: ReactNode;
}

// A dropdown field (the sheet's Category and Paid by). An empty list disables the trigger.
export function ExpenseSelectField({ id, label, value, onChange, options, placeholder, disabled, error, hint }: ExpenseSelectFieldProps) {
  return (
    <ExpenseField id={id} label={label} error={error}>
      <Select value={value} onValueChange={onChange} disabled={disabled || options.length === 0}>
        <SelectTrigger id={id} aria-invalid={!!error} className={SELECT_TRIGGER_CLASS}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} className={SELECT_ITEM_CLASS}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint && <p className="text-[13px] text-brand-muted">{hint}</p>}
    </ExpenseField>
  );
}

interface ExpenseFormFooterProps {
  editing: boolean;
  isPending: boolean;
  /** The create/update call in flight, and (adding) which button started it. */
  saving: boolean;
  pressed: SaveMode;
  onAddAnother: () => void;
}

// Adding: "Save & add another" beside "Add expense". Editing: one "Save changes".
// "Add expense" is the form's only submit button, so Enter in a field = Add expense (closes).
export function ExpenseFormFooter({ editing, isPending, saving, pressed, onAddAnother }: ExpenseFormFooterProps) {
  const spinner = <Loader2 className="mr-2 h-4 w-4 animate-spin" />;
  return (
    <div className={cn("border-t border-brand-rule p-4", !editing && "grid grid-cols-2 gap-2")}>
      {!editing && (
        // type="button": Enter never lands here; the click runs the save itself.
        <Button type="button" variant="outline" disabled={isPending} onClick={onAddAnother} className={ADD_ANOTHER_CLASS}>
          {saving && pressed === "again" && spinner}
          Save &amp; add another
        </Button>
      )}
      <Button type="submit" disabled={isPending} className={BRAND_BUTTON_CLASS}>
        {saving && (editing || pressed === "close") && spinner}
        {editing ? "Save changes" : "Add expense"}
      </Button>
    </div>
  );
}
