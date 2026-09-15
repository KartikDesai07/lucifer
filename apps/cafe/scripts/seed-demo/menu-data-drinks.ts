/**
 * Demo menu content — drinks half: Thick Shakes, Milk Shakes, Lassi, Cold
 * Coco, Hot Coffee, Iced Coffee, Sodas & Energy Drinks. Pure data, no
 * imports beyond ./types. Re-exported (merged with menu-data-food.ts) by
 * menu-data.ts, which is the module every other seed-demo file imports.
 *
 * Prices are rupees (whole numbers); `imageFile` is the EXACT file name in
 * the reference photos folder (case + extension). See menu-data.ts for the
 * category list, DEMO_MENU_STATS, and the shared modifier word lists.
 */
import type { DemoProduct } from "./types";

const SHAKE_MODIFIERS = ["Less sugar", "Extra thick", "Extra ice cream scoop", "No nuts"];
const COFFEE_MODIFIERS = ["Extra shot", "Less sugar", "Oat milk"];

export const THICK_SHAKES: DemoProduct[] = [
  { name: "Anjeer Thick Shake", category: "Thick Shakes", price: 140, imageFile: "Anjeer th.png", modifiers: SHAKE_MODIFIERS, weight: 5 },
  { name: "Black Currant Thick Shake", category: "Thick Shakes", price: 150, imageFile: "Black currant th.png", modifiers: SHAKE_MODIFIERS, weight: 4 },
  { name: "Chiku Thick Shake", category: "Thick Shakes", price: 130, imageFile: "Chiku th.png", modifiers: SHAKE_MODIFIERS, weight: 4 },
  { name: "Choco Nuts Thick Shake", category: "Thick Shakes", price: 160, imageFile: "Choco Nuts th (2).png", modifiers: SHAKE_MODIFIERS, discount: 10, weight: 6 },
  { name: "Chocolate Thick Shake", category: "Thick Shakes", price: 150, imageFile: "Chocolate th.png", modifiers: SHAKE_MODIFIERS, weight: 9 },
  { name: "Kesar Elaichi Thick Shake", category: "Thick Shakes", price: 160, imageFile: "Kesar Elaichi.png", modifiers: SHAKE_MODIFIERS, weight: 4 },
  { name: "Kesar Pista Thick Shake", category: "Thick Shakes", price: 160, imageFile: "Kesar Pista th.png", modifiers: SHAKE_MODIFIERS, weight: 5 },
  { name: "Mango Thick Shake", category: "Thick Shakes", price: 140, imageFile: "Mango.png", modifiers: SHAKE_MODIFIERS, available: false, weight: 1 },
  { name: "Pineapple Thick Shake", category: "Thick Shakes", price: 130, imageFile: "Pineapple th.png", modifiers: SHAKE_MODIFIERS, weight: 3 },
  { name: "Shahi Gulab Thick Shake", category: "Thick Shakes", price: 150, imageFile: "Shahi Gulab.png", modifiers: SHAKE_MODIFIERS, weight: 3 },
  { name: "Special Dry Fruit Thick Shake", category: "Thick Shakes", price: 160, imageFile: "Special Dryfruit th.png", modifiers: SHAKE_MODIFIERS, weight: 4 },
  { name: "Strawberry Thick Shake", category: "Thick Shakes", price: 140, imageFile: "Strawberry th.png", modifiers: SHAKE_MODIFIERS, weight: 6 },
  { name: "Vanilla Thick Shake", category: "Thick Shakes", price: 120, imageFile: "Vanilla th.png", modifiers: SHAKE_MODIFIERS, weight: 4 },
];

