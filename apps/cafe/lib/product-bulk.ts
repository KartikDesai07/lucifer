import type { FilterQuery, UpdateQuery } from "mongoose";
import type { IProduct } from "@/models/Product";
import type { ProductBulkAction } from "@pos/shared/schemas/product-bulk.schema";

// Pure shaping for POST /api/products/bulk (Menu redesign, 2026-09-30). No DB
// import — the route owns connectDB()/Product/updateMany; this only builds the
// STATE filter (R9) each action's updateMany runs, so its `matched` count only
// ever counts items the action actually changes something for, never every id
// sent (an id already in the target state doesn't count as "matched").

export interface BulkUpdateShape {
  // Extra filter clause, ANDed onto `{ _id: { $in: ids } }` by the route.
  stateFilter: FilterQuery<IProduct>;
  update: UpdateQuery<IProduct>;
}

// R9 (arbitration ruling) — the exact state filter + $set per action:
//   out-of-stock: active AND not-already-out-of-stock items only.
//   in-stock: active AND already-out-of-stock items only.
//   move: active OR archived, excluding items already in the target category
//     (moving an archived item is how a category gets emptied for delete).
//   archive: only currently-active items.
//   restore: only currently-archived items.
export function bulkUpdateOf(
  action: ProductBulkAction,
  categoryId?: string,
): BulkUpdateShape {
  switch (action) {
    case "out-of-stock":
      return {
        stateFilter: { isActive: true, available: { $ne: false } },
        update: { $set: { available: false } },
      };
    case "in-stock":
      return {
        stateFilter: { isActive: true, available: false },
        update: { $set: { available: true } },
      };
    case "move":
      return {
        stateFilter: { categoryId: { $ne: categoryId } },
        update: { $set: { categoryId } },
      };
    case "archive":
      return {
        stateFilter: { isActive: true },
        update: { $set: { isActive: false } },
      };
    case "restore":
      return {
        stateFilter: { isActive: false },
        update: { $set: { isActive: true } },
      };
  }
}
