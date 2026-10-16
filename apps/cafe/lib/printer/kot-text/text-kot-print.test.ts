import { settingsOf } from "../../print-template-golden.fixtures"; // FIRST: React's production build
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { KotBlock, KotTemplate } from "@pos/shared/print-template";
import type { LeasedPrintJob } from "@pos/shared/print-agent-wire";
import type { SlipCodeStatus } from "@/components/print/slip/slip-code";
import { printAgentSlipOf } from "@/lib/print-agent-slip";
import type { HostPrintSlip, SlipPrintTarget } from "@/lib/print-host-slips";
import { defaultKotTemplate } from "@/lib/print-template-designs";
import { classicKotTemplate } from "@/lib/print-template-legacy";
import { DOTS_58MM, DOTS_80MM, RASTER_MAX_ROWS } from "@/lib/printer/escpos";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";
import type { PrinterSnapshot } from "@/lib/printer/web-printer-types";
import type { Settings } from "@/types";
import { kotTextJob } from "./kot-text";
import { slipOf } from "./kot-text.fixtures";
import { textKotFitsPicture, textKotRouteOf, textKotWriteFor, type TextKotEnv } from "./text-kot-print";
import { textKotKeyForDevice, textKotKeyForPrinter, type TextKotChoice } from "./text-kot-store";

// Printing Phase 4 (spec 2026-10-15 §5.2, §5.4, S1, S3, S4): the print bridge's text step. With a printer's switch off,
// or anything text cannot print exactly, it answers null and calls no writer: the bridge then fires the picture as today.

const APP_80: DevicePrinter = { kind: "native", name: "Counter", paper: "80mm", printerId: "bt-classic:AA:BB:CC:DD:EE:FF", transport: "bt-classic" };
const APP_58: DevicePrinter = { kind: "native", name: "Kitchen 58", paper: "58mm", printerId: "tcp:10.0.2.2:9100", transport: "tcp" };
const PLAIN = settingsOf({ logo: "" });
const PRINTER = "6710aa00000000000000000a";

function fakeEnv(over: Partial<TextKotEnv> = {}) {
  const writes: string[] = [];
  const on = new Map<string, TextKotChoice>();
  let device: PrinterSnapshot = { status: "connected", printer: APP_80, message: null };
  const env: TextKotEnv = {
    devicePrinter: () => device,
    desktop: () => null,
    desktopPrintsRaw: () => false,
    rasterCapable: () => true,
    readTextKot: (key) => on.get(key) ?? null,
    slipCodeStatus: () => "idle",
    writeDevice: async (bytes) => void writes.push(`device ${bytes.length}`),
    writeNative: async (nativeId, bytes) => void writes.push(`app ${nativeId} ${bytes.length}`),
    writeLan: async (target, bytes) => void writes.push(`lan ${target.host}:${target.port} ${bytes.length}`),
    writeRawOn: async (name, bytes) => void writes.push(`windows ${name} ${bytes.length}`),
    ...over,
  };
  return {
    env,
    writes,
    on: (key: string, narrow80 = false) => on.set(key, { narrow80 }),
    setDevice: (next: PrinterSnapshot) => void (device = next),
  };
}

const KOTS = ["round-label-number", "void-reason-by-at", "moved-from-by-at", "cancel-notice-reason"] as const;
const ask = (env: TextKotEnv, slip: HostPrintSlip, target?: SlipPrintTarget, settings: Settings = PLAIN) => textKotWriteFor({ slip, settings, target, env });
const columnsJob = (slip: HostPrintSlip, columns: 32 | 42 | 48, settings: Settings = PLAIN) => {
  const job = kotTextJob({ slip: slip as Parameters<typeof kotTextJob>[0]["slip"], settings, columns });
  assert.ok(job.ok, "the slip prints as text");
  return job.bytes;
};

