// Source pins for the top-bar printer dot (Bluetooth-print plan, W5a): the
// header button, its narrow inputs, the pulse provider's dot context and the
// status banner. Raw bytes (comments included) for every absence check, each
// pin paired with a positive landmark, and every pin proven to BITE by running
// it against an in-memory mutation of the real file (no file is ever written).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(CAFE_ROOT, rel), "utf8");
const count = (hay: string, needle: string): number => hay.split(needle).length - 1;
const lines = (src: string): number => src.replace(/\n$/, "").split("\n").length;

const HEADER = "components/layout/Header.tsx";
const PROVIDER = "components/layout/PosPulseProvider.tsx";
const DOT_CONTEXT = "components/layout/print-host-dot-context.ts";
const BUTTON = "components/print/PrinterStatusButton.tsx";
const BANNER = "components/print/PrinterStatusBanner.tsx";
const CONNECT_OUTCOME = "components/print/connect-outcome.ts";
const CLASSES = "components/print/printer-classes.ts";
const DOT_LIB = "lib/printer/printer-dot.ts";
const ALL_FILES = [HEADER, PROVIDER, DOT_CONTEXT, BUTTON, BANNER, CONNECT_OUTCOME, CLASSES, DOT_LIB];

const POS_PULSE_CTX = "usePosPulse" + "Context";
const CONSOLE_CALL = /\bconsole\s*\./;
const CAFE_NAME = "luci" + "fer";
const PROVIDER_MAX_LINES = 300;
const BUTTON_MAX_LINES = 120;
const BANNER_MAX_LINES = 120;
const LIB_MAX_LINES = 300;

interface PinCase {
  name: string;
  file: string;
  check: (src: string) => void;
  /** Must change the source in a way `check` rejects. */
  mutate: (src: string) => string;
}

function ascending(src: string, needles: string[]): void {
  let last = -1;
  for (const needle of needles) {
    const at = src.indexOf(needle);
    assert.ok(at >= 0, `landmark missing: ${needle}`);
    assert.ok(at > last, `${needle} must come after the previous landmark`);
    last = at;
  }
}