export const MILK_SHAKES: DemoProduct[] = [
  { name: "Badam Shake", category: "Milk Shakes", price: 120, imageFile: "704a5baa-8789-44fd-a636-521fcc9c4634.png", variations: [{ name: "Regular", price: 120 }, { name: "Large", price: 150 }], modifiers: SHAKE_MODIFIERS, weight: 4 },
  { name: "Badam Anjeer Milk Shake", category: "Milk Shakes", price: 140, imageFile: "Badam Anjeer Milk Shake.png", variations: [{ name: "Regular", price: 140 }, { name: "Large", price: 170 }], modifiers: SHAKE_MODIFIERS, weight: 3 },
  { name: "Special Badam Shake", category: "Milk Shakes", price: 150, imageFile: "c6b8bb45-62b9-4513-b971-b2933bd809ea.png", variations: [{ name: "Regular", price: 150 }, { name: "Large", price: 180 }], modifiers: SHAKE_MODIFIERS, weight: 3 },
  { name: "Chiku Milk Shake", category: "Milk Shakes", price: 120, imageFile: "Chiku Milk Shake.png", variations: [{ name: "Regular", price: 120 }, { name: "Large", price: 150 }], modifiers: SHAKE_MODIFIERS, weight: 3 },
  { name: "Fresh Mango Milk Shake", category: "Milk Shakes", price: 130, imageFile: "Fresh Mango Milk Shake.png", variations: [{ name: "Regular", price: 130 }, { name: "Large", price: 160 }], modifiers: SHAKE_MODIFIERS, available: false, weight: 1 },
  { name: "Kaju Anjeer Milk Shake", category: "Milk Shakes", price: 150, imageFile: "Kaju Anjeer Milk Shake.png", variations: [{ name: "Regular", price: 150 }, { name: "Large", price: 180 }], modifiers: SHAKE_MODIFIERS, weight: 3 },
  { name: "Kaju Badam Milk Shake", category: "Milk Shakes", price: 150, imageFile: "Kaju Badam Milk Shake.png", variations: [{ name: "Regular", price: 150 }, { name: "Large", price: 180 }], modifiers: SHAKE_MODIFIERS, weight: 4 },
  { name: "Kaju Chocolate Milk Shake", category: "Milk Shakes", price: 150, imageFile: "Kaju Chocolate Milk Shake.png", variations: [{ name: "Regular", price: 150 }, { name: "Large", price: 180 }], modifiers: SHAKE_MODIFIERS, weight: 5 },
  { name: "Kaju Gulkand Milk Shake", category: "Milk Shakes", price: 150, imageFile: "Kaju Gulkand Milk Shake.png", variations: [{ name: "Regular", price: 150 }, { name: "Large", price: 180 }], modifiers: SHAKE_MODIFIERS, weight: 3 },
  { name: "Kitkat Chocolate Milk Shake", category: "Milk Shakes", price: 160, imageFile: "Kitkat Chocolate Milk Shake.png", variations: [{ name: "Regular", price: 160 }, { name: "Large", price: 190 }], modifiers: SHAKE_MODIFIERS, weight: 9 },
  { name: "Oreo Chocolate Milk Shake", category: "Milk Shakes", price: 160, imageFile: "Oreo Chocolate Milk Shake.png", variations: [{ name: "Regular", price: 160 }, { name: "Large", price: 190 }], modifiers: SHAKE_MODIFIERS, weight: 8 },
  { name: "Pineapple Milk Shake", category: "Milk Shakes", price: 120, imageFile: "Pinapple Milk Shake.png", variations: [{ name: "Regular", price: 120 }, { name: "Large", price: 150 }], modifiers: SHAKE_MODIFIERS, weight: 3 },
  { name: "Sitafal Milk Shake", category: "Milk Shakes", price: 130, imageFile: "Sitafal Milk Shake.png", variations: [{ name: "Regular", price: 130 }, { name: "Large", price: 160 }], modifiers: SHAKE_MODIFIERS, weight: 2 },
  { name: "Special Dry Fruit Milk Shake", category: "Milk Shakes", price: 160, imageFile: "Special Dry Fruit Milk Shake.png", variations: [{ name: "Regular", price: 160 }, { name: "Large", price: 190 }], modifiers: SHAKE_MODIFIERS, weight: 4 },
  { name: "Special Kaju Milk Shake", category: "Milk Shakes", price: 160, imageFile: "Special Kaju Milk Shake.png", variations: [{ name: "Regular", price: 160 }, { name: "Large", price: 190 }], modifiers: SHAKE_MODIFIERS, weight: 4 },
  // imageFile is the photo's on-disk file name in the owner's folder (an asset path, shown to nobody); the product NAME is what the cafe sees.
  { name: "House Special Milk Shake", category: "Milk Shakes", price: 170, imageFile: "Special Lucifer Milk Shake.png", variations: [{ name: "Regular", price: 170 }, { name: "Large", price: 200 }], modifiers: SHAKE_MODIFIERS, weight: 5 },
  { name: "Strawberry Milk Shake", category: "Milk Shakes", price: 130, imageFile: "Strawberry Milk Shake.png", variations: [{ name: "Regular", price: 130 }, { name: "Large", price: 160 }], modifiers: SHAKE_MODIFIERS, weight: 6 },
];