test("S1: with every switch off no slip answers text and no writer is called, on every route", async () => {
  const routes: Array<[string, Partial<TextKotEnv>, SlipPrintTarget | undefined, string | undefined]> = [
    ["the POS app's own printer", {}, undefined, undefined],
    ["one of the app's printers", {}, { nativeId: "tcp:192.168.1.50:9100", paper: "80mm" }, PRINTER],
    ["a network printer of the Windows app", { desktop: () => ({ chosen: "POS-80", printMode: "direct" }) }, { lan: { host: "192.168.1.50", port: 9100 }, paper: "80mm" }, PRINTER],
    ["a Windows printer", { desktop: () => ({ chosen: "POS-80", printMode: "direct" }), desktopPrintsRaw: () => true }, { printerName: "Kitchen TVS", paper: "80mm" }, PRINTER],
    ["the Windows app's chosen printer", { desktop: () => ({ chosen: "POS-80", printMode: "direct" }), desktopPrintsRaw: () => true }, undefined, undefined],
  ];
  for (const [name, over, target, printerId] of routes) {
    const f = fakeEnv(over);
    for (const id of KOTS) {
      const slip: HostPrintSlip = { ...slipOf(id), ...(printerId === undefined ? {} : { printerId }) };
      assert.equal(ask(f.env, slip, target), null, `${name} / ${id}: off is a picture`);
    }
    assert.deepEqual(f.writes, [], `${name}: no writer called`);
  }
});

test("only a job's kitchen slip: a bill, a token, End of day and a printer's Test print answer nothing with the switch on", () => {
  const f = fakeEnv();
  f.on(textKotKeyForDevice(APP_80));
  const order = slipOf("round-label-number").order;
  const others: HostPrintSlip[] = [
    { surface: "receipt", order, documentTitle: "bill" },
    { surface: "token", order, documentTitle: "token" },
    { surface: "eod", dateKey: "2026-10-15", dateLabel: "15 Oct", isToday: true, documentTitle: "eod" },
    { surface: "test", printerName: "Kitchen", lines: ["Kitchen"], requestedBy: "Asha", requestedAt: "2026-10-15T10:00:00.000Z", documentTitle: "test" },
  ];
  for (const slip of others) assert.equal(ask(f.env, slip), null, `${slip.surface}: a picture`);
  assert.notEqual(ask(f.env, slipOf("round-label-number")), null, "landmark: the KOT itself prints as text");
  assert.deepEqual(f.writes, [], "asking writes nothing");
});

test("S3: a slip text cannot print exactly answers nothing, so the picture prints it", () => {
  const f = fakeEnv();
  f.on(textKotKeyForDevice(APP_80));
  const kot = slipOf("round-label-number");
  const items = kot.kotRoundItems ?? [];
  const hindi = { ...kot, kotRoundItems: items.map((item, i) => (i === 0 ? { ...item, name: "पनीर टिक्का" } : item)) };
  assert.equal(ask(f.env, hindi), null, "a Hindi dish");
  assert.equal(ask(f.env, { ...kot, order: { ...kot.order, receiver: "આશા" } }), null, "a staff name in Gujarati");
  assert.equal(ask(f.env, kot, undefined, settingsOf({ kotShowLogo: true })), null, "the logo on, with a logo");
  assert.notEqual(ask(f.env, kot, undefined, settingsOf({ logo: "", kotShowLogo: true })), null, "landmark: the logo on with no logo prints text");
  const qr = (template: KotTemplate): KotBlock[] => [...template.blocks, { id: "qr-1", type: "qr", on: true, options: { content: "link", url: "https://example.com/menu" } } as KotBlock];
  const withQr = { ...PLAIN, kotTemplate: { ...classicKotTemplate(PLAIN), blocks: qr(classicKotTemplate(PLAIN)) } } as Settings;
  assert.equal(ask({ ...f.env, slipCodeStatus: () => "ready" }, kot, undefined, withQr), null, "a QR line with a usable link");
  assert.equal(ask(f.env, { ...kot, order: { ...kot.order, items: undefined } as never, kotRoundItems: undefined }), null, "an error in the text renderer");
  const throwing = { ...f.env, readTextKot: (): never => { throw new Error("storage"); } };
  assert.equal(ask(throwing, kot), null, "an error anywhere in the step");
  assert.deepEqual(f.writes, [], "no writer called");
});

