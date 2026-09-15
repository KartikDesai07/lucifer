import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { resolveItemVoid, type VoidableLine, type ItemVoidRequest } from "./order-void";
import { voidPrintJob, voidLineInstructionsWithRewardMarker } from "./print-routing";
import { stripComments } from "./source-pin-utils";
import { orderLineKey } from "@pos/shared/utils";
import { REWARD_ITEM_LINE_NOTE } from "@pos/shared/reward-redemption";
import { printJobPayloadSchema } from "@pos/shared/schemas/print-job.schema";
import type { GstConfig } from "./receipt";
import type { Order, OrderVoid } from "@/types";

// The reward (CONSEQUENT) arm of an `x.reward ? ... : ...` ternary, with the
// struck-through worth and FREE INSIDE it. Swapping the arms — which every
// separate /FREE/ + /line-through/ needle survived — fails this.
// `(?<![!\w.])` is load-bearing: without it `!item.reward ?` still contains
// the substring `item.reward ?`, so swapping the ternary arms — the exact bug
// this pin exists to catch — ESCAPED it (measured, not assumed).
const REWARD_ARM = /(?<![!\w.])(item|v)\.reward \?[\s\S]{0,400}?line-through[\s\S]{0,220}?FREE[\s\S]{0,140}?\)\s*:\s*\(/;

// "<instructions><non-empty separator><marker>" — pins that the fold JOINS
// the two rather than merely containing both.
const JOINED_FOLD = new RegExp(
  `^Less sugar\\s*\\S+\\s*${REWARD_ITEM_LINE_NOTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
);

// CB-5B S13+S14-remainder — the void-trail half of the reward feature: does a
// VOIDED reward line still tell the kitchen/trail/staff it was comped? The
// owner's binding decision (session 37) keeps KOTReceipt.tsx a NORMAL kitchen
// ticket, so the marker rides the DATA (the synthesized line's `instructions`
// string), never a new renderer branch — see print-routing.ts's
// voidLineInstructionsWithRewardMarker, single-homed and shared by BOTH print
// syntheses (voidPrintJob here and use-pos-print.ts's queueVoidSlip). This
// file is the DB-free proof that every hop from resolveItemVoid's trail entry
// through both print paths to the two staff surfaces carries the flag, and
// that the owner's KOT-stays-normal requirement still holds for the VOID
// variant specifically.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(path.join(HERE, "..", rel), "utf8");

const AT = new Date("2026-08-09T12:00:00.000Z");
const REASON = "Sent to wrong table";
const VOIDED_BY = "Asha";
const PRODUCT_ID_1 = "1".repeat(24);

const GST_OFF: GstConfig = { gstEnabled: false, gstRate: 0, gstMode: "exclusive" };

function line(over: Partial<VoidableLine> = {}): VoidableLine {
  return { productId: PRODUCT_ID_1, name: "Filter Coffee", price: 40, qty: 1, kotRound: 1, ...over };
}

const keyOf = (l: VoidableLine): string => orderLineKey({ ...l, productId: String(l.productId) });

function request(over: Partial<ItemVoidRequest> = {}): ItemVoidRequest {
  return {
    index: 0,
    lineKey: keyOf(line()),
    qty: 1,
    reason: REASON,
    voidedBy: VOIDED_BY,
    at: AT,
    ...over,
  };
}

// A tab must always keep at least one line (isLastLine/resolveItemVoid's own
// rule), so every fixture here voids ONE of TWO lines — a single-item tab
// would 400 as a cancellation before the reward carry is ever exercised.
const PRODUCT_ID_2 = "2".repeat(24);
function voidInput(overrideLine: Partial<VoidableLine> = {}) {
  const target = line(overrideLine);
  const other = line({ productId: PRODUCT_ID_2, name: "Tea", price: 20 });
  return {
    items: [target, other],
    request: request({ lineKey: keyOf(target) }),
    discount: 0,
    discountKind: undefined,
    reward: undefined,
    charge: 0,
    gstCfg: GST_OFF,
  };
}

// ── (a) resolveItemVoid's trail entry ────────────────────────────────────

test("resolveItemVoid: the trail entry CARRIES reward:true when the voided line was a reward", () => {
  const result = resolveItemVoid(voidInput({ reward: true }));
  if (!("entry" in result)) assert.fail(`expected a resolution, got error: ${JSON.stringify(result)}`);
  assert.ok("reward" in result.entry, "a reward line's void entry must carry the reward key");
  assert.equal(result.entry.reward, true);
});

test("resolveItemVoid: the trail entry OMITS reward entirely on a normal (non-reward) line — omit-empty, not falsiness", () => {
  const result = resolveItemVoid(voidInput());
  if (!("entry" in result)) assert.fail(`expected a resolution, got error: ${JSON.stringify(result)}`);
  assert.equal("reward" in result.entry, false, "a normal line's void entry must NOT carry a reward key at all (not even reward:false/undefined)");
  // positive landmark: the rest of the entry still built normally
  assert.equal(result.entry.name, "Filter Coffee");
});

// ── (b) both print syntheses carry the flag AND the printed marker ──────

function orderFixture(overrides: Partial<Order> = {}): Order {
  return {
    _id: "665f0a0000000000000000a1",
    orderId: "ORD-0001",
    customerName: "Walk-in",
    items: [{ productId: "p1", name: "Filter Coffee", price: 40, qty: 1, modifiers: [], instructions: "", kotRound: 1 }],
    subtotal: 40,
    discount: 0,
    total: 40,
    paidAmount: 40,
    payment: "Cash",
    status: "Completed",
    receiver: "Staff",
    tableNo: "T-4",
    kotRounds: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function orderVoidFixture(overrides: Partial<OrderVoid> = {}): OrderVoid {
  return {
    productId: "p1",
    name: "Filter Coffee",
    price: 40,
    qty: 1,
    kotRound: 1,
    reason: REASON,
    voidedBy: VOIDED_BY,
    at: "2026-01-02T10:00:00.000Z",
    ...overrides,
  };
}

test("voidPrintJob: payload.line carries reward:true and the marker rides in instructions when the entry was a reward with no prior instructions", () => {
  const job = voidPrintJob(orderFixture(), orderVoidFixture({ reward: true }), { reprint: false });
  assert.equal(job.payload.kind, "void");
  if (job.payload.kind !== "void") return;
  assert.equal(job.payload.line.reward, true);
  assert.equal(job.payload.line.instructions, REWARD_ITEM_LINE_NOTE);
});

test("voidPrintJob: a normal (non-reward) entry OMITS payload.line.reward entirely", () => {
  const job = voidPrintJob(orderFixture(), orderVoidFixture(), { reprint: false });
  assert.equal(job.payload.kind, "void");
  if (job.payload.kind !== "void") return;
  assert.equal("reward" in job.payload.line, false, "a normal void line must not carry a reward key");
});

// use-pos-print.ts's queueVoidSlip runs inside a React hook (useCallback) and
// cannot be called directly from a DB-free node:test file, so it is pinned as
// a SOURCE pin — with a POSITIVE landmark alongside the reward assertion
// (vision-guard rule: a bare "does it mention reward" scan could pass against
// the wrong file or an empty one).
test("SOURCE PIN: use-pos-print.ts's queueVoidSlip synthesizes the SAME reward carry as voidPrintJob — folds the marker via the shared helper and OMIT-EMPTY picks entry.reward", () => {
  const src = stripComments(readSrc("hooks/use-pos-print.ts"));
  // positive landmark: the function this pin is about still exists and still
  // builds the synthesized line the same way it always has.
  assert.match(src, /const queueVoidSlip = useCallback\(\(order: Order, entry: OrderVoid\) => \{/, "landmark: queueVoidSlip must still be defined with this signature");
  assert.match(src, /name: entry\.name,/, "landmark: the synthesized line must still carry the entry's name");
  assert.match(
    src,
    /instructions: voidLineInstructionsWithRewardMarker\(entry\.instructions \?\? "", entry\.reward\),/,
    "queueVoidSlip must fold the marker through the SAME shared helper voidPrintJob uses, or the two print paths can disagree",
  );
  assert.match(
    src,
    /\.\.\.\(entry\.reward \? \{ reward: true as const \} : \{\}\)/,
    "queueVoidSlip must OMIT-EMPTY carry entry.reward onto its synthesized line, mirroring voidPrintJob",
  );
});

// ── (c) the marker text comes from the shared constant, never a literal ──

test("voidLineInstructionsWithRewardMarker: the marker is the IMPORTED REWARD_ITEM_LINE_NOTE constant, not a hand-written literal", () => {
  assert.equal(voidLineInstructionsWithRewardMarker("", true), REWARD_ITEM_LINE_NOTE);
  // Renaming/changing the constant must change this function's output too —
  // proven by asserting equality against the IMPORT, never a hardcoded string.
  assert.notEqual(REWARD_ITEM_LINE_NOTE, "", "sanity: the imported constant must be non-empty for this pin to mean anything");
});

test("SOURCE PIN: voidLineInstructionsWithRewardMarker (print-routing.ts) builds the marker from the IMPORTED REWARD_ITEM_LINE_NOTE, never a hand-written literal string", () => {
  const src = stripComments(readSrc("lib/print-routing.ts"));
  assert.match(src, /import \{ REWARD_ITEM_LINE_NOTE \} from "@pos\/shared\/reward-redemption";/, "landmark: the constant must be imported from the shared module");

  assert.match(
    src,
    /export function voidLineInstructionsWithRewardMarker/,
    "landmark: the shared fold helper must still be exported from here",
  );
  // The reward branch must reference the imported identifier, never inline a
  // literal string like "Reward — free" of its own.
  const fnBody = src.slice(src.indexOf("export function voidLineInstructionsWithRewardMarker"));
  assert.match(fnBody.slice(0, 400), /REWARD_ITEM_LINE_NOTE/, "the fold must reference the imported constant by name");
});

// ── (d) the instructions fold ────────────────────────────────────────────

test("voidLineInstructionsWithRewardMarker: marker ALONE when the entry had no instructions", () => {
  assert.equal(voidLineInstructionsWithRewardMarker("", true), REWARD_ITEM_LINE_NOTE);
});

test("voidLineInstructionsWithRewardMarker: BOTH present when the entry had instructions — existing text preserved, not overwritten", () => {
  const folded = voidLineInstructionsWithRewardMarker("Less sugar", true);
  // The JOINED shape, not merely co-presence: deleting the separator left both
  // substrings present and escaped every assertion here (arbitrated escape).
  assert.notEqual(folded, `Less sugar${REWARD_ITEM_LINE_NOTE}`, "the two must not be run together with no separator");
  assert.match(folded, JOINED_FOLD, "the marker must follow the original instructions after a visible separator");
  assert.match(folded, /Less sugar/, "the original instructions must survive the fold");
  assert.match(folded, new RegExp(REWARD_ITEM_LINE_NOTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "the marker must also be present");
  assert.notEqual(folded, "Less sugar", "the fold must have actually added something");
});

test("voidLineInstructionsWithRewardMarker: BYTE-IDENTICAL to the old value on a non-reward entry (reward undefined or false)", () => {
  assert.equal(voidLineInstructionsWithRewardMarker("Less sugar", undefined), "Less sugar");
  assert.equal(voidLineInstructionsWithRewardMarker("Less sugar", false), "Less sugar");
  assert.equal(voidLineInstructionsWithRewardMarker("", undefined), "");
});

// ── (e) the .strict() void payload schema accepts reward, still rejects unknown keys ──

test("PIN: the void payload's .strict() line sub-schema ACCEPTS a reward:true line, and STILL REJECTS an unknown key (the widening was not bought by dropping the .strict() fence)", () => {
  const job = voidPrintJob(orderFixture(), orderVoidFixture({ reward: true }), { reprint: false });
  const parsed = printJobPayloadSchema.safeParse(job.payload);
  assert.ok(parsed.success, `a reward void line must parse: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`);

  // positive landmark: schema still declares `reward` — this is not a
  // side-effect of z.object silently permitting extra keys.
  const schemaSrc = stripComments(readSrc("../../packages/shared/src/schemas/print-job.schema.ts"));
  assert.match(schemaSrc, /line:\s*z\s*\n?\s*\.object\(\{/, "landmark: voidPayloadSchema.line must still be defined");
  // SCOPED to the void payload: printOrderSnapshotItemSchema declares a
  // byte-identical `reward` key, so an unscoped needle still passed with the
  // VOID line's own key deleted (arbitrated escape — it proved nothing).
  const voidStart = schemaSrc.indexOf("const voidPayloadSchema");
  assert.ok(voidStart > -1, "landmark: voidPayloadSchema must still exist");
  const voidSchemaSrc = schemaSrc.slice(voidStart);
  assert.match(voidSchemaSrc, /reward:\s*z\.literal\(true\)\.optional\(\)/, "the VOID line sub-schema must declare reward");

  if (job.payload.kind !== "void") return assert.fail("expected a void payload");
  const withUnknownKey = {
    ...job.payload,
    line: { ...job.payload.line, bogusKey: "nope" },
  };
  const rejected = printJobPayloadSchema.safeParse(withUnknownKey);
  assert.equal(rejected.success, false, "the .strict() fence must still reject an unlisted key on the line sub-object");
});

// ── (f) the two staff surfaces branch on item.reward with a FREE landmark ──

test("SOURCE PIN: OrderDetailSheet.tsx branches on item.reward with a struck-through worth + FREE landmark", () => {
  const src = stripComments(readSrc("components/orders/OrderDetailSheet.tsx"));
  assert.match(src, /orderItemLabel\(item\)/, "landmark: the item list must still render item labels");
  // Bound to the CONSEQUENT arm: the separate needles below passed even with the
  // ternary's arms SWAPPED — i.e. against the very bug they exist to catch.
  assert.match(src, REWARD_ARM, "the struck-through worth + FREE must be the reward arm of the item.reward ternary");
  assert.match(src, /REWARD_ITEM_LINE_NOTE/, "the marker must come from the shared constant, never a hand-written literal");
});

test("SOURCE PIN: VoidItemDialog.tsx branches on item.reward with a struck-through worth + FREE landmark, at the moment staff pick WHICH line to void", () => {
  const src = stripComments(readSrc("components/pos/VoidItemDialog.tsx"));
  assert.match(src, /orderItemLabel\(item\)/, "landmark: the line picker must still render item labels");
  assert.match(src, REWARD_ARM, "the struck-through worth + FREE must be the reward arm of the item.reward ternary");
});

// ── (g) the owner's KOT absence still holds for the VOID variant specifically ──

// re-pinned HERE (not just at reward-rungs.test.ts:770-779) because the void
// slip renders through the exact SAME items.map (KOTReceipt.tsx:199-218) that
// pin guards — S13/S14-remainder touches print-routing.ts/use-pos-print.ts,
// both upstream of that same renderer, so a future edit landing a
// `item.reward` branch there specifically for the void path would slip past
// a pin that only ever exercised the ordinary-KOT render.
test("PIN: KOTReceipt.tsx still does not reference item.reward (re-pinned for the VOID variant — the void slip renders through the SAME items.map), and still renders the ordinary qty × label line", () => {
  const kot = stripComments(readSrc("components/pos/KOTReceipt.tsx"));
  assert.match(kot, /\{item\.qty\} × \{orderItemLabel\(item\)\}/, "landmark: the KOT (incl. its void-variant render, same items.map) must still render the ordinary qty × name line");
  assert.ok(
    !/item\.reward/.test(kot),
    "the KOT must NOT branch on item.reward for ANY variant, including void — the owner's requirement is a normal kitchen ticket; the marker rides the void slip's `instructions` string, never a new KOTReceipt branch",
  );
});


// ── (i) the POS cart is the client twin of the server's subtotal reducer ────

test("SOURCE PIN: the cart subtotal SKIPS a reward line, and hydration carries the flag — the counter must never charge for a comped dish", () => {
  // The money defect this pin exists for: usePosTotals takes `subtotal` as an
  // INPUT, so it cannot compensate. With the flag dropped at hydration, a
  // reopened tab priced the free dish and staff collected cash the server
  // never billed.
  const src = stripComments(readSrc("hooks/use-cart.ts"));
  assert.match(src, /const subtotal = useMemo\(/, "landmark: the cart subtotal must still be a memo");
  assert.match(
    src,
    /cart\.reduce\(\(sum, ci\) => sum \+ \(ci\.reward \? 0 : ci\.price \* ci\.qty\), 0\)/,
    "the cart subtotal must skip a reward line exactly as lib/receipt.ts's reducer does",
  );
  assert.match(src, /reward\?: true;/, "CartItem must declare the flag, or hydration cannot carry it");
  assert.match(
    src,
    /\.\.\.\(it\.reward \? \{ reward: true as const \} : \{\}\),/,
    "cartItemFromOrderItem must carry the flag onto a rehydrated line (omit-empty)",
  );
});

// ── (j) the void TRAIL surface marks a comped dish ─────────────────────────

test("SOURCE PIN: OrderVoidTrail.tsx marks a voided reward line FREE — an unmarked amount reads as a refund that never happened", () => {
  const src = stripComments(readSrc("components/orders/OrderVoidTrail.tsx"));
  assert.match(src, /orderItemLabel\(v\)/, "landmark: the trail must still render voided-line labels");
  assert.match(src, REWARD_ARM, "the struck-through worth + FREE must be the reward arm of the v.reward ternary");
});
