// The customer sheet's SOURCE pins (U1 Task 10; values 8.1-8.3 in docs/superpowers/specs/2026-10-20-pos-html-values.md;
// design 4 builder-check, 6.12; owner Q1; rulings P30-P33). The sheet is three files: CustomerSearch.tsx (the Radix
// dialog: frame, head, search, list area, foot), CustomerRow.tsx (one search result) and CustomerAddForm.tsx (the add
// form). It opens from the cart's Customer cell (CartHead.tsx) and from the payment sheet's pill (PaymentModal.tsx), so on
// /pos, the Orders page and the dashboard alike. No React test framework here (see lib/table-flow-paths.test.ts): raw
// readFileSync pins. CustomerSearch's trigger and search-safety pins stay in lib/pos-header-paths.test.ts and
// lib/customer-privacy-paths.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

const SEARCH = "apps/cafe/components/pos/CustomerSearch.tsx";
const ROW = "apps/cafe/components/pos/CustomerRow.tsx";
const FORM = "apps/cafe/components/pos/CustomerAddForm.tsx";

const tokensOf = (src: string, name: string): string[] => src.match(new RegExp(`const ${name} =\\s*"([^"]*)"`))?.[1]?.split(/\s+/) ?? [];
function expectTokens(src: string, name: string, list: string[]): void {
  const tokens = tokensOf(src, name);
  for (const t of list) assert.ok(tokens.includes(t), `${name}: "${t}"`);
}

// Owner Q1: the HTML's words where it has the element — the search's "Phone number or name" (was "Name or mobile…"),
// "+ New customer" (was "New"), "Mobile number" (was "Mobile"), the form's placeholders. Ours for our features:
// "Customer", "Walk-In" (removes the customer), "Add customer", the search lines, "Results" as the caption. Ruling P30:
// the sub line names the order as the HTML's does (the cart's title / the payment sheet's place word), and today's
// sentence is the list's line until a search runs (design 4) and the dialog's description for screen readers.
test("PIN: the customer sheet's words (owner Q1) and its sub line, the order the caller names (ruling P30)", () => {
  const src = readSrc(SEARCH);
  const has = (re: RegExp, what: string) => assert.match(src, re, what);
  has(/placeholder="Phone number or name"/, "the HTML's search placeholder");
  has(/>\s*\+ New customer\s*<\/button>/, "the HTML's new-customer button (was New)");
  has(/<DialogPrimitive\.Title className=\{TITLE_CLASS\}>Customer<\/DialogPrimitive\.Title>/, "today's title");
  has(/context\?: string;/, "the order the sheet is for, from its caller");
  has(/\{context && \(\s*<div data-ui="cs-context" className=\{SUB_CLASS\}>\s*\{context\}\s*<\/div>\s*\)\}/, "the sub line names it; none without");
  has(/const SEARCH_HINT = "Search by name or mobile, or add a new customer\.";/, "today's description");
  has(/<DialogPrimitive\.Description className="sr-only">\{SEARCH_HINT\}<\/DialogPrimitive\.Description>/, "read out as the description");
  assert.equal(src.split("{SEARCH_HINT}").length - 1, 2, "on screen only once: the list's line until a search runs (P30)");
  has(/>\s*Walk-In\s*<\/button>/, "today's Walk-In");
  has(/onClick=\{\(\) => select\(undefined\)\}/, "Walk-In removes the customer");
  for (const line of ["Searching…", "Offline — could not check the customer list.", "Search failed. Try again.", "No matches. Add a new customer below."]) {
    assert.ok(src.includes(line), `today's line "${line}"`);
  }
  has(/aria-label="Cancel"/, "today's Cancel is the HTML's back button (to the search; ruling P33)");
  has(/initialMobile=\{termIsPhoneLike \? strippedTerm : undefined\}/, "a phone-like term seeds the mobile");
  has(/const termMode = termIsPhoneLike \? "Phone" : term\.trim\(\) \? "Name" : "";/, "the HTML's mode word, from the same rule");
  for (const gone of ["Name or mobile…", "UserPlus", "@/components/ui/dialog", "@/components/ui/button", "Frequent customers"]) {
    assert.ok(!src.includes(gone), `no ${gone}: the HTML's customer sheet (U1 Task 10)`);
  }
  const cart = readSrc("apps/cafe/components/pos/CartHead.tsx");
  assert.ok(cart.includes("context={cartTitle({ resumedOrder })}"), "the cart's cell: the cart's own title (New order / Table T-4 / Walk-In)");
  const modal = readSrc("apps/cafe/components/pos/PaymentModal.tsx");
  assert.ok(modal.includes("context={paymentPlace(tableNo, newSale)}"), "the payment pill: the payment title's place word");
});

