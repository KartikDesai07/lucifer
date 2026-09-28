import { test } from "node:test";
import assert from "node:assert/strict";

import { ApiError, apiGet, apiSend } from "./api-client";

// The REAL helpers over a fake fetch: a retrying writer (apps/cafe
// lib/pending-writes.ts) decides "refused" vs "maybe landed" from ApiError's
// kind + status, while every existing caller keeps toasting the same message.

async function withFetch<T>(fake: typeof fetch, run: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("a server error envelope throws ApiError(kind http, the status, the server's own message)", async () => {
  await withFetch(async () => json(409, { success: false, error: "Order already settled" }), async () => {
    const e = await apiSend("/api/x", "POST", {}).catch((err: unknown) => err);
    assert.ok(e instanceof ApiError && e instanceof Error);
    assert.equal(e.message, "Order already settled");
    assert.equal(e.kind, "http");
    assert.equal(e.status, 409);
  });
});

test("a body that is not the envelope keeps the old 'Request failed' message, with the status", async () => {
  await withFetch(async () => new Response("<html>gateway</html>", { status: 502 }), async () => {
    const e = (await apiGet("/api/x").catch((err: unknown) => err)) as ApiError;
    assert.equal(e.message, "Request failed");
    assert.deepEqual([e.kind, e.status], ["http", 502]);
  });
});

test("a fetch that never answered is a network ApiError; the timeout abort is a timeout one — messages unchanged", async () => {
  await withFetch(async () => {
    throw new TypeError("Failed to fetch");
  }, async () => {
    const e = (await apiSend("/api/x", "POST").catch((err: unknown) => err)) as ApiError;
    assert.deepEqual([e.kind, e.status, e.message], ["network", null, "Failed to fetch"]);
  });
  await withFetch(async () => {
    throw new DOMException("signal timed out", "TimeoutError");
  }, async () => {
    const e = (await apiGet("/api/x").catch((err: unknown) => err)) as ApiError;
    assert.deepEqual([e.kind, e.status, e.message], ["timeout", null, "signal timed out"]);
  });
});

test("success still unwraps data", async () => {
  await withFetch(async () => json(200, { success: true, data: { ok: 1 } }), async () => {
    assert.deepEqual(await apiGet("/api/x"), { ok: 1 });
  });
});
