import { test } from "node:test";
import assert from "node:assert/strict";

import { ApiError, NETWORK_ERROR_MESSAGE, TIMEOUT_ERROR_MESSAGE, apiGet, apiSend } from "./api-client";

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

test("a fetch that never answered is a network ApiError; the timeout abort is a timeout one — in plain English", async () => {
  // Review 2026-09-28: every write now fails at once while offline (mutations
  // networkMode "always"), and callers toast err.message — the browser's own
  // "Failed to fetch" / "signal timed out" must never reach the operator. The
  // copy never claims whether anything was saved (a write may have landed).
  await withFetch(async () => {
    throw new TypeError("Failed to fetch");
  }, async () => {
    const e = (await apiSend("/api/x", "POST").catch((err: unknown) => err)) as ApiError;
    assert.deepEqual([e.kind, e.status, e.message], ["network", null, NETWORK_ERROR_MESSAGE]);
  });
  await withFetch(async () => {
    throw new DOMException("signal timed out", "TimeoutError");
  }, async () => {
    const e = (await apiGet("/api/x").catch((err: unknown) => err)) as ApiError;
    assert.deepEqual([e.kind, e.status, e.message], ["timeout", null, TIMEOUT_ERROR_MESSAGE]);
  });
  assert.equal(NETWORK_ERROR_MESSAGE, "Could not reach the server. Check the internet connection.");
  assert.equal(TIMEOUT_ERROR_MESSAGE, "The server took too long to answer. Check the internet connection.");
});

test("success still unwraps data", async () => {
  await withFetch(async () => json(200, { success: true, data: { ok: 1 } }), async () => {
    assert.deepEqual(await apiGet("/api/x"), { ok: 1 });
  });
});

test("an error answer says whether it was our envelope", async () => {
  // The offline state (apps/cafe lib/offline-state.ts) counts an answer as reaching US only when it is our
  // envelope; a host's error page (Vercel's 402, a gateway 502) is not.
  await withFetch(async () => json(402, { success: false, error: "Paused" }), async () => {
    const e = (await apiGet("/api/x").catch((err: unknown) => err)) as ApiError;
    assert.equal(e.enveloped, true, "our JSON envelope is enveloped");
  });
  await withFetch(async () => new Response("<html>paused</html>", { status: 402 }), async () => {
    const e = (await apiGet("/api/x").catch((err: unknown) => err)) as ApiError;
    assert.equal(e.enveloped, false, "a host page is not enveloped");
  });
  await withFetch(async () => json(502, { message: "bad gateway" }), async () => {
    const e = (await apiSend("/api/x", "POST").catch((err: unknown) => err)) as ApiError;
    assert.equal(e.enveloped, false, "JSON that is not our envelope is not enveloped");
  });
  await withFetch(async () => {
    throw new TypeError("Failed to fetch");
  }, async () => {
    const e = (await apiGet("/api/x").catch((err: unknown) => err)) as ApiError;
    assert.equal(e.enveloped, false, "no answer is not enveloped");
  });
  assert.equal(new ApiError("x", "http", 400).enveloped, false, "the constructor default is false");
});
