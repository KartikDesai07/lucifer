// The page's one offline state (Printing Phase 5, spec 5.1; plan Task 10): a store over nextOfflineState that every
// reader shares (the send path, the pulse, the header, the runner), fed by the browser's own flag (TanStack's
// onlineManager), every pulse result and the send path.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createServerReach, feedBrowserOnline } from "./server-reach";

test("the store follows nextOfflineState and tells its listeners", () => {
  const reach = createServerReach();
  let told = 0;
  const off = reach.subscribe(() => {
    told += 1;
  });
  assert.equal(reach.isOffline(), false, "online at the start");
  reach.report({ type: "pulse", reach: "unreached" });
  assert.equal(reach.isOffline(), false, "one pulse miss is not offline");
  reach.report({ type: "pulse", reach: "unreached" });
  assert.equal(reach.isOffline(), true, "two pulse misses are offline");
  reach.report({ type: "pulse", reach: "reached" });
  assert.equal(reach.isOffline(), false, "a pulse that reached us ends it");
  assert.equal(told, 3, "each change is told once");
  off();
  reach.report({ type: "browser", online: false });
  assert.equal(told, 3, "an unsubscribed listener hears nothing");
  assert.equal(reach.isOffline(), true, "the browser going offline is offline");
});

test("a report that changes nothing tells nobody", () => {
  const reach = createServerReach();
  let told = 0;
  reach.subscribe(() => {
    told += 1;
  });
  reach.report({ type: "pulse", reach: "reached" });
  reach.report({ type: "browser", online: true });
  assert.equal(told, 0, "the online state was already online");
});

test("feedBrowserOnline: a browser already offline is said at once, then every change is forwarded", () => {
  const reach = createServerReach();
  let listener: ((online: boolean) => void) | null = null;
  let unsubscribed = false;
  const manager = {
    isOnline: () => false,
    subscribe: (fn: (online: boolean) => void) => {
      listener = fn;
      return () => {
        unsubscribed = true;
      };
    },
  };
  const stop = feedBrowserOnline(manager, reach);
  assert.equal(reach.isOffline(), true, "the browser was offline when the page started");
  reach.report({ type: "pulse", reach: "reached" });
  assert.equal(reach.isOffline(), false, "an answer ended it");
  assert.ok(listener !== null, "the manager is subscribed");
  (listener as (online: boolean) => void)(false);
  assert.equal(reach.isOffline(), true, "the browser's offline event is forwarded");
  stop();
  assert.equal(unsubscribed, true, "the feed stops with its cleanup");
});

test("reportWriteAnswer: an unanswered write is offline only once its one check fails too; an answered write resets", async () => {
  const { reportWriteAnswer } = await import("./server-reach");
  const { ApiError } = await import("@pos/shared/api-client");
  const reach = createServerReach();
  let checks = 0;
  await reportWriteAnswer(new ApiError("x", "network", null), reach, async () => {
    checks += 1;
    return "unreached";
  });
  assert.equal(checks, 1, "one check, only after a failure");
  assert.equal(reach.isOffline(), true, "the write and its check both missed");
  await reportWriteAnswer(null, reach, async () => {
    checks += 1;
    return "reached";
  });
  assert.equal(reach.isOffline(), false, "an answered write ends it");
  assert.equal(checks, 1, "no check after an answer");
  await reportWriteAnswer(new ApiError("x", "timeout", null), reach, async () => "reached");
  assert.equal(reach.isOffline(), false, "the check reached us: online");
  await reportWriteAnswer(new ApiError("refused", "http", 409, true), reach, async () => {
    checks += 1;
    return "unreached";
  });
  assert.equal(checks, 1, "our own 409 reached us: no check");
  await reportWriteAnswer(new ApiError("x", "network", null), reach, async () => Promise.reject(new Error("boom")));
  assert.equal(reach.isOffline(), true, "a check that throws is a miss");
});

test("fix wave I1: a failed tick is a miss; the null error after a recovery is no miss", async () => {
  const { pulseErrorReach } = await import("./server-reach");
  const { ApiError } = await import("@pos/shared/api-client");
  assert.equal(pulseErrorReach(0, new ApiError("x", "network", null)), null, "no failed tick yet");
  assert.equal(pulseErrorReach(2, null), null, "the next answer cleared the error: nothing to report");
  assert.equal(pulseErrorReach(1, new ApiError("x", "network", null)), "unreached", "a failed tick");
  assert.equal(pulseErrorReach(1, new ApiError("no", "http", 401, true)), "reached", "our own 401 reached us");
});
