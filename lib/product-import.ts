// Shared, dependency-free helpers for the bulk product CSV import wizard
// (PapaParse on the client → `/api/products/import` server validation).
//
// IMPORTANT: this module must stay pure/isomorphic — it is imported by both the
// browser dialog (template download, types) and the server route + Zod schema
// (header normalisation, row coercion). No Node, DOM, or Mongoose imports here.

// Canonical product columns, in the order they appear in the template.
// Note: `available` ("86" / in-stock) is deliberately NOT an import column — it
// is live operational state toggled from the menu table during service, so a
// bulk menu re-import (prices/modifiers) must never reset what's out of stock.
export const IMPORT_COLUMNS = [
  "name",
  "category",
  "price",
  "discount",
  "image",
  "modifiers",
  "isActive",
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

// Multiple modifiers in one cell are separated by a pipe (the cell itself is
// already comma-delimited by CSV, so a comma can't double as the separator).
export const MODIFIER_SEPARATOR = "|";

// Hard cap on a single import — a single cafe's menu is ~100-300 items; this
// keeps the request small (well under the serverless body/CPU budget) and
// bounds the bulkWrite. Rows beyond this are rejected with a clear message.
export const MAX_IMPORT_ROWS = 1000;

// Per-row outcome status shown in the dry-run preview table.
export type ImportRowStatus = "create" | "update" | "duplicate" | "error";

// Maps common header spellings to a canonical column key. Unlisted headers fall
// through unchanged (and are simply ignored by the coercion step).
const HEADER_ALIASES: Record<string, ImportColumn> = {
  name: "name",
  product: "name",
  "product name": "name",
  item: "name",
  "item name": "name",
  category: "category",
  cat: "category",
  group: "category",
  price: "price",
  rate: "price",
  mrp: "price",
  amount: "price",
  discount: "discount",
  disc: "discount",
  image: "image",
  img: "image",
  photo: "image",
  "image id": "image",
  "public id": "image",
  modifiers: "modifiers",
  modifier: "modifiers",
  addons: "modifiers",
  "add ons": "modifiers",
  options: "modifiers",
  isactive: "isActive",
  active: "isActive",
  "is active": "isActive",
  enabled: "isActive",
  status: "isActive",
};

// Normalise a raw CSV header to a canonical column key: lowercase, strip any
// non-alphanumerics (so "Price (₹)", "discount %", "is_active" all collapse),
// then map known synonyms. Unknown headers pass through and are ignored.
export function normalizeHeader(header: string): string {
  const key = header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return HEADER_ALIASES[key] ?? key;
}

// Re-key a raw parsed row onto canonical column keys. Later columns win if two
// headers normalise to the same key.
export function normalizeRow(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [header, value] of Object.entries(raw)) {
    out[normalizeHeader(header)] = value;
  }
  return out;
}

// "" / null / undefined → undefined (so Zod applies the field default or a
// "Required" error); a parseable number → the number; anything else → the raw
// string, so Zod reports a clear "Expected number, received string".
function toNumber(value: unknown): unknown {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return value ?? undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isNaN(n) ? trimmed : n;
}

const TRUE_WORDS = new Set(["true", "yes", "y", "1", "active", "enabled"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0", "inactive", "disabled"]);

// Empty → undefined (Zod default of true); recognised word → boolean; otherwise
// the raw string so Zod reports a type error rather than silently defaulting.
function toBoolean(value: unknown): unknown {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value ?? undefined;
  const t = value.trim().toLowerCase();
  if (t === "") return undefined;
  if (TRUE_WORDS.has(t)) return true;
  if (FALSE_WORDS.has(t)) return false;
  return value;
}

function toTrimmedString(value: unknown): unknown {
  if (typeof value !== "string") return value ?? undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function toModifiers(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return undefined;
  const parts = value
    .split(MODIFIER_SEPARATOR)
    .map((m) => m.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

// Turn one raw CSV row into a plain object shaped for `createProductSchema`:
// keys are canonicalised, values coerced to the schema's expected types (or
// left undefined so schema defaults / required-checks apply). The schema is the
// single source of truth for validity — this only bridges CSV strings to it.
export function coerceProductRow(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const row = normalizeRow(raw);
  return {
    name: toTrimmedString(row.name),
    category: toTrimmedString(row.category),
    price: toNumber(row.price),
    discount: toNumber(row.discount),
    image: toTrimmedString(row.image),
    modifiers: toModifiers(row.modifiers),
    isActive: toBoolean(row.isActive),
  };
}

// Best-effort display name for a row that failed validation (so the preview can
// still label it). Returns "" when no name cell was provided.
export function displayName(raw: Record<string, unknown>): string {
  const name = normalizeRow(raw).name;
  return typeof name === "string" ? name.trim() : "";
}

// RFC-4180 field escaping (mirrors lib/export.ts — kept local so this module
// stays dependency-free / isomorphic).
function escapeField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// A ready-to-fill template CSV: the canonical header row plus two example rows
// demonstrating modifiers (pipe-separated), discount, and the isActive flag.
export function buildTemplateCsv(): string {
  const examples: Record<ImportColumn, string>[] = [
    {
      name: "Margherita Pizza",
      category: "Pizza",
      price: "350",
      discount: "0",
      image: "",
      modifiers: "Extra Cheese|Thin Crust",
      isActive: "true",
    },
    {
      name: "Cold Coffee",
      category: "Beverages",
      price: "120",
      discount: "10",
      image: "",
      modifiers: "",
      isActive: "true",
    },
  ];
  const header = IMPORT_COLUMNS.join(",");
  const rows = examples.map((row) =>
    IMPORT_COLUMNS.map((col) => escapeField(row[col])).join(","),
  );
  return [header, ...rows].join("\r\n");
}
