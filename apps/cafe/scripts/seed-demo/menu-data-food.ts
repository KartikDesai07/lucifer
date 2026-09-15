/**
 * Demo menu content — food half: Ice Cream, Waffles, Brownies & Desserts,
 * Snacks. Pure data, no imports beyond ./types. Re-exported (merged with
 * menu-data-drinks.ts) by menu-data.ts, which is the module every other
 * seed-demo file imports.
 *
 * Prices are rupees (whole numbers); `imageFile` is the EXACT file name in
 * the reference photos folder (case + extension), or absent for the 5
 * no-image Snacks the plan adds on top of the 100 catalogue photos.
 */
import type { DemoProduct } from "./types";

const WAFFLE_MODIFIERS = ["Extra chocolate sauce", "Add ice cream scoop"];

export const ICE_CREAM: DemoProduct[] = [
  { name: "Afghan Mewa Ice Cream", category: "Ice Cream", price: 80, imageFile: "afghan meva.png", variations: [{ name: "Single Scoop", price: 80 }, { name: "Double Scoop", price: 130 }], weight: 3 },
  { name: "Black Currant Ice Cream", category: "Ice Cream", price: 70, imageFile: "black currant.png", variations: [{ name: "Single Scoop", price: 70 }, { name: "Double Scoop", price: 115 }], weight: 2 },
  { name: "Chocolate Chips Ice Cream", category: "Ice Cream", price: 80, imageFile: "chocolate chips.png", variations: [{ name: "Single Scoop", price: 80 }, { name: "Double Scoop", price: 130 }], weight: 6 },
  { name: "Coconut Ice Cream", category: "Ice Cream", price: 70, imageFile: "coconut.png", variations: [{ name: "Single Scoop", price: 70 }, { name: "Double Scoop", price: 115 }], weight: 3 },
  { name: "Cookies & Cream Ice Cream", category: "Ice Cream", price: 80, imageFile: "cookie.png", variations: [{ name: "Single Scoop", price: 80 }, { name: "Double Scoop", price: 130 }], weight: 6 },
  { name: "Dry Fruit Ice Cream", category: "Ice Cream", price: 85, imageFile: "dry friut.png", variations: [{ name: "Single Scoop", price: 85 }, { name: "Double Scoop", price: 140 }], weight: 3 },
  { name: "Fruits Bonanza Ice Cream", category: "Ice Cream", price: 75, imageFile: "Fruits Bonanza.png", variations: [{ name: "Single Scoop", price: 75 }, { name: "Double Scoop", price: 120 }], weight: 2 },
  { name: "Kaju Anjeer Ice Cream", category: "Ice Cream", price: 85, imageFile: "kaju anjeer.png", variations: [{ name: "Single Scoop", price: 85 }, { name: "Double Scoop", price: 140 }], weight: 2 },
  { name: "Kaju Draksh Ice Cream", category: "Ice Cream", price: 85, imageFile: "kaju draksh.png", variations: [{ name: "Single Scoop", price: 85 }, { name: "Double Scoop", price: 140 }], weight: 2 },
  { name: "Mawa Badam Ice Cream", category: "Ice Cream", price: 85, imageFile: "Mawa badam.png", variations: [{ name: "Single Scoop", price: 85 }, { name: "Double Scoop", price: 140 }], weight: 3 },
  { name: "Pan Masala Ice Cream", category: "Ice Cream", price: 80, imageFile: "pan.png", variations: [{ name: "Single Scoop", price: 80 }, { name: "Double Scoop", price: 130 }], weight: 2 },
  { name: "Raj Bhog Ice Cream", category: "Ice Cream", price: 85, imageFile: "Raj bhog.png", variations: [{ name: "Single Scoop", price: 85 }, { name: "Double Scoop", price: 140 }], weight: 2 },
  { name: "Roasted Almond Ice Cream", category: "Ice Cream", price: 85, imageFile: "rosted almand.png", variations: [{ name: "Single Scoop", price: 85 }, { name: "Double Scoop", price: 140 }], weight: 2 },
  { name: "Strawberry Ice Cream", category: "Ice Cream", price: 70, imageFile: "strawberry.png", variations: [{ name: "Single Scoop", price: 70 }, { name: "Double Scoop", price: 115 }], weight: 5 },
  { name: "Thabdi Ice Cream", category: "Ice Cream", price: 80, imageFile: "thabdi.png", variations: [{ name: "Single Scoop", price: 80 }, { name: "Double Scoop", price: 130 }], weight: 2 },
  { name: "Vanilla Ice Cream", category: "Ice Cream", price: 60, imageFile: "vanilla.png", variations: [{ name: "Single Scoop", price: 60 }, { name: "Double Scoop", price: 100 }], weight: 5 },
];

