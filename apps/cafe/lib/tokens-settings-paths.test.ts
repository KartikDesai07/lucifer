import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import { SETTINGS_SECTIONS, VISIBLE_SETTINGS_SECTIONS, isSettingsSectionHidden, settingsSectionPath } from "@/lib/settings-sections";
import { sampleBillOrder, withSampleToken } from "@/lib/bill-print-sample";
import { settingsOf } from "@/lib/print-template-golden.fixtures";
import type { GstConfig } from "@/lib/receipt";
import type { PrinterConfig, PrinterSlips } from "@pos/shared/print-printers";
import { NUMBER_RESET_HINT, TOKENS_NO_BILL_PRINTER_WARNING, TOKENS_RELOAD_HINT, tokensHaveNoBillPrinter } from "@/lib/token-settings-notes";

// Print customization S6: the Tokens & numbering page, its wiring, the links into it, the "no setting flips by itself"
// rule, and the four preview sites that show the sample token. Source-read pins over COMMENT-STRIPPED source.

const CAFE_ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));
const count = (src: string, needle: string): number => src.split(needle).length - 1;
const PAGE = "app/(dashboard)/settings/tokens/page.tsx";
const FIELDS = "components/settings/TokenSettingsFields.tsx";
// S8 added tokenReadyClearMinutes (how long a Ready token stays on the token list) as the section's fourth field.
const TOKEN_FIELDS = ["tokenEnabled", "tokenNumberStart", "numberResetMinutes", "tokenReadyClearMinutes"];

function sourcesUnder(dirs: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
    }
  };
  for (const d of dirs) walk(path.join(CAFE_ROOT, d));
  return out;
}
const relOf = (file: string): string => path.relative(CAFE_ROOT, file).split(path.sep).join("/");

test("section: 'tokens' owns exactly the four fields, sits right after kitchen-ticket, and is visible (not hidden)", () => {
  const slugs = SETTINGS_SECTIONS.map((s) => s.slug);
  const at = slugs.indexOf("tokens");
  assert.ok(at > 0, "landmark: the tokens section exists");
  assert.equal(slugs[at - 1], "kitchen-ticket");
  assert.deepEqual([...SETTINGS_SECTIONS[at].fields], TOKEN_FIELDS);
  assert.equal(SETTINGS_SECTIONS[at].title, "Tokens & numbering");
  assert.equal(isSettingsSectionHidden("tokens"), false);
  assert.ok(VISIBLE_SETTINGS_SECTIONS.some((s) => s.slug === "tokens"), "the hub and sidebar list it");
  assert.equal(settingsSectionPath("tokens"), "/settings/tokens");
  assert.ok(!SETTINGS_SECTIONS.some((s) => s.slug !== "tokens" && s.fields.some((f) => TOKEN_FIELDS.includes(f))), "no other section owns them");
  assert.match(read("components/settings/settings-section-icons.tsx"), /\btokens:\s*Ticket\b/, "the section has an icon");
});

test("page: renders SettingsSectionPage slug='tokens' wide > SettingsSectionForm (given the design draft's extra) > TokenSettingsFields", () => {
  const src = read(PAGE);
  const sibling = read("app/(dashboard)/settings/taxes/page.tsx");
  assert.ok(sibling.includes('<SettingsSectionPage slug="taxes">'), "landmark: the sibling page has the same shape");
  for (const needle of ['"use client"', '<SettingsSectionPage slug="tokens" wide>', "<SettingsSectionForm settings={settings} section={section} extra={design.extra}>", "<TokenSettingsFields "]) {
    assert.ok(src.includes(needle), `the page holds ${needle}`);
  }
  assert.ok(src.indexOf("<SettingsSectionPage") < src.indexOf("<SettingsSectionForm") && src.indexOf("<SettingsSectionForm") < src.indexOf("<TokenSettingsFields"));
  assert.match(src, /export default function \w+\(\)/);
});

