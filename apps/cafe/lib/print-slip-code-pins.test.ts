import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";

// R6 (01-PLAN A4) source pins: the lazy slip chunk stays lazy and the
// receipt bundle reads templates with the READ schema module only. Raw source (comments included) throughout; every
// absence pin is paired with a positive landmark in the SAME test (testing.md's vision-guard rule). Same
// readSrc + REPO_ROOT idiom as desktop-shell-paths.test.ts.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;
const SLIP_DIR = "apps/cafe/components/print/slip";

// ── d(ii) + d(iii). the lazy chunk stays lazy ────────────────────────────────

const APP_DIRS = ["app", "components", "hooks", "lib"];
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !/\.fixtures\.ts$/.test(entry.name)) out.push(rel);
  }
  return out;
}
const APP_FILES = APP_DIRS.flatMap((dir) => walk(`apps/cafe/${dir}`));

interface Import {
  specifier: string;
  kind: "static" | "type" | "dynamic" | "require";
}
function importsOf(src: string): Import[] {
  const found: Import[] = [];
  for (const m of src.matchAll(/\b(import|export)\s+(type\s+)?[^;"'`]*?\bfrom\s*["']([^"']+)["']/g)) {
    found.push({ specifier: m[3], kind: m[2] ? "type" : "static" });
  }
  for (const m of src.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) found.push({ specifier: m[1], kind: "static" });
  for (const m of src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) found.push({ specifier: m[1], kind: "dynamic" });
  for (const m of src.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) found.push({ specifier: m[1], kind: "require" });
  return found;
}
const baseOf = (specifier: string): string => specifier.split("/").pop() ?? specifier;
const importsByFile = new Map(APP_FILES.map((file) => [file, importsOf(readSrc(file))]));
const VALUE_KINDS = new Set(["static", "dynamic", "require"]);

const LAZY = "slip-code-lazy";
const DESIGN_MODULES = ["bill-modern-blocks", "bill-express-blocks", "bill-cafe-blocks", "kot-bold-blocks", "bill-themed-blocks"];
const CHUNK_OWNERS = new Set([...DESIGN_MODULES.map((m) => `${SLIP_DIR}/${m}.tsx`), `${SLIP_DIR}/${LAZY}.ts`]);

test("PIN: slip-code-lazy is reached ONLY by the one import() in slip-code.ts (a type import is erased and allowed)", () => {
  assert.ok(APP_FILES.length > 100, `landmark: the scan saw ${APP_FILES.length} app files`);
  assert.ok(APP_FILES.includes(`${SLIP_DIR}/slip-code.ts`) && APP_FILES.includes(`${SLIP_DIR}/${LAZY}.ts`), "landmark: both slip-code files are in the scan");
  const dynamicSites: string[] = [];
  for (const [file, imports] of importsByFile) {
    for (const imp of imports) {
      if (baseOf(imp.specifier) !== LAZY) continue;
      if (imp.kind === "dynamic") dynamicSites.push(`${file} -> ${imp.specifier}`);
      else assert.equal(imp.kind, "type", `${file} must not value-import ${LAZY} (it would put the chunk back into the page's First Load)`);
    }
  }
  assert.deepEqual(dynamicSites, [`${SLIP_DIR}/slip-code.ts -> ./${LAZY}`], "exactly one dynamic import, in slip-code.ts");
  assert.equal(count(readSrc(`${SLIP_DIR}/slip-code.ts`), `import("./${LAZY}")`), 1, "slip-code.ts holds the import() once");
});

test("PIN: the non-Classic design modules and the themed-blocks builder are imported only by each other and slip-code-lazy.ts", () => {
  const lazyImports = (importsByFile.get(`${SLIP_DIR}/${LAZY}.ts`) ?? []).filter((i) => i.kind === "static").map((i) => baseOf(i.specifier));
  for (const design of ["bill-modern-blocks", "bill-express-blocks", "bill-cafe-blocks", "kot-bold-blocks"]) {
    assert.ok(lazyImports.includes(design), `landmark: slip-code-lazy.ts imports ${design}`);
  }
  const themed = [...importsByFile].filter(([, imports]) => imports.some((i) => baseOf(i.specifier) === "bill-themed-blocks")).map(([file]) => file).sort();
  assert.deepEqual(
    themed,
    ["bill-cafe-blocks", "bill-express-blocks", "bill-modern-blocks"].map((m) => `${SLIP_DIR}/${m}.tsx`),
    "landmark: bill-themed-blocks has its three design importers",
  );
  for (const [file, imports] of importsByFile) {
    if (CHUNK_OWNERS.has(file)) continue;
    for (const imp of imports) {
      assert.ok(
        !(VALUE_KINDS.has(imp.kind) && DESIGN_MODULES.includes(baseOf(imp.specifier))),
        `${file} must not import ${imp.specifier} (the non-Classic designs load only through slip-code-lazy)`,
      );
    }
  }
});

test("PIN: a value import of qrcode lives only in slip-code-lazy.ts and tables/QrSheet.tsx; generic-blocks.tsx imports its type only", () => {
  const valueImporters = [...importsByFile]
    .filter(([, imports]) => imports.some((i) => i.specifier === "qrcode" && VALUE_KINDS.has(i.kind)))
    .map(([file]) => file)
    .sort();
  assert.deepEqual(valueImporters, ["apps/cafe/components/print/slip/slip-code-lazy.ts", "apps/cafe/components/tables/QrSheet.tsx"]);
  const generic = importsByFile.get(`${SLIP_DIR}/generic-blocks.tsx`) ?? [];
  assert.deepEqual(generic.filter((i) => i.specifier === "qrcode"), [{ specifier: "qrcode", kind: "type" }], "generic-blocks.tsx: one `import type` from qrcode, no value import");
  assert.ok(readSrc(`${SLIP_DIR}/generic-blocks.tsx`).includes('import type { create } from "qrcode";'), "landmark: the exact type import");
});

// ── d(iv) + d(v). the READ schema split ──────────────────────────────────────

const READ_SCHEMA = "packages/shared/src/schemas/print-template-read.schema.ts";

test("PIN: the receipt bundle's template reader imports the READ schema module, never the WRITE gate's", () => {
  const src = readSrc("apps/cafe/lib/print-template-resolve.ts");
  assert.ok(src.includes('from "@pos/shared/schemas/print-template-read.schema";'), "landmark: the READ module import");
  assert.ok(src.includes("billTemplateReadSchema") && src.includes("kotTemplateReadSchema"), "landmark: it uses the two READ schemas");
  assert.ok(!src.includes("schemas/print-template" + ".schema"), "no import of the WRITE gate's module");
  for (const [file, imports] of importsByFile) {
    if (file === "apps/cafe/lib/print-template-resolve.ts") continue;
    // The slip engine and the receipts are in the same bundle: none of them may drag the WRITE gate in either.
    if (file.startsWith(`${SLIP_DIR}/`) || file.startsWith("apps/cafe/components/pos/")) {
      assert.ok(!imports.some((i) => i.specifier.endsWith("schemas/print-template.schema")), `${file} imports the WRITE gate`);
    }
  }
});

test("PIN: print-template-read.schema.ts is READ-only: no write block set, no presence check, no required-block list", () => {
  const src = readSrc(READ_SCHEMA);
  assert.ok(src.includes('blockSchemasFor("read")'), "landmark: it builds the READ block set");
  assert.ok(src.includes("export const billTemplateReadSchema") && src.includes("export function billTemplateShape"), "landmark: the READ schemas and the shared shape builders live here");
  assert.ok(!src.includes('blockSchemasFor("write")'), "no WRITE block set");
  assert.ok(!src.includes("checkRequired"), "no presence check");
  assert.ok(!src.includes("REQUIRED_BLOCKS"), "no required-block list");
});

// ── the print host's gate, the absent onBeforePrint, and the previews ────────

const HOST_BRIDGE = "apps/cafe/hooks/use-print-host-bridge.ts";
const PENDING_HOOK = "apps/cafe/hooks/use-slip-code-pending.ts";
// Built by concatenation: a literal would match this file's own source.
const WRAP_NEEDLE = "useReactToPrint" + "(" + "slipPrintOptions" + "(";

test("PIN: the host bridge calls useSlipCodePending() once, holds a bill / kitchen dispatch on it, and re-runs the effect when it changes", () => {
  const src = readSrc(HOST_BRIDGE);
  assert.equal(count(src, 'import { useSlipCodePending } from "@/hooks/use-slip-code-pending";'), 1, "imports it from the hook module");
  assert.equal(count(src, "const slipCodePending = useSlipCodePending();"), 1, "calls it exactly once, into one constant");
  assert.equal(count(src, "useSlipCodePending("), 1, "no other call");
  // ONE merged line (the 250-line budget): the end-of-day report waits only for its figures; every other job waits for
  // the chunk only when it is a claimed slip, so the attestation test slip (kind "test") is never held.
  const guard = '    if (surface === "eod" ? !eodReady : current.kind === "slip" && slipCodePending) return;\n';
  assert.equal(count(src, guard), 1, "the guard: eod waits on eodReady; a claimed bill / kitchen slip waits on slipCodePending; the test slip never waits");
  assert.ok(!src.includes('if (surface === "eod" && !eodReady) return;'), "the old separate eod line is gone (merged, not duplicated)");
  const effect = src.slice(src.indexOf("  useEffect(() => {\n    if (!current || dispatchedRef.current || !surfacesMounted) return;"));
  assert.ok(effect.startsWith("  useEffect("), "landmark: the dispatch effect");
  const closing = effect.indexOf("  }, [");
  assert.ok(closing > 0 && effect.slice(closing, effect.indexOf("]);", closing)).includes("slipCodePending"), "slipCodePending is in the dispatch effect's deps");
  assert.ok(effect.indexOf(guard) > 0 && effect.indexOf(guard) < closing, "the guard sits inside that effect");
  assert.ok(effect.indexOf(guard) < effect.indexOf("const node = surface"), "and before the node and empty-slip checks");
  assert.ok(!src.includes("use-slip-print-gate"), "the old onBeforePrint gate is gone from the bridge");
});

test("PIN: the pending hook retries idle OR failed on mount, a receipt's view fetches only when idle, and neither pulls in what the host harness lacks", () => {
  const pending = readSrc(PENDING_HOOK);
  assert.ok(pending.includes('if (now === "idle" || now === "failed") void loadSlipCode();'), "mount fetches when idle, retries once when failed");
  assert.ok(pending.includes('const waiting = needs && (now === "idle" || now === "loading");'), "a wait = needs AND idle|loading (failed and ready release the host)");
  assert.ok(pending.includes("return waiting && !gaveUp;"), "pending = a wait that has not hit the ceiling");
  assert.equal(count(pending, "window.setTimeout(() => setGaveUp(true), SLIP_CODE_WAIT_MAX_MS)"), 1, "one ceiling timer, armed per wait");
  assert.ok(pending.includes("window.clearTimeout(id)") && pending.includes("setGaveUp(false);"), "a wait that ends clears its timer and resets the ceiling");
  assert.ok(pending.includes("export const SLIP_CODE_WAIT_MAX_MS = 8_000;"), "the ceiling's value");
  const code = stripComments(pending); // the hook's own comment names useSyncExternalStore
  assert.ok(code.includes("useState") && code.includes("useEffect"), "landmark: it is built on useState / useEffect");
  for (const banned of ["useSyncExternalStore", "useContext", "createContext"]) {
    assert.ok(!code.includes(banned), `${banned} would break the host harness's fake React`);
  }
  const view = readSrc("apps/cafe/components/print/slip/slip-view.ts");
  assert.equal(count(view, 'if (needs && slipCodeStatus() === "idle") void loadSlipCode();'), 1, "a receipt's effect asks only on idle (a failure is never retried by a re-render)");
  assert.ok(!view.includes('"failed") void loadSlipCode'), "no failed-triggered retry in the view");
  const store = readSrc(`${SLIP_DIR}/slip-code.ts`);
  assert.ok(store.includes("export function setSlipCodeImport("), "landmark: the store's test seam");
  assert.ok(!/from\s+["']react["']/.test(store), "the store imports no React");
  assert.ok(!existsSync(path.join(REPO_ROOT, "apps/cafe/hooks/use-slip-print-gate.ts")), "the old gate hook file is gone");
});

test("PIN: none of the 6 react-to-print files passes an onBeforePrint option or touches the old gate", () => {
  const files: [string, number][] = [
    [HOST_BRIDGE, 3],
    ["apps/cafe/hooks/use-kot-print-bridge.ts", 3],
    ["apps/cafe/hooks/use-token-print.ts", 1],
    ["apps/cafe/components/orders/OrderDetailSheet.tsx", 2],
    ["apps/cafe/components/reports/EndOfDayButton.tsx", 1],
    ["apps/cafe/components/orders/MoveTableDialog.tsx", 1],
  ];
  for (const [file, wrapped] of files) {
    const src = readSrc(file);
    assert.equal(count(src, WRAP_NEEDLE), wrapped, `${file}: landmark: its print-job count`);
    for (const banned of ["onBeforePrint" + ":", "slipGate", "useSlipPrintGate", "awaitSlipCode"]) assert.ok(!src.includes(banned), `${file} must not contain ${banned}`);
  }
  // The one remaining mention is the error callback's `where` type, which is react-to-print's own vocabulary.
  assert.ok(readSrc(HOST_BRIDGE).includes('"onBeforePrint" | "print"'), "landmark: the only onBeforePrint text in the bridge is onPrintError's type");
});

// s78 (print customization S4): the Bill design editor's gallery thumbnail (print-design/DesignThumb) is the THIRD
// renderer, a deliberate move of this pin from two to three. It is the real receipt too: its picture is the sample
// order drawn by <OrderReceipt> with the design's own starting template, so a thumbnail can never drift from a bill.
// s79 (S5): the kitchen-ticket editor's gallery thumbnail (print-design/KotDesignThumb) is the FOURTH, the same way around <KOTReceipt>.
test("PIN: exactly the four settings previews render <SlipPreview> (bill preview, kitchen-ticket preview, bill design thumbnail, kitchen design thumbnail), each around its own receipt", () => {
  const renderers = APP_FILES.filter((file) => /^[ \t]*<SlipPreview>$/m.test(readSrc(file))).sort();
  assert.deepEqual(renderers, [
    "apps/cafe/components/settings/BillPrintPreview.tsx",
    "apps/cafe/components/settings/KitchenTicketPreview.tsx",
    "apps/cafe/components/settings/print-design/DesignThumb.tsx",
    "apps/cafe/components/settings/print-design/KotDesignThumb.tsx",
  ]);
  const [billPreview, kitchenPreview, designThumb, kotThumb] = renderers;
  assert.match(readSrc(billPreview), /<SlipPreview>\n\s+<OrderReceipt [^\n]*\/>\n\s+<\/SlipPreview>/, "the bill preview wraps its OrderReceipt");
  assert.match(readSrc(kitchenPreview), /<SlipPreview>\n\s+<KOTReceipt [^\n]*\/>\n\s+<\/SlipPreview>/, "the kitchen-ticket preview wraps its KOTReceipt");
  assert.match(readSrc(designThumb), /<SlipPreview>\n\s+<OrderReceipt [^\n]*\/>\n\s+<\/SlipPreview>/, "the design thumbnail wraps its OrderReceipt");
  assert.match(readSrc(kotThumb), /<SlipPreview>\n\s+<KOTReceipt [^\n]*\/>\n\s+<\/SlipPreview>/, "the kitchen design thumbnail wraps its KOTReceipt");
  for (const file of renderers) assert.ok(readSrc(file).includes('import { SlipPreview } from "@/components/print/slip/SlipSkeleton";'), `${file}: imports SlipPreview from SlipSkeleton`);
  assert.ok(readSrc(`${SLIP_DIR}/SlipSkeleton.tsx`).includes("export function SlipPreview("), "landmark: the provider's definition (not a renderer)");
});
