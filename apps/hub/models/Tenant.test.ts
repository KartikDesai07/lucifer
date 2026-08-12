import { test } from "node:test";
import assert from "node:assert/strict";
import type mongoose from "mongoose";

import { Tenant, tenantSchema, tenantRoyaltySchema } from "./Tenant";

// DB-free schema guards (the F2 per-step precedent — the live round-trip against a
// seeded M0 is a separate integration leg). Proves the F3.1 registry shape:
// required identity, enums, defaults, the P8-G omit-empty block, the Int32 royalty
// rate, and the phase-F3 §3.4 index set (incl. the domain.primary partial-unique
// correctness refinement).

// SchemaType.defaultValue exists at runtime but isn't on the public TS type.
function defaultOf(schema: mongoose.Schema, path: string): unknown {
  return (schema.path(path) as unknown as { defaultValue?: unknown }).defaultValue;
}

test("Tenant: identity fields (slug/ownerEmail/businessType) are required", () => {
  const err = new Tenant({}).validateSync();
  assert.ok(err, "expected a ValidationError");
  assert.ok(err.errors.slug, "slug required");
  assert.ok(err.errors.ownerEmail, "ownerEmail required");
  assert.ok(err.errors.businessType, "businessType required");
});

test("Tenant: status defaults to 'provisioning', plan to 'free'", () => {
  const t = new Tenant({ slug: "acme", ownerEmail: "a@b.co", businessType: "cafe" });
  assert.equal(t.status, "provisioning");
  assert.equal(t.plan, "free");
  assert.equal(t.validateSync(), undefined, "a minimal tenant validates");
});

test("Tenant: businessType + status enums reject unknown values", () => {
  const bad = new Tenant({ slug: "acme", ownerEmail: "a@b.co", businessType: "diner" }).validateSync();
  assert.ok(bad?.errors.businessType, "unknown businessType rejected");
  const bad2 = new Tenant({ slug: "acme", ownerEmail: "a@b.co", businessType: "cafe", status: "zombie" }).validateSync();
  assert.ok(bad2?.errors.status, "unknown status rejected");
});

test("Tenant: slug + ownerEmail are normalized (lowercase/trim)", () => {
  const t = new Tenant({ slug: "  My-Cafe ", ownerEmail: "OWNER@X.CO", businessType: "cafe" });
  assert.equal(t.slug, "my-cafe");
  assert.equal(t.ownerEmail, "owner@x.co");
});

test("Tenant: pool arrays default to [] (registry is tiny — not byte-critical)", () => {
  // In-memory default. The stored BSON is ALSO `[]` (not omitted) — confirmed by
  // the live raw-BSON probe: Mongoose auto-inits array paths to [] and `minimize`
  // strips empty objects, not empty arrays. So no explicit `default: []` is needed.
  const t = new Tenant({ slug: "acme", ownerEmail: "a@b.co", businessType: "cafe" });
  assert.deepEqual(t.hosting, []);
  assert.deepEqual(t.dbPool, []);
  assert.deepEqual(t.imagePool, []);
});

test("Tenant: a dbPool cluster defaults provider='atlas' + capacityBytes=512MB", () => {
  const t = new Tenant({
    slug: "acme",
    ownerEmail: "a@b.co",
    businessType: "cafe",
    dbPool: [{ accountLabel: "acct1", clusterName: "c1", role: "primary" }],
  });
  assert.equal(t.dbPool[0].provider, "atlas");
  assert.equal(t.dbPool[0].capacityBytes, 536870912);
});

test("Tenant: the P8-G grouping block is omit-empty (no defaults)", () => {
  for (const p of ["chainClientId", "ownershipType", "gstinDisplay", "chv", "royalty", "consolidation.optIn"]) {
    assert.equal(defaultOf(tenantSchema, p), undefined, `${p} must have no default (omit-empty #8/#80)`);
  }
});

test("Tenant: royalty.rateBp + minPaise are BSON Int32 (a rate/paise, #40/#61)", () => {
  assert.equal(tenantRoyaltySchema.path("rateBp").instance, "Int32");
  assert.equal(tenantRoyaltySchema.path("minPaise").instance, "Int32");
});

test("Tenant: royalty.rateBp rejects a non-integer (Int32 CastError), accepts an integer", () => {
  const err = new Tenant({
    slug: "acme",
    ownerEmail: "a@b.co",
    businessType: "cafe",
    royalty: { rateBp: 6.5, basis: "gross" },
  }).validateSync();
  assert.equal(err?.errors["royalty.rateBp"]?.name, "CastError", "6.5 bp is not a valid Int32");
  const ok = new Tenant({
    slug: "acme",
    ownerEmail: "a@b.co",
    businessType: "cafe",
    royalty: { rateBp: 600, basis: "gross" },
  }).validateSync();
  assert.equal(ok, undefined, "600 bp (6.00%) validates");
});

test("Tenant: slug carries a unique index (field-level)", () => {
  assert.equal(tenantSchema.path("slug").options.unique, true);
});

test("Tenant: the §3.4 + P8-G index set is present", () => {
  const indexes = tenantSchema.indexes(); // [keySpec, options][]

  const status = indexes.find(([k]) => "status" in k && Object.keys(k).length === 1);
  assert.ok(status, "status index");

  // domain.primary is a PARTIAL unique index (the correctness refinement over the
  // plan's plain unique — many domain-less provisioning tenants must coexist).
  const domain = indexes.find(([k]) => "domain.primary" in k);
  assert.ok(domain, "domain.primary index present");
  assert.equal(domain?.[1]?.unique, true, "domain.primary is unique");
  assert.deepEqual(
    domain?.[1]?.partialFilterExpression,
    { "domain.primary": { $exists: true } },
    "domain.primary unique index MUST be partial (not plain unique)",
  );

  // P8-G consolidation fan-out compound.
  const consolidation = indexes.find(
    ([k]) => k["chainClientId"] === 1 && k["consolidation.optIn"] === 1,
  );
  assert.ok(consolidation, "P8-G {chainClientId, consolidation.optIn} index");
});