test("fields: registers the three names, builds the picker from numberResetOptions(saved?.numberResetMinutes) / numberResetLabel, and carries the copy", () => {
  const src = read(FIELDS);
  assert.equal(count(src, 'name="tokenEnabled"'), 1);
  assert.equal(count(src, 'name="numberResetMinutes"'), 1);
  assert.equal(count(src, 'register("tokenNumberStart"'), 1);
  assert.ok(src.includes("numberResetOptions(saved?.numberResetMinutes).map("), "the options come from the SAVED value, so a stored off-step time stays pickable after the owner tries another");
  assert.ok(src.includes("numberResetLabel(minutes)") && src.includes("numberResetMinutesOf(field.value)"));
  for (const copy of [
    "Give every order a token",
    "Every new order gets a token number. It prints on the bill and the kitchen ticket.",
    "Token numbers start at",
    "Numbers start again at",
    "Token, kitchen ticket and bill numbers all start again from their start number at this time.",
    "A short number for each order, so the customer can be called when it is ready.",
    "Daily restart time",
  ]) assert.ok(src.includes(copy), `copy: ${copy}`);
  assert.ok(!/tokenNumberStart[^\n]*(disabled|watch)/.test(src), "the start box is always shown, whatever the switch says");
});

test("fields (S8): the 'Ready tokens' group registers tokenReadyClearMinutes once, builds the picker from tokenReadyClearOptions(saved?.tokenReadyClearMinutes) / tokenReadyClearLabel, and carries the copy", () => {
  const src = read(FIELDS);
  assert.equal(count(src, 'name="tokenReadyClearMinutes"'), 1, "registered exactly once, through a Controller");
  assert.match(src, /<Controller\s+control=\{control\}\s+name="tokenReadyClearMinutes"/);
  assert.ok(src.includes("tokenReadyClearOptions(saved?.tokenReadyClearMinutes).map("), "the options come from the SAVED value, so a stored off-step time stays pickable after the owner tries another");
  assert.ok(src.includes("tokenReadyClearLabel(minutes)") && src.includes("tokenReadyClearMinutesOf(field.value)"), "the label and the shown value come from the shared readers");
  assert.match(src, /onValueChange=\{\(v\) => field\.onChange\(Number\(v\)\)\}/, "the picker stores a number, like the restart time");
  for (const copy of [
    "Ready tokens",
    "How long a ready token stays on the token list before it clears by itself.",
    "Clear a ready token after",
    "Marking it Collected clears it at once.",
  ]) assert.ok(src.includes(copy), `copy: ${copy}`);
  assert.match(src, /error=\{errors\.tokenReadyClearMinutes\?\.message\}/, "a rejected value shows its message under the field");
  // the group is a sibling of the other two, after the restart time, not folded into the tokens switch
  assert.ok(src.indexOf("Daily restart time") < src.indexOf("Ready tokens"), "it comes after the restart time group");
  assert.equal(count(src, "<SettingsGroup"), 3, "three groups: Tokens, Daily restart time, Ready tokens");
  // it must not depend on, or be hidden by, the tokens switch (nothing flips by itself)
  assert.ok(!/tokenReadyClearMinutes[^\n]*(disabled|watch)/.test(src));
  assert.ok(!/tokenEnabled[^\n]*tokenReadyClear|tokenReadyClear[^\n]*tokenEnabled/.test(src), "the two controls do not reference each other");
});

