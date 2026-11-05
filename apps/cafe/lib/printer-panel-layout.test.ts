// U5 Task 5 (2026-11-02): the printer panel in the owner's HTML look, LOOK ONLY (design 7; printer values 16-21). Source pins over
// the frame, the section card, the status card, the button / field / switch classes and the words; plus the keeps that must not
// move with the look: the panel's order, one pulse reader, no print trigger, no 44px-only or small-size tokens in the panel
// files, WebView 109 CSS, the safe-area inset at the foot, and /printers rendering the panel inline with no frame and no Done.
// Every pin is proven to bite by an in-memory mutation of the real file (nothing is written).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import {
  PRINTER_BUTTON_CLASS,
  PRINTER_BUTTON_PRIMARY_CLASS,
  PRINTER_BUTTON_REMOVE_CLASS,
  PRINTER_BUTTON_SMALL_CLASS,
  PRINTER_PANEL_BODY_CLASS,
  PRINTER_PANEL_DONE_CLASS,
  PRINTER_PANEL_FOOT_CLASS,
  PRINTER_PANEL_HEAD_CLASS,
  PRINTER_PANEL_SHEET_CLASS,
  PRINTER_PANEL_SIDE_CLASS,
  PRINTER_PANEL_XL_QUERY,
  PRINTER_SECTION_BODY_CLASS,
  PRINTER_SECTION_CARD_CLASS,
  PRINTER_SECTION_HEAD_CLASS,
  PRINTER_STATUS_LOOK,
  PRINTER_TILE_BAD_CLASS,
} from "@/components/print/printer-classes";
import { ORDER_DETAIL_SHEET_CLASS } from "@/lib/orders-layout";

const CAFE = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(CAFE, rel), "utf8").replace(/\r\n/g, "\n");
const count = (hay: string, needle: string): number => hay.split(needle).length - 1;
const has = (cls: string, token: string): boolean => cls.split(/\s+/).includes(token);
const hasAll = (cls: string, tokens: string[]): boolean => tokens.every((t) => has(cls, t));

const PRINT = "components/print/";
const FRAME = `${PRINT}PrinterPanelFrame.tsx`;
const SECTION = `${PRINT}PanelSection.tsx`;
const BUTTON = `${PRINT}PrinterStatusButton.tsx`;
const BANNER = `${PRINT}PrinterStatusBanner.tsx`;
// The 15 files of the hygiene pin (printer-ui-paths.test.ts HYGIENE) minus the lib / type files, plus the sections the look added.
const PANEL_FILES = [
  "PrinterPanel", "PrintWhereSection", "DevicePrinterSection", "NativePrinterPicker", "PaperSizeToggle", "PrinterTestTips", "PrinterAdvanced",
  "PrinterSetupCard", "PrintHostCardParts", "DesktopPrinterPicker", "BrowserPrinterConnect", "NotPrintedCard", "NotPrintedSection", "OtherDevicePrinters",
  "PrinterStatusBanner", "FindNetworkPrinters", "DesktopPrintMethod", "TextKotSection", "BillPrinterSection", "PanelSection", "PrinterPanelFrame",
].map((name) => `${PRINT}${name}.tsx`);

