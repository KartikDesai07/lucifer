// POS header-chip SOURCE pins (CB-1 S3, split out of lib/pos-layout-paths.test.ts
// to keep both files under the ~300-line convention). Covers PosHeader.tsx (since
// U1 Task 6 the HTML's switch-order button), TableSelector.tsx,
// CustomerSearch.tsx and OpenTabsButton.tsx (since U1 Task 6 the HTML's Open
// orders panel with the KOT reprint at its foot). No React/route test framework exists here (see
// lib/table-flow-paths.test.ts), so these are raw readFileSync pins. Own
// readSrc wiring — shares no module with either companion file beyond
// lib/source-pin-utils.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const POS_HEADER = "apps/cafe/components/pos/PosHeader.tsx";
const TABLE_SELECTOR = "apps/cafe/components/pos/TableSelector.tsx";
const CUSTOMER_SEARCH = "apps/cafe/components/pos/CustomerSearch.tsx";
const OPEN_TABS_BUTTON = "apps/cafe/components/pos/OpenTabsButton.tsx";

// U0 Task 3 (ruling R4): "POS Terminal" is the page header's title (the shell's 56px header, values 2.5), read to screen
// readers only on /pos (U1 Task 1). U1 Task 6 (values 1.2-1.4, 7; design 6.2; owner Q16, Q17): PosHeader is the HTML's
// switch-order button, handed to the header's actions box at every width through PageHeader's phoneActions; it opens
// the Open orders panel (OpenTabsButton), whose foot holds today's KOT reprint. The body control row is gone.
test("PIN: PosHeader names the page through the header slot and hands it the switch-order button at every width (phoneActions)", () => {
  const src = stripComments(readSrc(POS_HEADER));
  assert.match(src, /<PageHeader\s+title="POS Terminal"\s+phoneActions=\{/, "the title goes to the shell header, the switch button to its actions box at every width");
  assert.ok(!/<h[12]\b/.test(src), "no heading of its own");
  const phone = src.slice(src.indexOf("phoneActions={"));
  assert.match(phone, /^phoneActions=\{\s*<OpenTabsButton\b/, "the Open orders panel and its trigger are the header's phone actions");
  assert.ok(src.includes("trigger={<SwitchOrderButton view={view} />}"), "the switch-order button opens the panel");
  assert.match(src, /const view = switchView\(\{ resumedOrder, customerName, count, newCount, total \}, openTabs\);/, "its words come from lib/pos-open-orders.ts");
  assert.match(src, /import \{[^}]*\bswitchView\b[^}]*\} from "@\/lib\/pos-open-orders";/, "the pure helper");
  assert.ok(src.includes("onSelect={onTableChange}"), "the Floor hand-off still selects a table");
  // The body row's controls are gone: no KOT button of its own (it is the panel's foot), no row classes.
  for (const gone of ["ChefHat", "POS_HEADER_CONTROL_CLASS", "flex-wrap", "lastOrder &&", "onClick={onReprintKot}", "<Button"]) {
    assert.ok(!src.includes(gone), `PosHeader must no longer carry ${gone}: the control row is gone (U1 Task 6)`);
  }
});