test("the planning review's I-4: a design whose lazy code is not loaded answers nothing (the picture prints the legacy ticket)", () => {
  const f = fakeEnv();
  f.on(textKotKeyForDevice(APP_80));
  const bold = { ...PLAIN, kotTemplate: defaultKotTemplate("kitchenBold", PLAIN) } as Settings;
  const kot = slipOf("round-label-number");
  for (const status of ["idle", "loading", "failed"] as const satisfies readonly SlipCodeStatus[]) {
    assert.equal(ask({ ...f.env, slipCodeStatus: () => status }, kot, undefined, bold), null, `Kitchen Bold while the code is ${status}`);
  }
  assert.notEqual(ask({ ...f.env, slipCodeStatus: () => "ready" }, kot, undefined, bold), null, "Kitchen Bold once the code is in");
  const classic = { ...PLAIN, kotTemplate: classicKotTemplate(PLAIN) } as Settings;
  assert.notEqual(ask({ ...f.env, slipCodeStatus: () => "failed" }, kot, undefined, classic), null, "a stored Classic ticket needs no lazy code");
});

test("the columns come from the printer's paper at each print: 80 mm 48 or the 42 choice, 58 mm 32 whatever is stored", () => {
  const kot = slipOf("round-label-number");
  const f = fakeEnv();
  f.on(textKotKeyForDevice(APP_80));
  assert.deepEqual(ask(f.env, kot)?.bytes, columnsJob(kot, 48), "80 mm, Automatic: 48");
  f.on(textKotKeyForDevice(APP_80), true);
  assert.deepEqual(ask(f.env, kot)?.bytes, columnsJob(kot, 42), "80 mm, 42 chosen: 42");
  f.on(textKotKeyForDevice(APP_58), true);
  f.setDevice({ status: "connected", printer: APP_58, message: null });
  assert.deepEqual(ask(f.env, kot)?.bytes, columnsJob(kot, 32), "the paper changed to 58 mm: 32, the stored 42 choice does not apply");
  const target: SlipPrintTarget = { nativeId: "tcp:192.168.1.50:9100", paper: "58mm" };
  f.on(textKotKeyForPrinter(PRINTER, { kind: "app", nativeId: target.nativeId ?? "" }));
  assert.deepEqual(ask(f.env, { ...kot, printerId: PRINTER }, target)?.bytes, columnsJob(kot, 32), "a printer job: its printer's paper");
});

