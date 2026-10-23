// U2 Task 5 (2026-10-23; fix round 1): hooks/use-media-query.ts keeps ONE MediaQueryList and ONE change listener per
// query for every reader, so a width change re-renders every reader of a query in one React pass, parent first. The
// Orders page's choice and its detail's frame read the same query; with a list per reader the browser reported each on
// its own (a microtask between them), the detail re-rendered alone first and opened its bottom sheet on an auto-picked
// row the page was about to drop (found by the live check; ruling P9; Review Focus 2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";
import { mediaQueryMatches, subscribeMediaQuery } from "@/hooks/use-media-query";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));

/** A stubbed window.matchMedia: every list it makes, its listeners, and a way to flip it. */
function stubMatchMedia() {
  const made: { query: string; matches: boolean; listeners: (() => void)[] }[] = [];
  (globalThis as { window?: unknown }).window = {
    matchMedia: (query: string) => {
      const list = { query, matches: false, listeners: [] as (() => void)[], addEventListener: (_type: string, l: () => void) => list.listeners.push(l) };
      made.push(list);
      return list;
    },
  };
  const flip = (query: string, matches: boolean) => {
    for (const list of made.filter((m) => m.query === query)) {
      list.matches = matches;
      for (const l of list.listeners) l();
    }
  };
  return { made, flip };
}

test("subscribeMediaQuery / mediaQueryMatches: one list per query, every reader told in the same call, a reader removed on unsubscribe", () => {
  const { made, flip } = stubMatchMedia();
  try {
    const Q = "(min-width: 1280px) and (test-shared)";
    const told: string[] = [];
    const offPage = subscribeMediaQuery(Q, () => told.push(`page:${mediaQueryMatches(Q)}`));
    const offDetail = subscribeMediaQuery(Q, () => told.push(`detail:${mediaQueryMatches(Q)}`));
    assert.equal(made.filter((m) => m.query === Q).length, 1, "the page and its detail share ONE list");
    assert.equal(made.find((m) => m.query === Q)?.listeners.length, 1, "with one change listener");
    assert.equal(mediaQueryMatches(Q), false, "the snapshot reads the shared list");
    flip(Q, true);
    assert.deepEqual(told, ["page:true", "detail:true"], "one change tells every reader in the same call (React batches them into one pass)");
    offDetail();
    flip(Q, false);
    assert.deepEqual(told, ["page:true", "detail:true", "page:false"], "an unsubscribed reader is not told again");
    offPage();
    flip(Q, true);
    assert.equal(told.length, 3, "nobody left to tell");
    subscribeMediaQuery("(max-width: 1px) and (test-other)", () => undefined);
    assert.equal(made.length, 2, "another query gets its own list");
    assert.equal(made.find((m) => m.query === Q)?.listeners.length, 1, "and a query's list keeps its one listener");
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

test("useMediaQuery reads the shared list: every reader of a query subscribes to it and reads its snapshot (null on the server)", () => {
  const hook = read("hooks/use-media-query.ts");
  assert.equal(hook.split("window.matchMedia(").length - 1, 1, "the list is made once per query (in sharedList)");
  assert.match(hook, /list\.addEventListener\("change", \(\) => \{\s*for \(const tell of \[\.\.\.readers\]\) tell\(\);\s*\}\);/, "one listener tells every reader in the same call");
  assert.match(
    hook,
    /useSyncExternalStore\(\s*\(onChange\) => subscribeMediaQuery\(query, onChange\),\s*\(\) => mediaQueryMatches\(query\),\s*\(\) => null,\s*\)/,
    "the hook is the shared list's store",
  );
});