export const LASSI: DemoProduct[] = [
  { name: "Kesar Lassi", category: "Lassi", price: 90, imageFile: "28efb6d0-9db2-46ee-8a40-2d7211720379.png", weight: 5 },
  { name: "Special Dry Fruit Lassi", category: "Lassi", price: 110, imageFile: "3cdef691-dfae-49d5-9af0-69855e0e56f9.png", weight: 3 },
  { name: "Rose Lassi", category: "Lassi", price: 90, imageFile: "5cdd9eec-8805-4ac8-9b6e-f983257116ae.png", weight: 4 },
  { name: "Mango Lassi", category: "Lassi", price: 100, imageFile: "af967afe-2bcd-4368-9984-ef707a66c0e9.png", weight: 4 },
  { name: "Kaju Lassi", category: "Lassi", price: 100, imageFile: "b8858404-d600-4e77-98b8-f85a757f09d6.png", weight: 3 },
  { name: "Plain Lassi", category: "Lassi", price: 60, imageFile: "ce744dd4-6722-4e5b-a2aa-cd315e958b17.png", weight: 5 },
  { name: "Special House Lassi", category: "Lassi", price: 120, imageFile: "ec960a92-9818-4943-a2b4-d5f7f011e505.png", weight: 3 },
];

export const COLD_COCO: DemoProduct[] = [
  { name: "Special Rich Coco", category: "Cold Coco", price: 130, imageFile: "2da691fc-268c-4e97-8261-777f743d8fa6 (1).png", variations: [{ name: "Regular", price: 130 }, { name: "Large", price: 160 }], weight: 5 },
  { name: "Brownie Coco", category: "Cold Coco", price: 140, imageFile: "2feb0378-858e-445f-a010-1453169540b4.png", variations: [{ name: "Regular", price: 140 }, { name: "Large", price: 170 }], weight: 6 },
  { name: "Balls Coco", category: "Cold Coco", price: 120, imageFile: "Balls.png", variations: [{ name: "Regular", price: 120 }, { name: "Large", price: 150 }], weight: 4 },
  { name: "Cold Coco", category: "Cold Coco", price: 90, imageFile: "cold coco.png", variations: [{ name: "Regular", price: 90 }, { name: "Large", price: 120 }], weight: 10 },
  { name: "Crunch Coco", category: "Cold Coco", price: 130, imageFile: "crunch coco.png", variations: [{ name: "Regular", price: 130 }, { name: "Large", price: 160 }], weight: 5 },
  { name: "Ice Cream Coco", category: "Cold Coco", price: 140, imageFile: "ice cream coco.png", variations: [{ name: "Regular", price: 140 }, { name: "Large", price: 170 }], weight: 6 },
  { name: "Kaju Coco", category: "Cold Coco", price: 130, imageFile: "kaju coco.png", variations: [{ name: "Regular", price: 130 }, { name: "Large", price: 160 }], weight: 4 },
  { name: "Swirl Coco", category: "Cold Coco", price: 140, imageFile: "sw.png", variations: [{ name: "Regular", price: 140 }, { name: "Large", price: 170 }], weight: 5 },
];

