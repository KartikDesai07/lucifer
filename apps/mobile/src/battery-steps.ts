// Phase 3 Session 3D (spec §9.5): the battery checklist's words. Phones from Xiaomi, OPPO, vivo and Samsung stop apps in
// the background beyond Android's own rules (dontkillmyapp.com); a printing device must be told not to. The brand comes
// from the app (BatteryTargets.kt reads the phone's maker), so this phone's steps come first. Pure: no react-native.

export const BATTERY_BRANDS = ['xiaomi', 'oppo', 'vivo', 'samsung', 'other'] as const;
export type BatteryBrand = (typeof BATTERY_BRANDS)[number];

export type BatterySection = { brand: BatteryBrand; title: string; steps: readonly string[] };

export const BATTERY_INTRO =
  'Some phones stop apps that run with the screen off. On a device that prints for the cafe, do these steps once, so slips keep printing.';

export const BATTERY_SECTIONS: readonly BatterySection[] = [
  {
    brand: 'xiaomi',
    title: 'Xiaomi, Redmi, POCO',
    steps: [
      'Settings > Apps > Manage apps > Sandbee POS > Autostart: on.',
      'On the same screen: Battery saver > No restrictions.',
      'Open recent apps, press and hold Sandbee POS, and tap the lock.',
    ],
  },
  {
    brand: 'oppo',
    title: 'OPPO, realme, OnePlus',
    steps: [
      'Settings > Battery > Sandbee POS: allow background activity and auto launch.',
      'Settings > Apps > Auto launch: Sandbee POS on.',
      'Open recent apps, tap the menu on Sandbee POS, and choose Lock.',
    ],
  },
  {
    brand: 'vivo',
    title: 'vivo, iQOO',
    steps: [
      'Settings > Battery > Background power consumption: allow it for Sandbee POS.',
      'i Manager > App manager > Autostart: Sandbee POS on.',
      'Open recent apps and pull Sandbee POS down to lock it.',
    ],
  },
  {
    brand: 'samsung',
    title: 'Samsung',
    steps: [
      'Settings > Apps > Sandbee POS > Battery: Unrestricted.',
      'Settings > Battery > Background usage limits > Never sleeping apps: add Sandbee POS.',
      'Make sure Sandbee POS is not under Sleeping apps or Deep sleeping apps.',
    ],
  },
  {
    brand: 'other',
    title: 'Other phones',
    steps: [
      'Settings > Apps > Sandbee POS > Battery: Unrestricted (or "Don\'t optimise").',
      'If slips still stop with the screen off, keep the POS app open on this device.',
    ],
  },
];

/** The brand the app reported, or "other" for anything this list does not know. */
export function batteryBrandOf(reported: unknown): BatteryBrand {
  return (BATTERY_BRANDS as readonly unknown[]).includes(reported)
    ? (reported as BatteryBrand)
    : 'other';
}

/** Every section, this phone's first. */
export function batterySectionsFor(brand: BatteryBrand): BatterySection[] {
  const own = BATTERY_SECTIONS.filter(s => s.brand === brand);
  return [...own, ...BATTERY_SECTIONS.filter(s => s.brand !== brand)];
}

/** Only these brands have their own autostart screen to open (the app falls back to its settings screen). */
export function hasAutostartScreen(brand: BatteryBrand): boolean {
  return brand !== 'other';
}