// Ruling P31: the caption ("Results", values 8.2 list label) sits over the rows and over the no-match line, so that line
// is where the HTML's empty text is; before a search and while one runs there is none.
test("PIN: the caption sits over the rows and over the no-match line (ruling P31)", () => {
  const src = readSrc(SEARCH);
  assert.match(
    src,
    /const noMatches =\s*!searching && !isPaused && !isError && debounced\.trim\(\)\.length >= CUSTOMER_SEARCH_MIN_CHARS && rows\.length === 0;/,
    "the no-match case, ruled out offline and failed first (as the line's own pinned chain)",
  );
  assert.match(src, /\{\(rows\.length > 0 \|\| noMatches\) && \(\s*<div data-ui="cs-caption" className=\{CAPTION_CLASS\}>\s*Results\s*<\/div>/, "the caption");
});

test("PIN: the add form keeps today's rules, seeding and focus (CustomerAddForm.tsx)", () => {
  const src = readSrc(FORM);
  const has = (re: RegExp, what: string) => assert.match(src, re, what);
  has(/>\s*Mobile number\s*<\/span>/, "the HTML's mobile caption (was Mobile)");
  has(/>\s*Name\s*<\/span>/, "the name caption");
  has(/placeholder="98200 12345"[\s\S]*placeholder="Customer name"/, "the HTML's form placeholders");
  has(/"Add customer"/, "today's Add customer");
  has(/id="new-customer-mobile"[\s\S]*?inputMode="numeric"[\s\S]*?autoFocus=\{focusMobile\}/, "the mobile field: id, keypad, focus");
  has(/id="new-customer-name"[\s\S]*?autoFocus=\{!focusMobile\}/, "the name field: id, focus");
  has(/const valid = name\.trim\(\)\.length > 0 && mobile\.trim\(\)\.length >= 10;/, "today's rules");
  has(/disabled=\{!valid \|\| createCustomer\.isPending\}/, "blocked until they pass, and while it saves (ruling P32: at .5)");
  has(/notes: "Regular",/, "today's create");
  assert.ok(!src.includes("10-digit number"), "the HTML's placeholder, not today's");
  // Inside the cart sheet or the payment sheet that dialog pulls a plain autoFocus back before this one traps the focus.
  assert.match(readSrc(SEARCH), /onOpenAutoFocus=\{focusMarkedField\}[\s\S]*data-autofocus=""/, "on open the marked field takes the focus: the search");
  has(/data-autofocus=\{focusMobile \? "" : undefined\}[\s\S]*data-autofocus=\{focusMobile \? undefined : ""\}/, "or the form's empty field");
});

// Values 8.1-8.3 / 0.3 (csH, csMaxH, sheetAlign, sheetPad, sheetRadius): the --scrim (fadeIn .2s; the panel centred in
// 16px, on the foot below 720px) at z-index 51, over the payment sheet's 50 (the HTML's 46 over 45); the 460px panel,
// 600 tall (88dvh below 720px), a 1px --border, radius 14 (14 14 0 0), sheetIn .32s; the head (16 16 12, gap 10, 17/600
// over 12.5 --text-2, the 32px back and ✕); the 48px search with the --accent rule and ring; the caption; 56px rows;
// the foot (46px "+ New customer", 36px link); the form's 48px fields (1.5px --border, radius 12) and 48px button.
test("PIN: the customer sheet's look is the HTML's (values 8.1-8.3), over the payment sheet", () => {
  const src = readSrc(SEARCH);
  expectTokens(src, "SCRIM_CLASS", ["fixed", "inset-0", "z-[51]", "flex", "items-center", "justify-center", "bg-scrim", "p-4", "motion-safe:animate-scrim-in", "max-tab:items-end", "max-tab:p-0"]);
  expectTokens(src, "PANEL_CLASS", ["flex", "w-full", "max-w-[460px]", "flex-col", "overflow-hidden", "rounded-[14px]", "border", "border-border", "bg-card", "[box-shadow:var(--pop)]", "motion-safe:animate-html-sheet-in-cs", "tab:h-[600px]", "max-tab:h-[88vh]", "max-tab:rounded-[14px_14px_0_0]"]);
  expectTokens(src, "HEAD_CLASS", ["flex", "flex-none", "items-center", "gap-2.5", "px-4", "pt-4", "pb-3"]);
  expectTokens(src, "SUB_CLASS", ["text-[12.5px]", "text-muted-foreground"]);
  expectTokens(src, "ROUND_CLASS", ["flex", "size-8", "flex-none", "items-center", "justify-center", "border-0", "bg-surface-3"]);
  expectTokens(src, "SEARCH_BOX_CLASS", ["flex", "h-12", "items-center", "gap-2.5", "rounded-[12px]", "border-[1.5px]", "border-primary", "px-3", "[box-shadow:0_0_0_4px_var(--accent)]"]);
  expectTokens(src, "SEARCH_INPUT_CLASS", ["min-w-0", "flex-1", "text-[15px]", "max-tab:text-[16px]", "placeholder:text-subtle-foreground"]);
  expectTokens(src, "CAPTION_CLASS", ["flex-none", "px-[18px]", "pt-1", "pb-1.5", "text-[11.5px]", "font-semibold", "tracking-[0.05em]", "uppercase", "text-subtle-foreground"]);
  expectTokens(src, "NEW_CLASS", ["h-[46px]", "rounded-[12px]", "bg-primary", "text-[14.5px]", "font-semibold", "text-primary-foreground", "hover:bg-primary-hover"]);
  expectTokens(src, "LINK_CLASS", ["h-9", "bg-transparent", "text-[13.5px]", "font-medium", "text-link"]);
  const row = readSrc(ROW);
  expectTokens(row, "ROW_CLASS", ["flex", "w-full", "items-center", "gap-3", "rounded-[10px]", "px-2.5", "py-[9px]", "text-left", "hover:bg-hover", "motion-safe:animate-html-rise-cs"]);
  expectTokens(row, "AVATAR_CLASS", ["flex", "size-[38px]", "flex-none", "items-center", "justify-center", "rounded-[50%]", "text-[13px]", "font-semibold"]);
  expectTokens(row, "PHONE_CLASS", ["block", "font-mono", "text-[12.5px]", "text-muted-foreground"]);
  expectTokens(row, "RIGHT_CLASS", ["flex-none", "text-right", "text-[12px]", "leading-[1.4]", "text-muted-foreground"]);
  assert.ok(row.includes('const ROW_CURRENT_CLASS = "bg-accent";'), "the current customer's row on --accent-t, with a check");
  assert.ok(row.includes("AVATAR_HUES[avatarHueIndex(c.name)]"), "U0's precomputed avatar tints, by name (no runtime color-mix)");
  const form = readSrc(FORM);
  expectTokens(form, "FIELD_BOX_CLASS", ["flex", "h-12", "items-center", "gap-2", "rounded-[12px]", "border-[1.5px]", "border-border", "bg-card", "px-3"]);
  expectTokens(form, "SAVE_CLASS", ["h-12", "w-full", "rounded-[12px]", "bg-primary", "text-[15px]", "font-semibold", "disabled:opacity-50"]);
  assert.ok(readSrc("apps/cafe/lib/payment-sheet.ts").includes('"fixed inset-0 z-50 '), "the payment sheet stays at 50, under it");
  const css = readFileSync(path.join(REPO_ROOT, "apps/cafe/app/globals.css"), "utf8");
  assert.ok(css.includes("--animate-html-sheet-in-cs: sheet-in 0.32s cubic-bezier(0.2, 0.8, 0.2, 1) both;"), "the sheet's sheetIn .32s");
  assert.ok(css.includes("--animate-html-rise-cs: brand-rise 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) both;"), "a row's rise .3s");
});
