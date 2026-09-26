import { test } from "node:test";
import assert from "node:assert/strict";

import { KotTick } from "../models/KotTick";
import { assertSchemaTtlAllowed } from "./ttl-guard";

// P4-B — DB-free schema/index shape tests for KotTick (the kitchen board's
// tick state). models/KotTick.ts does not export its schema separately (same
// situation as models/Order.ts — see lib/order-request-model.test.ts's own
// comment on this), so these read it off the compiled model's `.schema`.
const kotTickSchema = KotTick.schema;

test("KotTick: readyAt path is a Date, optional (not required), with NO default", () => {
  const path = kotTickSchema.path("readyAt");
  assert.ok(path, "readyAt path must exist");
  assert.equal(path.instance, "Date", "readyAt must be declared as a Date path");
  const options = (path as unknown as { options: Record<string, unknown> }).options;
  assert.notEqual(options.required, true, "readyAt must not be required");
  assert.equal(options.default, undefined, "readyAt must carry NO default — absent means not-cleared");
});

test("KotTick: a minimal doc (no readyAt) validates cleanly and leaves readyAt undefined (omit-empty)", () => {
  const doc = new KotTick({ _id: "a".repeat(24) });
  const err = doc.validateSync();
  assert.equal(err, undefined, "a minimal doc must validate cleanly");
  assert.equal(doc.readyAt, undefined, "readyAt must be absent, not defaulted to any value");
});

test("KotTick: schema.indexes() contains ZERO TTL specs — this is operational state, not a TTL'd registry", () => {
  const indexes = kotTickSchema.indexes();

  // Positive landmark first (vision guard): prove indexes() actually returns
  // something meaningful before trusting an empty/absent expireAfterSeconds
  // sweep over it. refs is a plain array with no explicit index declared, so
  // the landmark here is the schema itself being inspectable and consistent
  // with its declared paths — assert the two real paths exist and refs/
  // readyAt are exactly what the model declares, so a blinded/stripped
  // indexes() call can't make the negative loop below pass vacuously.
  assert.ok(kotTickSchema.path("refs"), "positive landmark: the refs path must exist on the inspected schema");
  assert.ok(kotTickSchema.path("readyAt"), "positive landmark: the readyAt path must exist on the inspected schema");

  for (const [key, options] of indexes) {
    assert.equal(
      (options as Record<string, unknown>).expireAfterSeconds,
      undefined,
      `index ${JSON.stringify(key)} must not carry expireAfterSeconds — KotTick is operational state, never a TTL'd registry`,
    );
  }

  // This model is not walked by the registry's module-load TTL sweep (it is
  // not a federated CORE/LEDGER schema), so pin the guard directly too —
  // mirrors lib/order-request-model.test.ts's own direct pin.
  assert.doesNotThrow(() => assertSchemaTtlAllowed("KotTick", kotTickSchema));
});

test("KotTick: {timestamps:true} is set on the schema", () => {
  assert.equal(kotTickSchema.get("timestamps"), true);
});

test("KotTick: _id is a required String (the order's own hex id, not an ObjectId)", () => {
  const path = kotTickSchema.path("_id");
  assert.ok(path, "_id path must exist");
  assert.equal(path.instance, "String", "_id must be declared as a String path — the order's hex id, reused directly");
});

test("KotTick: refs defaults to an empty array on a minimal doc", () => {
  const doc = new KotTick({ _id: "b".repeat(24) });
  assert.deepEqual(doc.refs, [], "refs must default to []");
});
