import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// Printing Phase 4 (spec 2026-10-15 §7.3, §12): "Find network printers" beside the network printer address in the POS
// app's printer panel and in the printer setup form, only where the app can scan; a tap fills the address and port, and
// staff go on as today (nothing is added by itself); no request of any kind.

const src = (rel: string): string => stripComments(readFileSync(path.join(process.cwd(), rel), "utf8"));
const FIND = "components/print/FindNetworkPrinters.tsx";

test("PIN: the button and its list show only where the app can scan, and a tap only fills the address", () => {
  const find = src(FIND);
  assert.ok(find.includes("if (!lanScanAvailable()) return null;"), "hidden unless this device's app can scan");
  assert.ok(find.includes("{FIND_NETWORK_PRINTERS_LABEL}"), "the button says Find network printers");
  assert.ok(find.includes("const outcome = await scanNetworkPrinters();"), "the app's scan");
  assert.ok(find.includes("onClick={() => onPick(row.host, row.port)}"), "a tap fills the address and the port");
  for (const banned of ["selectNative(", "nativePool()", ".add(", "save.mutate", "mutateAsync"]) {
    assert.ok(!find.includes(banned), `nothing is added by itself (${banned})`);
  }
  for (const words of ["LAN_SCANNING_MESSAGE", "LAN_NONE_FOUND_MESSAGE", "LAN_NO_NETWORK_MESSAGE", "alreadyAddedText(row.alreadyAdded)"]) {
    assert.ok(find.includes(words), `the list says ${words}`);
  }
  assert.ok(find.includes("PRINTER_ACTION_CLASS"), "44 px controls");
  // Session 4D's review (m-A): the panel's network form is a <form onSubmit>, and the shared Button sets no type, so a
  // button without type="button" would submit it: a tap would add the address typed before.
  assert.ok(find.includes('<Button type="button" variant="outline"'), "the Find button never submits the form around it");
  assert.ok(find.includes('<Button type="button" variant="ghost"'), "a found printer's row never submits the form around it");
});

test("PIN: beside the network printer address, in the POS app's panel and the setup form", () => {
  const picker = src("components/print/NativePrinterPicker.tsx");
  assert.ok(picker.includes("<FindNetworkPrinters disabled={locked} onPick={(host, picked) => { setAddress(host); setPort(String(picked)); setFormError(null); }} />"), "the panel's network form: the address and port filled");
  assert.ok(picker.indexOf("<FindNetworkPrinters") > picker.indexOf("{NETWORK_TITLE}") && picker.indexOf("<FindNetworkPrinters") < picker.indexOf("Use this network printer"), "inside the network form, before Use");
  const form = src("components/print/setup/PrinterFormDialog.tsx");
  assert.ok(form.includes("<FindNetworkPrinters onPick={(host, picked) => set({ host, port: String(picked) })} />"), "the setup form's network address: filled");
  const lanBranch = form.slice(form.indexOf('draft.kind === "lan" ? ('), form.indexOf(") : windowsHere ? ("));
  assert.ok(lanBranch.includes("<FindNetworkPrinters"), "only on a Network (LAN) printer");
});

test("PIN (spec §12): the scan costs no request: the app's own local scan and the reads the page already has", () => {
  for (const file of [FIND, "lib/printer/lan-discovery.ts"]) {
    const text = src(file);
    for (const needle of ["api-client", "apiGet", "apiSend", "fetch(", "useQuery("]) assert.ok(!text.includes(needle), `${file} makes no request (${needle})`);
  }
  // Session 4D's review (m-B): the setup's printers are read from the page's cache, with no query observer of its own, so
  // opening a form never refetches the printers list (a stale list would refetch on mount).
  assert.ok(!src(FIND).includes("usePrintersRead("), "no printers query observer of its own");
  assert.ok(src(FIND).includes("qc.getQueryData<PrinterConfig[]>(PRINTERS_KEYS.all) ?? NO_SETUP_PRINTERS"), "the setup's printers from the page's cache");
});
