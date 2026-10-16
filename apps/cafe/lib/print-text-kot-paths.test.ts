import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// Printing Phase 4 (spec 2026-10-15 §5.1, S2, §12): "Fast text KOTs (English only)" in the printer panel. Its words, its
// confirm states, the rule that only "Yes" after a printed text test turns a printer on, and that it reads nothing new
// from the server.

const CAFE = process.cwd();
const src = (rel: string): string => stripComments(readFileSync(path.join(CAFE, rel), "utf8"));
const SECTION = "components/print/TextKotSection.tsx";

test("PIN: the section's words, as the spec says them", () => {
  const section = src(SECTION);
  for (const words of [
    'const TITLE = "Fast text KOTs (English only)";',
    "\"Prints English-only kitchen tickets as text in the printer's own font: much faster on Bluetooth. Tickets with Hindi, Gujarati or any other script, a logo or a QR code still print as now.\";",
    'const QUESTION = "Did it print clearly, with the ruler on one line?";',
    'const TRY_42 = "Keep it off, or try Characters per line: 42";',
    'const COLUMNS_LABEL = "Characters per line";',
  ]) {
    assert.ok(section.includes(words), `the section says: ${words}`);
  }
  assert.ok(section.includes('{narrow ? "42" : "Automatic"}'), "the 80 mm choice: Automatic or 42");
});

test("PIN (S2): turning a printer on prints its text test first; only Yes keeps it on; No and a failure leave it off", () => {
  const section = src(SECTION);
  const turnOn = section.slice(section.indexOf("const turnOn = async () => {"), section.indexOf("const answer = (clear: boolean) => {"));
  const made = turnOn.indexOf("bytes = textTestJob({ cafeName: settings.data?.restaurantName, columns: textColumnsOf(printer.paper, narrow80) });");
  const queued = turnOn.indexOf("await queueTestSlip(() => printer.write(bytes));");
  assert.ok(made > 0 && queued > made, "the test slip is made, then written to that printer inside the bridge's busy window");
  assert.ok(turnOn.indexOf("try {") < made && turnOn.indexOf("} catch {") > made && turnOn.indexOf("} catch {") < queued, "a test slip that cannot be made leaves the switch off (the 4A gate's note)");
  assert.ok(!turnOn.includes("writeTextKot("), "printing the test never turns the switch on by itself");
  const answer = section.slice(section.indexOf("const answer = (clear: boolean) => {"), section.indexOf("const turnOff = () => {"));
  assert.ok(answer.includes("if (clear) {\n      writeTextKot(printer.key, { narrow80: wide && narrow80 });"), "Yes turns it on, with the 42 choice on 80 mm only");
  assert.ok(answer.includes('} else setPhase("kept-off");'), "No keeps it off");
  assert.equal((section.match(/writeTextKot\(/g) ?? []).length, 2, "the switch is written in two places only: Yes, and Off");
  assert.ok(section.includes("writeTextKot(printer.key, null);"), "turning it off is immediate");
  assert.ok(section.includes("if (choice !== null) setNarrow80(choice.narrow80);"), "off keeps the 42 choice it was proven at for its next test");
  assert.ok(section.includes("message === PRINT_HOST_PRINT_FAILED_MESSAGE ? TEST_FAILED_MESSAGE : message"), "a test the watchdog gave up on says the section's own words");
  assert.ok(section.includes("disabled={on || busy}"), "the characters per line are chosen while the switch is off, before its test");
  assert.ok(section.includes("disabled={!on && (busy || current !== null)}"), "turning on waits for a free bridge; turning off never waits");
  assert.ok(section.includes("if (printers.length === 0) return null;"), "hidden on a device with no printer it can write text to");
  assert.ok(section.includes("<label htmlFor={switchId}") && section.includes("id={switchId}"), "the printer's whole row is the switch's label: a 44 px tap target on a phone");
});

test("PIN: the section sits right after this device's printer, in every printer panel", () => {
  const card = src("components/print/PrinterSetupCard.tsx");
  assert.ok(card.includes("      <DevicePrinterSection />\n      <TextKotSection />\n"), "after DevicePrinterSection");
  const provider = src("components/layout/PrintHostProvider.tsx");
  assert.ok(provider.includes("queueTestSlip: (write?: () => Promise<void>) => Promise<number>;"), "the provider hands the section the bridge's test window");
});

test("PIN (spec §12): the switch costs no request: its reads are this device's and the agent's one printers read", () => {
  const hook = src("hooks/use-text-kot-printers.ts");
  // The 4B gate's m-1 reads the same query's `answered` flag too: still the agent's one cache entry.
  assert.ok(hook.includes('const { printers, answered } = usePrintersRead(deviceId !== "");'), "the agent's printers read (one cache entry)");
  for (const file of [SECTION, "hooks/use-text-kot-printers.ts", "lib/printer/kot-text/text-kot-store.ts", "lib/printer/kot-text/text-kot-print.ts", "lib/printer/kot-text/text-kot-printers.ts"]) {
    const text = src(file);
    for (const needle of ["api-client", "apiGet", "apiSend", "fetch(", "useQuery("]) assert.ok(!text.includes(needle), `${file} makes no request (${needle})`);
  }
});
