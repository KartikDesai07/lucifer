/**
 * CB-DL-1 S6 fixture — the master documents the bootstrap live leg builds
 * through the REAL Mongoose models (never the raw driver), so every row it
 * compares has passed the same validation and picked up the same defaults a
 * route-created document would.
 *
 * Deliberately sorted "wrong": the category `order` values and the table
 * `displayOrder` values disagree with alphabetical name/tableNo order, so a
 * spec that lost its sort — or fell back to natural/insertion order — cannot
 * pass the parity checks by accident.
 * (console output belongs to the caller — this module only writes documents.)
 */
import type { Model } from "mongoose";
import type { ISettings } from "@/models/Settings";
import type { ICategory } from "@/models/Category";
import type { IProduct } from "@/models/Product";
import type { ITable } from "@/models/Table";
import type { IStaff } from "@/models/Staff";

// A recognisable, obviously-scratch cafe name (never a real client's).
export const SCRATCH_RESTAURANT_NAME = "Scratch Bootstrap Cafe";
// Not a credential: a fixed bcrypt-shaped string, so this file has no hashing
// cost and no password to leak. `password` is `select:false` on the schema, so
// no read path can return it anyway — which is one of the checks.
const FIXTURE_PASSWORD_HASH = "$2a$12$scratchfixturehashscratchfixturehashscratchfixturehash";

export interface SeedCounts {
  categories: number;
  products: number;
  tables: number;
  staff: number;
  /** The isActive:false product — must never appear in the products part. */
  archivedProductName: string;
  /** The product the leg updates to prove mastersVersion moves. */
  bumpProductName: string;
  /** The category the leg hard-deletes to prove the count component works. */
  deleteCategoryName: string;
}

export interface FixtureModels {
  Settings: Model<ISettings>;
  Category: Model<ICategory>;
  Product: Model<IProduct>;
  Table: Model<ITable>;
  Staff: Model<IStaff>;
}

export async function seedMasters(models: FixtureModels): Promise<SeedCounts> {
  // The singleton, created through the model so every print/GST/appearance
  // default lands exactly as a freshly provisioned cafe would have them.
  await models.Settings.create({
    restaurantName: SCRATCH_RESTAURANT_NAME,
    tagline: "scratch fixture",
    mobile: "0000000000",
    address: "Scratch Lane",
  });

  // `order` disagrees with alphabetical name order on purpose (Beverages=2,
  // Desserts=1, Appetizers=3), so {order:1,name:1} and {name:1} differ.
  const [beverages, desserts, appetizers] = await models.Category.create([
    { name: "Beverages", order: 2 },
    { name: "Desserts", order: 1 },
    { name: "Appetizers", order: 3 },
  ]);

  await models.Product.create([
    { name: "Cold Brew", categoryId: beverages._id, price: 180 },
    { name: "Masala Chai", categoryId: beverages._id, price: 60 },
    { name: "Brownie", categoryId: desserts._id, price: 140, discount: 10 },
    { name: "Paneer Tikka", categoryId: appetizers._id, price: 260, modifiers: ["Extra spicy"] },
    { name: "Nachos", categoryId: appetizers._id, price: 220 },
    // Archived: the products spec filters on { isActive: true }.
    { name: "Retired Cooler", categoryId: beverages._id, price: 150, isActive: false },
  ]);

  // displayOrder deliberately disagrees with tableNo order.
  await models.Table.create([
    { tableNo: "T-1", capacity: 4, displayOrder: 3 },
    { tableNo: "T-2", capacity: 2, displayOrder: 1 },
    { tableNo: "T-3", capacity: 6, displayOrder: 0 },
    // Never arranged: no displayOrder key at all — Mongo sorts a missing field
    // before any value, which is exactly what the tables spec relies on.
    { tableNo: "T-4", capacity: 4 },
  ]);

  await models.Staff.create([
    {
      name: "Zara Admin",
      mobile: "9990000001",
      username: "scratch-admin",
      password: FIXTURE_PASSWORD_HASH,
      role: "admin",
    },
    {
      name: "Arun Server",
      mobile: "9990000002",
      username: "scratch-staff",
      password: FIXTURE_PASSWORD_HASH,
      role: "staff",
    },
  ]);

  return {
    categories: 3,
    products: 6,
    tables: 4,
    staff: 2,
    archivedProductName: "Retired Cooler",
    bumpProductName: "Cold Brew",
    deleteCategoryName: "Desserts",
  };
}
