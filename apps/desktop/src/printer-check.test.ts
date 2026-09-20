// The startup printer check is a CONVENIENCE that sits next to the money
// path, so the tests below are mostly about what it must NOT do.
//
// Owner's hard requirement (2026-09-19): "lock na ho to bhi na le raha ho
// aesa hona hi nahi chahiye" — printing must never stop because of this
// check. Every assertion here exists to keep that true.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  PRINTER_CHECK_DELAY_MS,
  PRINTER_NOT_CHOSEN_MESSAGE,
  printerMissingMessage,
  runPrinterCheck,
  schedulePrinterCheck,
  type PrinterCheckDeps,
} from "./printer-check";

interface Recorded {
  notices: { title: string; body: string }[];
  infos: string[];
  errors: string[];
}

function harness(
  over: Partial<PrinterCheckDeps> & { deviceName?: string | null; printers?: string[] } = {},
): { deps: PrinterCheckDeps; rec: Recorded } {
  const rec: Recorded = { notices: [], infos: [], errors: [] };
  const deps: PrinterCheckDeps = {
    getDeviceName: () => (over.deviceName === undefined ? "POS80" : over.deviceName),
    listPrinterNames: async () => over.printers ?? ["POS80", "Microsoft Print to PDF"],
    notify: (title, body) => rec.notices.push({ title, body }),
    log: {
      info: (m: string) => rec.infos.push(m),
      error: (m: string) => rec.errors.push(m),
    },
    ...over,
  };
  return { deps, rec };
}

test("the chosen printer being connected is silent — no notification, just a log line", async () => {
  const { deps, rec } = harness({ deviceName: "POS80", printers: ["POS80", "Fax"] });
  assert.equal(await runPrinterCheck(deps), "ok");
  assert.equal(rec.notices.length, 0, "a healthy printer must never interrupt the operator");
  assert.equal(rec.errors.length, 0);
});

test("a chosen printer that is NOT connected warns once, naming it", async () => {
  const { deps, rec } = harness({ deviceName: "POS80", printers: ["Fax", "OneNote"] });
  assert.equal(await runPrinterCheck(deps), "missing");
  assert.equal(rec.notices.length, 1);
  assert.match(rec.notices[0]!.body, /POS80/, "the operator must be told WHICH printer is missing");
  assert.equal(rec.notices[0]!.body, printerMissingMessage("POS80"));
});

test("no printer chosen at all warns with the instruction to pick one", async () => {
  for (const nothing of [null, ""]) {
    const { deps, rec } = harness({ deviceName: nothing });
    assert.equal(await runPrinterCheck(deps), "not-chosen");
    assert.equal(rec.notices.length, 1);
    assert.equal(rec.notices[0]!.body, PRINTER_NOT_CHOSEN_MESSAGE);
  }
});

test("an EMPTY printer list is 'cannot tell', never 'missing' — the spooler may still be starting on a cold boot", async () => {
  const { deps, rec } = harness({ deviceName: "POS80", printers: [] });
  assert.equal(await runPrinterCheck(deps), "unavailable");
  assert.equal(
    rec.notices.length,
    0,
    "crying wolf about a healthy printer, every single boot, is worse than staying quiet",
  );
});

test("a throwing printer lookup is swallowed — the check can never take the app down", async () => {
  const { deps, rec } = harness({
    listPrinterNames: async () => {
      throw new Error("spooler exploded");
    },
  });
  assert.equal(await runPrinterCheck(deps), "unavailable");
  assert.equal(rec.notices.length, 0);
  assert.equal(rec.errors.length, 1, "the failure must be logged");
  assert.ok(!rec.errors[0]!.includes("exploded"), "a foreign error message must not be forwarded verbatim");
});

