import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import {
  printOrderSnapshotSchema,
  printOrderSnapshotItemSchema,
} from "@pos/shared/schemas/print-job.schema";

// Print-host plan PH-10, Slice D (print-host-plan.md:1381-1391) — a
// future-drift pin, not a repro: `OrderReceipt.tsx`/`KOTReceipt.tsx` (plus the
// `receiptGst`/`orderItemLabel` helpers they call) are the render-side TRUTH
// of what a printed slip actually reads off an `Order`. `printOrderSnapshotSchema`
// (packages/shared/src/schemas/print-job.schema.ts) is the payload contract a
// print-host job carries instead of a live Order. If a renderer starts reading
// a field the snapshot schema doesn't carry, a host-printed slip would silently
// render blank/undefined for that field while the local (non-host) path still
// works — this suite catches that BEFORE it ships, by harvesting every
// `order.<x>` / `item.<x>` accessor from the renderer source and asserting it
// is a subset of the schema's declared keys.
//
// Harvested via regex over COMMENT-STRIPPED source (stripComments) — this is a
// POSITIVE accessor harvest (the harvested set feeds a subset assertion), so a
// key mentioned only in a comment would silently WIDEN what's "read" and mask
// a real gap; stripping first keeps the harvest honest.

const ORDER_RECEIPT_PATH = "components/pos/OrderReceipt.tsx";
const KOT_RECEIPT_PATH = "components/pos/KOTReceipt.tsx";
const RECEIPT_LIB_PATH = "lib/receipt.ts";
const SHARED_UTILS_PATH = path.join("..", "..", "packages", "shared", "src", "utils.ts");
const SHARED_PRINT_JOB_PATH = path.join("..", "..", "packages", "shared", "src", "print-job.ts");

function readCafeSrc(relPath: string): string {
  return readFileSync(path.join(process.cwd(), relPath), "utf8");
}

const ORDER_KEY_RE = /\border(?:\?)?\.(\w+)/g;
const ITEM_KEY_RE = /\b(?:item|it)\.(\w+)/g;

function harvest(src: string, re: RegExp): Set<string> {
  const out = new Set<string>();
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  return out;
}

const orderReceiptSrc = stripComments(readCafeSrc(ORDER_RECEIPT_PATH));
const kotReceiptSrc = stripComments(readCafeSrc(KOT_RECEIPT_PATH));

// Print customization S2: a stored bill / kitchen-ticket template prints through the block engine
// (components/print/slip/), which reads the order WITHOUT going through OrderReceipt / KOTReceipt. Every non-test
// .ts/.tsx file in that directory is harvested (readdirSync, so a new engine file is covered automatically): a
// field the engine reads that the snapshot schema lacks would print blank on a host-printed slip.
const SLIP_ENGINE_DIR = path.join("components", "print", "slip");
const slipEngineFiles = readdirSync(path.join(process.cwd(), SLIP_ENGINE_DIR))
  .filter((f) => /.tsx?$/.test(f) && !/.test.tsx?$/.test(f))
  .sort();
const slipSrc = slipEngineFiles.map((f) => stripComments(readCafeSrc(path.join(SLIP_ENGINE_DIR, f))));
const slipOrderKeys = new Set<string>(slipSrc.flatMap((src) => [...harvest(src, ORDER_KEY_RE)]));
const slipItemKeys = new Set<string>(slipSrc.flatMap((src) => [...harvest(src, ITEM_KEY_RE)]));

// Direct-accessor harvest, per renderer, before any helper union — the basis
// for the item 5 "direct-accessor portion" landmark counts below.
const directOrderKeys = new Set<string>([
  ...harvest(orderReceiptSrc, ORDER_KEY_RE),
  ...harvest(kotReceiptSrc, ORDER_KEY_RE),
  ...slipOrderKeys,
]);
const directItemKeys = new Set<string>([
  ...harvest(orderReceiptSrc, ITEM_KEY_RE),
  ...harvest(kotReceiptSrc, ITEM_KEY_RE),
  ...slipItemKeys,
]);

// `receiptGst` (lib/receipt.ts:139-196) reads its `order`-shaped parameter for
// the GST breakdown a bill prints — harvested from the FUNCTION BODY, not
// hardcoded, so a future read there is caught the same way as the renderers'.
function receiptGstFunctionBody(): string {
  const src = stripComments(readCafeSrc(RECEIPT_LIB_PATH));
  const start = src.indexOf("export function receiptGst(");
  assert.ok(start >= 0, "receiptGst function not found in lib/receipt.ts");
  // Slice to the next top-level `export` after the function start (the file's
  // next export), or EOF — bounded, single-function slice.
  const nextExportIdx = src.indexOf("\nexport ", start + 1);
  return nextExportIdx === -1 ? src.slice(start) : src.slice(start, nextExportIdx);
}