export const WAFFLES: DemoProduct[] = [
  { name: "Biscoff Waffle", category: "Waffles", price: 220, imageFile: "Biscoff Waffle.png", modifiers: WAFFLE_MODIFIERS, weight: 8 },
  { name: "Chocolate Overload Waffle", category: "Waffles", price: 210, imageFile: "Chocolate Overload.png", modifiers: WAFFLE_MODIFIERS, weight: 6 },
  { name: "Cookie & Cream Waffle", category: "Waffles", price: 220, imageFile: "Cookie & Cream Waffle.jfif", modifiers: WAFFLE_MODIFIERS, weight: 8 },
  { name: "Dark Chocolate Waffle", category: "Waffles", price: 200, imageFile: "Dark.png", modifiers: WAFFLE_MODIFIERS, weight: 5 },
  { name: "Dubai Special Kunafa Waffle", category: "Waffles", price: 260, imageFile: "Dubai Special Kunafa Waffle.png", modifiers: WAFFLE_MODIFIERS, weight: 6 },
  { name: "Kiki & Oreo Waffle", category: "Waffles", price: 230, imageFile: "Kiki & Oreo.jfif", modifiers: WAFFLE_MODIFIERS, weight: 4 },
  { name: "Kitkat Waffle", category: "Waffles", price: 220, imageFile: "Kitkat.png", modifiers: WAFFLE_MODIFIERS, discount: 10, weight: 8 },
  { name: "Milk Chocolate Waffle", category: "Waffles", price: 190, imageFile: "Milk Chocolate Waffle.png", modifiers: WAFFLE_MODIFIERS, weight: 5 },
  { name: "Nutella Waffle", category: "Waffles", price: 240, imageFile: "Nutella.png", modifiers: WAFFLE_MODIFIERS, weight: 9 },
  { name: "Triple Chocolate Waffle", category: "Waffles", price: 230, imageFile: "Triple Chocolate Waffle.png", modifiers: WAFFLE_MODIFIERS, weight: 5 },
];

export const BROWNIES_AND_DESSERTS: DemoProduct[] = [
  { name: "Chocolate Mousse Cups", category: "Brownies & Desserts", price: 140, imageFile: "bdeb4b29-b6ef-44c0-b615-34c5502d0600.png", weight: 4 },
  { name: "Darkeys Brownie", category: "Brownies & Desserts", price: 180, imageFile: "Darkeys Brownie.png", modifiers: WAFFLE_MODIFIERS, weight: 5 },
  { name: "Sizzler Brownie", category: "Brownies & Desserts", price: 220, imageFile: "Sizzler Brownie.png", modifiers: WAFFLE_MODIFIERS, weight: 8 },
  // imageFile is the photo's on-disk file name in the owner's folder (an asset path, shown to nobody); the product NAME is what the cafe sees.
  { name: "House Special Brownie", category: "Brownies & Desserts", price: 200, imageFile: "Special Lucifer.png", modifiers: WAFFLE_MODIFIERS, weight: 4 },
  { name: "Triple Chocolate Brownie", category: "Brownies & Desserts", price: 210, imageFile: "Triple Chocolate.png", modifiers: WAFFLE_MODIFIERS, weight: 4 },
];

export const SNACKS: DemoProduct[] = [
  { name: "Classic Burger", category: "Snacks", price: 149, imageFile: "Classic Burger.png", discount: 15, weight: 4 },
  { name: "French Fries", category: "Snacks", price: 99, variations: [{ name: "Classic", price: 99 }, { name: "Peri Peri", price: 119 }], weight: 5 },
  { name: "Cheese Garlic Bread", category: "Snacks", price: 129, weight: 3 },
  { name: "Veg Grilled Sandwich", category: "Snacks", price: 119, weight: 3 },
  { name: "Paneer Tikka Sandwich", category: "Snacks", price: 149, weight: 3 },
  { name: "Mineral Water", category: "Snacks", price: 20, weight: 1 },
];
