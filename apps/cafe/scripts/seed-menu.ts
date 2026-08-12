/**
 * Seed sample menu data (categories + products) so the POS terminal is
 * testable before the Phase 5 management UI exists.
 * Standalone:  npm run seed:menu
 *
 * Idempotent: products/categories are upserted by name, so re-running updates
 * the sample rows rather than duplicating them. Safe to run repeatedly.
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Category } from "@/models/Category";
import { Product } from "@/models/Product";

const CATEGORIES = [
  { name: "Pizza", order: 1 },
  { name: "Pasta", order: 2 },
  { name: "Beverages", order: 3 },
  { name: "Desserts", order: 4 },
];

const PRODUCTS = [
  { name: "Margherita Pizza", category: "Pizza", price: 200, discount: 0, available: true, modifiers: ["Extra Cheese", "Extra Olives"] },
  { name: "Farmhouse Pizza", category: "Pizza", price: 280, discount: 10, available: true, modifiers: ["Extra Cheese"] },
  { name: "White Sauce Pasta", category: "Pasta", price: 180, discount: 0, available: true, modifiers: ["Add Chicken", "Extra Cheese"] },
  // One demo item marked out of stock ("86") to exercise the POS disabled tile.
  { name: "Red Sauce Pasta", category: "Pasta", price: 170, discount: 0, available: false, modifiers: [] },
  { name: "Cold Coffee", category: "Beverages", price: 120, discount: 0, available: true, modifiers: ["Extra Shot"] },
  { name: "Masala Chai", category: "Beverages", price: 40, discount: 0, available: true, modifiers: [] },
  { name: "Chocolate Brownie", category: "Desserts", price: 150, discount: 15, available: true, modifiers: ["With Ice Cream"] },
  { name: "Cheesecake", category: "Desserts", price: 220, discount: 0, available: true, modifiers: [] },
];

export async function seedMenu() {
  await connectDB();

  for (const c of CATEGORIES) {
    await Category.findOneAndUpdate(
      { name: c.name },
      { $set: { order: c.order } },
      { upsert: true },
    );
  }

  for (const p of PRODUCTS) {
    await Product.findOneAndUpdate(
      { name: p.name },
      { $set: { ...p, isActive: true, image: "" } },
      { upsert: true },
    );
  }

  console.log(
    `${CATEGORIES.length} categories and ${PRODUCTS.length} products seeded.`,
  );
}

const isMain = (process.argv[1] ?? "")
  .replace(/\\/g, "/")
  .endsWith("scripts/seed-menu.ts");
if (isMain) {
  seedMenu()
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