const receiptGstKeys = harvest(receiptGstFunctionBody(), /\border\.(\w+)/g);

// `orderItemLabel` (packages/shared/src/utils.ts:148-150) reads its `item`-
// shaped parameter for the name/variation label every receipt line uses.
function orderItemLabelFunctionBody(): string {
  const src = stripComments(readFileSync(path.join(process.cwd(), SHARED_UTILS_PATH), "utf8"));
  const start = src.indexOf("export function orderItemLabel(");
  assert.ok(start >= 0, "orderItemLabel function not found in packages/shared/src/utils.ts");
  const nextExportIdx = src.indexOf("\nexport ", start + 1);
  return nextExportIdx === -1 ? src.slice(start) : src.slice(start, nextExportIdx);
}

const orderItemLabelKeys = harvest(orderItemLabelFunctionBody(), /\bitem\.(\w+)/g);

// `orderItemModifierLines` (packages/shared/src/modifiers.ts, UI batch 1 F) reads
// its `item`-shaped parameter for the "NO …" / "+ …" lines under every receipt
// line — the renderers stopped reading `item.modifiers` themselves when it
// landed, so its reads are harvested here the same way orderItemLabel's are.
const SHARED_MODIFIERS_PATH = path.join("..", "..", "packages", "shared", "src", "modifiers.ts");
function orderItemModifierLinesBody(): string {
  const src = stripComments(readFileSync(path.join(process.cwd(), SHARED_MODIFIERS_PATH), "utf8"));
  const start = src.indexOf("export function orderItemModifierLines(");
  assert.ok(start >= 0, "orderItemModifierLines function not found in packages/shared/src/modifiers.ts");
  const nextExportIdx = src.indexOf("\nexport ", start + 1);
  return nextExportIdx === -1 ? src.slice(start) : src.slice(start, nextExportIdx);
}

const modifierLinesKeys = harvest(orderItemModifierLinesBody(), /\bitem\.(\w+)/g);

// Full harvested sets: renderer direct accessors UNION the helpers they call.
const orderKeys = new Set<string>([...directOrderKeys, ...receiptGstKeys]);
const itemKeys = new Set<string>([...directItemKeys, ...orderItemLabelKeys, ...modifierLinesKeys]);

const schemaOrderKeys = new Set<string>(Object.keys(printOrderSnapshotSchema.shape));
const schemaItemKeys = new Set<string>(Object.keys(printOrderSnapshotItemSchema.shape));

test("PIN: receiptGst reads exactly {total, gstAmount, gstRate, gstMode, chargeAmount} off its order param", () => {
  assert.deepEqual(
    [...receiptGstKeys].sort(),
    ["chargeAmount", "gstAmount", "gstMode", "gstRate", "total"].sort(),
  );
});

test("PIN: orderItemLabel reads exactly {name, variation} off its item param", () => {
  assert.deepEqual([...orderItemLabelKeys].sort(), ["name", "variation"].sort());
});

test("PIN: harvested order-level accessor keys are a subset of printOrderSnapshotSchema's keys", () => {
  // Non-vacuity landmarks (plan item 5) — direct-accessor portion, before the
  // helper union, so a regression that zeroes out the renderer harvest (e.g.
  // stripComments over-blinding) cannot pass by starving both sides at once.
  // CB-CHG lowered this from 19 to 18: OrderReceipt no longer reads
  // `order.chargeAmount` DIRECTLY — it renders through
  // `chargesFromOrder(order)`, which prefers the typed `charges[]` and falls
  // back to the legacy scalars. The key itself did not leave the payload
  // (`chargeAmount` is still harvested from receiptGst below, and `charges`
  // was added to printOrderSnapshot + its schema in the same change), so this
  // is one fewer DIRECT accessor, not one fewer carried field. The landmark is
  // an anti-vacuity floor — the real contract is the subset assertion below.
  assert.ok(
    directOrderKeys.size >= 18,
    `expected >=18 direct order keys, got ${directOrderKeys.size}`,
  );
  assert.ok(orderKeys.size >= 22, `expected >=22 union order keys, got ${orderKeys.size}`);

  // Positive landmarks: specific keys a real payload MUST carry.
  assert.ok(orderKeys.has("gstMode"), "gstMode must be a harvested order key");
  assert.ok(orderKeys.has("status"), "status must be a harvested order key");

  // `items` is a legitimate order-level key (the array itself) and must never
  // be checked against the item sub-shape — kept structurally separate from
  // the item-key subset assertion below.
  const missing = [...orderKeys].filter((k) => !schemaOrderKeys.has(k));
  assert.deepEqual(
    missing,
    [],
    `order keys read by the renderer/helpers but absent from printOrderSnapshotSchema: ${missing.join(", ")}`,
  );
});

