import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TTL_ALLOWED_COLLECTIONS,
  isTtlAllowedCollection,
  assertTtlIndexesAllowed,
  type DeclaredIndex,
} from "./ttl-guard";
import { HEARTBEAT_TTL_INDEX, HEARTBEATS_COLLECTION } from "./heartbeat";

// Build-rule #23 / F2c §7 guarantee 4 — default-DENY: a TTL index may exist
// ONLY on the explicit ephemeral allowlist; every financial collection throws
// at registration, so a future log collection can't silently violate the GST
// §36 72-month retention rule.

const ttl = (key: Record<string, unknown>, expireAfterSeconds: unknown): DeclaredIndex => ({
  key,
  options: { expireAfterSeconds },
});

test("allowlist is heartbeats-only today (P6 adds authLog when it lands)", () => {
  assert.deepEqual([...TTL_ALLOWED_COLLECTIONS], [HEARTBEATS_COLLECTION]);
  assert.equal(isTtlAllowedCollection("heartbeats"), true);
  assert.equal(isTtlAllowedCollection("Order"), false);
  assert.equal(isTtlAllowedCollection("dailyRollup"), false);
});

test("a TTL on a financial collection throws the #23 retention error", () => {
  for (const collection of ["Order", "dailyRollup", "productDayCounter", "actionAudit", "Customer"]) {
    assert.throws(
      () => assertTtlIndexesAllowed(collection, [ttl({ settledAt: 1 }, 86_400)]),
      /FORBIDDEN.*#23/s,
      `${collection} must reject TTL`,
    );
  }
});

test("non-TTL indexes pass on ANY collection (the guard only polices expiry)", () => {
  assert.doesNotThrow(() =>
    assertTtlIndexesAllowed("Order", [
      { key: { tableNo: 1 }, options: { partialFilterExpression: { status: "Pending" } } },
      { key: { customerId: 1 } },
      { key: { source: 1, externalRef: 1 }, options: { unique: true } },
    ]),
  );
  assert.doesNotThrow(() => assertTtlIndexesAllowed("Order", []));
});

test("the shared heartbeat TTL index spec passes its own guard", () => {
  assert.doesNotThrow(() =>
    assertTtlIndexesAllowed(HEARTBEATS_COLLECTION, [
      { key: HEARTBEAT_TTL_INDEX.key, options: { expireAfterSeconds: HEARTBEAT_TTL_INDEX.expireAfterSeconds } },
    ]),
  );
});

test("an allowed collection still rejects a MALFORMED TTL (compound, _id, bad seconds)", () => {
  // Compound TTL: MongoDB rejects it at creation (CannotCreateIndex) — the
  // guard surfaces that at registration, not at live index build.
  assert.throws(
    () => assertTtlIndexesAllowed(HEARTBEATS_COLLECTION, [ttl({ ts: 1, name: 1 }, 60)]),
    /single-field/,
  );
  assert.throws(
    () => assertTtlIndexesAllowed(HEARTBEATS_COLLECTION, [ttl({ _id: 1 }, 60)]),
    /single-field non-_id/,
  );
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, "60", null]) {
    assert.throws(
      () => assertTtlIndexesAllowed(HEARTBEATS_COLLECTION, [ttl({ ts: 1 }, bad)]),
      /invalid expireAfterSeconds/,
      `expireAfterSeconds=${String(bad)} must throw`,
    );
  }
});

test("only the TTL-bearing index trips the guard in a mixed set", () => {
  assert.throws(() =>
    assertTtlIndexesAllowed("Order", [
      { key: { customerId: 1 } }, // fine
      ttl({ settledAt: 1 }, 3600), // forbidden
    ]),
  );
});