const PINS: PinCase[] = [
  {
    name: "Header order: SidebarTrigger, Separator, h1, the quick tabs, then the ml-auto wrapper holding PrinterStatusButton",
    file: HEADER,
    check: (src) => {
      ascending(src, ["<SidebarTrigger", "<Separator", "<h1", "<HeaderQuickTabs", 'className="ml-auto flex items-center"', "<PrinterStatusButton"]);
      // 2026-10-11 (owner): the row now carries the New Order + Tables tabs; the cafe name stays the screen-reader h1.
      assert.match(src, /<h1 className="sr-only">\{name\}<\/h1>/, "the cafe name stays the page's h1, visually hidden");
      // s63 smoke: a 60-char name at 768 px pushed the button off-screen (its min-content widened the page) — the
      // same guard now sits on the tabs' nav: contained, filling the row, each label truncating.
      const tabs = read("components/layout/HeaderQuickTabs.tsx");
      assert.match(tabs, /<nav aria-label="Quick links" className="[^"]*\bmin-w-0\b[^"]*\bflex-1\b[^"]*\[contain:inline-size\][^"]*"/, "the tabs are contained and fill the row");
      assert.match(tabs, /<span className="truncate">\{tab\.title\}<\/span>/, "a tab's label truncates instead of pushing the button off");
      assert.match(src, /import \{ PrinterStatusButton \} from "@\/components\/print\/PrinterStatusButton";/);
    },
    mutate: (src) => src.replace("<SidebarTrigger />", "").replace("</header>", "<SidebarTrigger /></header>"),
  },
  {
    name: "Header keeps its h-14 / sticky top-0 chrome and the ml-auto class",
    file: HEADER,
    check: (src) => {
      assert.match(src, /<header className="sticky top-0 [^"]*\bh-14\b/);
      assert.ok(src.includes("ml-auto"));
    },
    mutate: (src) => src.replace("ml-auto", "mr-auto"),
  },
  {
    name: "button name: aria-label AND title come from printerButtonName( (a variable), never a literal",
    file: BUTTON,
    check: (src) => {
      assert.ok(src.includes("printerButtonName("), "landmark: the name comes from printerButtonName(");
      assert.match(src, /aria-label=\{name\}/);
      assert.match(src, /title=\{name\}/);
      assert.ok(!/aria-label="/.test(src), "no literal aria-label");
      assert.ok(!/title="/.test(src), "no literal title");
    },
    mutate: (src) => src.replace("aria-label={name}", 'aria-label="Printer"'),
  },
  {
    // R2-W7: was "only drawn when dot.show" with the tone computed inline; a checking printer must draw no dot
    // (never red while it only connects), so the tone now comes from printerDotTone( and the dot follows the tone.
    name: "button dot span is aria-hidden and only drawn when the tone is not none (a checking printer draws nothing)",
    file: BUTTON,
    check: (src) => {
      assert.match(src, /\{tone !== "none" && \(\s*<span\s+aria-hidden="true"\s+className=\{cn\(PRINTER_DOT_CLASS,/);
      assert.match(src, /data-printer-dot=\{tone\}/);
      assert.ok(src.includes("const tone = printerDotTone(dot);"), "the tone attribute is none / green / red, from the lib's printerDotTone(");
      assert.ok(src.includes('tone === "green" ? PRINTER_DOT_OK_CLASS : PRINTER_DOT_BAD_CLASS'), "green draws the ok class, anything else drawn the bad one");
    },
    mutate: (src) => src.replace('aria-hidden="true"', ""),
  },
  {
    name: "button: a checking printer shows no dot -- the dot is gated on the tone, not on dot.show",
    file: BUTTON,
    check: (src) => {
      assert.ok(src.includes('{tone !== "none" && ('), "landmark: the span is gated on the tone");
      assert.ok(!/\{dot\.show && \(/.test(src), "never gated on dot.show alone (checking has show: true)");
    },
    mutate: (src) => src.replace('{tone !== "none" && (', "{dot.show && ("),
  },

  {
    name: "button reads narrow inputs only: usePrintHostDot() present, the wide pulse context absent",
    file: BUTTON,
    check: (src) => {
      assert.ok(src.includes("usePrintHostDot()"), "landmark: usePrintHostDot()");
      for (const hook of ["usePrintHostContext()", "useDevicePrinter()", "usePrintLane()", "useDeviceOnline()", "useDesktopPrinterChosen()"]) {
        assert.ok(src.includes(hook), `landmark: ${hook}`);
      }
      assert.ok(!src.includes(POS_PULSE_CTX), "the button must never reference the wide pulse context");
      assert.match(src, /printerDotOf\(\{[^}]*\bdesktopChosen\b[^}]*\}\)/, "W-L: the dot gets the desktop shell's printer choice");
    },
    mutate: (src) => `${src}\n// ${POS_PULSE_CTX}();\n`,
  },
  {
    name: "button landmark pin: dropping usePrintHostDot() is caught (the absence check is not blind)",
    file: BUTTON,
    check: (src) => assert.ok(src.includes("usePrintHostDot()")),
    mutate: (src) => src.replace("usePrintHostDot()", "usePrintHostDots()"),
  },
  {
    name: "SheetContent is side=right, scrolls, and renders PrinterPanel with a Done that closes the sheet",
    file: BUTTON,
    check: (src) => {
      assert.match(src, /<SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">[\s\S]*<PrinterPanel onDone=\{\(\) => setOpen\(false\)\} \/>[\s\S]*<\/SheetContent>/);
      assert.match(src, /import \{ PrinterPanel \} from "@\/components\/print\/PrinterPanel";/);
      assert.match(src, /<SheetTrigger asChild>/);
      assert.ok(src.includes('SHEET_TITLE = "Printer"') && src.includes('"Printer status and setup for this device."'));
      assert.match(src, /<SheetTitle>\{SHEET_TITLE\}<\/SheetTitle>/);
      assert.match(src, /<SheetDescription>\{SHEET_DESCRIPTION\}<\/SheetDescription>/);
    },
    mutate: (src) => src.replace("<PrinterPanel onDone={() => setOpen(false)} />", ""),
  },
  {
    name: "PosPulseProvider derives printHostDotOf( exactly once",
    file: PROVIDER,
    check: (src) => {
      assert.equal(count(src, "printHostDotOf("), 1);
      assert.ok(src.includes("const dot = printHostDotOf(data);"));
      assert.match(src, /usePosPulse\(\)/, "landmark: the provider still owns the single poll");
    },
    mutate: (src) => src.replace("const dot = printHostDotOf(data);", "const dot = printHostDotOf(data);\n  const dot2 = printHostDotOf(data);"),
  },
  {
    name: "PrintHostDotContext.Provider is the OUTERMOST provider (first opened, last closed)",
    file: PROVIDER,
    check: (src) => {
      assert.match(src, /return \(\s*<PrintHostDotContext\.Provider value=\{dot\}>\s*<PrintHostRoutingContext\.Provider value=\{routing\}>/);
      assert.match(src, /<\/PrintHostRoutingContext\.Provider>\s*<\/PrintHostDotContext\.Provider>\s*\);\s*\}\s*$/);
      assert.equal(count(src, "<PrintHostDotContext.Provider"), 1);
    },
    mutate: (src) => src.replace("<PrintHostDotContext.Provider value={dot}>", "<PrintHostRoutingContext.Provider value={routing}>"),
  },
  {
    name: "PosPulseProvider keeps the value literal and carries no useMemo",
    file: PROVIDER,
    check: (src) => {
      assert.ok(src.includes("value={{ pulse: data, soundUnlocked, unlock, printHandler, registerKotPrintHandler }}"));
      assert.ok(!src.includes("useMemo"));
    },
    mutate: (src) => src.replace("const dot = printHostDotOf(data);", "const dot = useMemo(() => printHostDotOf(data), [data]);"),
  },
  {
    name: "dot context throws outside the provider and defaults to null",
    file: DOT_CONTEXT,
    check: (src) => {
      assert.ok(src.includes("createContext<PrintHostDot | null>(null)"));
      assert.ok(src.includes('throw new Error("usePrintHostDot must be used inside <PosPulseProvider>");'));
      assert.ok(src.startsWith('"use client";'));
    },
    mutate: (src) => src.replace("<PrintHostDot | null>(null)", "<PrintHostDot>(\"ok\")"),
  },
  {
    name: "banner: role=status aria-live=polite, exact props, aria-hidden dot, one fix Button",
    file: BANNER,
    check: (src) => {
      assert.match(src, /role="status" aria-live="polite"/);
      assert.ok(src.includes("{ dot: PrinterDot & { show: true }; copy: PrinterHeadline }"));
      assert.match(src, /<span\s+aria-hidden="true"/);
      assert.match(src, /<span aria-hidden="true" className=\{cn\(PRINTER_TILE_CLASS, tone\)\}>/, "the status tile is decoration (aria-hidden)");
      assert.equal(count(src, "<Button"), 1, "at most ONE fix button");
      assert.ok(src.includes("PRINTER_ACTION_CLASS"), "the fix button is 44px (shared action class)");
      assert.ok(!src.includes(POS_PULSE_CTX), "the banner takes its copy as props");
    },
    mutate: (src) => src.replace('role="status" aria-live="polite"', ""),
  },
  {
    // Re-anchored 2026-10-02 (W-U): the small dot became a 36px icon tile; "checking" is a spinner on a
    // neutral tile (still no good/bad colour), ok/bad are the green/red tints with a distinct icon.
    name: "banner tile: checking is a neutral spinner (no status colour); ok and bad carry different icons and tints",
    file: BANNER,
    check: (src) => {
      assert.ok(src.includes('const checking = dot.reason === "checking";'), "landmark: the checking branch");
      assert.ok(src.includes("checking ? PRINTER_TILE_NEUTRAL_CLASS : dot.ok ? PRINTER_TILE_OK_CLASS : PRINTER_TILE_BAD_CLASS"), "checking draws the neutral tone, never ok/bad");
      assert.ok(src.includes("checking ? Loader2 : dot.ok ? CheckCircle2 : AlertCircle"), "icons: spinner / check / alert");
      assert.ok(src.includes('checking && "motion-safe:animate-spin"'), "the spinner respects reduced motion");
    },
    mutate: (src) => src.replace("checking ? PRINTER_TILE_NEUTRAL_CLASS : dot.ok", "dot.ok"),
  },
  {
    name: "banner fixes: reconnect runs straight from the click; setup and print-here focus targets INSIDE this panel",
    file: BANNER,
    check: (src) => {
      assert.match(src, /if \(kind === "reconnect"\) \{\s*setReconnecting\(true\);\s*void toastConnectOutcome\(devicePrinter\(\)\.reconnect\(\)\)/);
      assert.ok(!/await devicePrinter\(\)/.test(src) && !src.includes("setTimeout"), "no deferral between the click and reconnect()");
      assert.ok(src.includes(`'[data-printer-target="device"]'`) && src.includes(`'[data-action="designate"]'`));
      assert.ok(!src.includes('"#printer-device"') && !src.includes("document.querySelector"), "W-P: never a page-wide lookup");
      assert.match(src, /closest\(PANEL_SELECTOR\)/);
      assert.ok(src.includes('PANEL_SELECTOR = "[data-printer-panel]"'));
      assert.match(src, /scrollIntoView\(/);
      assert.match(src, /onClick=\{\(\) => runFix\(fix\)\}/);
    },
    mutate: (src) => src.replace("void toastConnectOutcome(devicePrinter().reconnect())", "setTimeout(() => void toastConnectOutcome(devicePrinter().reconnect()), 0)"),
  },
  {
    name: "banner Reconnect (W-Q): disabled while running, the outcome is toasted by the shared helper, and it cannot reject",
    file: BANNER,
    check: (src) => {
      assert.ok(src.includes("disabled={blocked || reconnecting}"));
      assert.ok(src.includes("RECONNECTING_LABEL"));
      assert.match(src, /\.finally\(\(\) => setReconnecting\(false\)\)/);
      assert.match(src, /import \{ toastConnectOutcome \} from "@\/components\/print\/connect-outcome";/);
    },
    mutate: (src) => src.replace("disabled={blocked || reconnecting}", "disabled={blocked}"),
  },
  {
    name: "connect-outcome helper: toasts success / failure, swallows a rejection, cancelled stays silent",
    file: CONNECT_OUTCOME,
    check: (src) => {
      assert.ok(src.includes("export async function toastConnectOutcome("));
      assert.ok(src.includes('outcome === "connected"') && src.includes('outcome === "failed"'));
      assert.match(src, /catch \(error\) \{\s*toast\.error\(/, "a thrown attempt becomes a toast, not an unhandled rejection");
      assert.ok(!src.includes('"cancelled"'), "a cancelled chooser says nothing");
    },
    mutate: (src) => src.replace("catch (error)", "catch (_error)"),
  },
  {
    name: "banner disables a fix with a visible reason when another tab owns the printer",
    file: BANNER,
    check: (src) => {
      assert.ok(src.includes('snapshot.status === "elsewhere"'));
      // The expression gained "|| reconnecting" (W-Q): the button is also pending while a reconnect runs.
      assert.ok(src.includes("disabled={blocked || reconnecting}"));
      assert.ok(src.includes("PRINTER_ELSEWHERE_MESSAGE"));
    },
    mutate: (src) => src.replace("disabled={blocked || reconnecting}", ""),
  },
  {
    name: "printer-classes: the 40px / 44px coarse button and the 44px action and input",
    file: CLASSES,
    check: (src) => {
      assert.ok(src.includes('PRINTER_ICON_BUTTON_CLASS = "relative h-10 w-10 pointer-coarse:h-11 pointer-coarse:w-11"'));
      assert.ok(src.includes('PRINTER_ACTION_CLASS = "h-11 px-4 text-base"'));
      assert.ok(src.includes('PRINTER_INPUT_CLASS = "h-11 text-base md:text-base"'), "W-R: md:text-sm in the shared Input must not win");
      assert.ok(src.includes("bg-green-600") && src.includes("bg-red-600") && src.includes("ring-2 ring-background"));
    },
    mutate: (src) => src.replace("pointer-coarse:h-11 pointer-coarse:w-11", "pointer-coarse:h-9"),
  },
  {
    name: "the dot lib imports neither the desktop-shell seam nor print-lane (the lane is a parameter)",
    file: DOT_LIB,
    check: (src) => {
      assert.ok(src.includes("export function printerDotOf("), "landmark: the lib is the real one");
      assert.ok(!/from\s+["']@\/lib\/desktop-shell["']/.test(src));
      assert.ok(!/from\s+["']@\/lib\/printer\/print-lane["']/.test(src));
    },
    mutate: (src) => `import { currentLane } from "@/lib/printer/print-lane";\n${src}`,
  },
];

for (const pin of PINS) {
  test(`PIN: ${pin.name}`, () => {
    const src = read(pin.file);
    assert.ok(src.length > 0, `${pin.file} must exist and be non-empty`);
    pin.check(src);
  });
}

test("every pin bites: its check rejects an in-memory mutation of the real file", () => {
  assert.ok(PINS.length >= 15, "the pin list is not empty");
  for (const pin of PINS) {
    const src = read(pin.file);
    const mutated = pin.mutate(src);
    assert.notEqual(mutated, src, `mutation for "${pin.name}" must change the source`);
    assert.throws(() => pin.check(mutated), Error, `pin "${pin.name}" did not catch its mutation`);
  }
});

test("budgets: provider <= 300, button and banner small, dot lib <= 300", () => {
  assert.ok(lines(read(PROVIDER)) <= PROVIDER_MAX_LINES, `provider is ${lines(read(PROVIDER))} lines`);
  assert.ok(lines(read(BUTTON)) <= BUTTON_MAX_LINES, `button is ${lines(read(BUTTON))} lines`);
  assert.ok(lines(read(BANNER)) <= BANNER_MAX_LINES, `banner is ${lines(read(BANNER))} lines`);
  assert.ok(lines(read(DOT_LIB)) <= LIB_MAX_LINES, `dot lib is ${lines(read(DOT_LIB))} lines`);
});

test("no console call and no cafe name in any dot file (raw bytes), with a landmark that the scan read real files", () => {
  for (const file of ALL_FILES) {
    const src = read(file);
    assert.ok(src.length > 100, `${file} was read`);
    assert.ok(!CONSOLE_CALL.test(src), `${file} must not call console.`);
    assert.ok(!src.toLowerCase().includes(CAFE_NAME), `${file} must not name the cafe`);
  }
  assert.ok(CONSOLE_CALL.test("x; console.log(1)"), "the console needle can match");
});
