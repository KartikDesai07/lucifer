import { test } from "node:test";
import assert from "node:assert/strict";
import { Schema } from "mongoose";
import { loyaltyRulesSchema } from "@pos/shared/schemas/settings-loyalty.schema";
import { loyaltyRulesMongooseSchema } from "@/models/settings.subschemas";

// CB-5B D8 — THE BUG THIS FILE EXISTS FOR (found in review, 2026-09-13):
// a milestone field can be declared on the Zod schema, registered in the
// settings form, accepted by the PUT with a 200 — and then silently DROPPED,
// because Mongoose `strict` defaults to true and the field was never added to
// the milestone SUBSCHEMA. `itemProductId` and `qty` were both lost this way.
//
// Nothing else catches it: tsc is happy (the Zod type is the source of truth
// for the route), every unit suite stays green, and the UI shows a success
// toast. Only a live write reveals the loss.
//
// So this pin is DERIVED, not a hand-written list: it reads the key set off
// the Zod schema and requires the Mongoose subschema to declare every one of
// them. A future field added to the ladder is covered automatically.

function zodMilestoneKeys(): string[] {
  // Verified structure (probed, not assumed):
  //   loyaltyRulesSchema.shape.milestones = ZodEffects   (the duplicate-`at` refine)
  //     ._def.schema                      = ZodArray
  //       ._def.type                      = ZodEffects   (the per-row superRefine)
  //         ._def.schema                  = ZodObject    <- the shape we want
  interface ZodLike {
    shape?: Record<string, unknown>;
    _def?: { schema?: ZodLike; type?: ZodLike; innerType?: ZodLike };
  }
  const rules = loyaltyRulesSchema as unknown as { shape: Record<string, ZodLike> };
  let node: ZodLike | undefined = rules.shape.milestones;

  // Walk down through effects/array wrappers until an object shape appears.
  // Bounded so a future wrapper change fails the assert below rather than
  // looping — and so this pin can never pass by silently finding nothing.
  for (let depth = 0; depth < 8 && node && !node.shape; depth += 1) {
    node = node._def?.schema ?? node._def?.type ?? node._def?.innerType;
  }
  assert.ok(node?.shape, "could not reach the milestone object shape — update this unwrapper");
  return Object.keys(node.shape);
}

function mongooseMilestonePaths(): string[] {
  const milestones = loyaltyRulesMongooseSchema.path("milestones") as unknown as {
    schema?: Schema;
    caster?: { schema?: Schema };
  };
  const sub = milestones.schema ?? milestones.caster?.schema;
  assert.ok(sub, "milestones must be an array of a declared subschema");
  return Object.keys(sub.paths);
}

test("PARITY: every Zod milestone field is declared on the Mongoose subschema", () => {
  const zodKeys = zodMilestoneKeys();
  const mongoosePaths = new Set(mongooseMilestonePaths());

  // Positive landmark first (a negative-only pin passes vacuously if the
  // unwrapper silently returns []).
  assert.ok(zodKeys.length >= 5, `expected the milestone shape, got ${zodKeys.join(",")}`);
  assert.ok(zodKeys.includes("at") && zodKeys.includes("kind"), "sanity: the shape is the milestone");

  const missing = zodKeys.filter((key) => !mongoosePaths.has(key));
  assert.deepEqual(
    missing,
    [],
    `Mongoose strict:true will SILENTLY DROP these on save: ${missing.join(", ")}. ` +
      "Declare them in apps/cafe/models/settings.subschemas.ts.",
  );
});

test("PARITY: the D8/D11 fields specifically are storable", () => {
  // Named explicitly as well as covered by the derived pin above, so a
  // regression names the actual feature rather than a generic key diff.
  const paths = new Set(mongooseMilestonePaths());
  assert.ok(paths.has("itemProductId"), "the free dish's product REFERENCE must be storable");
  assert.ok(paths.has("qty"), "the dish COUNT must be storable");
});

test("PARITY: neither new field is `required`, so pre-D8 rows still save", () => {
  // Mongoose String `required` rejects "" outright and PUT /api/settings runs
  // with runValidators:true — the documented trap this repo has hit before.
  const milestones = loyaltyRulesMongooseSchema.path("milestones") as unknown as {
    schema?: Schema;
    caster?: { schema?: Schema };
  };
  const sub = (milestones.schema ?? milestones.caster?.schema) as Schema;
  for (const path of ["itemProductId", "qty"]) {
    const option = (sub.path(path) as unknown as { isRequired?: boolean }).isRequired;
    assert.ok(!option, `${path} must not be required — every pre-D8 row lacks it`);
  }
});
