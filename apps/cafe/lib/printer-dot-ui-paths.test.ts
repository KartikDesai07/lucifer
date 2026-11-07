// Source pins for the top-bar printer dot (Bluetooth-print plan, W5a): the
// header button, its narrow inputs, the pulse provider's dot context and the
// status card (PX-2 Task 6: the banner went). Raw bytes (comments included) for every absence check, each
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
const CARD = "components/print/PrinterStatusCard.tsx";
const PANEL = "components/print/PrinterPanel.tsx"; const FOCUS = "hooks/use-printer-panel-focus.ts";
const CONNECT_OUTCOME = "components/print/connect-outcome.ts";
const CLASSES = "components/print/printer-classes.ts";
const FRAME = "components/print/PrinterPanelFrame.tsx";
const DOT_LIB = "lib/printer/printer-dot.ts";
const VIEW_LIB = "lib/printer/printer-status-view.ts";
const ALL_FILES = [HEADER, PROVIDER, DOT_CONTEXT, BUTTON, CARD, PANEL, CONNECT_OUTCOME, CLASSES, DOT_LIB];

const POS_PULSE_CTX = "usePosPulse" + "Context";
const CONSOLE_CALL = /\bconsole\s*\./;
const CAFE_NAME = "luci" + "fer";
const PROVIDER_MAX_LINES = 300;
const BUTTON_MAX_LINES = 120;
const CARD_MAX_LINES = 120;
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
    // U0 Task 3 (values 2.5, design 5.3): the HTML's page header. On a phone the menu button (ruling R5, until the tab
    // bar) and the mini logo come first; then the title block, the page's own actions, and our global buttons in the
    // design's order: Tables, New order, Refresh, Tokens, the printer button last (where the HTML has it).
    // U0 Task 4: the phone's menu button went with the tab bar (the phone's nav); the mini logo leads.
    // U1 Task 1 (design 6.1): on /pos the clock block sits after the actions box, before Refresh; the printer button
    // hands its dot's tone to it (onToneChange).
    name: "Header order: (phone) mini logo, title block, page actions, Tables, New order, (/pos) the clock, Refresh, Tokens, printer",
    file: HEADER,
    check: (src) => {
      assert.ok(!src.includes("PhoneMenuButton"), "no phone menu button (the tab bar is the phone's nav)");
      ascending(src, [
        "<BrandTile",
        "<HeaderTitle",
        "ref={actionsRef}",
        "<HeaderQuickTabs />",
        "<PosHeaderClock",
        "<RefreshButton />",
        "<TokenSheet />",
        "<PrinterStatusButton",
      ]);
      ascending(read("components/layout/HeaderQuickTabs.tsx"), ['title: "Tables"', 'title: "New order"']);
      // s63 smoke: a 60-char name at 768 px pushed the button off-screen (its min-content widened the page) — the
      // title block is the HTML's flex:1 + min-width:0, so a long title shrinks instead of pushing the buttons off.
      assert.match(read("components/layout/HeaderTitle.tsx"), /data-ui="header-title-block" className="min-w-0 flex-1"/, "the title block takes the free width and may shrink");
      assert.match(src, /import \{ PrinterStatusButton \} from "@\/components\/print\/PrinterStatusButton";/);
    },
    mutate: (src) => src.replace("<RefreshButton />", "").replace("</header>", "<RefreshButton /></header>"),
  },
  {
    // Fix round 1: the actions box is min-w-0, so a page's wide actions never push the printer button off at 720px.
    name: "Header is the HTML's sticky 56px bar (min-h-14 sticky top-0), its actions box may shrink (min-w-0)",
    file: HEADER,
    check: (src) => {
      assert.match(src, /<header className="sticky top-0 [^"]*\bmin-h-14\b/);
      assert.match(src, /data-ui="header-actions"[^>]*className="flex min-w-0 /, "the actions box is min-w-0");
    },
    mutate: (src) => src.replace('className="flex min-w-0 ', 'className="flex '),
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
    // U0 Task 3 fix round 1 (values 2.5, design 5.3): the header dot is the HTML's ok green or warn orange.
    name: "button dot span is aria-hidden and only drawn when the tone is not none (a checking printer draws nothing)",
    file: BUTTON,
    check: (src) => {
      assert.match(src, /\{tone !== "none" && \(\s*<span\s+aria-hidden="true"\s+className=\{cn\(PRINTER_DOT_CLASS,/);
      assert.match(src, /data-printer-dot=\{tone\}/);
      // Printing Phase 5 (spec 5.10, deliberate change): offline the dot is the warn one ("red" draws the warn class).
      assert.ok(src.includes('const tone = offlineHeader !== null ? "red" : printerDotTone(dot);'), "the tone attribute is none / green / red, from the lib's printerDotTone(");
      assert.ok(src.includes('tone === "green" ? PRINTER_DOT_OK_CLASS : PRINTER_DOT_WARN_CLASS'), "green draws the ok class, anything else the warn one");
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
    // U5 Task 5 (printer P8): the button hands its open state and itself (the trigger) to the frame. PX-2 Task 6 (on purpose,
    // spec §6.1): it keeps the sheet's view (status on every open, reset on close) and hands the frame the title and the back (PX-3 Task 11: from use-printer-views).
    name: "the button opens PrinterPanelFrame (its trigger) around PrinterPanel with its view; the frame holds the title, the back and a Done that closes",
    file: BUTTON,
    check: (src) => {
      assert.match(src, /<PrinterPanelFrame\s+open=\{open\}\s+onOpenChange=\{openChange\}\s+\{\.\.\.printerFrameOf\(view, connect, show\)\}\s+trigger=\{[\s\S]*\}\s*>\s*<PrinterPanel view=\{view\} onView=\{show\} connect=\{connect\} onConnect=\{startConnect\} onConnectEvent=\{send\} onClose=\{\(\) => setOpen\(false\)\} \/>\s*<\/PrinterPanelFrame>/, "the frame (its trigger, each view's head and foot from printerFrameOf) around the panel with the button's views and close");
      assert.match(src, /const openChange = \(next: boolean\): void => \{\s*if \(next\) show\("status"\);\s*setOpen\(next\);\s*\};/, "status on every open, never on close (Ruling Q)");
      assert.ok(['export const STATUS_TITLE = "Printer";', 'export const SETTINGS_TITLE = "Printer settings";', 'if (view === "settings") return { title: SETTINGS_TITLE, onBack: () => show("status") };'].every((n) => read("hooks/use-printer-views.ts").includes(n)), "the titles, the settings view's back (PX-3 Task 11, on purpose: the views' hook holds each view's head)");
      assert.ok(/import \{ PrinterPanel \} from "@\/components\/print\/PrinterPanel";/.test(src) && /import \{ PrinterPanelFrame \} from "@\/components\/print\/PrinterPanelFrame";/.test(src), "the panel and its frame");
      const frame = read(FRAME);
      assert.ok(frame.includes('DESCRIPTION = "Printing on this device"') && frame.includes('BACK_LABEL = "Back to printer status"'), "the frame's words");
      assert.ok(/<DialogPrimitive\.Trigger asChild>\{trigger\}<\/DialogPrimitive\.Trigger>/.test(frame) && /<DialogPrimitive\.Title [^>]*>\{title\}<\/DialogPrimitive\.Title>/.test(frame), "the trigger, the view's title");
      assert.match(frame, /<DialogPrimitive\.Description className="sr-only">\{DESCRIPTION\}<\/DialogPrimitive\.Description>/, "the description for screen readers only");
      assert.match(frame, /<DialogPrimitive\.Close data-ui="printer-panel-done"[^>]*>\s*Done\s*<\/DialogPrimitive\.Close>/, "Done closes the frame");
    },
    mutate: (src) => src.replace("<PrinterPanel view={view} onView={show} connect={connect} onConnect={startConnect} onConnectEvent={send} onClose={() => setOpen(false)} />", "<PrinterPanel />"),
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
    // PX-2 Task 6 (on purpose): the banner became the status card (spec §6.2), prop-driven: the words, busy, two callbacks.
    name: "status card: role=status aria-live=polite, exact props, aria-hidden circle, at most one fixing Button",
    file: CARD,
    check: (src) => {
      assert.match(src, /role="status" aria-live="polite"/);
      assert.ok(src.includes("{ view: PrinterStatusView; busy: boolean; onAction: (kind: StatusActionKind) => void; onLink: (kind: StatusLinkKind) => void }"));
      assert.match(src, /<span aria-hidden="true" className=\{cn\(PRINTER_STATUS_CIRCLE_CLASS, /, "the 40px circle is decoration (aria-hidden)");
      assert.equal(src.split("<Button").length - 1, 1, "at most ONE fixing button");
      assert.ok(src.includes("PRINTER_BUTTON_FIX_CLASS"), "the fix button is the 44px full-width one (shared class)");
      assert.ok(!src.includes(POS_PULSE_CTX), "the card takes its words as props");
    },
    mutate: (src) => src.replace('role="status" aria-live="polite"', ""),
  },
  {
    // Re-anchored 2026-10-02 (W-U), moved to the card in PX-2 Task 6: "checking" claims no colour; ok and bad differ in glyph.
    name: "status card circle: checking is a neutral spinner (no status colour); ok and bad carry different glyphs and tones",
    file: CARD,
    check: (src) => {
      assert.ok(src.includes('const checking = view.tone === "checking";'), "landmark: the checking branch");
      assert.ok(src.includes('checking ? PRINTER_TILE_NEUTRAL_CLASS : view.tone === "ok" ? PRINTER_TILE_OK_CLASS : PRINTER_TILE_BAD_CLASS'), "checking draws the neutral tone, never ok/bad");
      assert.ok(src.includes('checking ? Loader2 : view.tone === "ok" ? Check : Bang'), "glyphs: spinner / check / the hand-drawn exclamation");
      assert.ok(src.includes('checking && "motion-safe:animate-spin"'), "the spinner respects reduced motion");
    },
    mutate: (src) => src.replace('checking ? PRINTER_TILE_NEUTRAL_CLASS : view.tone === "ok"', 'view.tone === "ok"'),
  },
  {
    // PX-2 Task 6 (spec §6.5, §6.6): Reconnect = reconnectDown (its first call inside the click); setup fixes switch view, then focus (PX-3 Task 10, a pure move: in the focus hook).
    name: "panel fixes: Reconnect runs straight from the click through reconnectDown; setup fixes focus targets INSIDE this panel",
    file: PANEL,
    check: (src) => {
      assert.match(src, /if \(statusView\.action\?\.kind !== "reconnect"\) return;[\s\S]{0,600}const run = statusView\.subject\.length === 0 \? toastConnectOutcome\(devicePrinter\(\)\.reconnect\(\)\) : reconnectDown\(statusView\.subject, RECONNECT_DEPS\)\.then\(sayReconnected\);\s*setBusy\(true\);/, "only on a Reconnect row; an empty subject keeps today's toastConnectOutcome (Ruling P), printers mode reconnectDown; the first call is made before anything is awaited");
      assert.ok(src.includes("const RECONNECT_DEPS = { device: () => devicePrinter().reconnect(), native: (id: string) => nativePool().reconnect(id) };"), "the device's own printer, or the app's printer by its id");
      assert.ok(!/await (devicePrinter|nativePool|reconnectDown)/.test(src) && !src.includes("setTimeout"), "no deferral between the click and the first reconnect");
      // The PX-3 polish (on purpose): the device card's selector lives in the focus hook (it also takes the focus when /printers
      // leaves its connect view); the panel imports that one copy.
      assert.ok(read(FOCUS).includes(`export const DEVICE_SECTION_SELECTOR = '[data-printer-target="device"]'`) && src.includes("import { DEVICE_SECTION_SELECTOR, usePrinterPanelFocus }") && src.includes(`DESIGNATE_SELECTOR = '[data-action="designate"]'`) && !src.includes('"#printer-device"') && !src.includes("document.querySelector"), "the two targets; W-P: never a page-wide lookup");
      assert.ok(/const target = root\?\.querySelector<HTMLElement>\(selector\) \?\? null;/.test(read(FOCUS)) && /scrollIntoView\(/.test(read(FOCUS)) && !read(FOCUS).includes("document.querySelector"), "looked up inside the panel's root, then shown");
      assert.match(read(FOCUS), /pendingTarget\.current = selector;\s*onView\?\.\("settings"\);/, "a setup fix switches to the settings view first");
      assert.match(src, /if \(kind === "printer-setup"\) \{\s*onClose\?\.\(\);\s*navigateTo\(router, "\/printers"\);/, "an admin's link closes the sheet, then opens Printer setup (the review's Important 1)");
    },
    mutate: (src) => src.replace("toastConnectOutcome(devicePrinter().reconnect())", "Promise.resolve().then(() => toastConnectOutcome(devicePrinter().reconnect()))"),
  },
  {
    // W-Q, moved to the card and the panel in PX-2 Task 6 (F-M5): one toast at the end, none when every chooser was closed.
    name: "Reconnect (W-Q): disabled while running with Reconnecting…, one toast at the end, a closed chooser says nothing",
    file: PANEL,
    check: (src) => {
      assert.ok(/void run\.finally\(\(\) => setBusy\(false\)\);/.test(src) && src.includes('import { toastConnectOutcome } from "@/components/print/connect-outcome";'), "both ways end the busy state (neither rejects): never stuck");
      assert.match(src, /if \(result\.connected\.length === 0 && result\.failed\.length === 0\) return;\s*const \{ tone, text \} = reconnectToastOf\(result\);/, "F-M5");
      const card = read(CARD);
      assert.ok(card.includes("disabled={busy}") && card.includes("RECONNECTING_LABEL") && card.includes('const reconnecting = busy && action?.kind === "reconnect";'), "the card's button waits and says so");
    },
    mutate: (src) => src.replace("if (result.connected.length === 0 && result.failed.length === 0) return;", ""),
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
    // PX-2 Task 6 (on purpose): was "the banner disables a fix with a visible reason"; the words now offer none (spec §6.4).
    name: "another tab owns the printer: the status words offer no fix that acts on it",
    file: VIEW_LIB,
    check: (src) => {
      assert.ok(src.includes('if (i.localStatus === "elsewhere") return null;'), "a printing device offline: no Reconnect of a printer in another tab");
      assert.match(src, /case "printer-elsewhere":\s*return bad\("Printer in another tab", "Print from that tab, or close it\."\);/, "no button");
    },
    mutate: (src) => src.replace('if (i.localStatus === "elsewhere") return null;', ""),
  },
  {
    // U0 Task 3: the HTML's 36px outline printer button with a 17px icon, the same size on touch (ruling R1: the shell
    // takes the HTML's sizes on touch screens too), and its 10px dot at top/right -3px with a 2px surface ring. The dot
    // keeps today's tone rules (green ok, red a problem) in the theme's ok / bad colours.
    name: "printer-classes: the HTML's 36px button and 10px dot (no touch enlargement), and the 44px action and input",
    file: CLASSES,
    check: (src) => {
      assert.ok(src.includes('PRINTER_ICON_BUTTON_CLASS = "relative h-9 w-9 flex-none px-1.5 py-px [&_svg]:size-[17px]"'), "36x36 with a button's 1px 6px padding, a 17px icon");
      assert.ok(!/PRINTER_ICON_BUTTON_CLASS = "[^"]*pointer-coarse:/.test(src), "no touch enlargement in the header (R1)");
      assert.ok(src.includes('PRINTER_ACTION_CLASS = "h-11 px-4 text-base"'));
      assert.ok(src.includes('PRINTER_INPUT_CLASS = "h-11 text-base md:text-base"'), "W-R: md:text-sm in the shared Input must not win");
      assert.ok(
        src.includes('PRINTER_DOT_CLASS = "absolute -right-[3px] -top-[3px] size-2.5 rounded-[50%] [box-shadow:0_0_0_2px_var(--card)]"'),
        "the HTML's dot: 10px at top/right -3px, a 2px ring in the surface colour",
      );
      assert.ok(src.includes("PRINTER_DOT_OK_CLASS = STATUS_CLASSES.ok.dot;"), "the header dot when printing works: the HTML's --ok green");
      assert.ok(src.includes("PRINTER_DOT_WARN_CLASS = STATUS_CLASSES.warn.dot;"), "the header dot when it does not: the HTML's --warn orange");
      assert.ok(src.includes("PRINTER_DOT_BAD_CLASS = STATUS_CLASSES.bad.dot;"), "the Printer setup page's own dots keep red for a problem");
    },
    mutate: (src) => src.replace('[&_svg]:size-[17px]"', '[&_svg]:size-[17px] pointer-coarse:h-11"'),
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

test("budgets: provider <= 300, button and status card small, dot lib <= 300", () => {
  assert.ok(lines(read(PROVIDER)) <= PROVIDER_MAX_LINES, `provider is ${lines(read(PROVIDER))} lines`);
  assert.ok(lines(read(BUTTON)) <= BUTTON_MAX_LINES, `button is ${lines(read(BUTTON))} lines`);
  assert.ok(lines(read(CARD)) <= CARD_MAX_LINES, `the status card is ${lines(read(CARD))} lines`);
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
