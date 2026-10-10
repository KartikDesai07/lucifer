import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stripComments } from "@/lib/source-pin-utils";
import { KITCHEN_PRINTER_SETUP_NOTE, KITCHEN_TOKEN_HINT } from "@/lib/kitchen-lines";

// Printing redesign, Phase 2 Session 2D (spec §6.2, §11; plan decision 7): the "Kitchen station" of a category and
// of an item, and this device's bill printer in the printer panel. Source pins (the routing that reads them is proven
// by the routing tests and live leg aj).

const CAFE = process.cwd();
const src = (rel: string): string => stripComments(readFileSync(path.join(CAFE, rel), "utf8"));

test("PIN (2D): the category dialog's Kitchen station: the default unless chosen; an edit back to the default sends null, a new category omits it", () => {
  const page = src("app/(dashboard)/categories/page.tsx");
  assert.match(page, /<StationSelect\s+id="category-station"\s+value=\{stationId\}\s+onChange=\{setStationId\}\s+stations=\{stations\}/, "every station, the default too (the 2D gate's review, I-2)");
  assert.match(page, /inheritLabel=\{`Default station \(\$\{defaultStation\?\.name \?\? "Kitchen"\}\)`\}/, "the default by name");
  assert.match(page, /data: \{ name: trimmed, stationId: stationId === "" \? null : stationId, noKot: noKot \? true : null \}/, "an edit says which station (or null for the default) and the kitchen switch (true, or null = back ON)");
  assert.match(page, /\.\.\.\(stationId !== "" \? \{ stationId \} : \{\}\), \.\.\.\(noKot \? \{ noKot \} : \{\}\)/, "a new category on the default carries no station, and no flag unless the switch is OFF");
  assert.match(page, /if \(formOpen\) setStationId\(editing\?\.stationId \?\? ""\);/, "the saved id as it is (a list still loading never turns it into the default)");
});

test("PIN (2D): the item form's Kitchen station: Use the category's station sends null on an edit; read only while the sheet is open", () => {
  const form = src("components/products/ProductFormSheet.tsx");
  assert.match(form, /const \{ stations \} = useStations\(open\);/);
  assert.match(form, /stationId: values\.stationId \?\? null,/, "the explicit clear, as icon and publicVisible");
  assert.match(form, /inheritLabel="Use the category's station"/);
  assert.match(form, /onChange=\{\(next\) => field\.onChange\(next === "" \? undefined : next\)\}/);
  assert.match(form, /stationId: product\.stationId,/, "the saved id as it is on open");
  const select = src("components/print/setup/StationSelect.tsx");
  assert.match(select, /const shown = value !== "" && stations\.some\(\(station\) => station\.id === value\) \? value : INHERIT;/, "an unlisted id shows as inherited and is kept until changed");
});

// The 2D review gate: with "Default" chosen, End of day goes to the first End of day printer, which need not be the
// default bill printer, so the section promises End of day only for a chosen printer.
test("PIN (the 2D review gate): the bill printer section says End of day follows a chosen printer", () => {
  const section = src("components/print/BillPrinterSection.tsx");
  assert.match(section, /const DESCRIPTION = "Bills from this device print here, and its End of day too when you choose a printer\.";/);
});

test("PIN (2D, decision 7): this device's bill printer: printers mode only, routable bill printers only, kept on the device", () => {
  const panel = src("components/print/PrinterPanel.tsx");
  const card = panel.indexOf("<PrinterSetupCard />");
  const bill = panel.indexOf("<BillPrinterSection />");
  assert.ok(card >= 0 && bill > card, "under this device's printer setup");
  const section = src("components/print/BillPrinterSection.tsx");
  assert.match(section, /const billPrinters = routablePrinters\(printers\)\.filter\(\(printer\) => printer\.slips\.bill\);/, "only printers routing would send a bill to (the 2B gate's R4)");
  assert.match(section, /if \(!printersModeOn\(printers\) \|\| billPrinters\.length === 0\) return null;/, "nothing to choose in simple mode");
  assert.match(section, /writeBillPrinterId\(id\);/, "kept on this device");
  assert.match(section, /const \{ printers \} = usePrintersRead\(deviceId !== ""\);/, "the agent's printers read: no request or subscription of its own");
});