test("spec §5.4: each writer gets the text bytes, through the route the picture takes", async () => {
  const kot = slipOf("round-label-number");
  const bytes = columnsJob(kot, 48);
  const cases: Array<[string, Partial<TextKotEnv>, SlipPrintTarget | undefined, string | undefined, string, string]> = [
    ["this device's own printer (simple mode)", {}, undefined, undefined, textKotKeyForDevice(APP_80), `device ${bytes.length}`],
    ["a printer job on the device's one printer (an app on bridge v1, a browser's printer)", {}, undefined, PRINTER, textKotKeyForPrinter(PRINTER, APP_80), `device ${bytes.length}`],
    ["one of the POS app's printers (bridge v2)", {}, { nativeId: "tcp:192.168.1.50:9100", paper: "80mm" }, PRINTER, textKotKeyForPrinter(PRINTER, { kind: "app", nativeId: "tcp:192.168.1.50:9100" }), `app tcp:192.168.1.50:9100 ${bytes.length}`],
    ["a network printer of the Windows app (1.12.0)", { desktop: () => ({ chosen: null, printMode: undefined }) }, { lan: { host: "192.168.1.50", port: 9100 }, paper: "80mm" }, PRINTER, textKotKeyForPrinter(PRINTER, { kind: "lan", host: "192.168.1.50", port: 9100 }), `lan 192.168.1.50:9100 ${bytes.length}`],
    ["a Windows printer of the setup (2.0.2, Direct)", { desktop: () => ({ chosen: "POS-80", printMode: "direct" }), desktopPrintsRaw: () => true }, { printerName: "Kitchen TVS", paper: "80mm" }, PRINTER, textKotKeyForPrinter(PRINTER, { kind: "windows", name: "Kitchen TVS" }), `windows Kitchen TVS ${bytes.length}`],
    ["the Windows app's chosen printer (simple mode, 2.0.2, Direct)", { desktop: () => ({ chosen: "POS-80", printMode: "direct" }), desktopPrintsRaw: () => true }, undefined, undefined, textKotKeyForDevice({ kind: "windows", name: "POS-80" }), `windows POS-80 ${bytes.length}`],
  ];
  for (const [name, over, target, printerId, key, wrote] of cases) {
    const f = fakeEnv(over);
    f.on(key);
    const text = ask(f.env, { ...kot, ...(printerId === undefined ? {} : { printerId }) }, target);
    assert.ok(text !== null, `${name}: text`);
    assert.deepEqual(text.bytes, bytes, `${name}: the slip's text bytes`);
    assert.deepEqual(f.writes, [], `${name}: nothing written before the bridge writes`);
    await text.write();
    assert.deepEqual(f.writes, [wrote], `${name}: one write, through its own writer`);
  }
});

test("a Windows printer prints text only through printRawOn and the Direct method, and only a printer it names", () => {
  const kot = { ...slipOf("round-label-number"), printerId: PRINTER };
  const target: SlipPrintTarget = { printerName: "Kitchen TVS", paper: "80mm" };
  const key = textKotKeyForPrinter(PRINTER, { kind: "windows", name: "Kitchen TVS" });
  const answer = (over: Partial<TextKotEnv>, slip: HostPrintSlip, to: SlipPrintTarget | undefined) => {
    const f = fakeEnv(over);
    f.on(key);
    f.on(textKotKeyForDevice({ kind: "windows", name: "POS-80" }));
    return ask(f.env, slip, to);
  };
  assert.equal(answer({ desktop: () => ({ chosen: "POS-80", printMode: "direct" }), desktopPrintsRaw: () => false }, kot, target), null, "an app before 2.0.2 (no printRawOn)");
  assert.equal(answer({ desktop: () => ({ chosen: "POS-80", printMode: "driver" }), desktopPrintsRaw: () => true }, kot, target), null, "Through the Windows driver");
  assert.equal(answer({ desktop: () => ({ chosen: "POS-80", printMode: undefined }), desktopPrintsRaw: () => true }, kot, target), null, "an app that does not say its method");
  assert.equal(answer({ desktop: () => ({ chosen: null, printMode: "direct" }), desktopPrintsRaw: () => true }, slipOf("round-label-number"), undefined), null, "simple mode with no printer chosen (the Windows default)");
  assert.equal(answer({ desktop: () => ({ chosen: "POS-80", printMode: "direct" }), desktopPrintsRaw: () => true }, kot, undefined), null, "a printer job with no Windows printer named (an older app prints its chosen one)");
  assert.notEqual(answer({ desktop: () => ({ chosen: "POS-80", printMode: "direct" }), desktopPrintsRaw: () => true }, kot, target), null, "landmark: 2.0.2 and Direct");
});