test("PIN: harvested item-level accessor keys are a subset of printOrderSnapshotItemSchema's keys", () => {
  // Re-baselined UP for CB-5B S14 (MEASURED this session: direct 7, union 9 —
  // `reward` and `note` joined the harvest). Kept as FLOORS, never `===`: the
  // pin exists to catch a renderer that stops reading a field, not to freeze
  // the count.
  // Re-baselined 2026-09-29 (UI batch 1 F, MEASURED: direct 6, union 10): the
  // renderers' own `item.modifiers` reads moved into orderItemModifierLines,
  // whose body is harvested above — the field is still read, one hop away —
  // and the union gained `removedModifiers`.
  assert.ok(
    directItemKeys.size >= 6,
    `expected >=6 direct item keys, got ${directItemKeys.size}`,
  );
  assert.ok(itemKeys.size >= 10, `expected >=10 union item keys, got ${itemKeys.size}`);
  assert.ok(itemKeys.has("reward"), "reward must be a harvested item key — the whole free-dish feature rides on it");
  assert.ok(itemKeys.has("removedModifiers"), "removedModifiers must be a harvested item key — the NO lines ride on it");

  // Positive landmarks.
  assert.ok(itemKeys.has("modifiers"), "modifiers must be a harvested item key");
  assert.ok(itemKeys.has("instructions"), "instructions must be a harvested item key");
  assert.ok(itemKeys.has("variation"), "variation must be a harvested item key");
  assert.ok(itemKeys.has("name"), "name must be a harvested item key");

  const missing = [...itemKeys].filter((k) => !schemaItemKeys.has(k));
  assert.deepEqual(
    missing,
    [],
    `item keys read by the renderer/helpers but absent from printOrderSnapshotItemSchema: ${missing.join(", ")}`,
  );
});

// `roundItems` (KOTReceipt.tsx:37, fed by print-host-slips.ts's kotRoundItems)
// needs no separate scan: KOTReceipt.tsx:88 unifies it into the same `items`
// array (`const items = roundItems ?? order?.items ?? []`), so every access
// below that point goes through the same `item.<x>` alias already harvested
// above. Positive landmark for that unification, next to the negative claim
// that no `roundItems.<prop>` accessor exists anywhere in the file.
test("PIN: KOTReceipt unifies roundItems into `items`/`item` — no separate roundItems.<prop> accessors", () => {
  assert.match(kotReceiptSrc, /const items = roundItems \?\? order\?\.items \?\? \[\];/);
  assert.ok(
    !/\broundItems\.\w+/.test(kotReceiptSrc),
    "KOTReceipt.tsx must not read roundItems.<prop> directly — it goes through `items`/`item`",
  );
});

