/**
 * Demo menu content — the module every other seed-demo file imports for
 * DEMO_CATEGORIES / DEMO_PRODUCTS. Pure data (no DB, no rng); split across
 * menu-data-drinks.ts + menu-data-food.ts to keep each file under the
 * ~300-line house limit, merged back together here.
 *
 * Category order 1..11 mirrors how the demo cafe's menu reads on the floor:
 * shakes and lassi first, then cold coco, then desserts, then the two coffee
 * sections, sodas last, snacks as the non-drink tail.
 */
import type { DemoCategory, DemoProduct } from "./types";
import {
  THICK_SHAKES,
  MILK_SHAKES,
  LASSI,
  COLD_COCO,
  HOT_COFFEE,
  ICED_COFFEE,
  SODAS_AND_ENERGY_DRINKS,
} from "./menu-data-drinks";
import { ICE_CREAM, WAFFLES, BROWNIES_AND_DESSERTS, SNACKS } from "./menu-data-food";

export const DEMO_CATEGORIES: DemoCategory[] = [
  { name: "Thick Shakes", order: 1 },
  { name: "Milk Shakes", order: 2 },
  { name: "Lassi", order: 3 },
  { name: "Cold Coco", order: 4 },
  { name: "Ice Cream", order: 5 },
  { name: "Waffles", order: 6 },
  { name: "Brownies & Desserts", order: 7 },
  { name: "Hot Coffee", order: 8 },
  { name: "Iced Coffee", order: 9 },
  { name: "Sodas & Energy Drinks", order: 10 },
  { name: "Snacks", order: 11 },
];

export const DEMO_PRODUCTS: DemoProduct[] = [
  ...THICK_SHAKES,
  ...MILK_SHAKES,
  ...LASSI,
  ...COLD_COCO,
  ...ICE_CREAM,
  ...WAFFLES,
  ...BROWNIES_AND_DESSERTS,
  ...HOT_COFFEE,
  ...ICED_COFFEE,
  ...SODAS_AND_ENERGY_DRINKS,
  ...SNACKS,
];

export const DEMO_MENU_STATS = {
  categories: DEMO_CATEGORIES.length,
  products: DEMO_PRODUCTS.length,
  withImages: DEMO_PRODUCTS.filter((p) => p.imageFile !== undefined).length,
};
