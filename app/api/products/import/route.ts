import type { AnyBulkWriteOperation } from "mongoose";

import { connectDB } from "@/lib/db";
import cache from "@/lib/cache";
import { Product, type IProduct } from "@/models/Product";
import { Category, type ICategory } from "@/models/Category";
import {
  success,
  failure,
  validateBody,
  requireAuth,
} from "@/lib/api-helpers";
import {
  importProductsSchema,
  importProductRowSchema,
  type CreateProductInput,
} from "@/schemas";
import { displayName, normalizeRow } from "@/lib/product-import";
import type {
  ImportRowResult,
  ImportPreview,
  ImportResult,
} from "@/types";

export const dynamic = "force-dynamic";

// Per-row parse outcome (validation reuses createProductSchema via
// importProductRowSchema — see schemas/product.schema.ts).
type ParsedRow =
  | { index: number; ok: true; data: CreateProductInput }
  | { index: number; ok: false; name: string; category: string; errors: string[] };

function parseRow(raw: Record<string, unknown>, index: number): ParsedRow {
  const result = importProductRowSchema.safeParse(raw);
  if (result.success) {
    return { index, ok: true, data: result.data as CreateProductInput };
  }
  // ZodEffects (preprocess) widens fieldErrors to `{}` — type it back.
  const flat = result.error.flatten() as {
    formErrors: string[];
    fieldErrors: Record<string, string[] | undefined>;
  };
  const errors = [
    ...flat.formErrors,
    ...Object.entries(flat.fieldErrors).flatMap(([field, msgs]) =>
      (msgs ?? []).map((m) => `${field}: ${m}`),
    ),
  ];
  const norm = normalizeRow(raw);
  return {
    index,
    ok: false,
    name: displayName(raw),
    category: typeof norm.category === "string" ? norm.category.trim() : "",
    errors: errors.length ? errors : ["Invalid row"],
  };
}

// POST /api/products/import — bulk-create/update products from parsed CSV rows.
// `dryRun: true` returns a per-row validation preview without writing; otherwise
// valid rows are upserted by name (re-import updates rather than duplicates) and
// any missing categories are auto-created.
export async function POST(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, importProductsSchema);
  if ("error" in parsed) return parsed.error;
  const { dryRun, rows } = parsed.data;

  try {
    await connectDB();

    const parsedRows = rows.map((raw, i) => parseRow(raw, i));
    const valid = parsedRows.filter(
      (p): p is Extract<ParsedRow, { ok: true }> => p.ok,
    );

    // Dedupe by exact (trimmed) name within the file: the last occurrence wins,
    // earlier ones are reported as duplicates and skipped. This also keeps the
    // upsert deterministic (one op per name → no self-collisions).
    const lastIndexByName = new Map<string, number>();
    valid.forEach((v) => lastIndexByName.set(v.data.name, v.index));
    const finalEntries = valid.filter(
      (v) => lastIndexByName.get(v.data.name) === v.index,
    );
    const duplicateIndexes = new Set(
      valid
        .filter((v) => lastIndexByName.get(v.data.name) !== v.index)
        .map((v) => v.index),
    );

    // Which target names already exist → create vs update classification.
    const names = finalEntries.map((e) => e.data.name);
    const existingDocs = names.length
      ? await Product.find({ name: { $in: names } })
          .select("name")
          .lean()
      : [];
    const existingNames = new Set(existingDocs.map((d) => d.name));

    // Categories referenced by valid rows that don't exist yet.
    const allCats = await Category.find({}).select("name order").lean();
    const existingCatNames = new Set(allCats.map((c) => c.name));
    const newCategories = [
      ...new Set(finalEntries.map((e) => e.data.category)),
    ].filter((c) => !existingCatNames.has(c));

    const invalid = parsedRows.filter((p) => !p.ok).length;

    if (dryRun) {
      const rowResults: ImportRowResult[] = parsedRows.map((p) => {
        const row = p.index + 1;
        if (!p.ok) {
          return {
            row,
            name: p.name,
            category: p.category,
            status: "error",
            errors: p.errors,
          };
        }
        if (duplicateIndexes.has(p.index)) {
          return {
            row,
            name: p.data.name,
            category: p.data.category,
            status: "duplicate",
          };
        }
        return {
          row,
          name: p.data.name,
          category: p.data.category,
          status: existingNames.has(p.data.name) ? "update" : "create",
        };
      });

      const toCreate = finalEntries.filter(
        (e) => !existingNames.has(e.data.name),
      ).length;

      const preview: ImportPreview = {
        dryRun: true,
        totalRows: rows.length,
        rows: rowResults,
        newCategories,
        summary: {
          valid: finalEntries.length,
          invalid,
          toCreate,
          toUpdate: finalEntries.length - toCreate,
          duplicates: duplicateIndexes.size,
        },
      };
      return success(preview);
    }

    // ── Commit ───────────────────────────────────────────────────────────────
    let created = 0;
    let updated = 0;

    if (finalEntries.length > 0) {
      if (newCategories.length > 0) {
        const maxOrder = allCats.reduce(
          (max, c) => Math.max(max, c.order ?? 0),
          0,
        );
        const catOps: AnyBulkWriteOperation<ICategory>[] = newCategories.map(
          (name, i) => ({
            updateOne: {
              filter: { name },
              update: { $setOnInsert: { name, order: maxOrder + i + 1 } },
              upsert: true,
            },
          }),
        );
        await Category.bulkWrite(catOps, { ordered: false });
        cache.del("categories");
      }

      const productOps: AnyBulkWriteOperation<IProduct>[] = finalEntries.map(
        (e) => ({
          updateOne: {
            filter: { name: e.data.name },
            update: {
              $set: {
                category: e.data.category,
                price: e.data.price,
                discount: e.data.discount,
                image: e.data.image,
                modifiers: e.data.modifiers,
                isActive: e.data.isActive,
              },
            },
            upsert: true,
          },
        }),
      );
      const res = await Product.bulkWrite(productOps, { ordered: false });
      created = res.upsertedCount ?? 0;
      updated = res.matchedCount ?? 0;
      cache.del("products");
    }

    const result: ImportResult = {
      dryRun: false,
      created,
      updated,
      skipped: invalid,
      duplicates: duplicateIndexes.size,
      newCategories,
    };
    return success(result);
  } catch {
    return failure("Failed to import products");
  }
}
