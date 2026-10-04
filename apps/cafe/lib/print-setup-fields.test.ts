import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stripComments } from "@/lib/source-pin-utils";

// Printing redesign, Phase 2 Session 2D (spec §6.2, §11; plan decision 7): the "Kitchen station" of a category and
// of an item, and this device's bill printer in the printer panel. Source pins (the routing that reads them is proven
// by the routing tests and live leg aj).

const CAFE = process.cwd();
const src = (rel: string): string => stripComments(readFileSync(path.join(CAFE, rel), "utf8"));

test("PIN (2D): the category dialog's Kitchen station: the default unless chosen; an edit back to the default sends null, a new category omits it", () => {
  const page = src("app/(dashboard)/categories/page.tsx");
  assert.match(page, /<StationSelect\s+id="category-station"\s+value=\{stationId\}\s+onChange=\{setStationId\}\s+stations=\{stations\}/, "every station, the default too (the 2D gate's review, I-2)");
  assert.match(page, /inheritLabel=\{`Default station \(\$\{defaultStation\?\.name \?\? "Kitchen"\}\)`\}/, "the default by name");
  assert.match(page, /data: \{ name: trimmed, stationId: stationId === "" \? null : stationId \}/, "an edit says which, or null for the default");
  assert.match(page, /\.\.\.\(stationId !== "" \? \{ stationId \} : \{\}\)/, "a new category on the default carries no station");
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
