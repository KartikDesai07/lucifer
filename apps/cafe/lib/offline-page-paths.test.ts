// Source pins for the page half of offline KOTs (Printing Phase 5, Session 5B). The rules are runtime-tested in the
// pure modules' own tests (server-reach, offline-outbox-store, offline-send, offline-replay, ...); these pin the
// WIRING a refactor could silently undo: who feeds the offline state, that the store re-reads another tab's write,
// and that the outbox lock and the storage event are the only ways the record moves.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

const REACH_HOOK = "apps/cafe/hooks/use-server-reach.ts";
const OUTBOX_HOOK = "apps/cafe/hooks/use-offline-outbox.ts";
const OUTBOX_STORE = "apps/cafe/lib/offline-outbox-store.ts";
const PULSE = "apps/cafe/hooks/use-pos-pulse.ts";

test("Task 10: the offline state is fed by the browser's own flag through TanStack's onlineManager", () => {
  const hook = src(REACH_HOOK);
  assert.match(hook, /import \{ onlineManager \} from "@tanstack\/react-query";/, "TanStack's onlineManager");
  assert.ok(hook.includes("useEffect(() => feedBrowserOnline(onlineManager), []);"), "subscribed once per mount, cleaned up");
  assert.ok(hook.includes("useSyncExternalStore(serverReach.subscribe, serverReach.isOffline, () => false)"), "one shared state, online on the server pass");
});

test("Task 10: every pulse result feeds the offline state, once per tick (not per retry)", () => {
  const pulse = src(PULSE);
  assert.ok(pulse.includes('if (dataUpdatedAt > 0) serverReach.report({ type: "pulse", reach: "reached" });'), "an answer reached us");
  assert.ok(pulse.includes('if (errorUpdateCount > 0) serverReach.report({ type: "pulse", reach: reachOf(error) });'), "a failed tick, by reachOf");
});

test("Task 10: every read-modify-write of the outbox runs under its Web Lock; the hook re-reads another tab's write", () => {
  const store = src(OUTBOX_STORE);
  assert.ok(store.includes("locks.request(OUTBOX_LOCK, () => work())"), "the Web Lock pos-offline-outbox");
  assert.equal((store.match(/writeOutbox\(/g) ?? []).length, 1, "one write site, inside update");
  const hook = src(OUTBOX_HOOK);
  assert.ok(hook.includes('window.addEventListener("storage", onStorage);'), "the storage event");
  assert.ok(hook.includes("if (event.key === OUTBOX_KEY || event.key === null) void offlineOutbox.refresh();"), "only the outbox key (or a clear)");
  assert.ok(hook.includes("if (snapshot.unreadable && offlineOutbox.claimUnreadableReport()) toast.warning(OUTBOX_UNREADABLE_MESSAGE);"), "the unreadable record is said once");
});
