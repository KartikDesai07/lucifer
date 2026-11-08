// Post-verifier V1/V2: the two moments that make held marks suspect (a newer build turning pending, the line found
// down), wired over the page's own stores. The real store factories with a spy on the record; the hook's wiring is
// pinned at the end (after stripComments, so a comment never satisfies a pin).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createHeldRoutes, markVisit } from "@/lib/held-routes";
import { beginNavigation, landingProves, type NavDeps } from "@/lib/navigate";
import { createNavProgress } from "@/lib/nav-progress";
import { createServerReach } from "@/lib/server-reach";
import { stripComments } from "@/lib/source-pin-utils";
import { watchSuspectPrefetches } from "@/lib/suspect-prefetch";
import { createUpdatePending } from "@/lib/update-pending";

const CAFE = fileURLToPath(new URL("../", import.meta.url));
const code = (rel: string): string => stripComments(readFileSync(path.join(CAFE, rel), "utf8"));

function world() {
  const held = createHeldRoutes(1000);
  const update = createUpdatePending();
  const reach = createServerReach();
  const w = { proof: null as number | null, since: [] as Array<number | null> };
  const spy = {
    distrustSince: (since: number | null) => {
      w.since.push(since);
      held.distrustSince(since);
    },
  };
  const stop = watchSuspectPrefetches({ held: spy, update, reach, proofAt: () => w.proof });
  return { held, update, reach, w, stop };
}

test("V1: a newer build turning pending distrusts the marks made at or after the last same-build report", () => {
  const { held, update, w, stop } = world();
  held.mark("/pos", 100);
  update.observe("a", "a", 200);
  held.mark("/orders", 300);
  assert.deepEqual(w.since, [], "nothing pending yet: nothing distrusted");
  update.observe("b", "a", 400);
  assert.deepEqual(w.since, [200], "one distrust, since the last same-build report");
  assert.equal(held.holds("/pos", 500), true, "a mark before that report stays held (its entry came from this page's build)");
  assert.equal(held.suspect("/orders", 500), true, "a mark after it is suspect");
  update.observe("c", "a", 450);
  assert.deepEqual(w.since, [200], "still pending (another newer build): no new distrust");
  update.observe("a", "a", 600);
  update.observe("b", "a", 800);
  assert.deepEqual(w.since, [200, 600], "pending again after a rollback: since the rollback's report");
  stop();
  update.observe("a", "a", 900);
  update.observe("b", "a", 950);
  assert.deepEqual(w.since, [200, 600], "stopped: nothing more");
});

test("V1: pending before any same-build report distrusts every mark", () => {
  const { held, update, w } = world();
  held.mark("/pos", 0);
  update.observe("b", "a", 100);
  assert.deepEqual(w.since, [null], "no same-build report seen: since null");
  assert.equal(held.suspect("/pos", 50), true, "every mark is suspect");
});

test("V2: the line found down distrusts the marks made at or after the last proof of reach", () => {
  const { held, reach, w, stop } = world();
  w.proof = 200;
  held.mark("/pos", 100);
  held.mark("/orders", 300);
  reach.report({ type: "pulse", reach: "unreached" });
  assert.deepEqual(w.since, [], "one missed pulse is a blip, not the line found down");
  reach.report({ type: "pulse", reach: "unreached" });
  assert.deepEqual(w.since, [200], "two in a row: offline, since the last proof");
  assert.equal(held.holds("/pos", 400), true, "a mark before the proof stays held");
  assert.equal(held.suspect("/orders", 400), true, "a mark after it is suspect");
  reach.report({ type: "pulse", reach: "unreached" });
  assert.deepEqual(w.since, [200], "still offline: no new distrust");
  reach.report({ type: "pulse", reach: "reached" });
  w.proof = 500;
  reach.report({ type: "browser", online: false });
  assert.deepEqual(w.since, [200, 500], "the browser's own offline is the line found down too, since the newer proof");
  stop();
  reach.report({ type: "pulse", reach: "reached" });
  reach.report({ type: "browser", online: false });
  assert.deepEqual(w.since, [200, 500], "stopped: nothing more");
});

test("a state already on when the watch starts counts as turning on then", () => {
  const update = createUpdatePending();
  const reach = createServerReach();
  update.observe("a", "a", 100);
  update.observe("b", "a", 200);
  reach.report({ type: "browser", online: false });
  const since: Array<number | null> = [];
  const stop = watchSuspectPrefetches({ held: { distrustSince: (s) => void since.push(s) }, update, reach, proofAt: () => 150 });
  assert.deepEqual(since, [100, 150], "pending (since the same-build report) and offline (since the proof), both at once");
  stop();
});

