// CB-1d.3c / C3 — the five POS modal roots (ModifierModal, PaymentModal,
// PosPrompts, VoidItemDialog, MoveTableDialog) extracted out of pos/page.tsx
// into components/pos/PosModals.tsx; every callback prop it forwards is
// latched through the new hooks/use-stable-callback.ts latest-ref hook so a
// closed root's props stay Object.is-stable across taps that don't concern
// it. pos/page.tsx keeps every piece of modal STATE and now renders
// <PosModals; PosHeader is memoized too and fed Object.is-stable props from
// the page. Same REPO_ROOT/readSrc/stripComments/countOccurrences idiom as
// lib/pos-tile-paths.test.ts and lib/pos-pulse-paths.test.ts; raw source
// preferred for absence checks, every negative pin paired with a positive
// landmark from the same file (testing.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const USE_STABLE_CALLBACK = "apps/cafe/hooks/use-stable-callback.ts";
const POS_MODALS = "apps/cafe/components/pos/PosModals.tsx";
const POS_HEADER = "apps/cafe/components/pos/PosHeader.tsx";
const POS_PROMPTS = "apps/cafe/components/pos/PosPrompts.tsx";
const POS_PAGE = "apps/cafe/app/(dashboard)/pos/page.tsx";

test("PIN: hooks/use-stable-callback.ts is the latest-ref latch — useRef(fn) + useInsertionEffect writing latest.current = fn + a []-deps useCallback forwarding to latest.current; no useLayoutEffect/useEffect; <= 60 lines", () => {
  const src = readSrc(USE_STABLE_CALLBACK);
  const stripped = stripComments(src);

  assert.match(
    stripped,
    /export function useStableCallback<A extends unknown\[\], R>\(/,
    "use-stable-callback.ts must declare export function useStableCallback<A extends unknown[], R>(",
  );
  assert.match(stripped, /useInsertionEffect\(\(\) => \{/, "use-stable-callback.ts must call useInsertionEffect(() => {");
  assert.match(stripped, /latest\.current = fn;/, "use-stable-callback.ts must write latest.current = fn; inside the insertion effect");
  assert.match(
    stripped,
    /return useCallback\(\(\.\.\.args: A\) => latest\.current\(\.\.\.args\), \[\]\);/,
    "use-stable-callback.ts must return useCallback((...args: A) => latest.current(...args), []);",
  );

  // RAW source (not stripped) — the negative checks must see comments too, so
  // a banned hook named in a comment cannot slip past a blinded scan.
  assert.ok(!src.includes("useLayoutEffect("), "use-stable-callback.ts must never call useLayoutEffect( — useInsertionEffect is the whole point (runs in the commit's mutation phase, before any layout/passive effect)");
  assert.ok(!src.includes("useEffect("), "use-stable-callback.ts must never call useEffect( — a passive effect runs too late for a child that reads the callback from its own effect in the same commit");

  const lineCount = src.replace(/\n$/, "").split("\n").length;
  assert.ok(lineCount <= 60, `use-stable-callback.ts must stay <= 60 lines, got ${lineCount}`);
});

test("PIN: PosModals.tsx is a NON-memo shell whose four dynamic() loaders are each memo(dynamic( with the loader lines verbatim, no .displayName, and exactly 4 dynamic( calls", () => {
  const src = readSrc(POS_MODALS);
  const stripped = stripComments(src);

  assert.equal(countOccurrences(stripped, "memo(dynamic("), 4, `PosModals.tsx must call memo(dynamic( exactly 4 times, got ${countOccurrences(stripped, "memo(dynamic(")}`);
  assert.equal(countOccurrences(stripped, "dynamic("), 4, `PosModals.tsx must call dynamic( exactly 4 times (all four wrapped in memo(), got ${countOccurrences(stripped, "dynamic(")}`);

  assert.match(
    stripped,
    /const ModifierModal = memo\(dynamic\(\s*\(\) => import\("@\/components\/pos\/ModifierModal"\)\.then\(\(m\) => m\.ModifierModal\),\s*\{ ssr: false \},\s*\)\);/,
    "PosModals.tsx must declare the ModifierModal loader verbatim",
  );
  assert.match(
    stripped,
    /const PaymentModal = memo\(dynamic\(\s*\(\) => import\("@\/components\/pos\/PaymentModal"\)\.then\(\(m\) => m\.PaymentModal\),\s*\{ ssr: false \},\s*\)\);/,
    "PosModals.tsx must declare the PaymentModal loader verbatim",
  );
  assert.match(
    stripped,
    /const VoidItemDialog = memo\(dynamic\(\s*\(\) => import\("@\/components\/pos\/VoidItemDialog"\)\.then\(\(m\) => m\.VoidItemDialog\),\s*\{ ssr: false \},\s*\)\);/,
    "PosModals.tsx must declare the VoidItemDialog loader verbatim",
  );
  assert.match(
    stripped,
    /const MoveTableDialog = memo\(dynamic\(\s*\(\) => import\("@\/components\/orders\/MoveTableDialog"\)\.then\(\(m\) => m\.MoveTableDialog\),\s*\{ ssr: false \},\s*\)\);/,
    "PosModals.tsx must declare the MoveTableDialog loader verbatim",
  );

  // RAW source (not stripped) — the .displayName absence check must see
  // comments too; paired with the positive landmark that the memo(dynamic(
  // shape (checked above on stripped source) is really there in the raw file.
  assert.ok(!src.includes(".displayName"), "PosModals.tsx must never set .displayName on the memo(dynamic( wrappers — the profiler keeps naming them LoadableComponent so before/after harness rows stay comparable");
  assert.ok(src.includes("memo(dynamic("), "positive landmark: PosModals.tsx must contain memo(dynamic( in the raw file (the .displayName scan above isn't reading a blinded/empty file)");

  assert.match(stripped, /export function PosModals\(/, "PosModals.tsx must declare export function PosModals(");
  assert.ok(!src.includes("memo(function PosModals"), "PosModals.tsx must NOT wrap the PosModals shell itself in memo( — it re-mints callback props and a fresh totals object every render, so a memo here could never bail out (the gate is one level down, per root)");
});

test("PIN: PosModals latches EVERY callback prop it forwards — exactly 15 useStableCallback( call sites, one per callback prop, by name", () => {
  const src = readSrc(POS_MODALS);
  const stripped = stripComments(src);

  const expectedLatches = [
    "const modifierOpenChange = useStableCallback(onModifierOpenChange);",
    "const modifierConfirm = useStableCallback(onModifierConfirm);",
    "const paymentOpenChange = useStableCallback(onPaymentOpenChange);",
    "const paymentConfirm = useStableCallback(onPaymentConfirm);",
    "const selectCustomer = useStableCallback(onSelectCustomer ?? noopSelectCustomer);",
    "const closeConfirmOpenChange = useStableCallback(onCloseConfirmOpenChange);",
    "const confirmCloseTab = useStableCallback(onConfirmCloseTab);",
    "const cancelResume = useStableCallback(onCancelResume);",
    "const confirmResume = useStableCallback(onConfirmResume);",
    "const dismissFreeTable = useStableCallback(onDismissFreeTable);",
    "const confirmFreeTable = useStableCallback(onConfirmFreeTable);",
    "const voidOpenChange = useStableCallback(onVoidOpenChange);",
    "const voidConfirm = useStableCallback(onVoidConfirm);",
    "const moveTableOpenChange = useStableCallback(onMoveTableOpenChange);",
    "const moved = useStableCallback(onMoved);",
  ];
  assert.equal(expectedLatches.length, 15, "self-check: expectedLatches must list exactly 15 entries");
  for (const line of expectedLatches) {
    assert.ok(stripped.includes(line), `PosModals.tsx must contain the exact latch line: ${line}`);
  }

  // The import line reads `import { useStableCallback } from "..."` — no `(`
  // immediately follows the name there, so it does not match this substring.
  // Only the 15 call sites do.
  const callSites = countOccurrences(stripped, "useStableCallback(");
  assert.equal(callSites, 15, `PosModals.tsx must contain useStableCallback( exactly 15 times (one per call site; the import statement has no trailing "(" so it doesn't match), got ${callSites}`);

  assert.ok(stripped.includes("{...totals}"), "PosModals.tsx must spread {...totals} into PaymentModal");
  assert.ok(
    stripped.includes("onSelectCustomer={onSelectCustomer ? selectCustomer : undefined}"),
    "PosModals.tsx must pass onSelectCustomer={onSelectCustomer ? selectCustomer : undefined} — the prop's presence/absence still follows the parent's decision even though the latch itself is unconditional",
  );
});

test("PIN: PosModals renders the five roots in page order and owns NO state", () => {
  const src = readSrc(POS_MODALS);
  const stripped = stripComments(src);

  assert.match(stripped, /<ModifierModal/, "PosModals.tsx must render <ModifierModal");
  assert.match(stripped, /<PaymentModal/, "PosModals.tsx must render <PaymentModal");
  assert.match(stripped, /<PosPrompts/, "PosModals.tsx must render <PosPrompts");
  assert.match(stripped, /<VoidItemDialog/, "PosModals.tsx must render <VoidItemDialog");
  assert.match(stripped, /<MoveTableDialog/, "PosModals.tsx must render <MoveTableDialog");

  const iModifier = stripped.indexOf("<ModifierModal");
  const iPayment = stripped.indexOf("<PaymentModal");
  const iPrompts = stripped.indexOf("<PosPrompts");
  const iVoid = stripped.indexOf("<VoidItemDialog");
  const iMove = stripped.indexOf("<MoveTableDialog");
  assert.ok(
    iModifier < iPayment && iPayment < iPrompts && iPrompts < iVoid && iVoid < iMove,
    `PosModals.tsx must render the five roots in page order (ModifierModal, PaymentModal, PosPrompts, VoidItemDialog, MoveTableDialog), got indices ${iModifier}, ${iPayment}, ${iPrompts}, ${iVoid}, ${iMove}`,
  );

  // RAW source (not stripped) — the useState absence check must see comments
  // too, paired with the positive landmark that the file really declares the
  // PosModals function (not a blinded/empty read).
  assert.ok(src.includes("export function PosModals("), "positive landmark: PosModals.tsx must declare export function PosModals(");
  assert.ok(!src.includes("useState"), "PosModals.tsx must own NO state — useState must never appear; every piece of modal state stays in PosPage and arrives as props");

  assert.ok(
    src.includes(
      "// POS modals are interaction-gated — load their chunks lazily so they stay out",
    ),
    "PosModals.tsx must keep the moved comment line verbatim: '// POS modals are interaction-gated — load their chunks lazily so they stay out'",
  );
  assert.ok(
    src.includes(
      "// of the initial POS bundle (CLAUDE.md §17). Client component, so ssr:false is OK.",
    ),
    "PosModals.tsx must keep the moved comment line verbatim: '// of the initial POS bundle (CLAUDE.md §17). Client component, so ssr:false is OK.'",
  );

  assert.match(
    stripped,
    /export interface PosModalsProps extends PosPromptsProps \{/,
    "PosModals.tsx must declare export interface PosModalsProps extends PosPromptsProps {",
  );
});

test("PIN: pos/page.tsx renders <PosModals, keeps every modal's STATE and both call-site rationale comments, and no longer loads or renders any modal itself", () => {
  // RAW source (not stripped) — every negative check below must see comments
  // too, so a banned reference hiding in a comment cannot slip past a
  // blinded scan.
  const src = readSrc(POS_PAGE);

  const negatives = [
    "next/dynamic",
    "m.ModifierModal",
    "m.PaymentModal",
    "m.VoidItemDialog",
    "m.MoveTableDialog",
    "<PosPrompts",
    "<PaymentModal",
    "<ModifierModal",
    "<VoidItemDialog",
    "<MoveTableDialog",
    "dynamic(",
  ];
  for (const needle of negatives) {
    assert.ok(!src.includes(needle), `pos/page.tsx must no longer contain "${needle}" — the five modal roots and their dynamic() loaders moved to PosModals.tsx`);
  }

  const positives = [
    "<PosModals",
    "usePosTab(",
    "useState<Product | null>(null)",
    "const [modifierOpen, setModifierOpen] = useState(false);",
    "const [moveTableOpen, setMoveTableOpen] = useState(false);",
    "const itemVoid = useItemVoid(",
    "totals={pos.modalTotals}",
    "onSelectCustomer={pos.resumedOrder?.customerId ? undefined : pos.setCustomer}",
    "pos.applyTabUpdate(order, { kot: false, keepUnfired: true })",
    "onModifierConfirm={(p, opts) => pos.addToCart(p, opts)}",
  ];
  for (const needle of positives) {
    assert.ok(src.includes(needle), `pos/page.tsx must contain "${needle}"`);
  }

  const comments = [
    "never reassigns one that already carries one. Hiding the picker there",
    "unsent cart lines are still owed and must survive the re-sync. No",
  ];
  for (const needle of comments) {
    assert.ok(src.includes(needle), `pos/page.tsx must keep the call-site rationale comment text verbatim: "${needle}"`);
  }
});

test("PIN: pos/page.tsx feeds the memoized PosHeader Object.is-stable props — NO_OPEN_TABS constant, two latched usePosTab closures, a useCallback opener, and no inline arrow inside <PosHeader …/>", () => {
  const src = readSrc(POS_PAGE);
  const stripped = stripComments(src);

  assert.ok(stripped.includes("const NO_OPEN_TABS: Order[] = [];"), "pos/page.tsx must declare const NO_OPEN_TABS: Order[] = [];");
  assert.ok(stripped.includes("const onResumeTab = useStableCallback(pos.requestResume);"), "pos/page.tsx must declare const onResumeTab = useStableCallback(pos.requestResume);");
  assert.ok(stripped.includes("const onTableChange = useStableCallback(pos.setTable);"), "pos/page.tsx must declare const onTableChange = useStableCallback(pos.setTable);");
  assert.ok(stripped.includes("const handleMoveTable = useCallback(() => setMoveTableOpen(true), []);"), "pos/page.tsx must declare const handleMoveTable = useCallback(() => setMoveTableOpen(true), []);");

  const headerIdx = stripped.indexOf("<PosHeader");
  assert.ok(headerIdx >= 0, "landmark: pos/page.tsx must render <PosHeader");
  const closeIdx = stripped.indexOf("/>", headerIdx);
  assert.ok(closeIdx > headerIdx, "must find a closing /> after <PosHeader");
  const block = stripped.slice(headerIdx, closeIdx);

  // U1 Task 6 (values 1.3): the switch button reads the order on screen as plain values (a name, numbers), so the
  // memo still bails out on an unrelated render.
  const propPins = [
    // U1 final fix wave (the final review's minor 4): the header gets the query's own data, undefined until the first
    // answer, so its "{N} open" pill waits for it (never "0 open" while loading); TanStack keeps the array's identity,
    // and PosHeader holds its own stable empty list, so the memo still bails out.
    "openTabs={openTabs.data}",
    "onResumeTab={onResumeTab}",
    "onTableChange={onTableChange}",
    "resumedOrder={pos.resumedOrder}",
    "isBusy={pos.isBusy}",
    "lastOrder={pos.lastOrder}",
    "onReprintKot={pos.reprintKot}",
    "customerName={pos.customer?.name}",
    "count={pos.count}",
    "newCount={pos.newCount}",
    "total={pos.total}",
  ];
  for (const needle of propPins) {
    assert.ok(block.includes(needle), `<PosHeader ...> block must include "${needle}", got:\n${block}`);
  }
  assert.ok(!block.includes("=>"), `<PosHeader ...> block must carry no inline arrow prop — every callback prop must be a pre-bound reference, got:\n${block}`);
  // U1 Task 4 (owner Q9): the move / assign opener is the cart's Table cell now, handed over with the cells' inputs.
  assert.ok(!block.includes("onMoveTable"), "the move opener left the header row");
  assert.ok(stripped.includes("onResumeTab, onMoveTable: handleMoveTable"), "the cart's Table cell opens the move / assign dialog");
});

test("PIN: the cart's Void action reaches the lazy void dialog as its initial line — a plain data prop, no new latch", () => {
  const page = stripComments(readSrc(POS_PAGE));
  const modals = stripComments(readSrc(POS_MODALS));
  assert.ok(page.includes("voidInitialLine={itemVoid.line}"), "the page hands PosModals the line the cart named");
  assert.ok(modals.includes("voidInitialLine: VoidLine | null;"), "PosModalsProps declares it");
  const tag = modals.slice(modals.indexOf("<VoidItemDialog"), modals.indexOf("/>", modals.indexOf("<VoidItemDialog")));
  assert.ok(tag.startsWith("<VoidItemDialog"), "landmark: PosModals renders <VoidItemDialog");
  assert.ok(tag.includes("initialLine={voidInitialLine}"), "and the dialog opens on it");
});

test("PIN: PosPrompts and PosHeader are named, exported React.memo wrappers (PosPromptsProps exported for PosModals)", () => {
  const promptsSrc = stripComments(readSrc(POS_PROMPTS));
  assert.match(
    promptsSrc,
    /export const PosPrompts = memo\(function PosPrompts\(/,
    "PosPrompts.tsx must declare export const PosPrompts = memo(function PosPrompts(",
  );
  assert.match(promptsSrc, /export interface PosPromptsProps \{/, "PosPrompts.tsx must declare export interface PosPromptsProps {");
  assert.match(promptsSrc, /import\s*\{\s*memo\s*\}\s*from\s*"react"/, 'PosPrompts.tsx must import memo from "react"');
  const confirmDialogCount = countOccurrences(promptsSrc, "<ConfirmDialog");
  assert.equal(confirmDialogCount, 3, `PosPrompts.tsx must render <ConfirmDialog exactly 3 times, got ${confirmDialogCount}`);

  const headerSrc = stripComments(readSrc(POS_HEADER));
  assert.match(
    headerSrc,
    /export const PosHeader = memo\(function PosHeader\(/,
    "PosHeader.tsx must declare export const PosHeader = memo(function PosHeader(",
  );
  assert.match(headerSrc, /import\s*\{\s*memo\s*\}\s*from\s*"react"/, 'PosHeader.tsx must import memo from "react"');
  // U1 Task 4 (owner Q9): the table chip left for the cart head; U1 Task 6: the switch button opens the Open orders panel.
  assert.match(headerSrc, /<OpenTabsButton/, "PosHeader.tsx must render <OpenTabsButton");
});

// ── U1 Task 8: the item options modal in the owner's HTML (values 10 in docs/superpowers/specs/2026-10-20-pos-html-values.md;
// design 6.10; owner Q1). Look only: its state, reset and add are pinned in lib/variation-paths.test.ts and
// lib/pos-tile-paths.test.ts; the add-on rows' checkbox semantics in lib/removed-modifiers-paths.test.ts.
const MODIFIER_MODAL = "apps/cafe/components/pos/ModifierModal.tsx";

/** The class-string literal a `const NAME = "...";` declares. */
function modalConst(src: string, name: string): string {
  const m = src.match(new RegExp(`const ${name} =\\s*"([^"]*)";`));
  assert.ok(m, `ModifierModal.tsx must declare ${name} as one plain string literal`);
  return m![1];
}

test("PIN (U1 Task 8, owner Q1): the item options modal speaks the HTML's words — Size, Add-ons, Kitchen note, Add to order · ₹x — and keeps ours where the HTML has none", () => {
  const src = stripComments(readSrc(MODIFIER_MODAL));
  assert.ok(src.includes(">Size</span>"), "the variations' caption is the HTML's \"Size\" (was \"Variation (required)\")");
  assert.ok(src.includes(">Add-ons</span>"), "the modifiers' caption is the HTML's \"Add-ons\"");
  assert.ok(src.includes(">Kitchen note</label>"), "the instructions field's caption is the HTML's \"Kitchen note\" (was \"Instructions (optional)\"), a real label");
  assert.ok(src.includes("`Add to order · ${inr(unit * qty)}`"), "the add button reads the HTML's \"Add to order · ₹x\" (was \"Add {n} — ₹x\"): the unit price × qty, as today");
  assert.ok(src.includes('"Pick a variation"'), "a variation item with none chosen still reads \"Pick a variation\" (our state, no HTML counterpart)");
  assert.ok(src.includes("Untick what the customer does not want."), "the reverse-mode hint stays (our feature, no HTML counterpart)");
  assert.ok(src.includes('placeholder="e.g. less spicy, no onions"'), "the note field keeps today's placeholder");
  assert.ok(src.includes('id="item-instructions"') && src.includes('htmlFor="item-instructions"'), "the caption labels the note field by today's id");
  assert.ok(src.includes('aria-label="Decrease quantity"') && src.includes('aria-label="Increase quantity"'), "today's stepper aria-labels kept");
  assert.ok(src.includes(">−</button>") && src.includes(">+</button>"), "the HTML's stepper glyphs (U+2212 and +), not icons");
  for (const gone of ["Variation (required)", "Instructions (optional)", "Add ${qty} —", ">Quantity<"]) {
    assert.ok(!src.includes(gone), `ModifierModal.tsx must no longer show "${gone}" (owner Q1: the HTML's words)`);
  }
});

test("PIN (U1 Task 8, values 10.1): the modal is the HTML's sheet — a Radix dialog whose scrim holds the 440px panel (a bottom sheet below 720px), the name + \"✕\" head, the read-out-only description", () => {
  const src = stripComments(readSrc(MODIFIER_MODAL));
  assert.match(src, /import \* as DialogPrimitive from "@radix-ui\/react-dialog";/, "a Radix dialog: focus trap, Escape, role=dialog (F8 / F9 stay off while it is open)");
  assert.ok(!src.includes('from "@/components/ui/dialog"'), "not the kit DialogContent: its corner X and black overlay are not the HTML's");
  assert.ok(!src.includes('from "@/components/ui/checkbox"') && !src.includes('from "@/components/ui/textarea"'), "the HTML's check rows and 48px field replace the kit checkbox and textarea");
  const overlay = src.indexOf("<DialogPrimitive.Overlay");
  const content = src.indexOf("<DialogPrimitive.Content");
  assert.ok(overlay > 0 && content > overlay && src.indexOf("</DialogPrimitive.Overlay>") > src.indexOf("</DialogPrimitive.Content>"), "the scrim holds the panel (values 10.1: the panel is centred / bottom-anchored inside it)");
  assert.ok(src.includes("className={SCRIM_CLASS}") && src.includes("className={PANEL_CLASS}"), "the scrim and the panel wear the HTML's frame");
  assert.ok(src.includes("<DialogPrimitive.Title className={NAME_CLASS}>{product.name}</DialogPrimitive.Title>"), "the title is the product's name in the head");
  assert.ok(src.includes('<DialogPrimitive.Description className="sr-only">'), "today's description stays for screen readers only (the HTML shows none)");
  assert.ok(src.includes('aria-label="Close"') && src.includes(">✕</DialogPrimitive.Close>"), "the HTML's \"✕\" character closes it, named Close");
  // U1 final fix wave (the Task 9 review's minor): the modal's own copy of the opener focus went; it spreads the shared
  // hook (hooks/use-opener-focus.ts, the same two handlers, pinned in lib/payment-sheet.test.ts), as the payment, void,
  // table and move sheets do. Behaviour identical: the panel takes the focus on open (no ring on "✕", no phone keyboard
  // for the note field) and gives it back to the opener on close (the page opens the modal from state, no trigger).
  assert.match(src, /import \{ useOpenerFocus \} from "@\/hooks\/use-opener-focus";/, "the shared hook");
  assert.ok(src.includes("const openerFocus = useOpenerFocus();"), "one instance per modal");
  assert.match(src, /<DialogPrimitive\.Content\s+data-ui="pos-item-options-panel"\s+\{\.\.\.openerFocus\}/, "spread on the panel");
  for (const gone of ["rememberOpener", "returnFocus", "openerRef"]) {
    assert.ok(!src.includes(gone), `no own copy of the opener focus: ${gone}`);
  }

  // Ruling P54 (U1 audit wave): the scrim and the panel are the shared sheet frame (lib/sheet-frame.ts) with the modal's
  // own z-index, width, overflow and sheetIn; lib/sheet-frame.test.ts pins each whole class set, unchanged.
  assert.ok(
    src.includes('const SCRIM_CLASS = cn(SHEET_SCRIM_BASE, "z-20");'),
    "values 10.1 scrim: the shared frame (fixed, --scrim, fadeIn .2s; centred in 16px, along the foot below 720px) at z-index 20 (over the phone's tab bar)",
  );
  assert.ok(
    src.includes('const PANEL_CLASS = cn(SHEET_PANEL_BASE, SHEET_PANEL_CAP_CLASS, "max-w-[440px] overflow-hidden motion-safe:animate-sheet-in");'),
    "values 10.1 panel: the shared panel (--surface, sheetRadius 14, --pop) at 440px, no border, sheetIn .34s; capped at the HTML's sheet heights (csMaxH) so a long option list scrolls in the body",
  );
  assert.equal(modalConst(src, "HEAD_CLASS"), "flex flex-none items-center gap-2.5 border-b border-border-2 px-[18px] py-4", "values 10.1 head: 16px 18px, gap 10, a --border-2 rule");
  // U1 final fix wave (the Task 8 review's minor): a long unbroken operator-typed name (CR1.1) wraps inside the head
  // instead of pushing the "✕" out of the panel.
  assert.equal(modalConst(src, "NAME_CLASS"), "min-w-0 flex-1 break-words text-[17px] font-semibold tracking-[-0.01em]", "values 10.1 name: 17px 600, -.01em, flex 1 (no veg mark: owner Q7); a long word wraps");
  assert.equal(
    modalConst(src, "CLOSE_CLASS"),
    "size-7 cursor-pointer rounded-[50%] border-0 bg-surface-3 px-1.5 py-px text-[12px] text-muted-foreground",
    "values 10.1 ✕: 28px round on --surface-3, 12px --text-2, the UA's 1px 6px padding",
  );
  assert.equal(modalConst(src, "BODY_CLASS"), "flex min-h-0 flex-col gap-[18px] overflow-y-auto px-[18px] py-4", "values 10.1 body: 16px 18px, the blocks 18px apart");
  assert.equal(modalConst(src, "BLOCK_CLASS"), "flex flex-col gap-2", "values 10.1: each block's caption 8px above its control");
  assert.equal(modalConst(src, "CAPTION_CLASS"), "text-[12px] font-semibold text-muted-foreground", "values 10.1 captions: 12px 600 --text-2");
  assert.equal(modalConst(src, "HINT_CLASS"), "text-[12px] text-muted-foreground", "the reverse-mode hint: 12px --text-2 under the caption");
});

test("PIN (U1 Task 8, values 10.1-10.2): Size segments, add-on rows, the 48px note field and the footer take the HTML's measures", () => {
  const src = stripComments(readSrc(MODIFIER_MODAL));
  assert.equal(modalConst(src, "SIZES_CLASS"), "grid gap-0.5 rounded-[8px] bg-surface-3 p-0.5", "values 10.1 segments: a --surface-3 track, radius 8, 2px inset and gap");
  assert.ok(src.includes("gridTemplateColumns: `repeat(${Math.min(product.variations!.length, SIZE_COLUMNS_MAX)}, minmax(0, 1fr))`"), "one column per size (m.cols), three a row at most (our items carry up to 20 sizes)");
  assert.match(src, /const SIZE_COLUMNS_MAX = 3;/, "the HTML's widest size row");
  assert.equal(
    modalConst(src, "SIZE_CLASS"),
    "flex h-11 min-w-0 cursor-pointer flex-col items-center justify-center rounded-[6px] border-0 px-1.5 py-px leading-[1.2] text-foreground",
    "values 10.1 size button: 44px, radius 6, line-height 1.2, --text, the UA's padding",
  );
  assert.equal(modalConst(src, "SIZE_ON_CLASS"), "bg-seg [box-shadow:var(--seg-sh)]", "SEG_ON (U0 values 1.6)");
  assert.equal(modalConst(src, "SIZE_OFF_CLASS"), "bg-transparent", "SEG_OFF");
  assert.equal(modalConst(src, "SIZE_LABEL_CLASS"), "max-w-full truncate text-[12px] text-muted-foreground", "the full size name, 12px --text-2");
  assert.equal(modalConst(src, "SIZE_PRICE_CLASS"), "text-[14px] font-semibold", "the price, 14px 600");
  assert.equal(modalConst(src, "ADDON_LIST_CLASS"), "overflow-hidden rounded-[10px] border border-border", "values 10.1 add-on list: 1px --border, radius 10");
  assert.equal(
    modalConst(src, "ADDON_CLASS"),
    "flex h-[42px] w-full cursor-pointer items-center gap-2.5 border-b border-border-2 bg-card px-3 text-left text-[14px] text-foreground hover:bg-hover",
    "values 10.1 add-on row: 42px, 0 12px, gap 10, 14px, a --border-2 rule under every row (the last too), hover --hover",
  );
  assert.equal(
    modalConst(src, "CHECK_CLASS"),
    "flex size-[18px] flex-none items-center justify-center rounded-[5px] border-[1.5px] text-[11px] text-primary-foreground",
    "values 10.1 check box: 18px, radius 5, a 1.5px rule, the 11px check in --on-accent",
  );
  assert.equal(modalConst(src, "CHECK_ON_CLASS"), "border-primary bg-primary", "values 10.2 add-on on: --accent box and fill");
  assert.equal(modalConst(src, "CHECK_OFF_CLASS"), "border-subtle-foreground bg-card", "values 10.2 add-on off: --text-3 box on --surface");
  assert.ok(src.includes('{on ? "✓" : ""}'), "the HTML's check character when on");
  // Ruling P54: the 48px field and the stepper are the shared sheet frame's (lib/sheet-frame.ts; their values are pinned
  // once in lib/sheet-frame.test.ts).
  assert.match(src, /placeholder="e\.g\. less spicy, no onions"[\s\S]*?className=\{SHEET_FIELD_CLASS\}/, "the HTML's 48px field (values 8.3) for the kitchen note");
  assert.equal(
    modalConst(src, "FOOT_CLASS"),
    "flex flex-none items-center gap-2.5 border-t border-border-2 px-[18px] pt-3.5 pb-[18px] max-tab:pb-[calc(18px+env(safe-area-inset-bottom))]",
    "values 10.1 footer: 14px 18px 18px, gap 10, a --border-2 rule; below 720px (the window's foot) 18px + the safe-area inset (ruling P49)",
  );
  assert.ok(src.includes('aria-label="Quantity" className={SHEET_STEPPER_CLASS}'), "values 10.1 stepper: the shared 46px stepper");
  assert.equal(countOccurrences(src, "className={cn(SHEET_STEP_CLASS, BRAND_PRESS_CLASS)}"), 2, "values 10.1 − / +: the shared 42x44 steps, with the HTML's press");
  assert.ok(src.includes('data-ui="pos-item-qty" className={SHEET_QTY_CLASS}'), "values 10.1 qty: the shared 15px 600 qty");
  assert.equal(
    modalConst(src, "ADD_CLASS"),
    "h-[46px] flex-1 cursor-pointer rounded-[10px] border-0 bg-primary px-1.5 py-px text-[15px] font-semibold text-primary-foreground not-disabled:hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50",
    "values 10.1 Add: 46px, flex 1, radius 10, --accent, 15px 600 --on-accent, hover --accent-h; disabled (no size yet) not-allowed at .5",
  );
});

// ── U1 Task 12: the void dialog in the HTML's sheet frame (values 12.1's 420px confirm frame; values 8.1 head, 8.3 field,
// 10.1 check rows and stepper; design 6.12). Look only: its state, reset, guard and payload are pinned in
// lib/variation-paths.test.ts, lib/reward-void-trail.test.ts and lib/removed-modifiers-paths.test.ts; the hook in
// hooks/use-item-void.ts is untouched.
const VOID_DIALOG = "apps/cafe/components/pos/VoidItemDialog.tsx";

/** The class-string literal a `const NAME = "...";` declares in VoidItemDialog.tsx. */
function voidConst(src: string, name: string): string {
  const m = src.match(new RegExp(`const ${name} =\\s*"([^"]*)";`));
  assert.ok(m, `VoidItemDialog.tsx must declare ${name} as one plain string literal`);
  return m![1];
}

test("PIN (U1 Task 12, design 6.12): the void dialog keeps every word and rule of today and adds the HTML's Cancel", () => {
  const src = stripComments(readSrc(VOID_DIALOG));
  for (const words of [
    ">Void an item</DialogPrimitive.Title>",
    "The kitchen gets a VOID slip for this line. This cannot be undone.",
    "Nothing sent to the kitchen yet on this tab.",
    "Quantity to void",
    "Reason (required)",
    'placeholder="e.g. wrong item fired, guest changed mind"',
    "This would empty the tab — a tab must keep at least one item. Ask",
    "an admin to cancel the order instead.",
    'Void {qty > 1 ? `${qty} × ` : ""}item',
    ">Cancel</DialogPrimitive.Close>",
    'aria-label="Decrease quantity"',
    'aria-label="Increase quantity"',
  ]) {
    assert.ok(src.includes(words), `VoidItemDialog.tsx keeps "${words}"`);
  }
  assert.ok(src.includes('id="void-reason"') && src.includes('htmlFor="void-reason"'), "the caption labels the reason field by today's id");
  assert.ok(src.includes("maxLength={ORDER_REASON_MAX_LEN}"), "the reason's 200-character cap");
  assert.ok(src.includes("trimmedReason.length >= ORDER_REASON_MIN_LEN"), "at least 3 trimmed characters before Void");
  assert.ok(src.includes("onClick={() => setQty((q) => Math.max(1, q - 1))}") && src.includes("onClick={() => setQty((q) => Math.min(line.qty, q + 1))}"), "the qty stays within 1 … the line's qty");
  assert.ok(src.includes("disabled={!canConfirm}") && src.includes("onClick={confirm}"), "Void runs today's confirm, off until the form is complete");
  assert.ok(src.includes("{wouldEmptyTab && ("), "the last-line guard sentence shows only when the void would empty the tab");
  assert.ok(src.includes("onValueChange={(v) => selectLine(Number(v))}"), "a pick selects the line with its whole qty (selectLine)");
});

test("PIN (U1 Task 12, values 12.1 / 8.1): the void dialog is the HTML's sheet — a Radix dialog whose scrim holds the 420px panel, the title + sub + ✕ head, the sent lines as one-choice check rows", () => {
  const src = stripComments(readSrc(VOID_DIALOG));
  assert.match(src, /import \* as DialogPrimitive from "@radix-ui\/react-dialog";/, "a Radix dialog: focus trap, Escape and the scrim close it, role=dialog");
  assert.match(src, /import \* as RadioGroupPrimitive from "@radix-ui\/react-radio-group";/, "the rows are one radio group: role radio, aria-checked, the arrow keys");
  for (const kit of ['from "@/components/ui/dialog"', 'from "@/components/ui/radio-group"', 'from "@/components/ui/textarea"', 'from "@/components/ui/label"', 'from "@/components/ui/button"']) {
    assert.ok(!src.includes(kit), `not the kit (${kit}): its corner X, outline buttons and small radios are not the HTML's`);
  }
  const overlay = src.indexOf("<DialogPrimitive.Overlay");
  const content = src.indexOf("<DialogPrimitive.Content");
  assert.ok(overlay > 0 && content > overlay && src.indexOf("</DialogPrimitive.Overlay>") > src.indexOf("</DialogPrimitive.Content>"), "the scrim holds the panel (centred; a bottom sheet below 720px)");
  assert.ok(src.includes("className={SCRIM_CLASS}") && src.includes("className={PANEL_CLASS}"), "the scrim and the panel wear the HTML's frame");
  assert.ok(src.includes("{...openerFocus}"), "the panel takes the focus as it opens and gives it back to the cart's Void on close (ruling P22's way)");
  assert.ok(src.includes("<DialogPrimitive.Description className={SUB_CLASS}>"), "today's description is the head's sub");
  assert.ok(src.includes('aria-label="Close"'), "the head's ✕ is named Close");
  assert.ok(src.includes("<RadioGroupPrimitive.Root") && src.includes("<RadioGroupPrimitive.Item"), "the sent lines: one radio group, one item per line");
  assert.ok(src.includes("value={selected === null ? undefined : String(selected)}"), "the group shows today's selection");
  assert.ok(src.includes("on ? CHECK_ON_CLASS : CHECK_OFF_CLASS") && src.includes('{on ? "✓" : ""}'), "the picked line's round check is lit with the HTML's ✓");
  assert.ok(src.includes('role="group"') && src.includes("aria-labelledby={qtyId}"), "the stepper is named by its caption");

  // Ruling P54 (U1 audit wave): the scrim, the panel, the ✕, the stepper, the 48px field and the foot are the shared sheet
  // frame (lib/sheet-frame.ts) with the dialog's own z-index, width, border and sheetIn; lib/sheet-frame.test.ts pins
  // each whole class set, unchanged.
  assert.ok(
    src.includes('const SCRIM_CLASS = cn(SHEET_SCRIM_BASE, "z-50");'),
    "values 12.1 scrim: the shared frame (fixed, --scrim, fadeIn .2s; centred in 16px, along the foot below 720px) at z-index 50",
  );
  assert.ok(
    src.includes('const PANEL_CLASS = cn(SHEET_PANEL_BASE, SHEET_PANEL_CAP_CLASS, "max-w-[420px] overflow-hidden border border-border motion-safe:animate-sheet-in");'),
    "values 12.1 panel: the shared panel (--surface, sheetRadius 14, --pop) at 420px, a 1px --border, sheetIn .34s; capped at the sheets' heights (values 0.3 csMaxH), the body scrolls",
  );
  assert.equal(voidConst(src, "HEAD_CLASS"), "flex flex-none items-center gap-2.5 px-4 pt-4 pb-3", "values 8.1 head: 16px 16px 12px, gap 10");
  assert.equal(voidConst(src, "TITLE_CLASS"), "text-[17px] font-semibold", "values 8.1 title: 17px 600");
  assert.equal(voidConst(src, "SUB_CLASS"), "text-[12.5px] text-muted-foreground", "values 8.1 sub: 12.5px --text-2");
  assert.ok(
    src.includes('data-ui="void-close" aria-label="Close" className={cn(SHEET_CLOSE_CLASS, BRAND_PRESS_CLASS)}'),
    "values 8.1 ✕: the shared 32px round ✕, with the HTML's press",
  );
  assert.equal(voidConst(src, "BODY_CLASS"), "flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto px-4 pt-1 pb-2", "values 8.3 body: 4px 16px 8px, the blocks 14px apart, the one scroller");
  assert.equal(voidConst(src, "EMPTY_CLASS"), "px-3 py-6 text-center text-[13.5px] leading-[1.5] text-muted-foreground", "our empty line in the HTML's empty block (values 8.2): 24px 12px, 13.5px --text-2, 1.5");
});

test("PIN (U1 Task 12, values 10.1 / 8.3 / 12.1): the check rows, the 46px stepper, the 48px reason field, the guard and the foot take the HTML's measures", () => {
  const src = stripComments(readSrc(VOID_DIALOG));
  assert.equal(voidConst(src, "LIST_CLASS"), "max-h-56 overflow-y-auto rounded-[10px] border border-border", "values 10.1 list: a 1px --border, radius 10; today's 14rem cap scrolls a long tab");
  assert.equal(
    voidConst(src, "ROW_CLASS"),
    "flex min-h-[42px] w-full cursor-pointer items-center gap-2.5 border-b border-border-2 bg-card px-3 py-2 text-left text-[14px] text-foreground last:border-b-0 hover:bg-hover",
    "values 10.1 row: 42px (taller with modifier lines), 0 12px, gap 10, 14px --text, a --border-2 rule under each but the last (the list's own border closes it), hover --hover",
  );
  assert.equal(
    voidConst(src, "CHECK_CLASS"),
    "flex size-[18px] flex-none items-center justify-center rounded-[50%] border-[1.5px] text-[11px] text-primary-foreground",
    "values 10.1 check: 18px, a 1.5px rule, the 11px check in --on-accent; round (one choice)",
  );
  assert.equal(voidConst(src, "CHECK_ON_CLASS"), "border-primary bg-primary", "values 10.2 on: --accent box and fill");
  assert.equal(voidConst(src, "CHECK_OFF_CLASS"), "border-subtle-foreground bg-card", "values 10.2 off: a --text-3 ring on --surface");
  assert.equal(voidConst(src, "NAME_CLASS"), "min-w-0 flex-1", "values 10.1 label: flex 1 between the check and the price");
  assert.equal(voidConst(src, "MODIFIER_CLASS"), "block text-[12px] text-muted-foreground", "our modifier lines under the name, 12px --text-2");
  assert.equal(voidConst(src, "PRICE_CLASS"), "flex-none whitespace-nowrap text-muted-foreground", "values 10.1 price: --text-2 at the row's right");
  assert.equal(voidConst(src, "CAPTION_CLASS"), "text-[12.5px] font-semibold text-muted-foreground", "values 8.3 captions: 12.5px 600 --text-2");
  assert.equal(voidConst(src, "QTY_ROW_CLASS"), "flex items-center justify-between gap-2.5", "the caption left, the stepper right (today's row)");
  // Ruling P54: the stepper, the 48px field and the foot are the shared sheet frame's (values pinned once in
  // lib/sheet-frame.test.ts).
  assert.ok(src.includes('aria-labelledby={qtyId} className={SHEET_STEPPER_CLASS}'), "values 10.1 stepper: the shared 46px stepper");
  assert.equal(countOccurrences(src, "className={cn(SHEET_STEP_CLASS, BRAND_PRESS_CLASS)}"), 2, "values 10.1 − / +: the shared 42x44 steps, with the HTML's press");
  assert.ok(src.includes('data-ui="void-qty" className={SHEET_QTY_CLASS}'), "values 10.1 qty: the shared 15px 600 qty");
  assert.ok(src.includes(">−</button>") && src.includes(">+</button>"), "the HTML's stepper glyphs (U+2212 and +), not icons");
  assert.equal(voidConst(src, "GUARD_CLASS"), "text-[13px] font-medium leading-[1.5] text-status-bad-ink", "the guard in --bad-i (the HTML's message, values 12.2: 13px 500)");
  assert.equal(voidConst(src, "FIELD_CLASS"), "flex flex-col gap-1.5", "values 8.3 field: the caption 6px over the box");
  assert.match(src, /id="void-reason"[\s\S]*?className=\{SHEET_FIELD_CLASS\}/, "values 8.3 box: the shared 48px field for the reason");
  assert.ok(src.includes('data-ui="void-foot" className={SHEET_FOOT_CLASS}'), "values 8.2 foot: the shared foot (14px + the safe area)");
  assert.equal(
    voidConst(src, "VOID_CLASS"),
    "h-[46px] w-full cursor-pointer rounded-[10px] border border-status-bad bg-status-bad px-1.5 py-px text-[14.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50",
    "values 12.1 button in --bad with white text (design 6.12): 46px, radius 10, 14.5px 600; off at .5 until the form is complete",
  );
  assert.equal(
    voidConst(src, "CANCEL_CLASS"),
    "h-[46px] w-full cursor-pointer rounded-[10px] border border-transparent bg-transparent px-1.5 py-px text-[14.5px] font-semibold text-link",
    "values 12.1 kind 2: the 46px Cancel link, transparent, --link, 14.5px 600",
  );
});

test("PIN: line budgets — pos/page.tsx < 300 (exact count pinned in pos-tile-paths), PosModals.tsx <= 300, PosHeader.tsx <= 300, PosPrompts.tsx <= 300", () => {
  const lineCount = (rel: string): number => readSrc(rel).replace(/\n$/, "").split("\n").length;

  assert.ok(lineCount(POS_PAGE) < 300, `pos/page.tsx must stay under the 300-line invariant, got ${lineCount(POS_PAGE)} (exact count is pinned in lib/pos-tile-paths.test.ts)`);
  assert.ok(lineCount(POS_MODALS) <= 300, `PosModals.tsx must stay <= 300 lines, got ${lineCount(POS_MODALS)}`);
  assert.ok(lineCount(POS_HEADER) <= 300, `PosHeader.tsx must stay <= 300 lines, got ${lineCount(POS_HEADER)}`);
  assert.ok(lineCount(POS_PROMPTS) <= 300, `PosPrompts.tsx must stay <= 300 lines, got ${lineCount(POS_PROMPTS)}`);
});
