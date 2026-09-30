import { z } from "zod";

// Item icons (owner, 2026-09-30): an item with no photo can show an icon
// instead — "pizza ya coffee, jiska bhi icon rakhna ho, bahut sare options".
// A photo always wins; with no photo the icon shows; with neither, the
// surfaces keep their first-letter tile.
//
// Keys are lucide-react icon names (kebab-case, all present in lucide-react
// 0.575's dynamicIconImports manifest) and are STORED on Product.icon, so this
// catalogue is APPEND-ONLY: never rename or remove a key. A key that is no
// longer here is not an error anywhere — every renderer treats it as "no icon"
// and the editor offers to replace it. Pure data + Zod only (client-safe, no
// React) — the key -> component map lives in apps/cafe/lib/product-icon-map.ts.

export const PRODUCT_ICON_GROUPS = [
  "Drinks",
  "Meals",
  "Bakery & sweets",
  "Fruit & veg",
  "Kitchen & labels",
] as const;
export type ProductIconGroup = (typeof PRODUCT_ICON_GROUPS)[number];

export interface ProductIconMeta {
  label: string;
  group: ProductIconGroup;
  // Extra plain-English search words for the picker (the label always matches).
  keywords: readonly string[];
}

export const PRODUCT_ICONS = {
  // Drinks
  coffee: { label: "Coffee", group: "Drinks", keywords: ["tea", "chai", "cappuccino", "latte", "espresso", "hot", "cup"] },
  "cup-soda": { label: "Cold drink", group: "Drinks", keywords: ["soda", "cola", "soft drink", "shake", "smoothie", "juice", "straw"] },
  milk: { label: "Milk", group: "Drinks", keywords: ["milkshake", "lassi", "dairy", "bottle"] },
  "glass-water": { label: "Glass", group: "Drinks", keywords: ["water", "lemonade", "nimbu", "mojito", "juice"] },
  citrus: { label: "Citrus", group: "Drinks", keywords: ["lemon", "lime", "orange", "nimbu", "fresh"] },
  beer: { label: "Beer", group: "Drinks", keywords: ["mug", "pint", "draught"] },
  wine: { label: "Wine glass", group: "Drinks", keywords: ["mocktail", "glass"] },
  "bottle-wine": { label: "Bottle", group: "Drinks", keywords: ["wine", "bottle"] },
  martini: { label: "Cocktail", group: "Drinks", keywords: ["mocktail", "martini", "glass"] },
  hop: { label: "Hops", group: "Drinks", keywords: ["beer", "craft"] },
  // Meals
  pizza: { label: "Pizza", group: "Meals", keywords: ["slice", "italian"] },
  hamburger: { label: "Burger", group: "Meals", keywords: ["hamburger", "fast food", "vada pav"] },
  sandwich: { label: "Sandwich", group: "Meals", keywords: ["toast", "sub", "grilled", "club"] },
  salad: { label: "Salad", group: "Meals", keywords: ["bowl", "healthy", "greens"] },
  soup: { label: "Soup", group: "Meals", keywords: ["bowl", "noodles", "ramen", "maggi", "hot"] },
  "cooking-pot": { label: "Pot", group: "Meals", keywords: ["curry", "dal", "biryani", "rice", "handi", "gravy", "thali"] },
  drumstick: { label: "Chicken", group: "Meals", keywords: ["drumstick", "fried chicken", "tandoori", "leg", "non veg"] },
  ham: { label: "Ham", group: "Meals", keywords: ["meat", "non veg"] },
  beef: { label: "Steak", group: "Meals", keywords: ["meat", "grill", "non veg"] },
  fish: { label: "Fish", group: "Meals", keywords: ["seafood", "fry", "non veg"] },
  shrimp: { label: "Prawn", group: "Meals", keywords: ["shrimp", "seafood", "non veg"] },
  egg: { label: "Egg", group: "Meals", keywords: ["boiled", "anda"] },
  "egg-fried": { label: "Fried egg", group: "Meals", keywords: ["omelette", "breakfast", "anda", "bhurji"] },
  // Bakery & sweets
  croissant: { label: "Croissant", group: "Bakery & sweets", keywords: ["bakery", "pastry", "puff", "breakfast"] },
  cookie: { label: "Cookie", group: "Bakery & sweets", keywords: ["biscuit", "bakery"] },
  donut: { label: "Donut", group: "Bakery & sweets", keywords: ["doughnut", "bakery", "sweet"] },
  cake: { label: "Cake", group: "Bakery & sweets", keywords: ["birthday", "celebration", "bakery"] },
  "cake-slice": { label: "Cake slice", group: "Bakery & sweets", keywords: ["pastry", "brownie", "cheesecake", "slice"] },
  dessert: { label: "Dessert", group: "Bakery & sweets", keywords: ["pudding", "sweet", "waffle", "sundae"] },
  "ice-cream-cone": { label: "Ice cream cone", group: "Bakery & sweets", keywords: ["ice cream", "cone", "softy", "gelato"] },
  "ice-cream-bowl": { label: "Ice cream bowl", group: "Bakery & sweets", keywords: ["ice cream", "sundae", "scoop", "kulfi"] },
  popsicle: { label: "Popsicle", group: "Bakery & sweets", keywords: ["ice candy", "kulfi", "stick"] },
  lollipop: { label: "Lollipop", group: "Bakery & sweets", keywords: ["candy", "kids", "sweet"] },
  candy: { label: "Candy", group: "Bakery & sweets", keywords: ["sweet", "toffee", "chocolate"] },
  "candy-cane": { label: "Candy cane", group: "Bakery & sweets", keywords: ["sweet", "festive"] },
  popcorn: { label: "Popcorn", group: "Bakery & sweets", keywords: ["snack", "movie"] },
  // Fruit & veg
  apple: { label: "Apple", group: "Fruit & veg", keywords: ["fruit", "fresh"] },
  banana: { label: "Banana", group: "Fruit & veg", keywords: ["fruit", "shake"] },
  cherry: { label: "Cherry", group: "Fruit & veg", keywords: ["fruit", "berry"] },
  grape: { label: "Grapes", group: "Fruit & veg", keywords: ["fruit", "juice"] },
  carrot: { label: "Carrot", group: "Fruit & veg", keywords: ["vegetable", "veg", "gajar"] },
  bean: { label: "Bean", group: "Fruit & veg", keywords: ["coffee bean", "rajma", "chole"] },
  nut: { label: "Nut", group: "Fruit & veg", keywords: ["almond", "cashew", "dry fruit"] },
  wheat: { label: "Wheat", group: "Fruit & veg", keywords: ["roti", "bread", "paratha", "naan", "grain"] },
  leaf: { label: "Leaf", group: "Fruit & veg", keywords: ["veg", "herbal", "green tea", "mint"] },
  "leafy-green": { label: "Greens", group: "Fruit & veg", keywords: ["veg", "spinach", "palak", "salad"] },
  sprout: { label: "Sprout", group: "Fruit & veg", keywords: ["healthy", "fresh", "new"] },
  vegan: { label: "Vegan", group: "Fruit & veg", keywords: ["veg", "plant based"] },
  // Kitchen & labels
  "chef-hat": { label: "Chef special", group: "Kitchen & labels", keywords: ["chef", "special", "signature"] },
  utensils: { label: "Fork & knife", group: "Kitchen & labels", keywords: ["meal", "dish", "food", "combo"] },
  "utensils-crossed": { label: "Crossed cutlery", group: "Kitchen & labels", keywords: ["meal", "dish", "food"] },
  flame: { label: "Spicy", group: "Kitchen & labels", keywords: ["hot", "fire", "tandoor", "grill"] },
  "flame-kindling": { label: "Grill", group: "Kitchen & labels", keywords: ["bbq", "tandoor", "wood fire"] },
  microwave: { label: "Microwave", group: "Kitchen & labels", keywords: ["heat", "warm"] },
  refrigerator: { label: "Chilled", group: "Kitchen & labels", keywords: ["cold", "fridge"] },
  snowflake: { label: "Cold", group: "Kitchen & labels", keywords: ["iced", "frozen", "chilled"] },
  "thermometer-sun": { label: "Served hot", group: "Kitchen & labels", keywords: ["hot", "warm"] },
  sparkles: { label: "New", group: "Kitchen & labels", keywords: ["new", "special"] },
  star: { label: "Bestseller", group: "Kitchen & labels", keywords: ["popular", "favourite", "top"] },
  heart: { label: "Favourite", group: "Kitchen & labels", keywords: ["love", "popular"] },
  crown: { label: "Premium", group: "Kitchen & labels", keywords: ["royal", "king", "special"] },
  award: { label: "Award", group: "Kitchen & labels", keywords: ["best", "winner"] },
  gift: { label: "Combo", group: "Kitchen & labels", keywords: ["gift", "offer", "hamper"] },
  percent: { label: "Offer", group: "Kitchen & labels", keywords: ["discount", "deal", "sale"] },
  package: { label: "Parcel", group: "Kitchen & labels", keywords: ["takeaway", "box", "pack"] },
  "shopping-bag": { label: "Takeaway", group: "Kitchen & labels", keywords: ["bag", "parcel"] },
  store: { label: "Shop", group: "Kitchen & labels", keywords: ["retail", "packaged"] },
} as const satisfies Record<string, ProductIconMeta>;

export type ProductIconKey = keyof typeof PRODUCT_ICONS;

export const PRODUCT_ICON_KEYS = Object.keys(PRODUCT_ICONS) as [ProductIconKey, ...ProductIconKey[]];

// Own-property check, not `in`: "constructor" / "toString" are on every
// object's prototype and must never read as a stored icon.
export function isProductIconKey(value: unknown): value is ProductIconKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PRODUCT_ICONS, value);
}

export const productIconSchema = z.enum(PRODUCT_ICON_KEYS, {
  errorMap: () => ({ message: "Pick an icon from the list" }),
});
