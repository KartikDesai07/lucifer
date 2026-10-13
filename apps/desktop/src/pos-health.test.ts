// Native apps 2.0 (spec §9): the address window checks a typed address once before saving it. A fake fetch stands in for
// Electron's net.fetch: what the POS answers decides found, not found or not reached, always in one request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPos, HEALTH_PATH, HEALTH_TIMEOUT_MS, type HealthFetch, type HealthInit } from "./pos-health";

type Call = { url: string; init: HealthInit };

function answering(status: number, body: () => Promise<unknown>): { fetch: HealthFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: HealthFetch = async (url, init) => {
    calls.push({ url, init });
    return { status, json: body };
  };
  return { fetch, calls };
}

const json = (value: unknown) => () => Promise.resolve(value);
const NOT_FOUND = "We couldn't find a POS at mycafe.sandbee.in. Check the name.";
// The N3 review gate (the review's m-2, the owner's ruling of 2026-10-13): a mistyped workspace name has no answer
// either, so the words name both causes.
const UNREACHABLE = "Couldn't reach mycafe.sandbee.in. Check the name and the internet connection.";

test("a POS whose database is up (200, its tenant named) is found, in one GET of /api/health that follows no redirect", async () => {
  const { fetch, calls } = answering(200, json({ ok: true, db: "up", tenant: "dev", ts: 1 }));
  assert.deepEqual(await checkPos("https://mycafe.sandbee.in", fetch), { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://mycafe.sandbee.in" + HEALTH_PATH);
  assert.equal(HEALTH_PATH, "/api/health");
  assert.equal(calls[0]!.init.method, "GET");
  assert.equal(calls[0]!.init.redirect, "manual");
  assert.equal(HEALTH_TIMEOUT_MS, 5_000);
});

test("a POS whose database is down (503, its tenant named) is found: the address is right, the POS page shows its own error", async () => {
  const { fetch, calls } = answering(503, json({ ok: false, db: "down", tenant: "mycafe", ts: 1 }));
  assert.deepEqual(await checkPos("https://mycafe.sandbee.in", fetch), { ok: true });
  assert.equal(calls.length, 1);
});

test("no POS at the address (404) is not found, and the message names the host", async () => {
  const { fetch, calls } = answering(404, json({ error: "not found" }));
  assert.deepEqual(await checkPos("https://mycafe.sandbee.in", fetch), { ok: false, error: NOT_FOUND });
  assert.equal(calls.length, 1);
  const local = answering(404, json({}));
  assert.deepEqual(await checkPos("http://127.0.0.1:8766", local.fetch), {
    ok: false,
    error: "We couldn't find a POS at 127.0.0.1:8766. Check the name.",
  });
});

test("another site's page (200 HTML) is not found", async () => {
  const { fetch, calls } = answering(200, () => Promise.reject(new SyntaxError("Unexpected token <")));
  assert.deepEqual(await checkPos("https://mycafe.sandbee.in", fetch), { ok: false, error: NOT_FOUND });
  assert.equal(calls.length, 1);
});

test("other JSON (200 without a tenant, or a redirect) is not found", async () => {
  for (const [status, body] of [
    [200, { ok: true }],
    [200, { tenant: 7, ok: true }],
    [200, null],
    [302, { tenant: "dev", ok: true }],
  ] as const) {
    const { fetch, calls } = answering(status, json(body));
    assert.deepEqual(await checkPos("https://mycafe.sandbee.in", fetch), { ok: false, error: NOT_FOUND }, JSON.stringify(body));
    assert.equal(calls.length, 1);
  }
});

test("no answer at all (a network error) is not reached", async () => {
  let calls = 0;
  const fetch: HealthFetch = async () => {
    calls += 1;
    throw new TypeError("fetch failed");
  };
  assert.deepEqual(await checkPos("https://mycafe.sandbee.in", fetch), { ok: false, error: UNREACHABLE });
  assert.equal(calls, 1);
});

test("no answer in time is not reached, and the request is aborted", async () => {
  let calls = 0;
  let aborted = false;
  const fetch: HealthFetch = (_url, init) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });
  };
  const started = Date.now();
  assert.deepEqual(await checkPos("https://mycafe.sandbee.in", fetch, 30), { ok: false, error: UNREACHABLE });
  assert.ok(Date.now() - started < 2_000, "the timeout ended the wait");
  assert.equal(aborted, true);
  assert.equal(calls, 1);
});