// ── CB-CHG — the typed charge array must reach the HOST lane ────────────────
// OrderReceipt renders charge lines from `chargesFromOrder(order)`, which
// prefers `charges[]` over the legacy scalars. `printOrderSnapshot` is a
// WHITELIST: a field it does not pick is simply absent from the payload, and
// the schema is strict-shaped so an undeclared key is stripped on the way
// through. Either omission would print a slip on the counter PC that silently
// drops every extra-charge line while the on-screen bill showed them — the
// customer's paper and the cafe's screen disagreeing about money. This pin
// asserts all three sides (picker, schema, renderer) in one place.
test("PIN (CB-CHG): `charges` survives the whole print lane — snapshot picker, schema, and renderer", () => {
  const snapshotSrc = stripComments(
    readFileSync(
      path.join(process.cwd(), "..", "..", "packages", "shared", "src", "print-job.ts"),
      "utf8",
    ),
  );
  const pickerStart = snapshotSrc.indexOf("export function printOrderSnapshot(");
  assert.ok(pickerStart >= 0, "landmark: printOrderSnapshot must exist");
  const pickerBody = snapshotSrc.slice(pickerStart);
  assert.match(
    pickerBody,
    /\bcharges\b/,
    "printOrderSnapshot must carry `charges` — it is a whitelist, so an unpicked field never reaches the host",
  );

  assert.ok(
    schemaOrderKeys.has("charges"),
    "printOrderSnapshotSchema must declare `charges` or the strict shape strips it in transit",
  );

  // Positive landmark: the renderer really does read charges through the
  // helper, so this pin is guarding a live path and not a dead one.
  assert.match(
    orderReceiptSrc,
    /chargesFromOrder\(/,
    "landmark: OrderReceipt must render charges via chargesFromOrder(order)",
  );
});

// ── Print customization S2 — the block engine is harvested too ──────────────
test("PIN (S2): every slip-engine file is harvested, and what the engine reads off an order / item is in the snapshot schema", () => {
  // Positive landmarks: the directory listing found the engine, and the harvest is non-vacuous.
  for (const f of ["SlipEngine.tsx", "bill-classic-blocks.tsx", "kot-classic-blocks.tsx", "slip-context.ts"]) {
    assert.ok(slipEngineFiles.includes(f), `landmark: ${f} is in the harvested slip-engine set`);
  }
  assert.ok(slipOrderKeys.has("billNumber") && slipOrderKeys.has("cancelReason") && slipOrderKeys.has("notes"), "landmark: engine order reads harvested");
  assert.ok(slipItemKeys.has("instructions") && slipItemKeys.has("reward") && slipItemKeys.has("price"), "landmark: engine item reads harvested");
  const missingOrder = [...slipOrderKeys].filter((k) => !schemaOrderKeys.has(k));
  const missingItem = [...slipItemKeys].filter((k) => !schemaItemKeys.has(k));
  assert.deepEqual(missingOrder, [], `order keys read by the slip engine but absent from printOrderSnapshotSchema: ${missingOrder.join(", ")}`);
  assert.deepEqual(missingItem, [], `item keys read by the slip engine but absent from printOrderSnapshotItemSchema: ${missingItem.join(", ")}`);
});

// ── Print customization S3b — the pay QR's first-print anchor must reach the HOST lane ─────────────────────────
// The slip engine reads `order.billFirstPrintedAt` (genericBillQr -> payQrPlan) for the "Valid till" line. The
// snapshot picker is a whitelist and the schema is strict, so either side omitting the key would print a host slip
// whose QR window restarts at every reprint while the counter's own print counts from the first one.
test("PIN (S3b): the slip engine's harvested order keys include billFirstPrintedAt, and the snapshot picker and schema carry it", () => {
  assert.ok(slipOrderKeys.has("billFirstPrintedAt"), "the engine reads order.billFirstPrintedAt (harvested from the slip sources)");
  assert.ok(orderKeys.has("billFirstPrintedAt"), "so it is in the full harvested set the subset pin above checks");
  assert.ok(schemaOrderKeys.has("billFirstPrintedAt"), "printOrderSnapshotSchema declares it, or the strict shape rejects the payload");
  const snapshotSrc = stripComments(readFileSync(path.join(process.cwd(), SHARED_PRINT_JOB_PATH), "utf8"));
  const pickerStart = snapshotSrc.indexOf("export function printOrderSnapshot(");
  assert.ok(pickerStart >= 0, "landmark: printOrderSnapshot must exist");
  assert.match(snapshotSrc.slice(pickerStart), /\bbillFirstPrintedAt\b/, "printOrderSnapshot's body carries billFirstPrintedAt");
});

// Print customization S6: the order's token is read by both legacy receipts and the block engine, so the snapshot
// schema MUST carry it (positive landmark: the harvest really sees the key, so the subset test above is not blind to it).
test("PIN (S6): tokenNumber is harvested from OrderReceipt, KOTReceipt and the slip engine, and the snapshot schema carries it", () => {
  assert.ok(harvest(orderReceiptSrc, ORDER_KEY_RE).has("tokenNumber"), "OrderReceipt reads order.tokenNumber");
  assert.ok(harvest(kotReceiptSrc, ORDER_KEY_RE).has("tokenNumber"), "KOTReceipt reads order.tokenNumber");
  assert.ok(slipOrderKeys.has("tokenNumber"), "the slip engine reads order.tokenNumber");
  assert.ok(directOrderKeys.has("tokenNumber"));
  assert.ok("tokenNumber" in printOrderSnapshotSchema.shape, "the snapshot schema declares tokenNumber");
  const snapshotBuilder = stripComments(readFileSync(path.join(process.cwd(), SHARED_PRINT_JOB_PATH), "utf8"));
  assert.ok(snapshotBuilder.includes("order.tokenNumber"), "printOrderSnapshot copies it from the live order");
});