test("fields: BOTH option lists come from the saved form defaults (useFormState defaultValues), never from field.value — a live-value list strands the stored off-step time", () => {
  const src = read(FIELDS);
  assert.match(src, /const \{ defaultValues: saved \} = useFormState\(\{ control \}\);/, "the saved values come from the form's defaults");
  assert.match(src, /import \{ Controller, useFormState \} from "react-hook-form"/);
  assert.equal(count(src, "numberResetOptions("), 1, "landmark: one options call for the restart time");
  assert.equal(count(src, "tokenReadyClearOptions("), 1, "landmark: one options call for the ready-clear time");
  assert.equal(count(src, "numberResetOptions(saved?.numberResetMinutes)"), 1);
  assert.equal(count(src, "tokenReadyClearOptions(saved?.tokenReadyClearMinutes)"), 1);
  // vision guard: the Select's own value still reads the LIVE field value — only the option lists moved
  assert.ok(src.includes("value={String(numberResetMinutesOf(field.value))}"), "landmark: the restart Select still shows the live value");
  assert.ok(src.includes("value={String(tokenReadyClearMinutesOf(field.value))}"), "landmark: the ready-clear Select still shows the live value");
  // negative: neither options call may take field.value (or anything but the saved default)
  assert.ok(!/(?:numberResetOptions|tokenReadyClearOptions)\(\s*field\.value/.test(src), "no options list is built from field.value");
  assert.ok(!/(?:numberResetOptions|tokenReadyClearOptions)\(\s*(?!saved\?\.)/.test(src.replace(/import[^;]*;/g, "")), "every options call takes saved?.<field>");
});

test("links: both numbering cards link to settingsSectionPath('tokens') with 'Change the restart time'", () => {
  for (const card of ["components/settings/BillNumberingCard.tsx", "components/settings/KotNumberingCard.tsx"]) {
    const src = read(card);
    assert.equal(count(src, 'href={settingsSectionPath("tokens")}'), 1, card);
    assert.ok(src.includes("Change the restart time") && src.includes("It starts again every day at the restart time."), card);
    assert.match(src, /import \{ settingsSectionPath \} from "@\/lib\/settings-sections";/, card);
  }
});

test("no automation: nothing sets tokenEnabled / numberResetMinutes / tokenNumberStart / tokenReadyClearMinutes on its own - only the start box's own blur floor", () => {
  const files = sourcesUnder(["components", "hooks", "app", "lib"]);
  assert.ok(files.length >= 300, `vision guard: the scan reads the tree (read ${files.length})`);
  const offenders: string[] = [];
  for (const file of files) {
    const src = stripComments(readFileSync(file, "utf8"));
    if (/\b(?:setValue|resetField)\(\s*["'`](?:tokenEnabled|numberResetMinutes|tokenNumberStart|tokenReadyClearMinutes)/.test(src)) offenders.push(relOf(file));
    if (/setValue\(\s*`(?:token|numberReset)/.test(src)) offenders.push(`${relOf(file)} (template name)`);
  }
  assert.deepEqual(offenders, [], "no literal setValue / resetField on a token field anywhere");
  const fields = read(FIELDS);
  assert.ok(!/\b(?:watch|useWatch|getValues|useEffect)\(/.test(fields), "the page reads no other field and runs no effect");
  assert.ok(fields.includes("makeNumberStartBlurHandler(setValue,"), "landmark: the one setValue use is the start box's blur handler");
  assert.ok(!/\bsetValue\(/.test(fields), "and the page never calls setValue itself (the Ready-clear picker only reports its own onChange)");
  // The ONE write: print-form-utils' blur handler, floored from the typed value of the input it is attached to.
  const utils = read("components/settings/print-form-utils.ts");
  assert.equal(count(utils, "setValue("), 1, "landmark: exactly one setValue in print-form-utils");
  assert.match(utils, /setValue\(name, blankToMinStart\(e\.target\.value\)/, "it writes its own field from its own input");
  assert.match(utils, /name: "billNumberStart" \| "kotNumberStart" \| "tokenNumberStart"/);
  const callers = files.filter((f) => stripComments(readFileSync(f, "utf8")).includes('makeNumberStartBlurHandler(setValue, "tokenNumberStart")')).map(relOf);
  assert.deepEqual(callers, [FIELDS], "only the token page's own box attaches it to tokenNumberStart");
});

test("previews: withSampleToken wraps the sample order in exactly the 4 preview / thumb sites, and the inner sample + receipt calls stay intact", () => {
  const files = sourcesUnder(["components", "hooks", "app", "lib"]);
  const callers = files.filter((f) => /withSampleToken\(/.test(stripComments(readFileSync(f, "utf8")))).map(relOf).sort();
  assert.deepEqual(callers, [
    "components/settings/BillPrintPreview.tsx",
    "components/settings/KitchenTicketPreview.tsx",
    "components/settings/print-design/DesignThumb.tsx",
    "components/settings/print-design/KotDesignThumb.tsx",
    "lib/bill-print-sample.ts",
  ].sort(), "the four sites plus the definition");
  const bill = read("components/settings/BillPrintPreview.tsx");
  assert.ok(bill.includes("withSampleToken(sampleBillOrder(gstCfg, cfg.numberStart, createdAt), live)") && bill.includes("<OrderReceipt order={order} settings={live} />"));
  const kitchen = read("components/settings/KitchenTicketPreview.tsx");
  assert.ok(kitchen.includes("withSampleToken(sampleKitchenOrder(createdAt), live)") && kitchen.includes("sampleKitchenSlip(chip, order, cfg)"));
  const thumb = read("components/settings/print-design/DesignThumb.tsx");
  assert.ok(thumb.includes("withSampleToken(") && thumb.includes("sampleBillOrder(gstConfigOfSettings(settings), printConfigOf(withTemplate).bill.numberStart, createdAt)") && thumb.includes("<OrderReceipt order={shown.order} settings={shown.settings} />"));
  const kotThumb = read("components/settings/print-design/KotDesignThumb.tsx");
  assert.ok(kotThumb.includes("withSampleToken(sampleKitchenOrder(createdAt), withTemplate)") && kotThumb.includes('sampleKitchenSlip("kot", order, printConfigOf(withTemplate).kot)'));
});

test("withSampleToken: tokens off (or absent) returns the SAME order; on shows the start number the next order would get", () => {
  const gst: GstConfig = { gstEnabled: false, gstRate: 0, gstMode: "inclusive" };
  const order = sampleBillOrder(gst, 1, "2026-10-05T10:00:00.000Z");
  assert.equal(order.tokenNumber, undefined, "landmark: the plain sample carries no token");
  assert.equal(withSampleToken(order, settingsOf()), order, "absent setting: untouched");
  assert.equal(withSampleToken(order, settingsOf({ tokenEnabled: false, tokenNumberStart: 50 })), order, "off: untouched");
  assert.equal(withSampleToken(order, settingsOf({ tokenEnabled: true, tokenNumberStart: 101 })).tokenNumber, 101);
  assert.equal(withSampleToken(order, settingsOf({ tokenEnabled: true })).tokenNumber, 1, "on with no start: the minimum");
  assert.equal(order.tokenNumber, undefined, "the input is not mutated");
});

// ── The token fix (plan 2026-10-06-token-direct-fix.md, T2–T4) ───────────────────────────────────────────────────
// The page's three notes live in lib/token-settings-notes.ts, so the page and docs/GO-LIVE-CHECKLIST.md say the same
// words (go-live-runbook.test.ts pins the doc's quote).

test("T2: the hint right under the tokens switch says to reload every POS screen and restart the Windows app first, in the owner's words", () => {
  assert.equal(
    TOKENS_RELOAD_HINT,
    "Before turning tokens on, reload every POS screen and restart the Windows app on every counter PC (an older page never prints token slips; they wait in the panel).",
    "the owner's words, verbatim",
  );
  const src = read(FIELDS);
  assert.match(src, /import \{[^}]*\bTOKENS_RELOAD_HINT\b[^}]*\} from "@\/lib\/token-settings-notes";/, "the page imports the one copy");
  assert.equal(count(src, "{TOKENS_RELOAD_HINT}"), 1, "shown once");
  const at = { toggle: src.indexOf('name="tokenEnabled"'), hint: src.indexOf("{TOKENS_RELOAD_HINT}"), start: src.indexOf("Token numbers start at") };
  assert.ok(at.toggle >= 0 && at.toggle < at.hint && at.hint < at.start, "under the tokens switch, before the start box");
  assert.match(src, /<p className=\{HINT_CLASS\}>\{TOKENS_RELOAD_HINT\}<\/p>/, "a hint line, styled like the page's other hints");
});

const NO_SLIPS: PrinterSlips = { bill: false, kotStations: [], kotAll: false, notices: false, eod: false };
function printerOf(name: string, slips: Partial<PrinterSlips>, over: { enabled?: boolean; writer?: string | null } = {}): PrinterConfig {
  const writer = over.writer === undefined ? "dev-a" : over.writer;
  return {
    id: `665f0a00000000000000${String(name.length).padStart(4, "0")}`,
    name,
    connection: { kind: "lan", host: "10.0.0.9", port: 9100 },
    ...(writer !== null ? { primaryDeviceId: writer } : {}),
    order: 0,
    paper: 80,
    slips: { ...NO_SLIPS, ...slips },
    copies: { kot: 1, bill: 1 },
    enabled: over.enabled ?? true,
  };
}

test("T3 tokensHaveNoBillPrinter: only in printers mode with no routable printer that takes bills", () => {
  const kitchen = printerOf("Kitchen", { kotStations: ["st-k"] });
  assert.equal(tokensHaveNoBillPrinter([]), false, "simple mode: a token prints where the bill prints today");
  assert.equal(tokensHaveNoBillPrinter([kitchen, printerOf("Counter", { bill: true })]), false, "a routable bill printer takes the tokens");
  assert.equal(tokensHaveNoBillPrinter([kitchen]), true, "printers mode, and no printer takes bills");
  assert.equal(tokensHaveNoBillPrinter([kitchen, printerOf("Counter", { bill: true }, { enabled: false })]), true, "a switched-off bill printer takes none");
  assert.equal(tokensHaveNoBillPrinter([kitchen, printerOf("Counter", { bill: true }, { writer: null })]), true, "a LAN bill printer no device writes takes none");
  assert.equal(tokensHaveNoBillPrinter([printerOf("Counter", { bill: true }, { enabled: false })]), false, "landmark: with only a switched-off printer the cafe is back in simple mode");
});

test("T3: the Tokens page warns when printers mode has no bill printer, from the shared printers read (no new request), with the way to Printer setup", () => {
  assert.equal(TOKENS_NO_BILL_PRINTER_WARNING, "Token slips print at the bill printer, and none is set up. Tick Bill on a printer in Printer setup.", "the warning's words");
  const src = read(FIELDS);
  assert.match(src, /import \{ usePrintersRead \} from "@\/hooks\/use-agent-printers";/, "the same cached printers read as the agent and the printer dot");
  assert.equal(count(src, "usePrintersRead("), 1, "one read");
  assert.ok(src.includes("const noBillPrinter = tokensHaveNoBillPrinter(usePrintersRead(true).printers);"), "the pure rule decides, from the read's printers");
  assert.match(src, /\{noBillPrinter && \(\s*<p role="alert"/, "shown only then, as an alert");
  assert.ok(src.includes("{TOKENS_NO_BILL_PRINTER_WARNING}") && src.includes('href="/printers"'), "its words, and a link to Printer setup");
  const at = { hint: src.indexOf("{TOKENS_RELOAD_HINT}"), warning: src.indexOf("{TOKENS_NO_BILL_PRINTER_WARNING}"), start: src.indexOf("Token numbers start at") };
  assert.ok(at.hint < at.warning && at.warning < at.start, "in the Tokens group, under the reload hint");
});

test("T4: the restart time's hint says to change it outside service hours, as a change during service can repeat or skip tonight's numbers", () => {
  assert.equal(
    NUMBER_RESET_HINT,
    "A new time takes full effect from the next day. Changing it during service can repeat or skip tonight's token, kitchen ticket and bill numbers, so change it outside service hours. Order IDs still change at midnight.",
    "the note, word for word",
  );
  const src = read(FIELDS);
  assert.match(src, /import \{[^}]*\bNUMBER_RESET_HINT\b[^}]*\} from "@\/lib\/token-settings-notes";/, "the page imports it");
  const field = src.slice(src.indexOf('label="Numbers start again at"'), src.indexOf('name="numberResetMinutes"'));
  assert.ok(field.includes("hint={NUMBER_RESET_HINT}"), "the restart time's own field shows it");
  assert.ok(!src.includes("On the day you change it, a few numbers can repeat."), "the old, softer words are gone");
});
