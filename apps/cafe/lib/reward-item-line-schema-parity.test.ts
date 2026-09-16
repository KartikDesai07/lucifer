import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { Order } from "@/models/Order";
import { stripComments } from "@/lib/source-pin-utils";

// CB-5B — DEFECT 2 regression (found 2026-09-13): lib/reward-item-line.ts's
// RewardItemLine.note ("Reward — free") was silently DROPPED on every write,
// because `note` was declared on the domain shape (RewardItemLine / IOrderItem)
// but NOT on the Mongoose `orderItemSchema` — Mongoose `strict:true` discards
// any key with no declared path. This is the EXACT session-33 bug class: 200
// OK, success toast, `reward:true` beside it stores fine, `note` reads back
// undefined, and every DB-free unit test stays green because nothing in that
// tier ever asks a real mongod what it kept.
//
// A HARDCODED field list would have caught THIS bug once, but not the NEXT
// field someone adds to RewardItemLine and forgets to declare on the
// subschema — so this pin is DERIVED, the same principle as
// loyalty-milestone-schema-parity.test.ts: it reads the field names straight
// off RewardItemLine's own SOURCE (readFileSync — a plain `interface` has no
// runtime representation to introspect, unlike a Zod schema) and requires
// orderItemSchema (models/Order.ts, read via the live Mongoose schema object
// Order.schema exposes) to declare every one of them as a path. Any FUTURE
// field added to RewardItemLine and left off orderItemSchema fails this test
// automatically, with no further edits needed here.
//
// Why source-regex rather than the TypeScript compiler API: this repo's
// existing parity pins (objectid-schema-parity.test.ts et al.) all extract
// facts from raw source via readFileSync + regex, never a parser dependency,
// and testing.md says to prefer raw source over a parsed view. RewardItemLine
// is a flat interface (one field per line, `name?: Type;` or `name: Type;`),
// so a bounded per-line regex over the comment-stripped body is exact for
// this shape and consistent with the rest of the suite.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");

// Extract RewardItemLine's own field names directly from its SOURCE. Comments
// are stripped first (stripComments — the shared, mutation-tested scanner) so
// a field name mentioned only in prose never counts. Bounded to the interface
// body (between its opening `{` and the FIRST top-level `}` that closes it) —
// this interface holds no nested `{}` of its own (checked: every member is a
// scalar/`Types.ObjectId`/`string`/`number`/`boolean` type), so a plain
// non-greedy match to the next `}` at start-of-line is exact for this shape.
function rewardItemLineFieldNames(): string[] {
  const src = stripComments(readSrc("reward-item-line.ts"));
  const bodyMatch = src.match(/export interface RewardItemLine \{([\s\S]*?)\n\}/);
  assert.ok(bodyMatch, "RewardItemLine interface body must be found in lib/reward-item-line.ts");
  const body = bodyMatch![1]!;

  // One field per non-blank line: `name` or `name?`, then `:`, then any type
  // text, then a trailing `;`. `\w+` deliberately excludes computed/quoted
  // keys — RewardItemLine has never used either, and a future switch to one
  // should fail this extractor loudly (the assert below) rather than silently
  // skip the field.
  const fieldLineRe = /^\s*(\w+)\??:\s*.+;\s*$/gm;
  const names: string[] = [];
  for (const m of body.matchAll(fieldLineRe)) {
    names.push(m[1]!);
  }
  return names;
}

function orderItemSchemaPaths(): Set<string> {
  const itemsPath = Order.schema.path("items") as unknown as {
    schema?: { paths: Record<string, unknown> };
    caster?: { schema?: { paths: Record<string, unknown> } };
  };
  const sub = itemsPath.schema ?? itemsPath.caster?.schema;
  assert.ok(sub, "Order.schema's `items` path must be an array of a declared subschema");
  return new Set(Object.keys(sub!.paths));
}

test("PARITY: every RewardItemLine field is declared as a path on orderItemSchema (models/Order.ts)", () => {
  const rewardFields = rewardItemLineFieldNames();
  const orderPaths = orderItemSchemaPaths();

  // Positive landmark first — a negative-only pin passes vacuously if the
  // extractor above silently found nothing (e.g. the interface was renamed).
  assert.ok(
    rewardFields.length >= 5,
    `expected RewardItemLine's real field list, got [${rewardFields.join(", ")}]`,
  );
  assert.ok(
    rewardFields.includes("productId") && rewardFields.includes("note"),
    "sanity: the extracted shape must be RewardItemLine (productId/note expected)",
  );

  const missing = rewardFields.filter((f) => !orderPaths.has(f));
  assert.deepEqual(
    missing,
    [],
    `Mongoose strict:true will SILENTLY DROP these RewardItemLine fields on write: ${missing.join(", ")}. ` +
      "Declare them on orderItemSchema in apps/cafe/models/Order.ts (the ITEM schema, not orderVoidSchema).",
  );
});

test("PARITY: `note` specifically is storable on orderItemSchema (the DEFECT 2 canary, named explicitly)", () => {
  // Named on top of the derived pin above so a regression here reads as the
  // actual feature that broke, not just a generic key-diff.
  const orderPaths = orderItemSchemaPaths();
  assert.ok(orderPaths.has("note"), "orderItemSchema must declare a `note` path — DEFECT 2 regressed");
});

test("PARITY: `note` is declared on orderItemSchema, NOT on orderVoidSchema (the misplacement this defect's fix corrected)", () => {
  // The owner's fix note states `note` was initially misplaced onto
  // orderVoidSchema and then corrected — pin the CORRECT location directly
  // against source, since orderVoidSchema is a SEPARATE Schema object with no
  // shared runtime handle to introspect the way orderItemSchema does via
  // Order.schema.path("items").
  const src = stripComments(readSrc("../models/Order.ts"));

  const itemSchemaMatch = src.match(/const orderItemSchema = new Schema<IOrderItem>\(\s*\{([\s\S]*?)\n {2}\},/);
  assert.ok(itemSchemaMatch, "orderItemSchema literal must be found in models/Order.ts");
  assert.match(itemSchemaMatch![1]!, /note:\s*\{\s*type:\s*String\s*\}/, "orderItemSchema must declare note: {type: String}");

  const voidSchemaMatch = src.match(/const orderVoidSchema = new Schema<IOrderVoid>\(\s*\{([\s\S]*?)\n {2}\},/);
  assert.ok(voidSchemaMatch, "orderVoidSchema literal must be found in models/Order.ts");
  assert.ok(
    !/note:/.test(voidSchemaMatch![1]!),
    "orderVoidSchema must NOT declare `note` — the void trail has its own `reason`/`instructions` fields, and a stray " +
      "`note` here would be exactly the initial misplacement the fix corrected",
  );

  // Positive landmark: orderVoidSchema really does have its own fields (so the
  // absence assert above isn't passing because the regex matched nothing).
  assert.match(voidSchemaMatch![1]!, /reason:\s*\{\s*type:\s*String,\s*required:\s*true\s*\}/, "landmark: orderVoidSchema must still declare reason");
});
