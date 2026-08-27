import { z } from "zod";
import { coerceProductRow, MAX_IMPORT_ROWS } from "../product-import";
import {
  MAX_VARIATIONS,
  VARIATION_NAME_MAX_LEN,
  VARIATION_NAME_MESSAGE,
  VARIATION_NAME_PATTERN,
  VARIATION_PRICE_MAX,
} from "../constants";

// carries a price ceiling rather than a percentage.
export const productVariationSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, VARIATION_NAME_MESSAGE)
      .max(
        VARIATION_NAME_MAX_LEN,
        `Keep it to ${VARIATION_NAME_MAX_LEN} characters or fewer`,
      )
      .regex(VARIATION_NAME_PATTERN, VARIATION_NAME_MESSAGE),
    price: z
      .number()
      .min(0, "Price cannot be negative")
      .max(VARIATION_PRICE_MAX, `At most ${VARIATION_PRICE_MAX}`),
  })
  .strict();

// One named size/portion and its own price. The name is printed verbatim on the
// bill and the kitchen ticket, so it is trimmed and charset-bounded exactly like
// a table's charge label; the price is the real selling price of that size, so it
// The set of sizes an item is sold in. Shared by create and update so the two
// can never drift on the bound, the cap or the duplicate-name rule.
const variationsArraySchema = z
  .array(productVariationSchema)
  .min(1, "Add at least one variation, or turn variations off")
  .max(MAX_VARIATIONS, `At most ${MAX_VARIATIONS} variations`)
  // Names are what the operator picks from and what prints; two identical ones
  // are unpickable and would bill whichever the code happened to find first.
  .refine((v) => new Set(v.map((x) => x.name)).size === v.length, {
    path: ["0", "name"],
    message: "Two variations have the same name",
  });

export const createProductSchema = z.object({
  name: z.string().trim().min(1, "Product name is required"),
  category: z.string().trim().min(1, "Category is required"),
  price: z.number().min(0, "Price cannot be negative"),
  // Optional with NO default on purpose: an item sold one way stores no key at
  // all (omit-empty), and the CSV import — which cannot express variations —
  // must therefore never send this field and never clear an existing set.
  variations: variationsArraySchema.optional(),
  discount: z.number().min(0).max(100).default(0), // percentage
  available: z.boolean().default(true), // in-stock / "86" toggle
  image: z.string().default(""), // opaque image ref — "r2:<key>" or a legacy Cloudinary public_id
  modifiers: z.array(z.string()).default([]),
  isActive: z.boolean().default(true), // false = archived
  // Optional with NO default: absent means "shown on the public menu", so an
  // existing cafe publishes its whole menu without a migration and the CSV
  // import — which has no column for this — can never hide an item by omission.
  // Only an explicit `false` is stored.
  publicVisible: z.boolean().optional(),
});

// PUT /api/products/[id]. Everything optional, PLUS one sentinel the create
// shape has no use for: `variations: null` means "this item is no longer sold
// by size, remove the set". It has to be an explicit VALUE because an absent
// key already means something different and load-bearing — "leave whatever is
// stored alone" — which is exactly what the CSV import relies on so that a
// re-import cannot wipe the sizes it has no column for. Absent is also all the
// client could otherwise send: JSON.stringify drops a key whose value is
// undefined, so before this sentinel existed the admin Has-variations toggle
// never reached the server and turning it OFF was a silent no-op — the product
// kept billing by size (probed against a real mongod).
export const updateProductSchema = createProductSchema.partial().extend({
  variations: variationsArraySchema.nullable().optional(),
  // Same sentinel, same bug as `variations`: hiding stores `false`, but
  // un-hiding must restore ABSENT (= visible) — and the client cannot say
  // "absent" over JSON, because JSON.stringify drops an undefined key and the
  // route reads an absent key as "leave the stored value alone". `null` is the
  // explicit "clear it" the PUT route turns into an $unset; without it a
  // product once hidden could never be shown again.
  publicVisible: z.boolean().nullable().optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

// ── Bulk CSV import ──────────────────────────────────────────────────────────
// A raw CSV row (string cells, arbitrary headers) is coerced onto the canonical
// product shape and then validated by the SAME `createProductSchema` above —
// the import has no separate notion of a "valid product".
export const importProductRowSchema = z.preprocess(
  (raw) => coerceProductRow((raw ?? {}) as Record<string, unknown>),
  createProductSchema,
);

// Request body for POST /api/products/import. `rows` are the raw parsed CSV
// rows; `dryRun` returns a validation preview without writing anything.
export const importProductsSchema = z.object({
  dryRun: z.boolean().default(false),
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .min(1, "No rows to import")
    .max(MAX_IMPORT_ROWS, `Too many rows (max ${MAX_IMPORT_ROWS})`),
});

export type ImportProductsInput = z.infer<typeof importProductsSchema>;
