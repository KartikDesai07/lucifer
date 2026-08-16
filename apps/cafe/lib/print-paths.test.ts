import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { RECEIPT_PAGE_STYLE, receiptPageStyle } from "./print";

// CR1.6 — the four on-device paper paths the go-live checklist's §7 device leg
// checks by hand (customer receipt w/ logo, KOT, VOID slip, end-of-day slip).
// There is no React test framework in this repo (deliberate): every pin below
// is a source-read pin (readFileSync over the REAL hook/component source),
// the same technique as settle-money.test.ts's PaymentModal-caller pin
// (line ~272) and due-payment.test.ts's §6 route pins (PIN: ...).
//
// NOT duplicated here — already pinned elsewhere, look there instead:
//   - settings-branding.test.ts: settingsSchema logo/fssai LENGTH LIMITS,
//     AppSidebar.tsx's logo rendering via productImageUrl, the repo-wide
//     banned-placeholder-string scan (BANNED_STRINGS there — do NOT quote
//     those literals anywhere in source, including a comment, or that scan
//     goes red), and
//     EndOfDaySummary.tsx's "as of print" label for a past date.
//   - due-payment.test.ts: EndOfDaySummary.tsx's "Dues collected" section
//     iterating DUES_RECEIPT_MODES (not the wide SETTLEMENT_PAY_MODES) — the
//     EndOfDayButton pin below only covers its OWN gating (admin/ready/date),
//     not that iteration.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// Scans forward from an opening `{` at `openIdx`, counting brace depth, and
// returns the index of its MATCHING closing `}` (depth back to 0). A naive
// `indexOf("}...")` from the opening marker stops at the FIRST such token,
// which can belong to a nested call/object literal inside the block and
// truncate the captured body before code that comes later in the same block —
// letting that later code escape whatever the caller then asserts about it.
function matchingBraceEnd(src: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("matchingBraceEnd: no matching closing brace found");
}

const USE_POS_TAB = "apps/cafe/hooks/use-pos-tab.ts";
const USE_POS_PRINT = "apps/cafe/hooks/use-pos-print.ts";
const POS_PAGE = "apps/cafe/app/(dashboard)/pos/page.tsx";
const PRINT_LIB = "apps/cafe/lib/print.ts";
const ORDER_RECEIPT = "apps/cafe/components/pos/OrderReceipt.tsx";
const KOT_RECEIPT = "apps/cafe/components/pos/KOTReceipt.tsx";
const ORDER_DETAIL_SHEET = "apps/cafe/components/orders/OrderDetailSheet.tsx";
const END_OF_DAY_BUTTON = "apps/cafe/components/reports/EndOfDayButton.tsx";
const END_OF_DAY_SUMMARY = "apps/cafe/components/reports/EndOfDaySummary.tsx";

// ── 1. Pay Now must fire the kitchen ticket too (CR1.2(a)) ──────────────────

