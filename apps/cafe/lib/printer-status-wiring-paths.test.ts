// Source pins for PX-2 Task 5's wiring (spec §6.5, §6.9 B6; the Task 5 review, M-1): the button and the panel read the
// same held status; the app's printers are held before the dot reads them; the dot's waiting printer rides the narrow
// string the pulse provider derives once (never the wide pulse, never a request). Every pin bites: its check rejects an
// in-memory mutation of the real file (no file is ever written).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const CAFE = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(CAFE, rel), "utf8");
const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

const BUTTON = "components/print/PrinterStatusButton.tsx";
const PANEL = "components/print/PrinterPanel.tsx";
const HOOK = "hooks/use-agent-printers.ts";
const PROVIDERS = "components/layout/PrintWaitingProviders.tsx";
const PULSE = "components/layout/PosPulseProvider.tsx";

function bodyOf(src: string, head: string): string {
  const at = src.indexOf(head);
  assert.ok(at >= 0, `landmark missing: ${head}`);
  return src.slice(at, src.indexOf("\n}\n", at));
}

interface Pin {
  name: string;
  file: string;
  check: (src: string) => void;
  /** Must change the source in a way `check` rejects. */
  mutate: (src: string) => string;
}

const HELD_LOCAL = "const snapshot = heldPrinterSnapshotOf(useDevicePrinter());";

const PINS: Pin[] = [
  {
    name: "B6: the header button reads this device's printer through the held snapshot",
    file: BUTTON,
    check: (src) => assert.equal(count(stripComments(src), HELD_LOCAL), 1, "the button's dot reads the held status"),
    mutate: (src) => src.replace(HELD_LOCAL, "const snapshot = useDevicePrinter();"),
  },
  {
    name: "B6: the panel reads it the same way (the same held value as the button)",
    file: PANEL,
    check: (src) => assert.equal(count(stripComments(src), HELD_LOCAL), 1, "the panel's dot reads the held status"),
    mutate: (src) => src.replace(HELD_LOCAL, "const snapshot = useDevicePrinter();"),
  },
  {
    name: "B6: the app's printers are held (the page's one memory) before the dot reads its worst one",
    file: HOOK,
    check: (src) => {
      const code = stripComments(src);
      assert.ok(code.includes("const HELD = (key: string, status: PrinterStatus): PrinterStatus => heldPrinterStatusOf(PAGE_HELD_STATUS, key, status);"), "one page memory");
      assert.ok(code.includes("const pool = useMemo(() => heldPoolOf(appPool, HELD), [appPool]);"), "the held pool");
      assert.ok(code.includes("const dot = useDotPrintersOf(printers, deviceId, local, desktop, pool, takenOver, lan);"), "the held pool feeds the dot");
    },
    mutate: (src) => src.replace("heldPoolOf(appPool, HELD)", "appPool"),
  },
  {
    name: "§6.5: useDotPrinters takes the waiting printers from the narrow context, the one this device does not print (R1)",
    file: HOOK,
    check: (src) => {
      const body = bodyOf(stripComments(src), "export function useDotPrinters(");
      assert.ok(body.includes("const waitingKey = usePrintWaitingPrinters();"), "the narrow string, no request");
      assert.ok(body.includes("const waiting = waitingElsewhereOf(waitingPrintersOf(waitingKey, printers), here);"), "named from the printers read, not one it prints");
      assert.ok(!/usePosPulseContext|useQuery\(|refetchInterval|setInterval/.test(body), "never the wide pulse, never a request or a timer");
    },
    mutate: (src) => src.replace("const waitingKey = usePrintWaitingPrinters();", 'const waitingKey = "";'),
  },
  {
    name: "§6.5: PrintWaitingProviders derives the count and the waiting printers once each and provides both",
    file: PROVIDERS,
    check: (src) => {
      const code = stripComments(src);
      assert.equal(count(code, "printWaitingBadgeOf("), 1, "the count, once");
      assert.equal(count(code, "printWaitingPrintersOf("), 1, "the waiting printers, once");
      assert.ok(code.includes("const printers = printWaitingPrintersOf(data, Date.now());"), "from the pulse already read");
      assert.match(code, /<PrintWaitingContext\.Provider value=\{waiting\}>\s*<PrintWaitingPrintersContext\.Provider value=\{printers\}>\{children\}<\/PrintWaitingPrintersContext\.Provider>/, "both narrow contexts");
      assert.ok(!src.includes("usePosPulseContext"), "it reads no wide pulse of its own");
    },
    mutate: (src) => src.replace("const printers = printWaitingPrintersOf(data, Date.now());", 'const printers = "";'),
  },
  {
    name: "§6.5: PosPulseProvider renders PrintWaitingProviders around its children and derives neither string itself",
    file: PULSE,
    check: (src) => {
      assert.equal(count(src, "<PrintWaitingProviders data={data}>{children}</PrintWaitingProviders>"), 1, "the one place, inside the pulse value");
      assert.ok(!src.includes("printWaitingBadgeOf(") && !src.includes("printWaitingPrintersOf("), "derived in PrintWaitingProviders only");
      assert.match(src, /usePosPulse\(\)/, "landmark: the provider still owns the single poll");
    },
    mutate: (src) => src.replace("<PrintWaitingProviders data={data}>{children}</PrintWaitingProviders>", "{children}"),
  },
];

for (const pin of PINS) {
  test(`PIN: ${pin.name}`, () => {
    const src = read(pin.file);
    assert.ok(src.length > 100, `${pin.file} was read`);
    pin.check(src);
  });
}

test("every pin bites: its check rejects an in-memory mutation of the real file", () => {
  assert.ok(PINS.length >= 6, "the pin list is whole");
  for (const pin of PINS) {
    const src = read(pin.file);
    const mutated = pin.mutate(src);
    assert.notEqual(mutated, src, `the mutation for "${pin.name}" must change the source`);
    assert.throws(() => pin.check(mutated), Error, `pin "${pin.name}" did not catch its mutation`);
  }
});

function callSites(needle: string): string[] {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") && stripComments(readFileSync(full, "utf8")).includes(needle)) {
        hits.push(path.relative(CAFE, full).split(path.sep).join("/"));
      }
    }
  };
  for (const dir of ["app", "components", "hooks", "lib"]) walk(path.join(CAFE, dir));
  return hits.sort();
}

test("PrintWaitingProviders is the one place both narrow strings are provided; the header button reads them, never the wide pulse", () => {
  assert.deepEqual(callSites("PrintWaitingContext.Provider"), [PROVIDERS], "the count's one provider");
  assert.deepEqual(callSites("PrintWaitingPrintersContext.Provider"), [PROVIDERS], "the waiting printers' one provider");
  assert.deepEqual(callSites("= printWaitingPrintersOf("), [PROVIDERS], "derived in one place");
  assert.deepEqual(callSites("<PrintWaitingProviders "), [PULSE], "rendered once, by the pulse provider");
  const button = stripComments(read(BUTTON));
  assert.ok(button.includes("const dotPrinters = useDotPrinters(deviceId);") && button.includes("const waiting = usePrintWaitingCount();"), "landmark: the button's narrow reads");
  assert.ok(!read(BUTTON).includes("usePosPulseContext") && !read(HOOK).includes("usePosPulseContext"), "the header button and its dot hook never read the wide pulse");
});