test("the check NEVER changes the stored printer choice — a printer off overnight is still the choice in the morning", async () => {
  // The dependency INTERFACE is the guarantee: there is no writer on it, so a
  // transient outage has no way to erase the operator's choice. Asserted
  // against the declared interface in the source, not a runtime object (a test
  // harness can always add its own keys).
  const src = readFileSync(path.join(__dirname, "printer-check.ts"), "utf8");
  const start = src.indexOf("export interface PrinterCheckDeps {");
  assert.ok(start > 0, "PrinterCheckDeps must exist");
  const body = src.slice(start, src.indexOf("}", start));
  for (const writer of ["setDeviceName", "persist", "writeStore", "savePrinter"]) {
    assert.ok(
      !body.includes(writer),
      `PrinterCheckDeps must not expose ${writer} — the startup check must never be able to rewrite the printer choice`,
    );
  }
  // Positive landmark: it really does read the choice and the printer list.
  assert.match(body, /getDeviceName\(\): string \| null;/);
  assert.match(body, /listPrinterNames\(\): Promise<string\[\]>;/);

  // And a missing printer still leaves the choice reported unchanged.
  const { deps } = harness({ deviceName: "POS80", printers: ["Fax"] });
  assert.equal(await runPrinterCheck(deps), "missing");
  assert.equal(deps.getDeviceName(), "POS80", "the choice must survive a failed check");
});

test("schedulePrinterCheck runs ONCE, after a delay, and can be cancelled before it fires", async () => {
  // Fires.
  {
    const { deps, rec } = harness({ deviceName: "POS80", printers: ["Fax"] });
    schedulePrinterCheck(deps, 1);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(rec.notices.length, 1, "the scheduled check must actually run");
  }
  // Cancelled.
  {
    const { deps, rec } = harness({ deviceName: "POS80", printers: ["Fax"] });
    const cancel = schedulePrinterCheck(deps, 20);
    cancel();
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(rec.notices.length, 0, "a cancelled check must not fire");
  }
});

test("the delay is long enough for a cold boot to bring up the spooler", () => {
  assert.ok(
    PRINTER_CHECK_DELAY_MS >= 10_000,
    `checking too early reports a healthy printer as missing; got ${PRINTER_CHECK_DELAY_MS}ms`,
  );
});

// ── The safety pins: what this feature must never grow into ───────────────

const SRC_DIR = __dirname;
const readSrc = (f: string): string => readFileSync(path.join(SRC_DIR, f), "utf8");

test("SAFETY: nothing in the app listens to lock/unlock/sleep/resume — the owner asked for a startup check ONLY", () => {
  // Needles built by concatenation so this test's own text cannot match them.
  const banned = [
    "power" + "Monitor",
    "lock-" + "screen",
    "unlock-" + "screen",
    '"' + "resume" + '"',
    '"' + "suspend" + '"',
  ];
  for (const file of [
    "main.ts",
    "printer-check.ts",
    "print.ts",
    "print-job.ts",
    "print-direct.ts",
    "print-driver.ts",
    "print-messages.ts",
    "raw-spool.ts",
    "shell-window.ts",
    "menu.ts",
  ]) {
    const src = readSrc(file);
    for (const needle of banned) {
      assert.ok(
        !src.includes(needle),
        `${file} must not reference ${needle} — a check on every unlock is exactly what the owner ruled out`,
      );
    }
  }
  // Positive landmark: the startup check really is wired (so the negatives
  // above are not vacuous).
  assert.match(readSrc("main.ts"), /schedulePrinterCheck\(/, "the startup check must be scheduled from main.ts");
});

test("SAFETY: printer-check.ts cannot block a print — it has no import from the print path and no throw that escapes", () => {
  const src = readSrc("printer-check.ts");
  assert.ok(!src.includes('from "./print"'), "the check must not reach into the print path");
  assert.match(src, /catch \(error\)/, "the whole check body must be wrapped in a catch");
  // Positive landmark.
  assert.match(src, /export async function runPrinterCheck/, "runPrinterCheck must exist");
});

test("SAFETY: print.ts does not consult the startup check — a print decision is made per job, so a printer coming back works immediately", () => {
  const src = readSrc("print.ts");
  assert.ok(
    !src.includes("printer-check") && !src.includes("runPrinterCheck"),
    "print.ts must never read the startup check's verdict — a stale 'missing' would keep refusing after the printer returned",
  );
  // Positive landmark: print.ts still makes its own per-job decision.
  assert.match(src, /PRINT_NO_PRINTER_MESSAGE/, "print.ts must still own its per-job printer decision");
});
