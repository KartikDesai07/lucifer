import { z } from "zod";
import { coerceProductRow, MAX_IMPORT_ROWS } from "@/lib/product-import";

export const createProductSchema = z.object({
  name: z.string().trim().min(1, "Product name is required"),
  category: z.string().trim().min(1, "Category is required"),
  price: z.number().min(0, "Price cannot be negative"),
  discount: z.number().min(0).max(100).default(0), // percentage
  available: z.boolean().default(true), // in-stock / "86" toggle
  image: z.string().default(""), // Cloudinary public_id
  modifiers: z.array(z.string()).default([]),
  isActive: z.boolean().default(true), // false = archived
});

export const updateProductSchema = createProductSchema.partial();

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
