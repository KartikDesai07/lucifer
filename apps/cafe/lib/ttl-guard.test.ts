import { test } from "node:test";
import assert from "node:assert/strict";
import { Schema } from "mongoose";

import { assertSchemaTtlAllowed, collectionNameFor } from "./ttl-guard";

// F2.10 — the mongoose adapter over the shared TTL allowlist (#23). The rule
// itself is tested in packages/shared/src/ttl-guard.test.ts; here we prove the
// SCHEMA-level lowering: collection-name resolution and mongoose's field-level
// `expires:` shorthand both reach the guard.

test("collectionNameFor: pinned `collection` option wins; else mongoose pluralization", () => {
  const pinned = new Schema({}, { collection: "dailyRollup" });
  assert.equal(collectionNameFor("DailyRollup", pinned), "dailyRollup");
  const unpinned = new Schema({});
  assert.equal(collectionNameFor("Order", unpinned), "orders");
});

test("an explicit schema.index TTL on a financial collection throws at registration", () => {
  const s = new Schema({ settledAt: Date });
  s.index({ settledAt: 1 }, { expireAfterSeconds: 3600 });
  assert.throws(() => assertSchemaTtlAllowed("Order", s), /FORBIDDEN[\s\S]*#23/);
});

test("the field-level `expires:` SHORTHAND is caught too (mongoose lowers it into a TTL index)", () => {
  const s = new Schema({ at: { type: Date, expires: 60 } });
  assert.throws(() => assertSchemaTtlAllowed("ErrorLog", s), /FORBIDDEN[\s\S]*#23/);
});

test("a valid single-field TTL on the allowlisted heartbeats collection passes", () => {
  const s = new Schema({ ts: Date }, { collection: "heartbeats" });
  s.index({ ts: 1 }, { expireAfterSeconds: 7 * 86_400 });
  assert.doesNotThrow(() => assertSchemaTtlAllowed("Heartbeat", s));
});

test("TTL-free schemas of any name pass untouched", () => {
  const s = new Schema({ name: String });
  s.index({ name: 1 }, { unique: true });
  assert.doesNotThrow(() => assertSchemaTtlAllowed("Customer", s));
});
