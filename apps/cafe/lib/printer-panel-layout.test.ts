// U5 Task 5 (2026-11-02): the printer panel in the owner's HTML look, LOOK ONLY (design 7; printer values 16-21). Source pins over
// the frame, the section card, the status card, the button / field / switch classes and the words; plus the keeps that must not
// move with the look: the panel's order, one pulse reader, no print trigger, no 44px-only or small-size tokens in the panel
// files, WebView 109 CSS, the safe-area inset at the foot, and /printers rendering the panel inline with no frame and no Done.
// PX-2 Task 6 (on purpose, spec §6.1 / §6.2): two views in the one sheet (status first, settings one tap away), the new
// status card's values, the head without its sub, the 640px column; F-I4 (no recurring request) and F-M6 (focus follows).
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
  PRINTER_BUTTON_FIX_CLASS,
  PRINTER_PANEL_BODY_CLASS,
  PRINTER_PANEL_COLUMN_CLASS,
  PRINTER_PANEL_DONE_CLASS,
  PRINTER_PANEL_FOOT_CLASS,
  PRINTER_PANEL_HEAD_ROW_CLASS,
  PRINTER_PANEL_SHEET_CLASS,
  PRINTER_PANEL_SIDE_CLASS,
  PRINTER_PANEL_VIEW_HEAD_CLASS,
  PRINTER_PANEL_XL_QUERY,
  PRINTER_SECTION_BODY_CLASS,
  PRINTER_SECTION_CARD_CLASS,
  PRINTER_SECTION_HEAD_CLASS,
  PRINTER_STATUS_ACT_CLASS,
  PRINTER_STATUS_CARD_CLASS,
  PRINTER_STATUS_CIRCLE_CLASS,
  PRINTER_STATUS_DETAIL_CLASS,
  PRINTER_STATUS_HEAD_CLASS,
  PRINTER_STATUS_LINK_CLASS,
  PRINTER_STATUS_LOOK,
  PRINTER_STATUS_NOTE_CLASS,
  PRINTER_STATUS_STEP_CLASS,
  PRINTER_STATUS_STEP_NUM_CLASS,
  PRINTER_STATUS_STEPS_CLASS,
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
const PANEL = `${PRINT}PrinterPanel.tsx`;
const CARD = `${PRINT}PrinterStatusCard.tsx`;
// The 15 files of the hygiene pin (printer-ui-paths.test.ts HYGIENE) minus the lib / type files, plus the sections the look added.
const PANEL_FILES = [
  "PrinterPanel", "PrintWhereSection", "DevicePrinterSection", "NativePrinterPicker", "PaperSizeToggle", "PrinterTestTips", "PrinterAdvanced",
  "PrinterSetupCard", "PrintHostCardParts", "DesktopPrinterPicker", "BrowserPrinterConnect", "NotPrintedCard", "NotPrintedSection", "OtherDevicePrinters",
  "PrinterStatusCard", "PrinterHereCard", "PrinterSettingsRow", "FindNetworkPrinters", "DesktopPrintMethod", "TextKotSection", "BillPrinterSection", "PanelSection", "PrinterPanelFrame",
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

// PX-2 Task 6 (on purpose, spec §6.1): one 62px line (14 + 34 + 14); the sub "Printer status and setup for this device" goes and
// the Radix Description stays for screen readers only; a 34px back on the settings view; from 720px a 640px column.
test("the frame's head, body and foot: one 62px line with the view's title, the description for screen readers only, 34px close and back, Done 44px, a 640px column", () => {
  assert.ok(hasAll(PRINTER_PANEL_VIEW_HEAD_CLASS, ["flex-none", "px-5", "py-3.5", "bg-card", "border-b"]), "head: --surface, padding 14px 20px, a rule below");
  assert.ok(hasAll(PRINTER_PANEL_HEAD_ROW_CLASS, ["min-h-[34px]", "items-center", "gap-2.5", "mx-auto", "w-full", "tab:max-w-[640px]"]), "one line, its contents in the column");
  const frame = read(FRAME);
  const classes = read(`${PRINT}printer-classes.ts`);
  assert.match(classes, /PRINTER_PANEL_TITLE_CLASS = "text-\[17px\] font-semibold"/, "the title is 17px 600");
  assert.ok(frame.includes('const DESCRIPTION = "Printing on this device";') && frame.includes('<DialogPrimitive.Description className="sr-only">{DESCRIPTION}</DialogPrimitive.Description>'), "the description, visually hidden");
  assert.ok(!frame.includes("Printer status and setup"), "the old sub is gone");
  assert.match(classes, /PRINTER_PANEL_CLOSE_CLASS = `flex size-\[34px\][^`]*rounded-\[8px\][^`]*pointer-fine:hover:bg-hover/, "the close: 34px, radius 8, --hover under a pointer only");
  assert.ok(classes.includes("PRINTER_PANEL_BACK_CLASS = `${PRINTER_PANEL_CLOSE_CLASS} -ml-2`") && frame.includes('const BACK_LABEL = "Back to printer status";'), "the back: the close's 34px look");
  assert.match(frame, /\{onBack !== undefined && \(\s*<button type="button" data-ui="printer-panel-back" aria-label=\{BACK_LABEL\}/, "a back only where the view has one");
  assert.ok(hasAll(PRINTER_PANEL_BODY_CLASS, ["px-5", "py-4", "gap-3", "bg-background", "overflow-y-auto", "flex-1", "min-h-0"]), "body: the one scroller, padding 16px 20px, 12px apart, --bg");
  assert.ok(hasAll(PRINTER_PANEL_COLUMN_CLASS, ["mx-auto", "w-full", "tab:max-w-[640px]", "flex-col", "gap-3"]), "from 720px a centered 640px column");
  assert.ok(count(frame, "{PRINTER_PANEL_COLUMN_CLASS}") === 2 && frame.includes("{PRINTER_PANEL_HEAD_ROW_CLASS}"), "the column in the head, the body and the foot");
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

// PX-2 Task 6 (on purpose, spec §6.2): the new card's values replace U5's (radius 12, a 34px circle, a 14.5px headline, a 32px fix).
test("the status card: radius 14, padding 16, 12 apart; a 40px circle; 17px / 13.5px words; 22px steps indented 52px; one 44px fix", () => {
  assert.ok(PRINTER_STATUS_LOOK.ok.card.includes("border-[rgba(36,161,72,.3)]") && PRINTER_STATUS_LOOK.ok.card.includes("bg-status-ok-tint") && PRINTER_STATUS_LOOK.ok.head.includes("text-status-ok-ink"), "ok: --status-ok-tint, rgba(36,161,72,.3), --status-ok-ink");
  assert.ok(PRINTER_STATUS_LOOK.bad.card.includes("border-[rgba(255,131,43,.45)]") && PRINTER_STATUS_LOOK.bad.card.includes("bg-status-warn-tint") && PRINTER_STATUS_LOOK.bad.head.includes("text-status-warn-ink"), "bad: --status-warn-tint, rgba(255,131,43,.45), --status-warn-ink");
  assert.ok(PRINTER_STATUS_LOOK.checking.card.includes("bg-card") && PRINTER_STATUS_LOOK.checking.card.includes("border-border"), "checking: --card with a --border rule (neither ok nor bad)");
  assert.ok(has(PRINTER_TILE_BAD_CLASS, "text-foreground") && has(PRINTER_TILE_BAD_CLASS, "bg-status-warn"), "the bad circle's mark is --foreground");
  assert.ok(hasAll(PRINTER_STATUS_CARD_CLASS, ["flex-col", "gap-3", "rounded-[14px]", "border", "p-4"]), "radius 14, 1px border, padding 16, gap 12");
  assert.ok(hasAll(PRINTER_STATUS_CIRCLE_CLASS, ["size-10", "rounded-[50%]", "[&_svg]:size-5"]), "a 40px circle");
  assert.ok(hasAll(PRINTER_STATUS_HEAD_CLASS, ["text-[17px]", "font-semibold", "outline-none"]) && hasAll(PRINTER_STATUS_DETAIL_CLASS, ["text-[13.5px]", "text-muted-foreground"]), "headline 17px / 600, detail 13.5px --muted-foreground");
  assert.ok(hasAll(PRINTER_STATUS_STEPS_CLASS, ["pl-[52px]", "gap-1.5"]) && hasAll(PRINTER_STATUS_STEP_CLASS, ["text-[14px]", "leading-[1.45]"]), "steps 14px / 1.45, indented 52px");
  assert.ok(hasAll(PRINTER_STATUS_STEP_NUM_CLASS, ["size-[22px]", "bg-card", "border", "border-status-info-border", "text-status-info-ink", "text-[12px]", "font-bold"]), "22px circles: --card, 1px #a6c8ff, --status-info-ink 12px bold");
  assert.ok(hasAll(PRINTER_BUTTON_FIX_CLASS, ["h-11", "w-full", "rounded-[10px]", "text-[15px]", "font-semibold"]), "the fix: 44px, the card's width, radius 10, 15px / 600");
  assert.ok(hasAll(PRINTER_STATUS_LINK_CLASS, ["text-[13px]", "font-medium", "text-link"]) && hasAll(PRINTER_STATUS_NOTE_CLASS, ["text-[13px]", "pl-[52px]"]), "the 13px link and the 13px note");
  assert.ok(has(PRINTER_STATUS_ACT_CLASS, "gap-1.5") && has(PRINTER_STATUS_LINK_CLASS, "before:-inset-y-1.5"), "the link's 44px tap area (6px above) never reaches the fix button 6px above it (the review's Minor 1)");
  const card = read(CARD);
  assert.equal(count(card, "<Button"), 1, "one fixing button");
  assert.ok(card.includes('role="status" aria-live="polite"'), "the card keeps role=status aria-live=polite");
});

test("the buttons: primary 40px radius 9 14px 600; secondary 36px radius 8 13.5px 500; the fix 32px 12.5px; Remove in --bad-i with the bad rgba border", () => {
  assert.ok(hasAll(PRINTER_BUTTON_PRIMARY_CLASS, ["h-10", "rounded-[9px]", "text-[14px]", "font-semibold", "self-start"]), "Connect printer look: 40px / 9 / 14px 600, the width of its words");
  assert.ok(hasAll(PRINTER_BUTTON_CLASS, ["h-9", "rounded-[8px]", "text-[13.5px]", "font-medium"]), "Search nearby printers look: 36px / 8 / 13.5px 500");
  assert.ok(hasAll(PRINTER_BUTTON_SMALL_CLASS, ["h-8", "rounded-[8px]", "text-[12.5px]", "font-medium"]), "the small button: 32px / 12.5px (the app's printer list)");
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

// PX-2 Task 6 (on purpose, spec §6.1 / §6.2): was Waiting < Banner < Setup < Bill in one column. The status view: the card, the
// Not printed card, On this device, the Printer settings row; the settings view: today's setup, unchanged; /printers both.
test("the views: status = card < Not printed < On this device < Printer settings; settings = setup < bill; /printers both, inline", () => {
  const panel = stripComments(read(PANEL));
  assert.equal(count(panel, "usePosPulseContext("), 1, "P118: the panel is one of the eight readers, once");
  const at = ["<PrinterStatusCard", "<NotPrintedSection", "<PrinterHereCard", "<PrinterSettingsRow", "<PrinterSetupCard", "<BillPrinterSection"].map((tag) => panel.indexOf(tag));
  assert.ok(at.every((i, n) => i >= 0 && (n === 0 || i > (at[n - 1] ?? 0))), `card < Not printed < here < settings row < setup < bill: ${at.join(", ")}`);
  assert.ok(panel.includes('const status = home === "page" || view === "status";') && panel.includes('const settings = home === "page" || view === "settings";'), "/printers draws both views");
  assert.match(panel, /\{home === "sheet" && view === "status" && <PrinterSettingsRow /, "the settings row only in the sheet's status view");
  assert.ok(panel.includes("data-printer-panel"), "the focus targets' scope marker");
  const where = read(`${PRINT}PrintWhereSection.tsx`);
  assert.ok(where.includes('id="printer-where"') && count(where, 'data-action="designate"') === 1, "the focus targets stay");
  assert.ok(read(`${PRINT}DevicePrinterSection.tsx`).includes('data-printer-target="device"'), "the device section's target stays");
  const page = read("app/(dashboard)/printers/page.tsx");
  assert.ok(page.includes('<PrinterPanel home="page" />') && !page.includes("PrinterPanelFrame") && !/>\s*Done\s*</.test(page), "/printers: the panel inline, no frame, no Done");
  const button = read(BUTTON);
  assert.equal(count(button, "<PrinterPanel view={view} onView={setView} onClose={() => setOpen(false)} />"), 1, "the button mounts the panel once (inside its frame), with its view and its close");
  assert.ok(!button.includes("usePosPulseContext"), "the button never reads the wide pulse");
});

// Ruling Q (the Task 6 review): the view is set to status where the sheet OPENS (the trigger, the alarm's Show), never where it
// closes: a sheet sliding down from the settings view keeps showing them, and the panel's view effect (scroll to the top,
// focus the title) never runs inside a closing sheet.
test("the sheet opens on the status view and never resets while it closes", () => {
  const button = stripComments(read(BUTTON));
  assert.match(button, /const openChange = \(next: boolean\): void => \{\s*if \(next\) setView\("status"\);\s*setOpen\(next\);\s*\};/, "the trigger's open path");
  assert.match(button, /onOpenPrinterPanel\(\(\) => \{\s*setView\("status"\);\s*setOpen\(true\);\s*\}\)/, "the alarm's Show opens on status too");
  assert.equal(count(button, 'setView("status")'), 3, "the two opens and the settings view's back, nowhere else");
  assert.ok(!/if \(!next\)/.test(button) && !/setOpen\(false\);\s*setView/.test(button), "nothing resets the view on close");
  assert.match(button, /onClose=\{\(\) => setOpen\(false\)\}/, "the panel can close the sheet (Printer setup, the review's Important 1)");
});

// F-I4 (moved here from Task 2's budget test): the sheet's parts read what is already cached; nothing in them asks again.
const RECURRING = /refetchInterval|setInterval|router\.refresh|useQuery\(/;
test("the panel adds no recurring request", () => {
  const files = [...["PrinterPanel", "NotPrintedSection", "NotPrintedCard", "PrinterStatusCard", "PrinterHereCard", "PrinterSettingsRow"].map((n) => `${PRINT}${n}.tsx`), "hooks/use-not-printed-actions.ts"];
  for (const file of files) {
    const raw = read(file);
    assert.ok(raw.length > 100, `${file} was read`);
    assert.ok(!RECURRING.test(raw), `${file}: no refetchInterval, setInterval, router.refresh or useQuery(`);
  }
  for (const bad of ["refetchInterval: 5000", "setInterval(tick, 1000)", "router.refresh()", "useQuery({"]) assert.ok(RECURRING.test(bad), `the needle catches ${bad}`);
});

// F-M6 (spec §6.1): a view switch moves the focus to the new view's title (focusable, tabIndex -1), or to the part an action
// pointed at; when the Not printed card leaves (Clear all, the last Clear, its slips printing) holding the focus, the status
// card's headline takes it. A server render cannot move focus: the wiring is pinned at its source.
test("focus follows the view", () => {
  assert.match(read(FRAME), /<DialogPrimitive\.Title data-ui="printer-panel-title" tabIndex=\{-1\}/, "the title can take the focus");
  const panel = stripComments(read(PANEL));
  const switched = panel.slice(panel.indexOf("if (shownView.current === view) return;"), panel.indexOf("}, [view]);"));
  assert.ok(switched.length > 40 && switched.includes("body.scrollTop = 0;"), "a view switch scrolls back to the top");
  assert.ok(switched.includes("if (target !== null && focusAndShow(rootRef.current, target)) return;") && switched.includes("frame?.querySelector<HTMLElement>(TITLE_SELECTOR)?.focus({ preventScroll: true });"), "then the part an action pointed at, else the title");
  assert.ok(panel.includes(`TITLE_SELECTOR = '[data-ui="printer-panel-title"]'`), "the frame's title");
  assert.ok(panel.includes("if (!left || !listFocused.current) return;") && panel.includes("rootRef.current?.querySelector<HTMLElement>(HEADLINE_SELECTOR)?.focus({ preventScroll: true });"), "the card left with the focus: the headline takes it");
  assert.ok(panel.includes("if (active !== null && active !== document.body && active !== frame) return;"), "never stolen from elsewhere");
  assert.ok(panel.includes("listFocused.current = listRef.current?.contains(event.target as Node) ?? false;"), "where the focus was is tracked");
  assert.ok(read(CARD).includes('<p data-ui="printer-status-headline" tabIndex={-1}'), "the headline can take the focus");
});

test("the words: only design 7.7's changes (Paper width, the Remove note's dash, the sub's full stop)", () => {
  assert.ok(read(`${PRINT}PaperSizeToggle.tsx`).includes('PAPER_QUESTION = "Paper width"'), "Paper width");
  assert.ok(read(`${PRINT}PrinterAdvanced.tsx`).includes("remove it from any device — even a phone. Waiting slips are cancelled"), "the Remove note: the HTML's dash");
  assert.ok(read(FRAME).includes('"Printing on this device"'), "the description, no full stop (PX-2 Task 6: the sub went, spec §6.1)");
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
  if (frame.includes('device."')) p.push("the description has no full stop");
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
    ["the full stop back", frame.replace('on this device";', 'on this device.";')],
  ];
  for (const [name, mutated] of mutations) {
    assert.notEqual(mutated, frame, name + ": the mutation changed the source");
    assert.ok(frameProblems(mutated).length >= 1, name + ": the pin did not notice");
  }
});
