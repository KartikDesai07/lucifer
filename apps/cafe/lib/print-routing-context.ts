import mongoose, { type Types } from "mongoose";
import { printersModeOn, resolveStationId } from "@pos/shared/print-printers";
import { Category } from "@/models/Category";
import { Product } from "@/models/Product";
import { Station } from "@/models/Station";
import type { PrintRouting } from "@/lib/print-printer-routing";
import { listPrinters } from "@/lib/print-printers";
import { stationWireOf } from "@/lib/print-stations";

// Printing redesign, Phase 2 (spec §6.2, §8): what one order request routes its slips with, read fresh
// (never cached: a printer switched off must stop getting slips at once). Simple mode costs ONE small read
// (the printers) and answers null; printers mode adds the stations and the stations of this request's items
// (two reads by id: the items, then their categories). Session 2C calls it from job creation. Never calls
// connectDB(). No console.*.

interface ProductStationRow {
  _id: Types.ObjectId;
  categoryId: Types.ObjectId;
  stationId?: Types.ObjectId;
}

interface CategoryStationRow {
  _id: Types.ObjectId;
  stationId?: Types.ObjectId;
}

/** null in simple mode (spec §6.6): no enabled printer takes a slip, so routing is today's. */
export async function readPrintRouting(input: { productIds: readonly string[]; billPrinterId?: string }): Promise<PrintRouting | null> {
  const printers = await listPrinters();
  if (!printersModeOn(printers)) return null;
  const ids = [...new Set(input.productIds)].filter((id) => mongoose.isValidObjectId(id));
  const [stationRows, products] = await Promise.all([
    Station.find().select("name order isDefault").lean<Array<{ _id: Types.ObjectId; name: string; order: number; isDefault: boolean }>>(),
    ids.length === 0 ? Promise.resolve([]) : Product.find({ _id: { $in: ids } }).select("categoryId stationId").lean<ProductStationRow[]>(),
  ]);
  const stations = stationRows.map(stationWireOf);
  const categoryIds = [...new Set(products.map((product) => String(product.categoryId)))];
  const categories =
    categoryIds.length === 0 ? [] : await Category.find({ _id: { $in: categoryIds } }).select("stationId").lean<CategoryStationRow[]>();
  const categoryStation = new Map(categories.map((category) => [String(category._id), category.stationId]));
  const itemStations = new Map<string, string>();
  for (const product of products) {
    const categoryStationId = categoryStation.get(String(product.categoryId));
    const resolved = resolveStationId(
      {
        ...(product.stationId !== undefined ? { productStationId: String(product.stationId) } : {}),
        ...(categoryStationId !== undefined ? { categoryStationId: String(categoryStationId) } : {}),
      },
      stations,
    );
    if (resolved !== null) itemStations.set(String(product._id), resolved);
  }
  return { printers, stations, itemStations, ...(input.billPrinterId !== undefined ? { billPrinterId: input.billPrinterId } : {}) };
}
