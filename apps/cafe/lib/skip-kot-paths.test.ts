import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { stripComments } from "@/lib/source-pin-utils";
import { orderItemSchema } from "@/schemas";

// Skip-KOT S6 (plan 12-skip-kot-plan.md): source pins over the COMMENT-STRIPPED files. Every server writer stamps
// its lines through withKitchenFlags BEFORE its KOT number draw and gates the draw on the stamp; the void route
// gates its number on the voided entry's noKot; every client KOT entry point reads the kitchen-lines helpers before
// it routes a kitchen slip; the models declare noKot with no default; the client line schema never accepts it.
// Each pin carries a positive landmark so it cannot pass on a file that moved or emptied.

const CAFE = path.join(__dirname, "..");
const SHARED = path.join(CAFE, "..", "..", "packages", "shared", "src");
const code = (rel: string, root = CAFE): string =>
  stripComments(readFileSync(path.join(root, rel), "utf8")).replace(/\r\n/g, "\n");
const raw = (rel: string, root = CAFE): string => readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
const count = (src: string, needle: string): number => src.split(needle).length - 1;
const at = (src: string, needle: string, from = 0): number => {
  const found = src.indexOf(needle, from);
  assert.ok(found !== -1, `needle present: ${needle}`);
  return found;
};
/** src between two needles (both required, the end strictly after the start). */
const between = (src: string, start: string, end: string): string => {
  const s = at(src, start);
  return src.slice(s, at(src, end, s + start.length));
};
function sourcesUnder(dirs: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path.relative(CAFE, full).split(path.sep).join("/"));
    }
  };
  for (const d of dirs) walk(path.join(CAFE, d));
  return out;
}

const ORDERS_ROUTE = "app/api/orders/route.ts";
const ITEMS_ROUTE = "app/api/orders/[id]/items/route.ts";
const VOID_ROUTE = "app/api/orders/[id]/items/void/route.ts";
const ACCEPT = "lib/order-request-accept.ts";
const ACCEPT_ADDROUND = "lib/order-request-accept-addround.ts";
const SERVER_HELPER_IMPORT = 'import { withKitchenFlags } from "@/lib/kitchen-lines-server";';
const KOT_DRAW = 'nextPrintedNumber("kot"';
const OPENING_DRAW = "allocateOpeningSlips(";

// ── server writers: stamp, THEN draw, and the draw reads the stamp ───────────────────────────────

const WRITERS: ReadonlyArray<{ file: string; stamp: string; draw: string; gate: string; stored: string }> = [
  {
    file: ORDERS_ROUTE,
    stamp: "const kot = await withKitchenFlags(rewardItems);",
    draw: OPENING_DRAW,
    gate: "slips = await allocateOpeningSlips(printCfg, { kitchen: kot.kitchen });",
    stored: "rewardItems = kot.lines;",
  },
  {
    file: ITEMS_ROUTE,
    stamp: "const kot = await withKitchenFlags(fullItems.slice(old.items.length));",
    draw: KOT_DRAW,
    gate: "const ticket = printCfg.kot.showNumber && kot.kitchen\n      ? await nextPrintedNumber(\"kot\", printCfg.kot)",
    stored: "fullItems = [...old.items, ...kot.lines];",
  },
  {
    file: ACCEPT,
    stamp: "const kot = await withKitchenFlags(orderItems);",
    draw: OPENING_DRAW,
    gate: "const slips = await allocateOpeningSlips(printCfg, { kitchen: kot.kitchen });",
    stored: "items: kot.lines.map((it) => ({ ...it, kotRound: 1 })),",
  },
  {
    file: ACCEPT_ADDROUND,
    stamp: "const kot = await withKitchenFlags(items);",
    draw: KOT_DRAW,
    gate: "const ticket = printCfg.kot.showNumber && kot.kitchen\n    ? await nextPrintedNumber(\"kot\", printCfg.kot)",
    stored: "...kot.lines.map((it) => ({ ...it, kotRound: round }))",
  },
];