// Values 1.2 (the HTML's Switch order button): 42px, radius 12, padding 0 10 0 6, gap 10, max-width 340 (a phone: no
// cap, flex 1); the 30px --ink code tile with its 9px dot in a 2px ring; title 14/600/1.2 and sub 11.5 --text-2/1.3,
// both cut with an ellipsis; the 22px --surface-3 count pill; the 16px --text-3 chevron; hover --text-3 border + the
// soft shadow. Busy never disables it: the panel opens, its rows and the reprint are what lock (owner Q17).
test("PIN: the switch-order button is the HTML's (values 1.2): sizes, parts, dot colours, hover; it stays openable while busy", () => {
  const src = stripComments(readSrc(POS_HEADER));
  const literal = (name: string) => src.match(new RegExp(`const ${name} =\\s*"([^"]*)"`))?.[1]?.split(/\s+/) ?? [];
  const button = literal("SWITCH_CLASS");
  for (const t of [
    "flex", "h-[42px]", "min-w-0", "max-w-[340px]", "flex-[0_1_auto]", "items-center", "gap-2.5", "rounded-[12px]", "border", "border-border",
    "bg-card", "py-0", "pl-1.5", "pr-2.5", "text-left", "text-foreground", "cursor-pointer", "hover:border-subtle-foreground",
    "hover:[box-shadow:0_4px_14px_rgba(0,0,0,0.06)]", "max-tab:max-w-none", "max-tab:flex-1",
  ]) {
    assert.ok(button.includes(t), `the switch button (values 1.2): "${t}"`);
  }
  assert.match(src, /<button\s+type="button"\s+title="Switch order"\s+data-ui="pos-switch"/, "the HTML's title, a data-ui for the room rule");
  const tile = literal("CODE_CLASS");
  for (const t of ["relative", "flex", "size-[30px]", "flex-none", "rounded-[8px]", "bg-ink", "text-on-ink", "text-[11.5px]", "font-bold", "tracking-[-0.01em]"]) {
    assert.ok(tile.includes(t), `the code tile: "${t}"`);
  }
  const dot = literal("DOT_RING_CLASS");
  for (const t of ["absolute", "-right-[3px]", "-top-[3px]", "size-[9px]", "rounded-[50%]", "[box-shadow:0_0_0_2px_var(--card)]"]) {
    assert.ok(dot.includes(t), `the tile's dot: "${t}"`);
  }
  assert.match(src, /empty: STATUS_CLASSES\.neutral\.dot,\s*unsent: STATUS_CLASSES\.warn\.dot,\s*sent: STATUS_CLASSES\.ok\.dot,/, "grey / orange / green (values 1.3 dot), the shared status dots (lib/ui)");
  assert.ok(src.includes('className="flex min-w-0 flex-1 flex-col"'), "the text column takes the shrink");
  assert.ok(src.includes('className="truncate text-[14px] font-semibold leading-[1.2]"'), "the title");
  assert.ok(src.includes('className="truncate text-[11.5px] leading-[1.3] text-muted-foreground"'), "the sub line");
  // U1 final fix wave (the final review's minor 4): the pill waits for the open tabs' first answer.
  assert.match(src, /\{view\.count !== null && \(\s*<span data-ui="pos-switch-count" className=\{COUNT_CLASS\}>/, "no pill until the open tabs are known");
  assert.ok(src.includes("switchView({ resumedOrder, customerName, count, newCount, total }, openTabs)"), "the header hands switchView the query's own data");
  assert.ok(src.includes("tabs={openTabs ?? NO_OPEN_TABS}"), "the panel lists a stable empty list meanwhile");
  const pill = literal("COUNT_CLASS");
  for (const t of ["flex", "h-[22px]", "flex-none", "items-center", "whitespace-nowrap", "rounded-[999px]", "bg-surface-3", "px-2", "text-[11.5px]", "font-semibold", "text-muted-foreground"]) {
    assert.ok(pill.includes(t), `the count pill: "${t}"`);
  }
  assert.ok(src.includes('<path d="m6 9 6 6 6-6" />'), "the chevron");
  assert.ok(src.includes('className="flex-none text-subtle-foreground"'), "in --text-3");
  assert.ok(!src.includes("disabled="), "nothing in PosHeader is disabled while busy: the switch button stays openable");
});

// U1 Task 4 (owner Q9, design 6.5): the Table and Customer chips are the cart head's two cells now
// (components/pos/CartHead.tsx, pinned in lib/pos-layout-paths.test.ts); the Floor hand-off still selects a table
// through onTableChange.
test("PIN: the Table and Customer chips left PosHeader for the cart's cells (owner Q9) — no chip, no chip class, no move opener", () => {
  const src = stripComments(readSrc(POS_HEADER));
  for (const gone of [
    "<TableSelector",
    "<CustomerSearch",
    "LayoutGrid",
    "POS_HEADER_CHIP_FIXED_CLASS",
    "POS_HEADER_CHIP_FLEX_CLASS",
    "POS_HEADER_CHIP_ICON_CLASS",
    "onMoveTable",
    "onCustomerChange",
    "min-w-0 flex-1 xl:flex-none",
  ]) {
    assert.ok(!src.includes(gone), `PosHeader must no longer carry ${gone}: the cells live in the cart head`);
  }
  assert.ok(src.includes("onSelect={onTableChange}"), "the Floor hand-off still selects a table");
});

// U1 Task 11: the dialog is the HTML's "Choose a table" sheet on a Radix dialog of its own (DialogPrimitive, as the
// customer and payment sheets), so the trigger is DialogPrimitive.Trigger (look; the pin keeps its meaning: the cell).
test("PIN: TableSelector opens from the trigger it is given (the cart's Table cell) — the HTML's table sheet", () => {
  const src = stripComments(readSrc(TABLE_SELECTOR));
  assert.match(src, /trigger: ReactElement;/, "TableSelector must take the cell it opens from");
  assert.ok(src.includes("<DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>"), "the cell is the dialog's trigger");
  for (const gone of ["LayoutGrid", "POS_HEADER_CHIP_ICON_CLASS", "className?: string", "disabled?: boolean"]) {
    assert.ok(!src.includes(gone), `TableSelector must no longer carry its chip's ${gone}: the cell brings its own look and lock`);
  }
  assert.ok(src.includes("title={TABLE_SHEET_TITLE}"), "landmark: the HTML's sheet, \"Choose a table\" (U1 Task 11)");
});

// U1 Task 9 (values 11.1; design 6.11): the payment sheet is the only user of CustomerSearch's own trigger, so the chip
// became the HTML's 28px customer pill ("+ Add customer" / "Customer: {name} · change"; no icon). Reason: the HTML's
// payment look. The cart's Customer cell still brings its own trigger. U1 Task 10: the dialog is the HTML's customer
// sheet on a Radix dialog of its own (DialogPrimitive), so the trigger is DialogPrimitive.Trigger.
test("PIN: CustomerSearch's own trigger is the payment sheet's pill and it opens from the cart's Customer cell when given one", () => {
  const src = stripComments(readSrc(CUSTOMER_SEARCH));
  assert.match(src, /trigger\?: ReactElement;/, "an optional trigger (the cart's Customer cell)");
  assert.match(src, /<DialogPrimitive\.Trigger asChild>\s*\{trigger \?\? \(/, "the given trigger, else the payment sheet's pill");
  assert.match(
    src,
    /import\s*\{[^}]*PAY_PILL_CLASS[^}]*\}\s*from\s*"@\/lib\/payment-sheet"/,
    "the pill's look comes from the payment sheet's look",
  );
  assert.ok(!src.includes("POS_HEADER_CHIP_ICON_CLASS"), "the chip's icon went with the chip");
  assert.ok(src.includes("{pickerPillText(value?.name)}"), "the pill's words from lib/payment-sheet.ts");
});

test("PIN: CustomerSearch's empty trigger label is not Walk-In (the table already owns that word)", () => {
  const csSrc = stripComments(readSrc(CUSTOMER_SEARCH));
  const lib = stripComments(readSrc("apps/cafe/lib/payment-sheet.ts"));
  const empty = lib.match(/export const ADD_CUSTOMER_PILL = "([^"]+)";/);
  assert.ok(empty, "the pill's empty label must be one plain constant");
  assert.equal(empty![1], "+ Add customer", `the pill's empty label must be "+ Add customer", found "${empty![1]}"`);
  assert.ok(!/Walk-In/.test(empty![1]), "never Walk-In");
  assert.match(csSrc, /title=\{value \? value\.name : "Select customer"\}/, "CustomerSearch's trigger must carry a title=");
});

// U1 Task 10 (values 8; design 4, 6.12; owner Q1; rulings P30-P33): the customer sheet's own words, behaviour and look
// are pinned in lib/customer-sheet-paths.test.ts (CustomerSearch, CustomerRow, CustomerAddForm).

// U1 Task 6 (values 7; design 6.2; owner Q16, Q17): today's Open tabs dialog became the HTML's Open orders panel — a
// Radix dialog (focus trap, Escape, the scrim closes it) opened by the switch button. Its rows are our open tabs (the
// list the page already reads), searched on the device, in the tabs All · Tables · Walk-In (no "+ New …" footer); a tap
// resumes the tab through today's requestResume (its prompt rules) and closes the panel. The KOT reprint is its foot,
// only after this device printed or sent something (today's rule), with today's title.
test("PIN: OpenTabsButton is the HTML's Open orders panel — the trigger it is given, the head, search, tabs, rows, no footer buttons", () => {
  const src = stripComments(readSrc(OPEN_TABS_BUTTON));
  assert.match(src, /import \* as DialogPrimitive from "@radix-ui\/react-dialog";/, "a Radix dialog: focus trap, Escape, role=dialog (F8/F9 stay off while it is open)");
  assert.ok(src.includes("<DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>"), "the switch button opens it");
  assert.match(src, /trigger: ReactElement;/, "it takes the button it opens from");
  assert.ok(src.includes('<DialogPrimitive.Title className="text-[16px] font-semibold">Open orders</DialogPrimitive.Title>'), "the HTML's title, 16/600");
  assert.ok(src.includes("{openOrdersSummary(tabs)}"), "\"{N} open · ₹{sum}\"");
  assert.ok(src.includes('placeholder="Table, customer, phone or order #"'), "the HTML's placeholder");
  assert.ok(src.includes("openOrderRows(tabs, currentId, q, tab, now)"), "the rows from lib/pos-open-orders.ts");
  assert.ok(src.includes("const counts = openOrderCounts(tabs);"), "the tab counts, whatever the search");
  assert.ok(src.includes("OPEN_ORDER_TABS.map("), "All · Tables · Walk-In");
  assert.ok(src.includes("onClick={() => resume(row.tab)}"), "a row resumes its tab");
  // Ruling P18 (2026-10-21): the tab already on screen only closes the panel (the HTML's), no requestResume for it.
  assert.match(
    src,
    /const resume = \(order: Order\) => \{\s*if \(order\._id !== currentId\) onResume\(order\);\s*setOpen\(false\);\s*\};/,
    "another tab: through the page's requestResume (its prompt rules); the current one: no resume; then it closes",
  );
  assert.ok(src.includes("No open orders match “{q.trim()}”"), "the HTML's no-match line");
  assert.ok(src.includes("No open tabs") && src.includes("Orders you send to the kitchen appear here until settled."), "our empty words");
  for (const gone of ["+ Takeaway", "+ Delivery", "+ Table", "DialogContent", "EmptyState", "POS_DIALOG_LIST_CAP_CLASS"]) {
    assert.ok(!src.includes(gone), `no ${gone}: the HTML's panel with our tabs and no footer buttons (owner Q16)`);
  }
});

test("PIN: the KOT reprint is the Open orders panel's foot (owner Q17) — only with a last order, today's title, locked while busy", () => {
  const src = stripComments(readSrc(OPEN_TABS_BUTTON));
  const foot = src.slice(src.indexOf("{lastOrder && ("));
  assert.ok(src.includes("{lastOrder && ("), "only after this device printed or sent something (today's rule)");
  // Ruling P19 (U1 final fix wave): the tap starts today's reprint and closes the panel (the HTML's footer buttons close it;
  // the toast reports the result).
  assert.ok(foot.includes("onClick={reprint}"), "today's reprint: the last ticket this device handled");
  assert.match(src, /const reprint = \(\) => \{\s*onReprintKot\(\);\s*setOpen\(false\);\s*\};/, "P19: the reprint starts, then the panel closes");
  assert.ok(foot.includes("aria-label={`Print kitchen ticket for ${lastOrder.orderId}`}"), "today's aria-label");
  assert.ok(foot.includes("title={`Print kitchen ticket for ${lastOrder.orderId}`}"), "today's title");
  assert.ok(foot.includes("Print kitchen ticket · {lastOrder.orderId}"), "the visible words");
  assert.ok(foot.includes("disabled={isBusy}"), "locked while a send flies");
});

// Values 7.1 / 0.3: the scrim (6% black, the panel at the top right under the header, 62/16/16; a phone: --scrim, the
// panel at the foot), the panel (420px, max-height min(640px, 100dvh - 80px); a phone: full width, 86dvh, radius
// 18 18 0 0), the head, the 40px search on --surface-2 (15px; 16px below 720px, ruling R36), the segmented tabs, the
// 54px rows (36px tile, --accent for the current one), the empty line. The search is focused on open from 1100px only.
test("PIN: the Open orders panel's frame is the HTML's (values 7.1), the search focused on open from 1100px only", () => {
  const src = stripComments(readSrc(OPEN_TABS_BUTTON));
  const literal = (name: string) => src.match(new RegExp(`const ${name} =\\s*"([^"]*)"`))?.[1]?.split(/\s+/) ?? [];
  const expect = (name: string, list: string[]) => {
    const tokens = literal(name);
    for (const t of list) assert.ok(tokens.includes(t), `${name}: "${t}"`);
  };
  expect("SCRIM_CLASS", ["fixed", "inset-0", "z-[44]", "flex", "items-start", "justify-end", "bg-[rgba(0,0,0,0.06)]", "px-4", "pt-[62px]", "pb-4", "max-tab:items-end", "max-tab:justify-center", "max-tab:bg-scrim", "max-tab:p-0", "motion-safe:animate-scrim-in"]);
  expect("PANEL_CLASS", ["flex", "w-full", "max-w-[420px]", "flex-col", "overflow-hidden", "rounded-[16px]", "border", "border-border", "bg-card", "[box-shadow:var(--pop)]", "motion-safe:animate-html-sheet-in-op", "max-tab:max-w-none", "max-tab:rounded-[18px_18px_0_0]"]);
  expect("HEAD_CLASS", ["flex", "flex-none", "flex-col", "gap-2.5", "border-b", "border-border-2", "px-3.5", "pt-3.5", "pb-2.5"]);
  expect("SEARCH_CLASS", ["flex", "h-10", "items-center", "gap-2", "rounded-[10px]", "border", "border-border", "bg-surface-2", "px-3"]);
  expect("INPUT_CLASS", ["min-w-0", "flex-1", "text-[15px]", "max-tab:text-base", "placeholder:text-subtle-foreground"]);
  expect("TABS_CLASS", ["grid", "grid-cols-3", "gap-0.5", "rounded-[8px]", "bg-surface-3", "p-0.5"]);
  expect("ROW_CLASS", ["flex", "w-full", "items-center", "gap-3", "rounded-[10px]", "px-2.5", "py-[9px]", "text-left", "motion-safe:animate-html-rise-row"]);
  expect("TILE_CLASS", ["relative", "flex", "size-9", "flex-none", "items-center", "justify-center", "rounded-[10px]", "text-[12px]", "font-bold"]);
  expect("FOOT_BUTTON_CLASS", ["h-10", "w-full", "rounded-[10px]", "border", "border-border", "bg-card", "text-[13px]", "font-semibold", "not-disabled:hover:border-primary", "not-disabled:hover:text-accent-foreground"]);
  assert.ok(src.includes("onOpenAutoFocus={focusOnOpen}"), "the panel decides where focus lands");
  assert.ok(src.includes("window.matchMedia(DESK_QUERY).matches"), "the search from 1100px (the HTML's desk), else the panel itself");
  assert.ok(src.includes("style={{ animationDelay: row.delay }}"), "the rows rise in turn (values 7.2 d)");
  const css = readSrc("apps/cafe/app/globals.css");
  assert.ok(css.includes("--animate-html-sheet-in-op: sheet-in 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) both;"), "the panel's sheetIn .3s");
  assert.ok(css.includes("--animate-html-rise-row: brand-rise 0.35s cubic-bezier(0.2, 0.8, 0.2, 1) both;"), "a row's rise .35s");
});

// U1 Task 4: TableSelector's trigger is the cart's Table cell (its own look), so it takes no className any more; U1
// Task 6: OpenTabsButton's trigger is the switch button (PosHeader.tsx), so neither does it.
test("PIN: CustomerSearch accepts a className and applies it to its trigger", () => {
  const src = stripComments(readSrc(CUSTOMER_SEARCH));
  assert.match(src, /className\?:\s*string/, "CustomerSearch must declare className?: string");
  assert.match(src, /cn\([^)]*\bclassName\b[^)]*\)/, "CustomerSearch must apply className via a cn(...) call on its trigger");
});

test("PIN: no stray lg: token remains in PosHeader/CustomerSearch/OpenTabsButton — the HTML's breakpoints are tab: and desk:", () => {
  for (const { label, path: rel } of [
    { label: "PosHeader.tsx", path: POS_HEADER },
    { label: "CustomerSearch.tsx", path: CUSTOMER_SEARCH },
    { label: "OpenTabsButton.tsx", path: OPEN_TABS_BUTTON },
  ]) {
    assert.ok(!stripComments(readSrc(rel)).includes("lg:"), `${label} must not carry a stray lg: token`);
  }
  // U1 Task 9: the chip (and its xl: width) became the payment sheet's pill.
  assert.match(stripComments(readSrc(CUSTOMER_SEARCH)), /PAY_PILL_CLASS/, "landmark: CustomerSearch's trigger is the payment pill");
});
