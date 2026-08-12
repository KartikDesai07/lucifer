import { test } from "node:test";
import assert from "node:assert/strict";

import { Chain, chainSchema, chainRoyaltySchema, CHAIN_SCHEMA_VERSION } from "./Chain";

// DB-free schema guards for the P8-G grouping collection (build-rule #80).

test("Chain: name + ownerEmail are required; productId defaults to 'cafe-pos'", () => {
  const err = new Chain({}).validateSync();
  assert.ok(err?.errors.name, "name required");
  assert.ok(err?.errors.ownerEmail, "ownerEmail required");
  assert.ok(!err?.errors.productId, "productId has a default, so not required-erroring");

  const c = new Chain({ name: "Acme Franchise", ownerEmail: "FR@X.CO" });
  assert.equal(c.productId, "cafe-pos");
  assert.equal(c.ownerEmail, "fr@x.co", "ownerEmail lowercased");
  assert.equal(c.validateSync(), undefined, "a minimal chain validates");
});

test("Chain: v defaults to CHAIN_SCHEMA_VERSION and is Int32", () => {
  const c = new Chain({ name: "Acme", ownerEmail: "a@b.co" });
  assert.equal(c.v, CHAIN_SCHEMA_VERSION);
  assert.equal(chainSchema.path("v").instance, "Int32");
});

test("Chain: defaultRoyalty.rateBp + minPaise are BSON Int32", () => {
  assert.equal(chainRoyaltySchema.path("rateBp").instance, "Int32");
  assert.equal(chainRoyaltySchema.path("minPaise").instance, "Int32");
});

test("Chain: defaultRoyalty.basis enum rejects unknown values", () => {
  const bad = new Chain({
    name: "Acme",
    ownerEmail: "a@b.co",
    defaultRoyalty: { rateBp: 600, basis: "netOfNothing" },
  }).validateSync();
  assert.ok(bad?.errors["defaultRoyalty.basis"], "unknown basis rejected");
});

test("Chain: the product-view pivot index {productId:1} is present", () => {
  const hit = chainSchema.indexes().find(([k]) => k.productId === 1);
  assert.ok(hit, "{productId:1} index");
});
