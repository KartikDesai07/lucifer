import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

// Direct-accessor harvest, per renderer, before any helper union — the basis
// for the item 5 "direct-accessor portion" landmark counts below.
const directOrderKeys = new Set<string>([
  ...harvest(orderReceiptSrc, ORDER_KEY_RE),
  ...harvest(kotReceiptSrc, ORDER_KEY_RE),
]);
const directItemKeys = new Set<string>([
  ...harvest(orderReceiptSrc, ITEM_KEY_RE),
  ...harvest(kotReceiptSrc, ITEM_KEY_RE),
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

// Full harvested sets: renderer direct accessors UNION the helpers they call.
const orderKeys = new Set<string>([...directOrderKeys, ...receiptGstKeys]);
const itemKeys = new Set<string>([...directItemKeys, ...orderItemLabelKeys]);

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
  assert.ok(
    directOrderKeys.size >= 19,
    `expected >=19 direct order keys, got ${directOrderKeys.size}`,
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
  assert.ok(
    directItemKeys.size >= 7,
    `expected >=7 direct item keys, got ${directItemKeys.size}`,
  );
  assert.ok(itemKeys.size >= 9, `expected >=9 union item keys, got ${itemKeys.size}`);
  assert.ok(itemKeys.has("reward"), "reward must be a harvested item key — the whole free-dish feature rides on it");

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