for (const w of WRITERS) {
  test(`writer ${w.file}: imports withKitchenFlags, stamps ONCE, before its only KOT number draw, and the draw is gated on kot.kitchen`, () => {
    const src = code(w.file);
    at(src, SERVER_HELPER_IMPORT);
    assert.equal(count(src, "withKitchenFlags("), 1, "exactly one stamp per writer");
    assert.equal(count(src, w.draw), 1, `exactly one ${w.draw} draw (a second, unstamped draw would burn a number)`);
    const stamp = at(src, w.stamp);
    const draw = at(src, w.draw);
    assert.ok(stamp < draw, "the stamp precedes the number draw");
    const gate = at(src, w.gate);
    assert.ok(gate <= draw && draw < gate + w.gate.length, "the one draw IS the gated expression");
    const stored = at(src, w.stored);
    assert.ok(stamp < stored, "the stamped lines (kot.lines) are the ones the writer stores, after the stamp");
  });
}

test("void route: the void number is gated on the voided entry's noKot, and the trail push keeps that entry (noKot carried)", () => {
  const src = code(VOID_ROUTE);
  assert.equal(count(src, "withKitchenFlags("), 0, "landmark-paired negative: a void re-reads no menu (the line's own stamp decides)");
  assert.equal(count(src, KOT_DRAW), 1, "landmark: the void route draws its number in one place");
  const gate = at(src, "printCfg.kot.showNumber && printCfg.kot.numberVoidSlips && !resolved.entry.noKot");
  const draw = at(src, KOT_DRAW);
  assert.ok(gate < draw && draw - gate < 120, "the noKot gate sits in the draw's own condition");
  at(src, "voids: voidTicket === undefined\n            ? resolved.entry\n            : { ...resolved.entry, kotNumber: voidTicket },");
  at(src, 'slips: [{ kind: "void" }],');
});

test("allocateOpeningSlips: a no-kitchen opening round returns {} before EITHER draw (no KOT number, no token)", () => {
  const src = code("lib/slip-numbers.ts");
  const fn = between(src, "export async function allocateOpeningSlips<T>(", "return {\n    ...(kotNumber");
  at(fn, "round: { kitchen: boolean },");
  const skip = at(fn, "if (!round.kitchen) return {};");
  assert.ok(skip < at(fn, 'nextPrintedNumber("kot", cfg.kot, deps)') && skip < at(fn, 'nextPrintedNumber("token", cfg.token, deps)'));
});

test("structural gate: the ONLY files that draw a KOT number are the four stamped writers, the void route and slip-numbers", () => {
  const files = sourcesUnder(["app", "lib", "components", "hooks"]);
  assert.ok(files.length > 300, `landmark: the scan read ${files.length} files`);
  const drawers = files.filter((f) => {
    const src = code(f);
    return src.includes(KOT_DRAW) || src.includes("await " + OPENING_DRAW);
  }).sort();
  assert.deepEqual(drawers, [ITEMS_ROUTE, VOID_ROUTE, ORDERS_ROUTE, ACCEPT_ADDROUND, ACCEPT, "lib/slip-numbers.ts"].sort());
  const stampers = files.filter((f) => code(f).includes("withKitchenFlags(")).sort();
  assert.deepEqual(stampers, [ITEMS_ROUTE, ORDERS_ROUTE, ACCEPT_ADDROUND, ACCEPT].sort(), "the four writers call it (the definition is generic: withKitchenFlags<T>)");
  at(code("lib/kitchen-lines-server.ts"), "export async function withKitchenFlags<T extends KitchenFlagged & { productId: unknown }>(");
});

test("withKitchenFlags fails OPEN: a read throw returns the lines unchanged with kitchen: true", () => {
  const src = code("lib/kitchen-lines-server.ts");
  const tryAt = at(src, "try {");
  const reads = at(src, 'Product.find({ _id: { $in: ids } }).select("categoryId noKot")');
  at(src, 'Category.find({ noKot: true }).select("_id")');
  assert.ok(tryAt < reads, "both reads run inside the try");
  at(src, "} catch {\n    return { lines: [...lines], kitchen: true };\n  }");
});

// ── server print lanes: kitchen slips are built from kitchen lines only ───────────────────────────

