import { test } from "node:test";
import assert from "node:assert/strict";
import { createModelReady, type ModelLike } from "./db";

// modelReady: connect, then mongoose's own init(); only when init's memo is a rejection, a per-model
// resettable fallback (createCollection then createIndexes). The write still fails CLOSED.

interface Fake {
  model: ModelLike;
  calls: string[];
}

/** A counting fake model. `initFails` makes init() reject on EVERY call (mongoose's memoized rejection). */
function fakeModel(
  name: string,
  calls: string[],
  opts: { initFails?: boolean; collectionError?: Error; indexError?: Error } = {},
): ModelLike {
  return {
    init: async () => {
      calls.push(`${name}.init`);
      if (opts.initFails) throw new Error("memoized init rejection");
    },
    createCollection: async () => {
      calls.push(`${name}.createCollection`);
      if (opts.collectionError) throw opts.collectionError;
    },
    createIndexes: async () => {
      calls.push(`${name}.createIndexes`);
      if (opts.indexError) throw opts.indexError;
    },
  };
}

function setup(opts: { initFails?: boolean; collectionError?: Error; indexError?: Error } = {}): Fake & {
  ready: (model: ModelLike) => Promise<void>;
} {
  const calls: string[] = [];
  const ready = createModelReady(async () => {
    calls.push("connect");
  });
  return { model: fakeModel("m", calls, opts), calls, ready };
}

function dupError(): Error & { code: number } {
  return Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
}

test("modelReady: init() resolves -> resolves, the fallback never runs (connect + init per call, nothing else)", async () => {
  const { model, calls, ready } = setup();
  await ready(model);
  assert.deepEqual(calls, ["connect", "m.init"], "first call: connect then init only");
  await ready(model);
  assert.deepEqual(calls, ["connect", "m.init", "connect", "m.init"], "every call awaits connect and init, nothing else");
});

test("modelReady: init() rejects -> createCollection then createIndexes after connect; later calls do not rerun the fallback", async () => {
  const { model, calls, ready } = setup({ initFails: true });
  await ready(model);
  assert.deepEqual(
    calls,
    ["connect", "m.init", "m.createCollection", "m.createIndexes"],
    "connect, the rejecting init, then the fallback in order",
  );
  calls.length = 0;
  await ready(model);
  assert.deepEqual(calls, ["connect", "m.init"], "a later call awaits init (rejects again) but the memoized fallback does not run");
});

test("modelReady: createIndexes rejects (an 11000) -> the call rejects with that error; the next call runs the fallback again", async () => {
  const err = dupError();
  const { model, calls, ready } = setup({ initFails: true, indexError: err });
  await assert.rejects(ready(model), (e: unknown) => e === err, "fails closed with the index build's own error");
  calls.length = 0;
  await assert.rejects(ready(model), (e: unknown) => e === err, "still failing closed on the retry");
  assert.deepEqual(
    calls,
    ["connect", "m.init", "m.createCollection", "m.createIndexes"],
    "the failed fallback was dropped, so the next call ran it again",
  );
});

test("modelReady: createCollection rejects -> createIndexes is not called; rejects with that error; the next call retries", async () => {
  const err = new Error("createCollection boom");
  const { model, calls, ready } = setup({ initFails: true, collectionError: err });
  await assert.rejects(ready(model), (e: unknown) => e === err, "fails closed with createCollection's error");
  assert.ok(!calls.includes("m.createIndexes"), "createIndexes never ran after a failed createCollection");
  calls.length = 0;
  await assert.rejects(ready(model), (e: unknown) => e === err, "the retry fails the same way");
  assert.deepEqual(calls, ["connect", "m.init", "m.createCollection"], "the next call ran the fallback again");
});

test("modelReady: two concurrent calls whose init rejects run the fallback once", async () => {
  const { model, calls, ready } = setup({ initFails: true });
  await Promise.all([ready(model), ready(model)]);
  assert.equal(calls.filter((c) => c === "m.createCollection").length, 1, "createCollection ran once");
  assert.equal(calls.filter((c) => c === "m.createIndexes").length, 1, "createIndexes ran once");
  assert.equal(calls.filter((c) => c === "m.init").length, 2, "both callers awaited init");
});

test("modelReady: two models have separate fallback memos", async () => {
  const calls: string[] = [];
  const ready = createModelReady(async () => {
    calls.push("connect");
  });
  const a = fakeModel("a", calls, { initFails: true });
  const b = fakeModel("b", calls, { initFails: true });
  await ready(a);
  await ready(b);
  assert.equal(calls.filter((c) => c === "a.createIndexes").length, 1, "model a built its indexes once");
  assert.equal(calls.filter((c) => c === "b.createIndexes").length, 1, "model b was not skipped by a's memo");
});

test("modelReady: connect rejects -> the call rejects, nothing else runs; the next call tries again", async () => {
  const calls: string[] = [];
  const err = new Error("no connection");
  let fail = true;
  const ready = createModelReady(async () => {
    calls.push("connect");
    if (fail) throw err;
  });
  const model = fakeModel("m", calls, { initFails: true });
  await assert.rejects(ready(model), (e: unknown) => e === err, "the connect error reaches the caller");
  assert.deepEqual(calls, ["connect"], "init and the fallback never ran");
  fail = false;
  await ready(model);
  assert.deepEqual(
    calls,
    ["connect", "connect", "m.init", "m.createCollection", "m.createIndexes"],
    "the next call connected again and went on",
  );
});