test("this device's own printer as the picture's lane: none saved, another tab's, or a plain browser answer nothing", () => {
  const kot = slipOf("round-label-number");
  const f = fakeEnv();
  f.on(textKotKeyForDevice(APP_80));
  f.setDevice({ status: "none", printer: null, message: null });
  assert.equal(ask(f.env, kot), null, "no printer on this device");
  f.setDevice({ status: "elsewhere", printer: APP_80, message: "another tab" });
  assert.equal(ask(f.env, kot), null, "another tab of this browser owns it (the picture refuses with its own sentence)");
  f.setDevice({ status: "connected", printer: APP_80, message: null });
  assert.equal(ask({ ...f.env, rasterCapable: () => false }, kot), null, "a plain browser: the print window");
  assert.notEqual(ask(f.env, kot), null, "landmark: the printer, connected");
  f.setDevice({ status: "connecting", printer: APP_80, message: null });
  assert.notEqual(ask(f.env, kot), null, "a printer still connecting is written as the picture is (the write reconnects once)");
});

test("a printer pointed elsewhere, or another printer, reads off until its own text test", () => {
  const kot = { ...slipOf("round-label-number"), printerId: PRINTER };
  const f = fakeEnv();
  f.on(textKotKeyForPrinter(PRINTER, { kind: "app", nativeId: "tcp:192.168.1.50:9100" }));
  assert.notEqual(ask(f.env, kot, { nativeId: "tcp:192.168.1.50:9100", paper: "80mm" }), null, "landmark: the printer that passed its test");
  assert.equal(ask(f.env, kot, { nativeId: "tcp:192.168.1.51:9100", paper: "80mm" }), null, "re-pointed to another address");
  assert.equal(ask(f.env, { ...kot, printerId: "6710aa00000000000000000b" }, { nativeId: "tcp:192.168.1.50:9100", paper: "80mm" }), null, "another setup printer at that address");
  assert.equal(ask(f.env, slipOf("round-label-number")), null, "this device's own printer in simple mode");
});

test("spec §5.3: a printer this device only takes over for another device prints pictures, its stored switch or not", () => {
  const target: SlipPrintTarget = { nativeId: "tcp:192.168.1.50:9100", paper: "80mm" };
  const f = fakeEnv();
  f.on(textKotKeyForPrinter(PRINTER, { kind: "app", nativeId: "tcp:192.168.1.50:9100" }));
  const kot: HostPrintSlip = { ...slipOf("round-label-number"), printerId: PRINTER };
  assert.notEqual(ask(f.env, kot, target), null, "landmark: its own printer, switch on: text");
  assert.equal(ask(f.env, { ...kot, takeover: true }, target), null, "taken over for another device: a picture");
  assert.deepEqual(f.writes, [], "no writer called");
});

test("PIN (spec §5.3): the agent marks a slip of a printer it only takes over", () => {
  const agent = readFileSync(path.join(process.cwd(), "hooks/use-print-agent.ts"), "utf8");
  assert.ok(agent.includes("const takeoverRef = useRef(printers.takeoverIds);"), "the printers it may take over, read at print time");
  assert.ok(agent.includes("job.printerId !== undefined && takeoverRef.current.includes(job.printerId) ? { ...slip, takeover: true } : slip"), "such a job's slip says so");
});