test("server print jobs: createOrderPrintJobs filters through kitchenSlipsOf BEFORE building requests; KOT/moved/cancel snapshots use kitchenOrderOf, bill/token the whole order", () => {
  const jobs = code("lib/print-order-jobs.ts");
  const fn = between(jobs, "export async function createOrderPrintJobs(", "export async function enqueueOwnPrintJob(");
  assert.ok(at(fn, "const wanted = kitchenSlipsOf(order, input.slips);") < at(fn, "requestOf(order, slip)"));
  at(fn, "if (wanted.length === 0) return refs;");
  const routing = code("lib/print-routing.ts");
  assert.equal(count(routing, "printOrderSnapshot(kitchenOrderOf(order))"), 3, "kot + moved + cancel-notice");
  at(routing, 'payload: { kind: "kot", snapshot: printOrderSnapshot(kitchenOrderOf(order)), round },');
  at(routing, 'payload: { kind: "cancel-notice", snapshot: printOrderSnapshot(kitchenOrderOf(order)), reason },');
  at(routing, 'payload: { kind: "bill", snapshot: printOrderSnapshot(order)');
  at(routing, 'payload: { kind: "token", snapshot: printOrderSnapshot(order)');
});

// ── client KOT entry points ──────────────────────────────────────────────────────────────────────

const KL_IMPORT = 'from "@/lib/kitchen-lines";';

test("use-print-routing: queueKotRound gates ONLY the KOT on roundSkipsKitchen (the token is outside the gate); queueVoidSlip returns on noKot; reprint toasts on an all-skip order", () => {
  const src = code("hooks/use-print-routing.ts");
  at(src, "import { KITCHEN_NOTHING_TO_SEND_MESSAGE, orderSkipsKitchen, roundSkipsKitchen } " + KL_IMPORT);
  const kot = between(src, "const queueKotRound = useCallback(", "const queueVoidSlip = useCallback(");
  const gate = at(kot, "if (!roundSkipsKitchen(order.items, resolved)) {\n      routePrint(() => kotPrintJob(order, resolved),");
  const close = at(kot, "}\n", gate + 1);
  const token = at(kot, "if (opensWithToken(order, resolved)) {");
  assert.ok(gate < close && close < token, "the KOT gate closes before the token's own gate");
  const voidFn = between(src, "const queueVoidSlip = useCallback(", "const reprintKot = useCallback(");
  assert.ok(at(voidFn, "if (entry.noKot) return;") < at(voidFn, "routePrint(() => voidPrintJob(order, entry,"));
  assert.ok(at(voidFn, "noteOrder(order);") < at(voidFn, "if (entry.noKot) return;"), "the order is still noted for a skipped void");
  const reprint = src.slice(at(src, "const reprintKot = useCallback("));
  const skip = at(reprint, "if (orderSkipsKitchen(target)) {\n      toast.info(KITCHEN_NOTHING_TO_SEND_MESSAGE);\n      return;\n    }");
  assert.ok(skip < at(reprint, "routePrint(() => kotPrintJob(target, null)"));
});

test("PrintHostDrain: the host's self-order lane gates the KOT on roundSkipsKitchen, the token stays outside", () => {
  const src = code("components/print/PrintHostDrain.tsx");
  at(src, "import { roundSkipsKitchen } " + KL_IMPORT);
  const gate = at(src, "if (!roundSkipsKitchen(order.items, round)) {\n        routePrint(() => kotPrintJob(order, round),");
  assert.ok(gate < at(src, "if (opensWithToken(order, round)) {"));
  assert.equal(count(src, "roundSkipsKitchen("), 1);
});

test("OrderDetailSheet: Notify Kitchen / KOT reprint returns with a toast on an all-skip order before routing; its KOTReceipt renders kitchenOrderOf", () => {
  const src = code("components/orders/OrderDetailSheet.tsx");
  at(src, "import { KITCHEN_NOTHING_TO_SEND_MESSAGE, kitchenOrderOf, orderSkipsKitchen } " + KL_IMPORT);
  const fn = between(src, "const printKitchenSlip = () => {", "localPrintOf(order, printKot),");
  const skip = at(fn, "if (orderSkipsKitchen(order)) {\n      toast.info(KITCHEN_NOTHING_TO_SEND_MESSAGE);\n      return;\n    }");
  assert.ok(skip < at(fn, "routePrint("));
  at(src, "<KOTReceipt\n            order={order ? kitchenOrderOf(order) : order}");
  at(src, "<OrderReceipt order={order} settings={settings.data} ref={receiptRef} />");
});

