// Inventory lite, Slice 5: the supplier sheet's form and the due wording, as pure functions (no React). The shared
// createSupplierSchema / updateSupplierSchema stay the server's gate; this only gives the sheet its field messages
// (same limits) and builds the bodies. A phone or note left empty sends no key on create and CLEARS on update (null).
import {
  SUPPLIER_NAME_MAX_LEN,
  SUPPLIER_NOTE_MAX_LEN,
  SUPPLIER_PHONE_MAX_LEN,
  SUPPLIER_PHONE_PATTERN,
} from "@pos/shared/inventory";
import { inrPaise } from "@/lib/utils";
import type { CreateSupplierInput, UpdateSupplierInput } from "@/schemas";
import type { SupplierDto } from "@/types/inventory";

export interface SupplierFormValues {
  name: string;
  phone: string;
  note: string;
}

export interface SupplierFormErrors {
  name?: string;
  phone?: string;
  note?: string;
}

const NAME_EMPTY = "Name the supplier";
const NAME_LONG = `Keep the name to ${SUPPLIER_NAME_MAX_LEN} characters or fewer`;
const PHONE_LONG = `Keep the phone to ${SUPPLIER_PHONE_MAX_LEN} characters or fewer`;
const PHONE_CHARS = "Use digits, spaces, + or - only";
const NOTE_LONG = `Keep the note to ${SUPPLIER_NOTE_MAX_LEN} characters or fewer`;

export function initialSupplierValues(supplier: SupplierDto | null): SupplierFormValues {
  return { name: supplier?.name ?? "", phone: supplier?.phone ?? "", note: supplier?.note ?? "" };
}

/** Field errors for the sheet; an empty object means it can be sent. */
export function validateSupplierForm(values: SupplierFormValues): SupplierFormErrors {
  const errors: SupplierFormErrors = {};
  const name = values.name.trim();
  if (name === "") errors.name = NAME_EMPTY;
  else if (name.length > SUPPLIER_NAME_MAX_LEN) errors.name = NAME_LONG;
  const phone = values.phone.trim();
  if (phone.length > SUPPLIER_PHONE_MAX_LEN) errors.phone = PHONE_LONG;
  else if (!SUPPLIER_PHONE_PATTERN.test(phone)) errors.phone = PHONE_CHARS;
  if (values.note.trim().length > SUPPLIER_NOTE_MAX_LEN) errors.note = NOTE_LONG;
  return errors;
}

/** The create body; call only after validateSupplierForm found no errors. An empty phone or note sends no key. */
export function buildSupplierCreateInput(values: SupplierFormValues): CreateSupplierInput {
  const phone = values.phone.trim();
  const note = values.note.trim();
  return { name: values.name.trim(), ...(phone === "" ? {} : { phone }), ...(note === "" ? {} : { note }) };
}

/** The update body: only what CHANGED (an emptied phone or note is null, which clears it), or null when nothing did. */
export function buildSupplierUpdateInput(supplier: SupplierDto, values: SupplierFormValues): UpdateSupplierInput | null {
  const input: UpdateSupplierInput = {};
  const name = values.name.trim();
  const phone = values.phone.trim();
  const note = values.note.trim();
  if (name !== supplier.name) input.name = name;
  if (phone !== (supplier.phone ?? "")) input.phone = phone === "" ? null : phone;
  if (note !== (supplier.note ?? "")) input.note = note === "" ? null : note;
  return Object.keys(input).length === 0 ? null : input;
}

export type DueTone = "owed" | "ahead" | "settled";

/** The right-hand words of a supplier row: above 0 is still to pay, below 0 is paid ahead, 0 is settled. */
export function dueLabel(duePaise: number): { text: string; tone: DueTone } {
  if (duePaise > 0) return { text: `${inrPaise(duePaise)} to pay`, tone: "owed" };
  if (duePaise < 0) return { text: `${inrPaise(-duePaise)} paid ahead`, tone: "ahead" };
  return { text: "Settled", tone: "settled" };
}

/** A row's second line: phone and note, whichever exist. */
export function supplierSubLine(supplier: SupplierDto): string {
  return [supplier.phone, supplier.note].filter((part): part is string => part !== undefined && part !== "").join(" · ");
}