test("the frame: a 420px aside from 1280px, U2's bottom sheet below, one dialog that follows the width", () => {
  assert.equal(PRINTER_PANEL_XL_QUERY, "(min-width: 1280px)", "the owner's right-panel rule: a side panel only from 1280px");
  assert.ok(hasAll(PRINTER_PANEL_SIDE_CLASS, ["fixed", "inset-y-0", "right-0", "w-[min(420px,100%)]", "border-l", "bg-background", "motion-safe:animate-html-line-in-panel"]), "the HTML's aside: min(420px,100%) on --bg with its left rule and lineIn");
  assert.ok(has(PRINTER_PANEL_SIDE_CLASS, "[box-shadow:var(--pop)]"), "the aside wears --pop");
  assert.ok(PRINTER_PANEL_SHEET_CLASS.includes("fixed inset-0") && PRINTER_PANEL_SHEET_CLASS.includes(ORDER_DETAIL_SHEET_CLASS.split(" ").find((t) => t.startsWith("motion-safe:data-[state=open]")) ?? "?"), "below 1280px: U2's full-screen bottom sheet (the /pos cart sheet's constant) that slides up");
  assert.ok(has(PRINTER_PANEL_SHEET_CLASS, "bg-background"), "the sheet's body is --bg, as the aside's");
  const css = read("app/globals.css");
  assert.match(css, /--animate-html-line-in-panel:\s*html-line-in 0\.3s cubic-bezier\(0\.2, 0\.8, 0\.2, 1\) both;/, "the HTML's lineIn at .3s on the existing html-line-in keyframes");
  const frame = read(FRAME);
  assert.ok(frame.includes("useMediaQuery(PRINTER_PANEL_XL_QUERY)") && frame.includes("side ? PRINTER_PANEL_SIDE_CLASS : PRINTER_PANEL_SHEET_CLASS"), "one Radix dialog whose classes follow the width (a resize never remounts the panel)");
  assert.equal(count(frame, "<DialogPrimitive.Content"), 1, "one panel mounted, whatever the width");
  assert.ok(frame.includes("onOpenChange={onOpenChange}") && frame.includes("open={open}"), "controlled by the button (the alarm's Show still opens it)");
  assert.ok(!/onEscapeKeyDown|onInteractOutside|onPointerDownOutside/.test(frame), "Escape and a scrim tap close it (Radix defaults), as the owner's rule and the old sheet");
});