export const HOT_COFFEE: DemoProduct[] = [
  { name: "Hot Americano", category: "Hot Coffee", price: 100, imageFile: "Hot Americano.png", modifiers: COFFEE_MODIFIERS, weight: 5 },
  { name: "Hot Cappuccino", category: "Hot Coffee", price: 130, imageFile: "Hot Cappuccino.png", modifiers: COFFEE_MODIFIERS, weight: 9 },
  { name: "Hot Dark Mocha Latte", category: "Hot Coffee", price: 150, imageFile: "Hot Dark Mocha Latte.png", modifiers: COFFEE_MODIFIERS, weight: 5 },
  { name: "Hot Espresso", category: "Hot Coffee", price: 80, imageFile: "Hot Espresso.png", modifiers: COFFEE_MODIFIERS, weight: 4 },
  { name: "Hot Latte", category: "Hot Coffee", price: 120, imageFile: "Hot Latte.png", modifiers: COFFEE_MODIFIERS, weight: 6 },
  { name: "Hot Mocha Latte", category: "Hot Coffee", price: 160, imageFile: "Hot Mocha Latte.png", modifiers: COFFEE_MODIFIERS, weight: 5 },
];

export const ICED_COFFEE: DemoProduct[] = [
  { name: "Espresso Tonic Ginger Ale", category: "Iced Coffee", price: 160, imageFile: "Espresso Tonic Ginger Ale.png", modifiers: COFFEE_MODIFIERS, weight: 2 },
  { name: "Ice Americano", category: "Iced Coffee", price: 120, imageFile: "Ice Americano.png", modifiers: COFFEE_MODIFIERS, weight: 8 },
  { name: "Ice Cappuccino", category: "Iced Coffee", price: 150, imageFile: "Ice Cappuccino.png", modifiers: COFFEE_MODIFIERS, weight: 6 },
  { name: "Ice Dark Mocha Latte", category: "Iced Coffee", price: 180, imageFile: "Ice Dark Mocha Latte.png", modifiers: COFFEE_MODIFIERS, weight: 5 },
  { name: "Ice Espresso", category: "Iced Coffee", price: 130, imageFile: "Ice Espresso.png", modifiers: COFFEE_MODIFIERS, weight: 4 },
  { name: "Ice Mocha Latte", category: "Iced Coffee", price: 170, imageFile: "Ice Mocha Latte.png", modifiers: COFFEE_MODIFIERS, weight: 5 },
];

export const SODAS_AND_ENERGY_DRINKS: DemoProduct[] = [
  { name: "Black Currant Mocktail", category: "Sodas & Energy Drinks", price: 80, imageFile: "b1e4959e-4465-4137-874c-eb935a2301c2.png", weight: 3 },
  { name: "Bitter Lemon Schweppes", category: "Sodas & Energy Drinks", price: 70, imageFile: "Bitter Lemon Schweppes.png", weight: 2 },
  { name: "Blood Orange Tubtim Schweppes", category: "Sodas & Energy Drinks", price: 70, imageFile: "Blood Orange Tubtim Schweppes.png", weight: 2 },
  { name: "Coca Cola", category: "Sodas & Energy Drinks", price: 50, imageFile: "Coca Cola.png", weight: 9 },
  { name: "Diet Coke", category: "Sodas & Energy Drinks", price: 60, imageFile: "Diet Coke.png", weight: 1 },
  { name: "Fanta Orange", category: "Sodas & Energy Drinks", price: 50, imageFile: "Fanta.png", weight: 4 },
  { name: "Monster Energy", category: "Sodas & Energy Drinks", price: 130, imageFile: "Monster.png", weight: 1 },
  { name: "Red Bull", category: "Sodas & Energy Drinks", price: 130, imageFile: "Red Bull.png", weight: 2 },
  { name: "Sprite", category: "Sodas & Energy Drinks", price: 50, imageFile: "Sprite.png", weight: 5 },
  { name: "Thums Up", category: "Sodas & Energy Drinks", price: 50, imageFile: "Thums Up.png", weight: 4 },
  { name: "Wild Berry Schweppes", category: "Sodas & Energy Drinks", price: 70, imageFile: "Wild Berry Schweppes.png", weight: 2 },
];