test("PIN: usePosTab's Pay-Now branch queues the KOT round, the settle branch does not — without it a counter sale prints a bill and the kitchen never sees it (CR1.2(a))", () => {
  const src = readSrc(USE_POS_TAB);
  const fnStart = src.indexOf("const confirmPayment");
  assert.ok(fnStart >= 0, "confirmPayment must exist in use-pos-tab.ts");
  const nextFnStart = src.indexOf("const enterResume");
  assert.ok(nextFnStart > fnStart, "enterResume must exist after confirmPayment");
  const body = src.slice(fnStart, nextFnStart);

  const elseSplit = body.indexOf("} else {");
  assert.ok(elseSplit > 0, "confirmPayment must branch on paymentIntent (settle vs pay-now)");
  const settleBranch = body.slice(0, elseSplit);
  const payNowBranch = body.slice(elseSplit);

  assert.match(
    payNowBranch,
    /print\.queueKotRound\(order\)/,
    "the Pay-Now branch must call print.queueKotRound(order) — POST /api/orders stamps a fresh KOT round on every create, so a counter sale is a real round server-side too; without this call the kitchen gets nothing",
  );
  assert.ok(
    !/print\.queueKotRound\(/.test(settleBranch),
    "the settle branch fires nothing new (no items added) — it must NOT queue a KOT round",
  );
});

// ── 2. The two print signals have exactly one owner ─────────────────────────

test("PIN: usePosPrint is the single owner of both print signals — it defines queueKotRound, queueVoidSlip, reprintKot, and returns them alongside shouldPrintKot/shouldPrintReceipt", () => {
  const src = readSrc(USE_POS_PRINT);
  for (const fn of ["queueKotRound", "queueVoidSlip", "reprintKot"]) {
    assert.match(
      src,
      new RegExp(`const ${fn} = useCallback`),
      `${fn} must be defined in usePosPrint — a second definition elsewhere would fork the print-signal state`,
    );
  }
  assert.match(src, /const \[shouldPrintReceipt, setShouldPrintReceipt\] = useState/);
  assert.match(src, /const \[shouldPrintKot, setShouldPrintKot\] = useState/);

  const returnStart = src.indexOf("return {");
  assert.ok(returnStart >= 0, "usePosPrint must return its public surface");
  const returnBlock = src.slice(returnStart);
  for (const name of [
    "queueKotRound",
    "queueVoidSlip",
    "reprintKot",
    "shouldPrintReceipt",
    "shouldPrintKot",
  ]) {
    assert.match(
      returnBlock,
      new RegExp(`\\b${name}\\b`),
      `usePosPrint must return ${name} — a caller can't react to a signal the hook doesn't expose`,
    );
  }
});

// ── 3. Two print jobs must never fire in one tick (CR1.2) ───────────────────

test("PIN: pos/page.tsx sequences KOT then receipt via a guard ref — onAfterPrint only clears the flag (never fires the receipt itself), and the receipt effect waits for the KOT flag to clear", () => {
  const src = readSrc(POS_PAGE);

  assert.match(
    src,
    /const kotPrinting = useRef\(false\)/,
    "a guard ref must gate the KOT effect from re-firing while a job is in flight",
  );

  const onAfterPrintMarker = "onAfterPrint: () => {";
  const onAfterPrintMarkerStart = src.indexOf(onAfterPrintMarker);
  assert.ok(onAfterPrintMarkerStart >= 0, "printKot must define onAfterPrint");
  // Brace-balanced scan (not indexOf("});", …)) — a plain string search stops
  // at the FIRST "});" it finds, which can belong to a nested call inside the
  // callback (e.g. `someHelper({});`) and truncate the body BEFORE a later
  // print() call, letting that call escape the negative assertion below.
  const openBraceIdx = onAfterPrintMarkerStart + onAfterPrintMarker.length - 1;
  assert.equal(src[openBraceIdx], "{", "marker must end on the arrow function's opening brace");
  const closeBraceIdx = matchingBraceEnd(src, openBraceIdx);
  const onAfterPrintBody = src.slice(openBraceIdx, closeBraceIdx + 1);
  // Pin the captured window's own boundary too, so a future reindent that
  // changes this shape fails loudly here instead of the window silently
  // shrinking around it.
  assert.equal(onAfterPrintBody.at(-1), "}", "the captured body must end on the matched closing brace");
  assert.equal(
    src[closeBraceIdx + 1],
    ",",
    "onAfterPrint's closing brace must be immediately followed by a comma (it's an object property) — a reindent that changes this shape must fail this assertion, not silently drift",
  );

  assert.match(onAfterPrintBody, /kotPrinting\.current = false;/, "onAfterPrint must clear the guard ref");
  assert.match(onAfterPrintBody, /clearPrintKot\(\);/, "onAfterPrint must clear shouldPrintKot");
  assert.ok(
    !/\bprint\(\)/.test(onAfterPrintBody),
    "onAfterPrint must NOT call the receipt's print() directly — firing it synchronously inside the KOT's teardown is exactly what deletes the receipt's just-appended iframe (CR1.2); the brace-balanced scan means a print() call nested inside another callback here can no longer escape this check via a truncated window",
  );

  assert.match(
    src,
    /if \(shouldPrintReceipt && lastOrder && !shouldPrintKot\) \{/,
    "the receipt effect must be gated on shouldPrintKot being clear — it fires on the NEXT effect flush, safely after the KOT's own teardown",
  );
  assert.match(
    src,
    /if \(shouldPrintKot && lastOrder && !kotPrinting\.current\) \{/,
    "the KOT effect must be gated on the guard ref, or a re-render re-fires the same print job",
  );
});

// ── 4. Every print surface uses the one shared 80mm page setup ─────────────

test("PIN: RECEIPT_PAGE_STYLE carries the 80mm/4mm page setup, and every print trigger (POS, order-detail, end-of-day) passes it", () => {
  assert.match(RECEIPT_PAGE_STYLE, /size: 80mm auto/);
  assert.match(RECEIPT_PAGE_STYLE, /margin: 4mm/);

  // The POS now chooses its page size from Settings, because a cafe may run a
  // different paper width on the bill roll than on the kitchen printer. The
  // dynamic builder must still produce EXACTLY the old setup at 80mm — that
  // equality is what makes the switch safe for every cafe that never touches
  // the setting — and must actually change the size at 58mm, or the option is
  // a lie and the browser silently scales the slip.
  assert.equal(
    receiptPageStyle("80mm"),
    RECEIPT_PAGE_STYLE,
    "receiptPageStyle('80mm') must reproduce the long-standing page setup byte for byte",
  );
  assert.match(receiptPageStyle("58mm"), /size: 58mm auto/);
  assert.match(receiptPageStyle("58mm"), /margin: 4mm/);

  // Both POS jobs must take their page setup from the RESOLVED config, and
  // from their own surface's width — a copy-paste that pointed the KOT job at
  // `bill.paperWidth` would print kitchen tickets on the wrong roll.
  const posSrc = readSrc(POS_PAGE);
  const posMatches = posSrc.match(/pageStyle:\s*receiptPageStyle\(/g) ?? [];
  assert.equal(posMatches.length, 2, "pos/page.tsx must build a page style for both the receipt AND the KOT print hooks");
  assert.match(
    posSrc,
    /pageStyle:\s*receiptPageStyle\(printCfg\.bill\.paperWidth\)/,
    "the receipt job must use the BILL paper width",
  );
  assert.match(
    posSrc,
    /pageStyle:\s*receiptPageStyle\(printCfg\.kot\.paperWidth\)/,
    "the KOT job must use the KITCHEN TICKET paper width, not the bill's",
  );
  assert.match(
    posSrc,
    /printConfigOf\(/,
    "the widths must come from printConfigOf — reading settings.billPaperWidth raw returns undefined on any cafe whose Settings document predates the field",
  );

  // The REPRINT path renders the very same receipt components, which size
  // themselves from Settings — so it must declare the same paper the POS does.
  // A fixed 80mm page here would shrink-to-fit a 58mm cafe's duplicate bill
  // while its original slip printed correctly.
  const orderDetailSrc = readSrc(ORDER_DETAIL_SHEET);
  const orderDetailMatches = orderDetailSrc.match(/pageStyle:\s*receiptPageStyle\(/g) ?? [];
  assert.equal(
    orderDetailMatches.length,
    2,
    "OrderDetailSheet.tsx must build a page style for both its receipt AND KOT print hooks",
  );
  assert.match(
    orderDetailSrc,
    /pageStyle:\s*receiptPageStyle\(printCfg\.bill\.paperWidth\)/,
    "the reprinted bill must use the BILL paper width",
  );
  assert.match(
    orderDetailSrc,
    /pageStyle:\s*receiptPageStyle\(printCfg\.kot\.paperWidth\)/,
    "the reprinted KOT must use the KITCHEN TICKET paper width",
  );

  // The end-of-day slip is the ONE surface that legitimately stays fixed: it
  // renders its own component with a hardcoded w-[300px] (EndOfDaySummary), not
  // the settings-driven receipt, so its page must stay 80mm.
  const eodSummarySrc = readSrc(END_OF_DAY_SUMMARY);
  assert.match(
    eodSummarySrc,
    /w-\[300px\]/,
    "EndOfDaySummary must keep its fixed 300px width, or EndOfDayButton's fixed 80mm page setup stops matching it",
  );

  const eodSrc = readSrc(END_OF_DAY_BUTTON);
  const eodMatches = eodSrc.match(/pageStyle:\s*RECEIPT_PAGE_STYLE/g) ?? [];
  assert.equal(eodMatches.length, 1, "EndOfDayButton.tsx must pass RECEIPT_PAGE_STYLE to its print hook");
});

// ── 5. The mobile-UA hazard must stay documented ────────────────────────────

test("PIN: lib/print.ts still names the fixed 500ms onAfterPrint timer on MOBILE user-agents — delete this comment and the go-live checklist's tablet warning becomes unverifiable", () => {
  const src = readSrc(PRINT_LIB);
  assert.match(src, /MOBILE user-agents/);
  assert.match(src, /500ms timer/);
  assert.match(src, /onAfterPrint/);
  assert.match(
    src,
    /NOT a supported counter device/,
    "the comment must state the CR1.6 'not supported' decision, or lib/print.ts and docs/GO-LIVE-CHECKLIST.md §7 can drift apart silently (one could soften/remove the warning without the other noticing)",
  );
});

// ── 6. A receipt never prints a fallback brand ──────────────────────────────
// The repo-wide banned-placeholder-string scan already lives in
// settings-branding.test.ts — this pins the CONDITIONAL-RENDER SHAPE that
// makes a blank Settings field print nothing at all, which that scan does not.

test("PIN: OrderReceipt renders name/tagline/address/mobile/footer only behind a truthiness guard on the trimmed Settings value — a blank field prints nothing, never a fallback", () => {
  const src = readSrc(ORDER_RECEIPT);
  assert.match(src, /const name = settings\?\.restaurantName\?\.trim\(\);/);
  assert.match(src, /const tagline = settings\?\.tagline\?\.trim\(\);/);
  assert.match(src, /const address = settings\?\.address\?\.trim\(\);/);
  assert.match(src, /const mobile = settings\?\.mobile\?\.trim\(\);/);
  assert.match(src, /const footer = settings\?\.receiptFooter\?\.trim\(\);/);

  assert.match(src, /\{name && \(/);
  assert.match(src, /\{tagline && <div/);
  assert.match(src, /\{address && <div/);
  assert.match(src, /\{mobile && <div/);
  assert.match(src, /\{footer && <div/);
});

// ── 7. The receipt prints the logo and the FSSAI number ────────────────────

test("PIN: OrderReceipt resolves the logo via productImageUrl's no-crop fit, prints FSSAI independent of the GST flag, and gates GSTIN on the order's own GST snapshot", () => {
  const src = readSrc(ORDER_RECEIPT);
  assert.match(
    src,
    /productImageUrl\(settings\?\.logo, undefined, \{ fit: true \}\)/,
    "the logo must resolve through productImageUrl with { fit: true } (c_fit, no crop) — a square-cropped logo (the product-tile default) would mangle a wide brand mark",
  );

  const fssaiIdx = src.indexOf("FSSAI:");
  assert.ok(fssaiIdx >= 0, "an FSSAI line must exist");
  const before = src.slice(Math.max(0, fssaiIdx - 150), fssaiIdx);
  assert.ok(
    !/gst\?\.show/.test(before),
    "FSSAI is a food-licence number, not a tax field — it must render unconditional on the GST flag",
  );
  assert.match(src, /\{fssai && <div className="text-\[10px\]">FSSAI: \{fssai\}<\/div>\}/);

  assert.match(
    src,
    /\{gst\?\.show && gstNumber && \(/,
    "GSTIN must be gated on the order's own GST snapshot (gst.show), not the cafe's LIVE gst setting — otherwise toggling GST later rewrites old receipts",
  );
});

// ── 8. A cancelled bill cannot be mistaken for a valid receipt ─────────────

test("PIN: OrderReceipt prints *** CANCELLED *** plus a 'no payment due' line INSTEAD of Paid/Due when the order is Cancelled, and the cancelled branch itself prints neither a Paid nor a Due line", () => {
  const src = readSrc(ORDER_RECEIPT);
  assert.match(src, /\*\*\* CANCELLED \*\*\*/);
  assert.match(src, /VOID — no payment due/);

  const ternaryIdx = src.indexOf("isCancelled ? (");
  assert.ok(ternaryIdx >= 0, "the Paid/Due block must be gated on isCancelled");
  const afterTernary = src.slice(ternaryIdx);
  const elseMarker = ") : (";
  const elseIdx = afterTernary.indexOf(elseMarker);
  assert.ok(elseIdx > 0, "the ternary must have an else branch printing the normal Paid/Due lines");
  const cancelledBranch = afterTernary.slice(0, elseIdx);
  const elseBranch = afterTernary.slice(elseIdx);

  assert.match(
    elseBranch,
    /label=\{`Paid \(\$\{order\.payment\}\)`\}/,
    "the Paid line must only render in the NON-cancelled branch",
  );

  // A bill that prints "Paid" (or a live Due balance) while stamped CANCELLED
  // reads as settled on paper even though the cancel already reversed it.
  assert.ok(
    !/label=\{`Paid \(\$\{order\.payment\}\)`\}/.test(cancelledBranch),
    "the cancelled branch must NOT print a Paid line",
  );
  assert.ok(
    !/label="Due"/.test(cancelledBranch),
    "the cancelled branch must NOT print a Due line",
  );
});

// ── 9. The VOID slip tells the kitchen who and what ─────────────────────────

test("PIN: KOTReceipt's void variant prints *** VOID *** / CANCELLED ITEMS — DO NOT MAKE ONLY in the void branch (never in the plain-KOT branch, which prints KITCHEN ORDER instead), prefers voider/void-time with a both-or-neither fallback, and still prints modifiers/instructions", () => {
  const src = readSrc(KOT_RECEIPT);

  const ternaryIdx = src.indexOf("isVoid ? (");
  assert.ok(ternaryIdx >= 0, "the VOID banner must be gated on isVoid");
  const afterTernary = src.slice(ternaryIdx);
  const elseMarker = ") : (";
  const elseIdx = afterTernary.indexOf(elseMarker);
  assert.ok(elseIdx > 0, "the ternary must have an else branch printing KITCHEN ORDER");
  const voidBranch = afterTernary.slice(0, elseIdx);
  const elseBranchStart = elseIdx + elseMarker.length;
  const closeIdx = afterTernary.indexOf(")}", elseBranchStart);
  assert.ok(closeIdx > elseBranchStart, "the ternary must close with )}");
  const elseBranch = afterTernary.slice(elseBranchStart, closeIdx);

  // Scoped to the branch (mirrors the cancelled-receipt pin above) — a whole-
  // file string search still passes if the banner became unconditional, or if
  // it were moved to the WRONG branch (inverted). Neither escapes this.
  assert.match(voidBranch, /\*\*\* VOID \*\*\*/, "the void branch must print *** VOID ***");
  assert.match(voidBranch, /CANCELLED ITEMS — DO NOT MAKE/, "the void branch must print the DO NOT MAKE warning");
  assert.ok(!/\*\*\* VOID \*\*\*/.test(elseBranch), "the plain-KOT (else) branch must NOT print *** VOID ***");
  assert.ok(
    !/CANCELLED ITEMS — DO NOT MAKE/.test(elseBranch),
    "the plain-KOT (else) branch must NOT print the DO NOT MAKE warning",
  );
  assert.match(elseBranch, /KITCHEN ORDER/, "the plain-KOT (else) branch must print KITCHEN ORDER");
  assert.ok(!/KITCHEN ORDER/.test(voidBranch), "the void branch must NOT also print KITCHEN ORDER");

  assert.match(
    src,
    /const voidMeta = isVoid && voidedBy && voidedAt \? \{ by: voidedBy, at: voidedAt \} : null;/,
    "a slip naming only ONE of who/when must fall back to the tab's opener/open-time, not print a half-identified attribution",
  );
  assert.match(src, /fmtTime\(voidMeta\?\.at \?\? order\.createdAt\)/);
  assert.match(src, /voidMeta\?\.by \?\? order\.receiver/);
  assert.match(src, /item\.modifiers\.length > 0/, "a void slip must still show the voided line's modifiers");
  assert.match(src, /item\.instructions &&/, "a void slip must still show the voided line's instructions");
});

// ── 10. A void's attribution can never leak onto a real ticket ─────────────

test("PIN: queueKotRound filters items to the CURRENT round and labels the ticket with it (else every fired round reprints the whole tab and the kitchen makes the food twice) — queueVoidSlip carries the void entry's OWN qty/modifiers/instructions (never hardcoded empty), and both queueKotRound AND reprintKot reset variant/reason/voidedBy/voidedAt", () => {
  const src = readSrc(USE_POS_PRINT);

  const voidStart = src.indexOf("const queueVoidSlip");
  const reprintStart = src.indexOf("const reprintKot");
  assert.ok(voidStart >= 0 && reprintStart > voidStart, "queueVoidSlip and reprintKot must both exist, in that order");
  const voidBody = src.slice(voidStart, reprintStart);

  const qtyMatches = voidBody.match(/qty:\s*[^,]+,/g) ?? [];
  assert.equal(qtyMatches.length, 1, "queueVoidSlip's synthesized line must set qty exactly once");
  assert.match(qtyMatches[0], /entry\.qty/, "qty must come from the void entry, never a literal");

  const modifiersMatches = voidBody.match(/modifiers:\s*[^,]+,/g) ?? [];
  assert.equal(modifiersMatches.length, 1);
  assert.match(modifiersMatches[0], /entry\.modifiers \?\? \[\]/, "modifiers must come from the void entry, never a hardcoded []");

  const instructionsMatches = voidBody.match(/instructions:\s*[^,]+,/g) ?? [];
  assert.equal(instructionsMatches.length, 1);
  assert.match(
    instructionsMatches[0],
    /entry\.instructions \?\? ""/,
    "instructions must come from the void entry, never a hardcoded empty string",
  );

  const kotRoundStart = src.indexOf("const queueKotRound");
  assert.ok(kotRoundStart >= 0 && kotRoundStart < voidStart, "queueKotRound must exist before queueVoidSlip");
  const kotRoundBody = src.slice(kotRoundStart, voidStart);

  assert.match(
    kotRoundBody,
    /setKotRoundItems\(order\.items\.filter\(\(it\) => it\.kotRound === order\.kotRounds\)\)/,
    "queueKotRound must filter items down to the CURRENT round — without this filter, firing round 2 reprints round 1's items too and the kitchen makes them again (§7 path 2: 'round 2 prints only the new items')",
  );
  assert.match(
    kotRoundBody,
    /setKotRoundLabel\(`Round \$\{order\.kotRounds\}`\)/,
    "queueKotRound must label the ticket with the current round number",
  );

  const resetAssertions = [
    /setKotVariant\("kot"\);/,
    /setVoidReason\(undefined\);/,
    /setVoidedBy\(undefined\);/,
    /setVoidedAt\(undefined\);/,
  ];
  for (const re of resetAssertions) {
    assert.match(kotRoundBody, re, `queueKotRound must reset ${re} — a fresh round must not inherit an earlier void's banner`);
  }

  const reprintBody = src.slice(reprintStart);
  for (const re of resetAssertions) {
    assert.match(reprintBody, re, `reprintKot must reset ${re} — a plain reprint must not inherit an earlier void's banner`);
  }
});

// ── 11. The end-of-day slip is reachable by the staff who hold the cash ────
// EndOfDaySummary's dues-mode iteration (DUES_RECEIPT_MODES) is already pinned
// in due-payment.test.ts — this pin only covers EndOfDayButton's OWN gating.

test("PIN: EndOfDayButton references no session/role source at all — the cashier who took the cash must be able to print the closing slip — and gates the print button on its figures being loaded, and supports a chosen date", () => {
  const src = readSrc(END_OF_DAY_BUTTON);
  assert.ok(
    !/\buseAuth\b/.test(src) &&
      !/\buseSession\b/.test(src) &&
      !/\bisAdmin\b/.test(src) &&
      !/\brequireAdmin\b/.test(src) &&
      !/\bAdminGuard\b/.test(src) &&
      !/\brole\b/.test(src),
    "EndOfDayButton must not reference ANY session/role source (useAuth/useSession/isAdmin/requireAdmin/AdminGuard/role) — pinning the absence of the capability itself, not just a few known gate spellings, so an idiomatic inverse gate can't escape this check. The cashier who took the cash during the shift must be able to reconcile it.",
  );
  assert.match(
    src,
    /const ready =\s*!!summary\.data && !!settings\.data && \(!isToday \|\| openTabs\.isSuccess\);/,
    "ready must require the open-tabs query to have succeeded for TODAY specifically, so the slip never prints a false 'all tabs settled'",
  );
  assert.match(src, /disabled=\{!ready\}/, "the print button must be disabled until ready");
  assert.match(src, /<Input\s+type="date"/, "a date picker must exist so a past day's slip can be reprinted");
  assert.match(src, /onChange=\{\(e\) => setDate\(e\.target\.value\)\}/);
});