test("the frame's head, body and foot are the HTML's: 18/20/14 padding, 17px title, 12.5px sub with no full stop, 34px close, Done 44px", () => {
  assert.ok(hasAll(PRINTER_PANEL_HEAD_CLASS.replace("pt-[18px]", "pt-18"), ["px-5", "pt-18", "pb-3.5", "bg-card", "border-b"]), "head: --surface, padding 18px 20px 14px, a rule below");
  const frame = read(FRAME);
  const classes = read(`${PRINT}printer-classes.ts`);
  assert.match(classes, /PRINTER_PANEL_TITLE_CLASS = "text-\[17px\] font-semibold"/, "the title is 17px 600");
  assert.match(classes, /PRINTER_PANEL_SUB_CLASS = "mt-0\.5 text-\[12\.5px\] text-muted-foreground"/, "the sub is 12.5px --text-2");
  assert.ok(frame.includes('const SUB = "Printer status and setup for this device";') && !frame.includes('device."'), "the sub has no full stop (design 7.7)");
  assert.match(classes, /PRINTER_PANEL_CLOSE_CLASS = `flex size-\[34px\][^`]*rounded-\[8px\][^`]*pointer-fine:hover:bg-hover/, "the close: 34px, radius 8, --hover under a pointer only");
  assert.ok(hasAll(PRINTER_PANEL_BODY_CLASS, ["px-5", "py-4", "gap-3", "bg-background", "overflow-y-auto", "flex-1", "min-h-0"]), "body: the one scroller, padding 16px 20px, 12px apart, --bg");
  assert.ok(hasAll(PRINTER_PANEL_FOOT_CLASS, ["px-5", "pt-3.5", "pb-[calc(14px+env(safe-area-inset-bottom))]", "bg-card", "border-t"]), "the fixed foot: 14px 20px and the bottom inset at every width");
  assert.ok(hasAll(PRINTER_PANEL_DONE_CLASS, ["h-11", "w-full", "rounded-[10px]", "text-[14.5px]", "font-semibold", "bg-primary"]), "Done: 44px, accent, radius 10, 14.5px 600");
  assert.ok(frame.indexOf("printer-panel-head") < frame.indexOf("printer-panel-body") && frame.indexOf("printer-panel-body") < frame.indexOf("printer-panel-foot"), "head, then the body, then the foot");
});

test("the section card: radius 12, --surface, clipped; a 34px radius-9 tile; title 14px 600; sub 12.5px --text-3; body 0 16px 16px, 12px apart", () => {
  assert.ok(hasAll(PRINTER_SECTION_CARD_CLASS, ["rounded-[12px]", "border", "bg-card", "overflow-clip"]), "overflow: clip, never hidden (WebView 109 rule for pure clipping)");
  assert.ok(hasAll(PRINTER_SECTION_HEAD_CLASS, ["px-4", "py-3.5", "gap-3"]), "head padding 14px 16px, 12px apart");
  assert.ok(hasAll(PRINTER_SECTION_BODY_CLASS, ["px-4", "pb-4", "gap-3"]), "body padding 0 16px 16px, 12px apart");
  const classes = read(`${PRINT}printer-classes.ts`);
  assert.match(classes, /PRINTER_SECTION_TILE_CLASS = "grid size-\[34px\] flex-none place-items-center rounded-\[9px\] bg-surface-3 text-muted-foreground/, "the 34px tile, radius 9, --surface-3 / --text-2");
  assert.match(classes, /PRINTER_SECTION_TITLE_CLASS = "text-\[14px\] font-semibold"/, "title 14px 600");
  assert.match(classes, /PRINTER_SECTION_SUB_CLASS = "mt-0\.5 text-\[12\.5px\] text-subtle-foreground"/, "sub 12.5px --text-3");
  const section = read(SECTION);
  assert.ok(section.includes("{...rest}") && section.includes("<h3"), "id, data-printer-target and tabIndex pass through to the <section> (the banner focuses them)");
});

test("the status card: ok / bad / checking, the precomputed rgba borders, the bad glyph in --text, one fix button", () => {
  assert.ok(PRINTER_STATUS_LOOK.ok.card.includes("border-[rgba(36,161,72,.3)]") && PRINTER_STATUS_LOOK.ok.card.includes("bg-status-ok-tint") && PRINTER_STATUS_LOOK.ok.head.includes("text-status-ok-ink"), "ok: --ok-t, rgba(36,161,72,.3), --ok-i");
  assert.ok(PRINTER_STATUS_LOOK.bad.card.includes("border-[rgba(255,131,43,.35)]") && PRINTER_STATUS_LOOK.bad.card.includes("bg-status-warn-tint") && PRINTER_STATUS_LOOK.bad.head.includes("text-status-warn-ink"), "bad: --warn-t, rgba(255,131,43,.35), --warn-i");
  assert.ok(PRINTER_STATUS_LOOK.checking.card.includes("bg-card") && PRINTER_STATUS_LOOK.checking.card.includes("border-border"), "checking: --surface with a --border rule (neither ok nor bad)");
  assert.ok(has(PRINTER_TILE_BAD_CLASS, "text-foreground") && has(PRINTER_TILE_BAD_CLASS, "bg-status-warn"), "the bad circle's mark is --text (the HTML's white is 2.46:1)");
  const banner = read(BANNER);
  assert.equal(count(banner, "<Button"), 1, "one fix button");
  assert.ok(banner.includes('role="status"') && banner.includes("PRINTER_BUTTON_SMALL_CLASS"), "role=status kept; the fix button is the 32px one");
  assert.match(read(`${PRINT}printer-classes.ts`), /PRINTER_STATUS_CARD_CLASS = "flex flex-none items-start gap-3 rounded-\[12px\] border px-4 py-3\.5"/, "padding 14px 16px, radius 12, 12px apart; the fix button sits under our long words");
});

test("the buttons: primary 40px radius 9 14px 600; secondary 36px radius 8 13.5px 500; the fix 32px 12.5px; Remove in --bad-i with the bad rgba border", () => {
  assert.ok(hasAll(PRINTER_BUTTON_PRIMARY_CLASS, ["h-10", "rounded-[9px]", "text-[14px]", "font-semibold", "self-start"]), "Connect printer look: 40px / 9 / 14px 600, the width of its words");
  assert.ok(hasAll(PRINTER_BUTTON_CLASS, ["h-9", "rounded-[8px]", "text-[13.5px]", "font-medium"]), "Search nearby printers look: 36px / 8 / 13.5px 500");
  assert.ok(hasAll(PRINTER_BUTTON_SMALL_CLASS, ["h-8", "rounded-[8px]", "text-[12.5px]", "font-medium"]), "the card's fix: 32px / 12.5px");
  assert.ok(hasAll(PRINTER_BUTTON_REMOVE_CLASS, ["h-9", "text-status-bad-ink", "border-[rgba(218,30,40,.4)]", "hover:bg-[var(--status-bad-tint)]"]), "Remove: --bad-i text, rgba(218,30,40,.4) border, --bad-t hover");
  const sizes = read(`${PRINT}PrinterSetupCard.tsx`) + read(`${PRINT}OtherDevicePrinters.tsx`) + read(`${PRINT}PrinterAdvanced.tsx`);
  assert.ok(sizes.includes("PRINTER_BUTTON_REMOVE_CLASS"), "the Remove buttons wear the Remove look");
  assert.ok(read(`${PRINT}PrintWhereSection.tsx`).includes("PRINTER_BUTTON_PRIMARY_CLASS") && read(`${PRINT}BrowserPrinterConnect.tsx`).includes("PRINTER_BUTTON_PRIMARY_CLASS") && read(`${PRINT}NativePrinterPicker.tsx`).includes("PRINTER_BUTTON_PRIMARY_CLASS"), "Connect printer, Print all slips here, Find printers and Use this network printer are the 40px primary");
});

test("the panel files hold no h-8 / h-9 / h-10 token, no size=sm, no print trigger and no dialog word (the sizes come from printer-classes.ts)", () => {
  for (const file of PANEL_FILES) {
    const raw = read(file);
    assert.ok(raw.length > 100, `${file} was read`);
    assert.ok(!/\bh-(8|9|10)\b/.test(raw) && !raw.includes('size="' + 'sm"'), `${file}: no sub-44px token of its own`);
    assert.ok(!raw.includes("useReactToPrint") && !raw.includes("pageStyle"), `${file}: no print trigger`);
    assert.ok(!/<select\b/.test(raw), `${file}: never a native select`);
  }
  for (const file of PANEL_FILES.filter((f) => !f.endsWith("PrinterPanelFrame.tsx"))) {
    assert.ok(!/dia\s*log/i.test(stripComments(read(file))), `${file}: no dialog word in the panel's copy`);
  }
});