test("spec §4.1 rule 7 in the step: a slip whose text would pass the picture's limit at its paper prints as a picture", () => {
  // The review's m-1 (M5): the same slip fits 80 mm's limit and passes 58 mm's.
  const kot = slipOf("round-label-number");
  const line = { ...(kot.kotRoundItems ?? [])[0], qty: 1, name: "Masala Chai", modifiers: [], instructions: "" };
  const big: HostPrintSlip = { ...kot, kotRoundItems: Array.from({ length: 22_300 }, () => line) };
  const narrow = kotTextJob({ slip: big as Parameters<typeof kotTextJob>[0]["slip"], settings: PLAIN, columns: 32 });
  const wide = kotTextJob({ slip: big as Parameters<typeof kotTextJob>[0]["slip"], settings: PLAIN, columns: 48 });
  assert.ok(narrow.ok && narrow.bytes.length > (DOTS_58MM / 8) * RASTER_MAX_ROWS, "landmark: on 58 mm the text is past the picture's limit");
  assert.ok(wide.ok && wide.bytes.length <= (DOTS_80MM / 8) * RASTER_MAX_ROWS, "landmark: on 80 mm it is within it");
  const f58 = fakeEnv();
  f58.setDevice({ status: "connected", printer: APP_58, message: null });
  f58.on(textKotKeyForDevice(APP_58));
  // A boolean, not the answer: a failing equal would diff a ~780 KB job and run node out of memory (the review's m-9).
  assert.equal(ask(f58.env, big) === null, true, "58 mm: a picture (rule 7)");
  const f80 = fakeEnv();
  f80.on(textKotKeyForDevice(APP_80));
  assert.equal(ask(f80.env, big) !== null, true, "80 mm: text");
});

test("spec §4.1 rule 7: text larger than the largest picture of that paper answers nothing", () => {
  assert.equal(textKotFitsPicture((DOTS_80MM / 8) * RASTER_MAX_ROWS, "80mm"), true, "80 mm: up to the picture's own limit");
  assert.equal(textKotFitsPicture((DOTS_80MM / 8) * RASTER_MAX_ROWS + 1, "80mm"), false, "80 mm: one byte more");
  assert.equal(textKotFitsPicture((DOTS_58MM / 8) * RASTER_MAX_ROWS + 1, "58mm"), false, "58 mm: one byte more");
  assert.equal(textKotFitsPicture(1200, "58mm"), true, "a real kitchen ticket");
  const route = textKotRouteOf({ printerId: undefined, target: undefined, settings: PLAIN, env: fakeEnv().env });
  assert.equal(route?.paper, "80mm", "landmark: the route names the paper the limit is measured at");
});

test("copies: each pass through the bridge decides alike and writes once", async () => {
  const f = fakeEnv();
  f.on(textKotKeyForDevice(APP_80));
  const kot = slipOf("round-label-number");
  const first = ask(f.env, kot);
  const second = ask(f.env, kot);
  assert.ok(first !== null && second !== null, "both copies are text");
  assert.deepEqual(first.bytes, second.bytes, "the same bytes");
  await first.write();
  await second.write();
  assert.equal(f.writes.length, 2, "one write per copy");
});

test("a printer job's slip names its printer; a simple-mode job's slip names none", () => {
  const base = { id: "j1", kind: "kot", labels: [], copies: 1, payload: { kind: "kot", snapshot: slipOf("round-label-number").order, round: 1 } } as unknown as LeasedPrintJob;
  assert.equal(printAgentSlipOf({ ...base, printerId: PRINTER } as LeasedPrintJob, "2026-10-15").printerId, PRINTER, "the job's printer");
  assert.equal("printerId" in printAgentSlipOf(base, "2026-10-15"), false, "no printer: as before");
});