test("end to end: a suspect row is a full load online and the toast offline, even after the update clears", () => {
  const { held, update } = world();
  update.observe("a", "a", 200);
  held.mark("/orders", 300);
  update.observe("b", "a", 400);
  update.observe("a", "a", 450);
  assert.equal(update.isPending(), false, "landmark: a rollback cleared pending");
  const deps = (offline: boolean): Partial<NavDeps> => ({ isOffline: () => offline, holds: held.holds, suspect: held.suspect, updatePending: update.isPending });
  assert.equal(beginNavigation("/orders", undefined, "/pos", 500, createNavProgress(), deps(false)).action, "full-load", "online: our gated load (Next keeps the marker for the window)");
  assert.equal(beginNavigation("/orders", undefined, "/pos", 500, createNavProgress(), deps(true)).action, "refuse", "offline: the toast");
  assert.equal(beginNavigation("/orders", undefined, "/pos", 1300, createNavProgress(), deps(false)).action, "navigate", "the window over: a plain tap again");
});

function callSites(needle: string): string[] {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") && readFileSync(full, "utf8").includes(needle)) hits.push(path.relative(CAFE, full).split(path.sep).join("/"));
    }
  };
  for (const root of ["app", "components", "hooks"]) walk(path.join(CAFE, root));
  return hits.sort();
}

test("PIN: the pulse hook feeds the update store from real answers only, with their time, and starts the one watch", () => {
  const hook = code("hooks/use-pos-pulse.ts");
  assert.match(
    hook,
    /if \(event\.type !== "updated" \|\| event\.action\.type !== "success" \|\| event\.action\.manual === true \|\| event\.query\.queryHash !== pulseHash\) return;/,
    "only the pulse's own fetched answers count: a cache edit keeps the old build and proves no reach",
  );
  assert.match(
    hook,
    /pulseAnsweredAt = event\.query\.state\.dataUpdatedAt;\s*updatePending\.observe\(\(event\.query\.state\.data as PosPulseData \| undefined\)\?\.build, POS_BUILD, pulseAnsweredAt\);/,
    "each answer is the last proof of reach and is observed with its time",
  );
  assert.match(hook, /const offSuspect = watchSuspectPrefetches\(\{ proofAt: \(\) => pulseAnsweredAt \}\);/, "the watch reads that answer's time as the proof");
  assert.match(hook, /return \(\) => \{\s*offAnswers\(\);\s*offSuspect\(\);\s*\};\s*\}, \[qc\]\);/, "both stop with the effect");
  assert.deepEqual(callSites("watchSuspectPrefetches("), ["hooks/use-pos-pulse.ts"], "the wiring lives in one place");
});

// Post-verifier V11: a landed visit is never distrusted, so offline the POS still reopens from memory.
test("V11: a visited row is not distrusted on a line drop nor on pending; a prefetched-only row in the same window is", () => {
  const drop = world();
  drop.w.proof = 200;
  markVisit(drop.held, "/pos", "", 300, true);
  drop.held.mark("/orders", 300);
  drop.reach.report({ type: "pulse", reach: "unreached" });
  drop.reach.report({ type: "pulse", reach: "unreached" });
  assert.deepEqual(drop.w.since, [200], "landmark: the line was found down, since the last proof");
  const offline: Partial<NavDeps> = { isOffline: () => true, holds: drop.held.holds, suspect: drop.held.suspect, updatePending: () => false };
  assert.equal(beginNavigation("/pos", undefined, "/orders", 400, createNavProgress(), offline).action, "navigate", "offline, the visited POS still opens from memory");
  assert.equal(beginNavigation("/orders", undefined, "/pos", 400, createNavProgress(), offline).action, "refuse", "offline, a prefetched-only row in the same window is refused");
  const pend = world();
  pend.update.observe("a", "a", 200);
  markVisit(pend.held, "/pos", "", 300, true);
  pend.held.mark("/orders", 300);
  pend.update.observe("b", "a", 400);
  assert.deepEqual(pend.w.since, [200], "landmark: pending turned on, since the same-build report");
  assert.equal(pend.held.suspect("/pos", 500), false, "pending: the visited row is not distrusted");
  assert.equal(pend.held.suspect("/orders", 500), true, "pending: the prefetched-only row is");
});

// The first call of landingProves in this test process (the module remembers the document's first screen).
test("V11: a landing proves its entry only as the document's first screen or as the end of a soft navigation to it", () => {
  const p = createNavProgress();
  assert.equal(landingProves("/pos", p), true, "the document's first screen: Next seeds its cache with it, from this build");
  assert.equal(landingProves("/pos", p), false, "then a landing with no opening (a Back / Forward step restores from history) proves nothing");
  const online: Partial<NavDeps> = { isOffline: () => false, holds: () => false, suspect: () => false, updatePending: () => false };
  beginNavigation("/orders", undefined, "/pos", 1, p, online);
  assert.equal(landingProves("/orders", p), true, "a soft navigation to it landed: Next resolved it from this build");
  assert.equal(landingProves("/kitchen", p), false, "a landing on another path (a redirect) proves nothing for it");
  const q = createNavProgress();
  beginNavigation("/orders", undefined, "/pos", 1, q, { ...online, updatePending: () => true });
  assert.equal(landingProves("/orders", q), false, "an opening that began as our full load is not a soft landing");
  const r = createNavProgress();
  r.start("/orders", "Orders", 1, "/pos");
  assert.equal(landingProves("/orders", r), false, "an opening this module did not start proves nothing");
});
