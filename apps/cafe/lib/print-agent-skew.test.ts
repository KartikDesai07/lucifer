import { test } from "node:test";
import assert from "node:assert/strict";

import { ApiError } from "@/lib/api-client";
import { createOlderServerFallback, olderAckBody, olderWakeBody } from "@/lib/print-agent-skew";

// Phase 3 Session 3C (the 3B review gate's I-1): a server from before Phase 3 refuses the fields a Phase 3 page adds to
// its ack and its wake (its schemas are strict: 400 "Validation failed"), and the ack store reads a 400 as answered, so
// after a rollback of the web every slip such a page printed would expire into a REPRINT. The page sends the body once
// more without them; once that works, it sends the older body until it reloads.

const refused = () => new ApiError("Validation failed", "http", 400);

test("3C (I-1): a body the server takes goes once, as it is", async () => {
  const fallback = createOlderServerFallback();
  const sent: unknown[] = [];
  const answer = await fallback.send({ a: 1, tokenSlips: true }, (body) => ({ a: body.a }), async (body) => {
    sent.push(body);
    return "ok";
  });
  assert.equal(answer, "ok");
  assert.deepEqual(sent, [{ a: 1, tokenSlips: true }]);
});

test("3C (I-1): a server from before Phase 3 refuses the new fields: the body goes once more without them, and from then on only the older body", async () => {
  const fallback = createOlderServerFallback();
  const sent: unknown[] = [];
  const send = async (body: Record<string, unknown>) => {
    sent.push(body);
    if ("tokenSlips" in body) throw refused();
    return "ok";
  };
  assert.equal(await fallback.send({ a: 1, tokenSlips: true }, (body) => ({ a: body.a }), send), "ok");
  assert.deepEqual(sent, [{ a: 1, tokenSlips: true }, { a: 1 }], "one refusal, one resend");
  assert.equal(await fallback.send({ a: 2, tokenSlips: true }, (body) => ({ a: body.a }), send), "ok");
  assert.deepEqual(sent.slice(2), [{ a: 2 }], "the next body goes as the older server takes it, in one request");
});

test("3C (I-1): a refusal the older body does not cure is thrown, and the page keeps sending its own body", async () => {
  const fallback = createOlderServerFallback();
  const sent: unknown[] = [];
  const send = async (body: Record<string, unknown>) => {
    sent.push(body);
    throw refused();
  };
  await assert.rejects(fallback.send({ a: 1, tokenSlips: true }, (body) => ({ a: body.a }), send), (error: ApiError) => error.status === 400);
  await assert.rejects(fallback.send({ a: 2, tokenSlips: true }, (body) => ({ a: body.a }), send), (error: ApiError) => error.status === 400);
  assert.deepEqual(sent, [{ a: 1, tokenSlips: true }, { a: 1 }, { a: 2, tokenSlips: true }, { a: 2 }], "never sticks to the older body");
});

test("3C (I-1): any other failure (a 5xx, a 409, no answer) is thrown at once, never sent again here", async () => {
  for (const error of [new ApiError("Failed", "http", 500), new ApiError("Conflict", "http", 409), new ApiError("Could not reach the server.", "network", null), new ApiError("Other", "http", 400)]) {
    const fallback = createOlderServerFallback();
    let calls = 0;
    await assert.rejects(
      fallback.send({ a: 1 }, (body) => body, async () => {
        calls += 1;
        throw error;
      }),
    );
    assert.equal(calls, 1, `${error.status ?? error.kind}: once`);
  }
});

test("3C (I-1): the older ack drops tokenSlips and reason; the older wake drops lanFailover, tokenSlips and printers", () => {
  assert.deepEqual(olderAckBody({ deviceId: "d", epoch: 2, outcome: "failed", sent: "no", reason: "unreachable", error: "x", tokenSlips: true }), { deviceId: "d", epoch: 2, outcome: "failed", sent: "no", error: "x" });
  const caps = { lan: true, bluetooth: true, usb: true, windowsPrinters: false, webSerial: false, webBluetooth: false };
  assert.deepEqual(
    olderWakeBody({ deviceId: "d", label: "L", shell: "android", nativeProtocol: 2, capabilities: { ...caps, lanFailover: true }, tokenSlips: true, printers: [{ printerId: "p", link: "connected" }] }),
    { deviceId: "d", label: "L", shell: "android", nativeProtocol: 2, capabilities: caps },
  );
});
