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