// S1's source pin: the picture's code is not changed in Phase 4 (spec §2.1 S1, the plan's Global Constraints). Each file's
// SHA-256 as of the spec commit d21ee37 (the repo checks out LF everywhere: .gitattributes).
const PICTURE_FILES: ReadonlyArray<readonly [string, string]> = [
  ["apps/cafe/lib/printer/escpos.ts", "a0ebdf99560951b26ab030fe2c063e32c39e2348b8267dea4ca630aa98bbacb7"],
  ["apps/cafe/lib/printer/raster.ts", "a8e28e7255671fde55fc67bcbfcfc4179a356190ff52d42db48403f4c9917a55"],
  ["apps/cafe/lib/printer/raster-assets.ts", "890fa950970a301991f5e6cad7a4c8ac944d86640242f162d69cce11df3c5282"],
  ["apps/cafe/lib/printer/lane-print.ts", "85c2fbfe90c4ace49714f4eca7dab38ea71f518aa2e85c046f7411eab041f631"],
  ["apps/cafe/lib/desktop-shell.ts", "6500105e629eab187c941973bdf2efefb9527a864ed3c7a4344ec31ff65002a9"],
  ["apps/cafe/components/pos/KOTReceipt.tsx", "8cf5b916d92dfb849cebfc706e5092ae64a32f5543c32c3881280b75a2cc6a6c"],
  ["apps/cafe/components/pos/OrderReceipt.tsx", "0b5403aae20c88068bad01301de7f252110e34c249a390be0927d8b9ef2a27b0"],
  ["apps/cafe/components/pos/PrintSources.tsx", "9e48741a302e346676ab3d5743f33b71186f2ab263ada641486713e562391626"],
  ["apps/cafe/components/pos/PrintBanner.tsx", "ae64381a09a8756e96e5a8ff354dd30929ffe69157023b88d5eff34d7ac8adbb"],
  ["apps/cafe/components/print/slip/SlipEngine.tsx", "7dadadca482d807afe61af08fa5251fe6700c10b44d5e0742441c8532d0efa48"],
  ["apps/cafe/components/print/slip/SlipSkeleton.tsx", "f611392cca061ecbd578917e498bc6c2b22f9b6d82574d47377d28fee4065350"],
  ["apps/cafe/components/print/slip/TokenSlip.tsx", "dc61cf11886300c5fb1f67e25633fa81c56526944936445e12685019c8194e14"],
  ["apps/cafe/components/print/slip/bill-cafe-blocks.tsx", "52bfa8cdd7d34e936f07afe17c952417eb9cb101dc760b1d1e72b7aa0afb4edf"],
  ["apps/cafe/components/print/slip/bill-classic-blocks.tsx", "e65be3f269183afd0ced7d2f18fb7b445d7f59c460aaa095fe8d33405739c203"],
  ["apps/cafe/components/print/slip/bill-express-blocks.tsx", "cea92172ce8a542c8caec96488124b3f55a0df52bae05e273e2bb65522f5268f"],
  ["apps/cafe/components/print/slip/bill-modern-blocks.tsx", "309fba301f66402263b8495772b4f7577b70effb097718ba1f0bfb873c7e1f2c"],
  ["apps/cafe/components/print/slip/bill-themed-blocks.tsx", "acf359519cb9d63beb624fa18be9d9b1b88ce1a460bd8f682e6a43e034f675cd"],
  ["apps/cafe/components/print/slip/generic-blocks.tsx", "caf0b117be2497bb9b089ec0f2f890e1b182d84a9d828a94ea27c752fc32b5ab"],
  ["apps/cafe/components/print/slip/kot-bold-blocks.tsx", "f8cf55c4e5ad8d3b38a13ff09f79921d6954c948374c9c9ff584f80815db4957"],
  ["apps/cafe/components/print/slip/kot-classic-blocks.tsx", "398dcaff958c617b564ff4f31f10bab9722bcd5345bcd3db17610d18b9d22c9f"],
  ["apps/cafe/components/print/slip/slip-code-lazy.ts", "c9b5ee58ab7c1b4b7667286f5a0f004f8a771d12b00c731801c401a0763e1082"],
  ["apps/cafe/components/print/slip/slip-code.ts", "57233d57b60d16bf006e708456ddbcdd5ffbca6a949c94ec8cfa8ea49355e857"],
  ["apps/cafe/components/print/slip/slip-context.ts", "4877169aca7bff0e6e709d5ea1ddfcd449e39e78dd8fa417492da37a8ba28ccd"],
  ["apps/cafe/components/print/slip/slip-designs.ts", "de65eccd2cdfa92760c785c7759c720acc02d51858c09e707c18fffafaea8c87"],
  ["apps/cafe/components/print/slip/slip-format.ts", "0d2a327a80178b1aa4f76f3ed49915499bfa19f4a630183e8e5ec33972534263"],
  ["apps/cafe/components/print/slip/slip-groups.ts", "326e115f246eacb022d19da2613f9d7f4e430e6f3df6a522155daf6ce908c0ea"],
  ["apps/cafe/components/print/slip/slip-rows.tsx", "b50c240dd1e57a5a314a8da3fe52edaea9cbc66ce7bbf99ed21dbd3a3b2f0da2"],
  ["apps/cafe/components/print/slip/slip-style.ts", "e6d4fcf11a7e054694526589dcce269a2e2fe1162deca18505faf64c51d5a626"],
  ["apps/cafe/components/print/slip/slip-view.ts", "c0820bb0952f8e2cfb65edb7870fc5913bd2a84e88b5c0c075ebd4f85cec18d3"],
  ["apps/cafe/components/print/slip/token-blocks.tsx", "9784facf66ec6774eda7234384407dcf8c0f35d6d5f6ca5e6fab0a63e53ee875"],
  ["apps/cafe/components/print/slip/token-designs.tsx", "c79f13e5dca0e26b327f028338315945794f7f6fa7c190f56dc4377931906ed4"],
  ["apps/desktop/src/print-direct.ts", "2b0c34fac5bad5fa9f4feb685505e1655eb23d3ba8a409fb1dc2c555630e7db0"],
  ["apps/desktop/src/escpos.ts", "d4e61dc6ad244e3fe7dc6881e9608ab966af0eee64b40be74e428330e57e4a62"],
  ["apps/desktop/src/raw-spool.ts", "f9f30989801d1404435160e34c1f9cac30cad05f0d1599fe4b48870150630267"],
  ["apps/desktop/src/raw-tcp.ts", "0e393ddc0cd0f39e875f55c1168cfd78b572101dade45eeed4f250e9554d13e0"],
  ["apps/desktop/src/print-job.ts", "aa8784291abf6da80efcad1ac0b5a494a3055f301b696c59a22729000e4107d2"],
  ["apps/mobile/android/app/src/main/java/com/possoftware/pos/printer/PrinterManager.kt", "2528f235b7b1d29ecd81ac9645d232b628348855a0ef05c5a29a4b39928cd635"],
  ["apps/mobile/android/app/src/main/java/com/possoftware/pos/printer/PrinterPool.kt", "d17d127edcbdfdfd707cdaf63f4d49e242cc781d05e0d67ee6d98a6fd647d179"],
  ["apps/mobile/android/app/src/main/java/com/possoftware/pos/printer/BleTransport.kt", "c672736fdfc7a01e8042b16c29de8e90425672d1fcdba055dc6178e84c490e66"],
  ["apps/mobile/android/app/src/main/java/com/possoftware/pos/printer/ClassicTransport.kt", "6c433670f0eb600d176a3a42811b522ab254e8da53bed24ac074c575bea34661"],
  ["apps/mobile/android/app/src/main/java/com/possoftware/pos/printer/TcpTransport.kt", "907f9360cc400bef578b390950ef58aaf4179cf5fa090521ad50a33b7afcf059"],
  ["apps/mobile/android/app/src/main/java/com/possoftware/pos/printer/UsbTransport.kt", "2b72a9b30b55d0ba30ef5ad7fe8a77bc28a0a8a3fd39d47aca925f70d534a297"],
  ["apps/mobile/android/app/src/main/java/com/possoftware/pos/printer/TransportFactory.kt", "b64898010ea7b10b94911b367659b1b61d077d06309072f8fda5462da908c4bc"],
];

test("PIN (S1): the picture's files are byte for byte as at the spec commit d21ee37", () => {
  const root = path.join(process.cwd(), "..", "..");
  for (const [file, sha256] of PICTURE_FILES) {
    const actual = createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex");
    assert.equal(actual, sha256, `${file} is unchanged`);
  }
  assert.equal(PICTURE_FILES.length, 43, "every picture file is pinned");
});
