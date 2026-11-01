// "Show on QR menu" for `Product.publicVisible` (CR2.1's diner QR menu). The field is omit-empty on purpose — ABSENT means
// visible, so an existing cafe publishes its whole menu with no migration and the CSV import (which has no column for
// this) can never hide an item by omission. The switch mirrors that: ON reads `undefined` OR `true`; turning it OFF
// writes the real, meaningful `false`; turning it back ON writes `undefined` again rather than `true`, so a never-hidden
// product still stores no key at all. The row itself is the switches card's (ItemSwitchesCard, U5 Task 3); this keeps the
// two conversions, one place for the rule.

/** What the QR switch shows for the stored value. */
export function qrVisibleOf(value: boolean | undefined): boolean {
  return value === undefined || value === true;
}

/** What the form stores when the QR switch is turned to `visible`. */
export function publicVisibleFromQr(visible: boolean): boolean | undefined {
  return visible ? undefined : false;
}
