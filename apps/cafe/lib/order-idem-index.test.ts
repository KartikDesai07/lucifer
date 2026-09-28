import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Order } from "@/models/Order";
import { orderSchema as ledgerOrderSchema } from "@/models/order.ledger";
import { stripComments } from "./source-pin-utils";
import { createIdemKeyIndex, findCreateReplay, idemKeyIndexSpec, memoizeUntilFailure } from "./order-idem";

// Split from order-idem.test.ts (file-size cap): the create replay's idemKey
// index is ensured on its own — a targeted, memoized createIndex whose memo
// resets on failure — and a failed ensure never fails the create.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEY = "2f1c7d0a-8b4e-4c3a-9d6f-1e2a3b4c5d6e";
const OTHER = "7a9b8c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const STORED = { _id: "665f0000000000000000ab01", status: "Completed", billNumber: 42 };

type IndexSpec = [Record<string, unknown>, Record<string, unknown>];
function indexOn(schema: { indexes(): IndexSpec[] }, field: string): IndexSpec | undefined {
  return schema.indexes().find(([fields]) => Object.keys(fields).length === 1 && field in fields);
}

test("memoizeUntilFailure: a success is memoized (one run, one shared promise)", async () => {
  let runs = 0;
  const ensure = memoizeUntilFailure(async () => {
    runs += 1;
  });
  const a = ensure();
  const b = ensure();
  assert.equal(a, b, "concurrent callers share the one in-flight promise");
  await Promise.all([a, b, ensure()]);
  await ensure();
  assert.equal(runs, 1);
});

test("memoizeUntilFailure: a failure RESETS the memo, so the next call runs again", async () => {
  let runs = 0;
  const ensure = memoizeUntilFailure(async () => {
    runs += 1;
    if (runs === 1) throw new Error("index conflict");
  });
  const [first, twin] = await Promise.allSettled([ensure(), ensure()]);
  assert.equal(first.status, "rejected");
  assert.equal(twin.status, "rejected", "a caller that joined the failing run sees the same failure");
  assert.equal(runs, 1, "the joined caller did not start a second run");
  await ensure();
  assert.equal(runs, 2, "the call after the failure retried");
  await ensure();
  assert.equal(runs, 2, "and the retry's success is memoized");
});

test("memoizeUntilFailure: a synchronous throw is a rejection (never a throw at the call site) and also resets", async () => {
  let runs = 0;
  const ensure = memoizeUntilFailure((): Promise<void> => {
    runs += 1;
    if (runs === 1) throw new Error("sync");
    return Promise.resolve();
  });
  const first = ensure();
  await assert.rejects(first, /sync/);
  await ensure();
  assert.equal(runs, 2);
});

test("idemKeyIndexSpec: the declared schema index, deep-equal to the ledger's (no literal restated)", () => {
  assert.deepEqual(idemKeyIndexSpec(), indexOn(Order.schema, "idemKey"));
  assert.deepEqual(idemKeyIndexSpec(ledgerOrderSchema), indexOn(ledgerOrderSchema, "idemKey"));
  assert.equal(idemKeyIndexSpec({ indexes: () => [[{ orderId: 1 }, {}]] }), undefined, "no idemKey index → nothing to ensure");
});

test("createIdemKeyIndex: creates ONLY the idemKey index, with exactly the declared spec", async () => {
  const calls: unknown[][] = [];
  await createIdemKeyIndex({
    createIndex: async (...args: unknown[]) => {
      calls.push(args);
      return "idemKey_unique_partial";
    },
  });
  assert.deepEqual(calls, [idemKeyIndexSpec()]);
  await assert.rejects(
    createIdemKeyIndex({ createIndex: async () => "unused" }, { indexes: () => [] }),
    /idemKey index/,
    "an undeclared index fails loud (and the memo resets), never a silent success",
  );
});

test("findCreateReplay: the ensure runs first; a FAILED ensure still looks the key up (the create never 500s on it)", async () => {
  const events: string[] = [];
  const stored = STORED;
  const found = await findCreateReplay(KEY, {
    ensureIndex: async () => {
      events.push("ensure");
      throw new Error("IndexKeySpecsConflict");
    },
    findByKey: async (key) => {
      events.push(`find:${key}`);
      return stored;
    },
  });
  assert.equal(found, stored);
  assert.deepEqual(events, ["ensure", `find:${KEY}`]);
  const none = await findCreateReplay(OTHER, { ensureIndex: async () => undefined, findByKey: async () => null });
  assert.equal(none, null, "a new key → null");
});

test("PIN: lib/order-idem.ts no longer awaits the whole-model init() (it memoizes a rejection forever)", () => {
  const src = stripComments(readFileSync(path.join(HERE, "order-idem.ts"), "utf8"));
  assert.ok(src.includes("memoizeUntilFailure(() => createIdemKeyIndex(Order.collection))"), "landmark: the targeted, resettable ensure");
  assert.ok(!/\.init\(\)/.test(src), "no Model.init() anywhere in the replay path");
  assert.ok(!/createIndexes\(/.test(src), "no whole-model createIndexes() either — only the one index");
});
