// buildItemsReport / buildItemDetail — the ONE place the Items & categories
// report's numbers are computed, mirroring lib/reports/sales-build.ts's own
// shape (route + the live leg both call these).
import { Types } from "mongoose";
import { Order } from "@/models/Order";
import { Product } from "@/models/Product";
import { Category } from "@/models/Category";
import { compareWindow, currentWindow, seriesMode } from "@/lib/dashboard/range";
import {
  itemDetailPipeline,
  itemVoidsPipeline,
  itemsCompareTotals,
  itemsFacet,
  type ItemsCompareTotalsRow,
  type ItemsFacet,
  type ItemSeriesRow,
  type ItemVoidsRow,
} from "@/lib/reports/items-pipelines";
import { foldItemDetail, foldItemsReport } from "@/lib/reports/items-fold";
import type { DashboardRange } from "@/types/dashboard";
import type { ItemDetail, ItemsReport } from "@/types/reports-b2";

interface ProductCategoryLean {
  _id: unknown;
  categoryId: unknown;
}
interface CategoryNameLean {
  _id: unknown;
  name: string;
}

export async function buildItemsReport(range: DashboardRange, now: Date = new Date()): Promise<ItemsReport> {
  const current = currentWindow(range, now);
  const compareWin = compareWindow(range, now);

  const [facetRows, compareRows, products, categories] = await Promise.all([
    Order.aggregate<ItemsFacet>(itemsFacet(current)),
    Order.aggregate<ItemsCompareTotalsRow>(itemsCompareTotals(compareWin)),
    Product.find({}).select("categoryId").lean<ProductCategoryLean[]>(),
    Category.find({}).select("name").lean<CategoryNameLean[]>(),
  ]);

  const facet = facetRows[0] ?? { items: [], totals: [] };
  const productCategory = new Map(products.map((p) => [String(p._id), String(p.categoryId)]));
  const categoryName = new Map(categories.map((c) => [String(c._id), c.name]));

  return foldItemsReport({ range, facet, compareTotals: compareRows, productCategory, categoryName });
}

export async function buildItemDetail(
  range: DashboardRange,
  item: { productId: string; label: string },
  now: Date = new Date(),
): Promise<ItemDetail> {
  const mode = seriesMode(range);
  const current = currentWindow(range, now);
  const productId = item.productId === "" ? null : new Types.ObjectId(item.productId);

  const [rows, voidRows] = await Promise.all([
    Order.aggregate<ItemSeriesRow>(itemDetailPipeline(current, mode, productId, item.label)),
    Order.aggregate<ItemVoidsRow>(itemVoidsPipeline(current, productId, item.label)),
  ]);

  return foldItemDetail({
    range,
    key: `${item.productId}|${item.label}`,
    label: item.label,
    mode,
    rows,
    voids: voidRows,
  });
}
