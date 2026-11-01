import mongoose, { type Types } from "mongoose";
import { Category } from "@/models/Category";
import { Product } from "@/models/Product";
import { stampKitchenFlags, type KitchenFlagged, type ProductKitchenFacts } from "@/lib/kitchen-lines";

// Skip-KOT, the WRITE-time half: stamp `noKot: true` on every line the menu says never goes to the
// kitchen, and say whether any kitchen line is left. KOT kitchen order: the same pass stamps each
// kitchen line's `kotRank` from its category's `kotOrder` (the one category read serves both). Every order writer calls this BEFORE it draws a
// KOT number or builds a print job (the stamp is what the number draw, the token, the kitchen screen,
// the repair and the claim read — none of them re-reads the menu). The resolution itself is pure and
// unit-tested in lib/kitchen-lines.ts; this file only reads the small sets it needs.
//
// FAILS OPEN: if either read throws, the lines come back UNCHANGED with `kitchen: true` (no skips, no
// ranks), so the order prints exactly as it did before these features — a menu read hiccup must never fail an order. The
// caller must have called connectDB() already (like readPrintRouting). No console.*.

interface ProductRow {
  _id: Types.ObjectId;
  categoryId?: Types.ObjectId;
  noKot?: boolean;
}

interface CategoryRow {
  _id: Types.ObjectId;
  noKot?: boolean;
  kotOrder?: number;
}

export interface KitchenFlagsResult<T> {
  lines: T[];
  kitchen: boolean;
}

export async function withKitchenFlags<T extends KitchenFlagged & { productId: unknown }>(
  lines: readonly T[],
): Promise<KitchenFlagsResult<T>> {
  const ids = [...new Set(lines.map((l) => String(l.productId)))].filter((id) => mongoose.isValidObjectId(id));
  // Nothing on the menu to look up: every line is a kitchen line, and no read is spent.
  if (ids.length === 0) return { lines: [...lines], kitchen: true };
  try {
    const [products, categories] = await Promise.all([
      Product.find({ _id: { $in: ids } }).select("categoryId noKot").lean<ProductRow[]>(),
      // Only the categories that skip or are placed in the Kitchen order (a cafe that set neither reads none).
      Category.find({ $or: [{ noKot: true }, { kotOrder: { $exists: true } }] })
        .select("_id noKot kotOrder")
        .lean<CategoryRow[]>(),
    ]);
    const facts = new Map<string, ProductKitchenFacts>(
      products.map((p): [string, ProductKitchenFacts] => [
        String(p._id),
        {
          ...(p.categoryId !== undefined ? { categoryId: String(p.categoryId) } : {}),
          ...(p.noKot !== undefined ? { noKot: p.noKot } : {}),
        },
      ]),
    );
    const skipCategoryIds = new Set(categories.filter((c) => c.noKot === true).map((c) => String(c._id)));
    const categoryRanks = new Map<string, number>();
    for (const c of categories) {
      if (typeof c.kotOrder === "number" && Number.isFinite(c.kotOrder)) categoryRanks.set(String(c._id), c.kotOrder);
    }
    return stampKitchenFlags(lines, facts, skipCategoryIds, categoryRanks);
  } catch {
    return { lines: [...lines], kitchen: true };
  }
}