// Skip-KOT S5 (plan 12): the category switch, the item's three-way choice, the "No KOT" tags, and the two hints.
test("PIN (skip-KOT): the category dialog renders the kitchen switch from state loaded with the dialog, sent on save", () => {
  const page = src("app/(dashboard)/categories/page.tsx");
  assert.match(page, /const \[noKot, setNoKot\] = useState\(false\);/, "off by default: a new category sends to the kitchen");
  assert.match(page, /if \(formOpen\) setNoKot\(editing\?\.noKot === true\);/, "the saved flag as it is on open");
  assert.match(page, /<CategoryKitchenTicketField id="category-no-kot" noKot=\{noKot\} onChange=\{setNoKot\} \/>/);
  const field = src("components/menu/CategoryKitchenTicketField.tsx");
  assert.match(field, /checked=\{!noKot\}/, "ON means sent to the kitchen");
  assert.match(field, /onCheckedChange=\{\(sendToKitchen\) => onChange\(!sendToKitchen\)\}/);
  assert.match(field, /\{noKot && <p className="text-xs text-muted-foreground">\{KITCHEN_CATEGORY_OFF_HINT\}<\/p>\}/, "the hint shows only while off");
  assert.match(field, /KITCHEN_CATEGORY_SWITCH_LABEL/);
  assert.match(field, /min-h-11/, "a 44px target");
  assert.ok(!field.includes("components/ui/") || /from "@\/components\/ui\/(label|switch)"/.test(field), "shadcn primitives only");
});

test("PIN (skip-KOT): the item form's Kitchen ticket: Same as its category sends null; Always = false, No kitchen ticket = true", () => {
  const form = src("components/products/ProductFormSheet.tsx");
  assert.match(form, /noKot: product\.noKot,/, "the saved choice as it is on open");
  assert.match(form, /noKot: values\.noKot \?\? null,/, "the explicit clear (the PUT route $unsets a null)");
  assert.match(form, /<KitchenTicketField control=\{control\} categories=\{categories\} \/>/);
  const field = src("components/products/KitchenTicketField.tsx");
  assert.match(field, /useController\(\{ control, name: "noKot" \}\)/);
  assert.match(field, /useWatch\(\{ control, name: "categoryId" \}\)/, "the label follows the chosen category");
  assert.match(field, /kitchenItemSameLabel\(categorySkips\)/);
  assert.match(field, /if \(noKot === undefined\) return SAME;\s*return noKot \? NEVER : ALWAYS;/);
  assert.match(field, /if \(choice === NEVER\) return true;\s*if \(choice === ALWAYS\) return false;\s*return undefined;/);
  for (const label of ["KITCHEN_ITEM_SELECT_LABEL", "KITCHEN_ITEM_ALWAYS_LABEL", "KITCHEN_ITEM_NEVER_LABEL"]) assert.ok(field.includes(label), `the copy comes from kitchen-lines: ${label}`);
});

test("PIN (skip-KOT): the \"No KOT\" tag sits on the Categories and both Items layouts, and the item rule is its own choice over its category", () => {
  assert.match(src("components/menu/CategoryRow.tsx"), /<NoKotTag skips=\{category\.noKot === true\} \/>/);
  assert.match(src("components/menu/ItemsTable.tsx"), /<NoKotTag skips=\{itemSkipsKitchen\(product, categoryMap\)\} \/>/);
  assert.match(src("components/menu/ItemCards.tsx"), /<NoKotTag skips=\{itemSkipsKitchen\(product, categoryMap\)\} \/>/);
  const tag = src("components/menu/NoKotTag.tsx");
  assert.match(tag, /skipsKitchenTicket\(\{ noKot: product\.noKot \?\? categoryMap\.get\(product\.categoryId\)\?\.noKot \}\)/);
  assert.match(tag, /KITCHEN_NO_KOT_TAG/);
});

test("PIN (skip-KOT): Printer setup says no-KOT items never print on a KOT, and Tokens says an all-no-KOT order has no token", () => {
  const stations = src("components/print/setup/StationsSetupSection.tsx");
  assert.match(stations, /\(Menu → Items\)\. \$\{KITCHEN_PRINTER_SETUP_NOTE\}`;/, "the note is appended to the section description");
  assert.match(src("components/settings/TokenSettingsFields.tsx"), /<p className=\{HINT_CLASS\}>\{KITCHEN_TOKEN_HINT\}<\/p>/);
  assert.ok(KITCHEN_PRINTER_SETUP_NOTE.length > 0 && KITCHEN_TOKEN_HINT.length > 0, "landmark: the copy is not empty");
});

test("PIN (skip-KOT): the item and category APIs take noKot null as a removal", () => {
  const cat = src("app/api/categories/[id]/route.ts");
  assert.match(cat, /if \(noKot === null\) existing\.set\("noKot", undefined\);/);
  assert.match(cat, /else if \(noKot !== undefined\) existing\.set\("noKot", noKot\);/);
  assert.match(src("app/api/products/[id]/route.ts"), /nullClearsFields: \[[^\]]*"noKot"[^\]]*\]/);
});
