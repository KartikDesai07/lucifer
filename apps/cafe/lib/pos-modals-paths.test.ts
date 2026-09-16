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

  const propPins = [
    "openTabs={openTabs.data ?? NO_OPEN_TABS}",
    "onResumeTab={onResumeTab}",
    "onMoveTable={handleMoveTable}",
    "onTableChange={onTableChange}",
    "resumedOrder={pos.resumedOrder}",
    "isBusy={pos.isBusy}",
  ];
  for (const needle of propPins) {
    assert.ok(block.includes(needle), `<PosHeader ...> block must include "${needle}", got:\n${block}`);
  }
  assert.ok(!block.includes("=>"), `<PosHeader ...> block must carry no inline arrow prop — every callback prop must be a pre-bound reference, got:\n${block}`);
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
  assert.match(headerSrc, /<TableSelector/, "PosHeader.tsx must render <TableSelector");
});

test("PIN: line budgets — pos/page.tsx < 300 (exact count pinned in pos-tile-paths), PosModals.tsx <= 300, PosHeader.tsx <= 300, PosPrompts.tsx <= 300", () => {
  const lineCount = (rel: string): number => readSrc(rel).replace(/\n$/, "").split("\n").length;

  assert.ok(lineCount(POS_PAGE) < 300, `pos/page.tsx must stay under the 300-line invariant, got ${lineCount(POS_PAGE)} (exact count is pinned in lib/pos-tile-paths.test.ts)`);
  assert.ok(lineCount(POS_MODALS) <= 300, `PosModals.tsx must stay <= 300 lines, got ${lineCount(POS_MODALS)}`);
  assert.ok(lineCount(POS_HEADER) <= 300, `PosHeader.tsx must stay <= 300 lines, got ${lineCount(POS_HEADER)}`);
  assert.ok(lineCount(POS_PROMPTS) <= 300, `PosPrompts.tsx must stay <= 300 lines, got ${lineCount(POS_PROMPTS)}`);
});