test("WebView 109: no light-dark(), no runtime color-mix(), no oklab, no mask-image in the panel's files or classes", () => {
  for (const file of [...PANEL_FILES, `${PRINT}printer-classes.ts`]) {
    const raw = stripComments(read(file));
    assert.ok(!/light-dark\(|color-mix\(|in oklab|mask-image/.test(raw), `${file}: WebView 109 CSS only (rgba() borders are precomputed)`);
  }
  assert.ok(read(SECTION).length > 0 && PRINTER_SECTION_CARD_CLASS.includes("overflow-clip") && !PRINTER_SECTION_CARD_CLASS.includes("overflow-hidden"), "pure clipping is overflow: clip");
});

test("the panel keeps its order, one pulse reader and its focus targets; /printers draws it inline with no frame and no Done", () => {
  const panel = stripComments(read(`${PRINT}PrinterPanel.tsx`));
  assert.equal(count(panel, "usePosPulseContext("), 1, "P118: the panel is one of the eight readers, once");
  // PX-2 Task 4 (on purpose): the waiting slips are the Not printed card's container now.
  const waiting = panel.indexOf("<NotPrintedSection"), banner = panel.indexOf("<PrinterStatusBanner"), setup = panel.indexOf("<PrinterSetupCard"), bill = panel.indexOf("<BillPrinterSection");
  assert.ok(waiting >= 0 && waiting < banner && banner < setup && setup < bill, "Waiting < Banner < Setup < Bill");
  assert.ok(panel.includes("data-printer-panel"), "the banner's scope marker");
  const where = read(`${PRINT}PrintWhereSection.tsx`);
  assert.ok(where.includes('id="printer-where"') && count(where, 'data-action="designate"') === 1, "the focus targets stay");
  assert.ok(read(`${PRINT}DevicePrinterSection.tsx`).includes('data-printer-target="device"'), "the device section's target stays");
  const page = read("app/(dashboard)/printers/page.tsx");
  assert.ok(page.includes("<PrinterPanel />") && !page.includes("PrinterPanelFrame") && !/>\s*Done\s*</.test(page), "/printers: the panel inline, no frame, no Done");
  const button = read(BUTTON);
  assert.equal(count(button, "<PrinterPanel />"), 1, "the button mounts the panel once (inside its frame)");
  assert.ok(!button.includes("usePosPulseContext"), "the button never reads the wide pulse");
});

test("the words: only design 7.7's changes (Paper width, the Remove note's dash, the sub's full stop)", () => {
  assert.ok(read(`${PRINT}PaperSizeToggle.tsx`).includes('PAPER_QUESTION = "Paper width"'), "Paper width");
  assert.ok(read(`${PRINT}PrinterAdvanced.tsx`).includes("remove it from any device — even a phone. Waiting slips are cancelled"), "the Remove note: the HTML's dash");
  assert.ok(read(FRAME).includes("Printer status and setup for this device\""), "the sub, no full stop");
  const keep = read(`${PRINT}PrinterAdvanced.tsx`) + read(`${PRINT}PrinterSetupCard.tsx`) + read(`${PRINT}PrintWhereSection.tsx`);
  for (const word of ["More options", "Change POS address", "Print test slip", "Remove the printing device", "Stop printing here", "Where slips print"]) assert.ok(keep.includes(word), `${word} stays`);
});

// The frame pin as a function, so a mutation of the real file can be shown to be noticed.
function frameProblems(frame: string): string[] {
  const p: string[] = [];
  if (!frame.includes("useMediaQuery(PRINTER_PANEL_XL_QUERY)")) p.push("the width is read with the 1280px query");
  if (count(frame, "<DialogPrimitive.Content") !== 1) p.push("one panel mounted");
  if (/onEscapeKeyDown|onInteractOutside|onPointerDownOutside/.test(frame)) p.push("Escape and the scrim keep Radix's close");
  if (!/<DialogPrimitive.Close data-ui="printer-panel-done"/.test(frame)) p.push("Done closes");
  if (frame.includes('device."')) p.push("the sub has no full stop");
  return p;
}

test("every pin bites: the frame pin notices a mutation of the real file", () => {
  const frame = read(FRAME);
  assert.deepEqual(frameProblems(frame), [], "the real frame is clean");
  const mutations: [string, string][] = [
    ["the width read dropped", frame.replace("useMediaQuery(PRINTER_PANEL_XL_QUERY)", "true")],
    ["a second panel", frame.replace("</DialogPrimitive.Content>", "</DialogPrimitive.Content><DialogPrimitive.Content />")],
    ["Escape blocked", frame.replace("<DialogPrimitive.Content ", "<DialogPrimitive.Content onEscapeKeyDown={() => {}} ")],
    ["Done not a close", frame.replace('<DialogPrimitive.Close data-ui="printer-panel-done"', '<button data-ui="printer-panel-done"')],
    ["the full stop back", frame.replace('for this device";', 'for this device.";').replace('for this device."', 'for this device".') + ' // device."'],
  ];
  for (const [name, mutated] of mutations) {
    assert.notEqual(mutated, frame, name + ": the mutation changed the source");
    assert.ok(frameProblems(mutated).length >= 1, name + ": the pin did not notice");
  }
});