test("MoveTableDialog: an all-skip order prints no moved slip on either lane but the dialog still closes; its KOTReceipt renders kitchenOrderOf", () => {
  const src = code("components/orders/MoveTableDialog.tsx");
  at(src, "import { kitchenOrderOf, orderSkipsKitchen } " + KL_IMPORT);
  const skip = at(src, "if (orderSkipsKitchen(slip.order)) {");
  const local = at(src, "} else if (!shouldRoute) {\n      printSlip();", skip);
  const routed = at(src, "} else {\n      void queueMovedSlip(slip.order, {", local);
  assert.ok(skip < local && local < routed, "skip, then the local branch, then the routed branch: one if/else chain");
  assert.ok(routed < at(src, "onOpenChange(false);\n    onMoved?.(slip.order, slip.from);", routed), "close + onMoved run after the chain, for every branch");
  at(src, "order={slip ? kitchenOrderOf(slip.order) : null}");
});

test("PrintSources: the KOT renders kitchenOrderOf + kitchenLinesOf(roundItems); the bill and token keep the whole order", () => {
  const src = code("components/pos/PrintSources.tsx");
  at(src, "import { kitchenLinesOf, kitchenOrderOf } " + KL_IMPORT);
  const kot = between(src, "<KOTReceipt", "/>");
  at(kot, "order={order ? kitchenOrderOf(order) : order}");
  at(kot, "roundItems={kotRoundItems ? [...kitchenLinesOf(kotRoundItems)] : undefined}");
  at(src, "<OrderReceipt order={order} settings={settings}");
  at(src, "<TokenSlip order={order} settings={settings}");
});

// ── models: declared, no default; the client line schema never takes it ──────────────────────────

const NO_DEFAULT_PATH = "noKot: { type: Boolean },";
function assertOneNoDefaultPath(block: string, landmark: string, where: string): void {
  at(block, landmark);
  assert.equal(count(block, "noKot:"), 1, `${where}: exactly one noKot path`);
  const line = block.split("\n").find((l) => l.includes("noKot:")) ?? "";
  assert.equal(line.trim(), NO_DEFAULT_PATH, `${where}: noKot is a bare Boolean path`);
  assert.ok(!line.includes("default"), `${where}: no default (omit-empty)`);
}

test("models/Order.ts: noKot on BOTH the item and the void subschema, no default; both interfaces type it", () => {
  const src = code("models/Order.ts");
  const item = between(src, "const orderItemSchema = new Schema<IOrderItem>(", "{ _id: false }");
  assertOneNoDefaultPath(item, "kotRound: { type: Number, default: 0 },", "orderItemSchema");
  const voids = between(src, "const orderVoidSchema = new Schema<IOrderVoid>(", "{ _id: false }");
  assertOneNoDefaultPath(voids, "reward: { type: Boolean },", "orderVoidSchema");
  assert.ok(between(src, "export interface IOrderItem {", "\n}").includes("noKot?: boolean;"));
  assert.ok(between(src, "export interface IOrderVoid {", "\n}").includes("noKot?: boolean;"));
});

test("models/Category.ts + Product.ts: noKot declared with no default", () => {
  const cat = code("models/Category.ts");
  assertOneNoDefaultPath(between(cat, "export const categorySchema = new Schema<ICategory>(", "{ timestamps: true }"), "stationId: { type: Schema.Types.ObjectId },", "categorySchema");
  const prod = code("models/Product.ts");
  const schemaStart = at(prod, "new Schema<IProduct>(");
  const block = prod.slice(schemaStart, at(prod, "{ timestamps: true }", schemaStart));
  assertOneNoDefaultPath(block, "publicVisible: { type: Boolean },", "productSchema");
});

test("shared orderItemSchema declares no noKot (source), and a client-sent noKot is stripped (runtime)", () => {
  const src = code("schemas/order.schema.ts", SHARED);
  const block = between(src, "export const orderItemSchema = z.object({", "\n});");
  at(block, "productId: objectIdString,");
  at(block, "instructions: z.string().optional().default(\"\"),");
  assert.ok(!block.includes("noKot"), "the client line schema never names noKot");
  assert.ok(raw("schemas/order.schema.ts", SHARED).includes("deliberately NO `noKot` key"), "landmark: the fence comment is in the raw file");
  const parsed = orderItemSchema.safeParse({ productId: "665f000000000000000000a1", name: "Water", price: 20, qty: 1, noKot: true });
  assert.ok(parsed.success, "landmark: the line itself is valid");
  assert.ok(parsed.success && !("noKot" in parsed.data));
});
