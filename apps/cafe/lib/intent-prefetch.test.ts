import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stripComments } from "@/lib/source-pin-utils";
import { HELD_ROUTES_WINDOW_MS } from "./held-routes";
import { INTENT_HOVER_MS, shouldIntentPrefetch } from "./intent-prefetch";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));

const OK = { href: "/pos", online: true, offline: false, lineProven: true, offeredAt: undefined, now: 1_000_000 };

test("a touch prefetches only online, with the server reachable, on a proven line, for a row not yet offered", () => {
  assert.equal(shouldIntentPrefetch(OK), true, "all conditions met");
  assert.equal(shouldIntentPrefetch({ ...OK, online: false }), false, "browser offline blocks");
  assert.equal(shouldIntentPrefetch({ ...OK, offline: true }), false, "server unreachable blocks");
  assert.equal(shouldIntentPrefetch({ ...OK, lineProven: false }), false, "an unproven line blocks");
});

test("a repeat inside the window is blocked; at the boundary and after it is allowed", () => {
  const offeredAt = OK.now;
  assert.equal(shouldIntentPrefetch({ ...OK, offeredAt, now: offeredAt }), false, "same instant");
  assert.equal(shouldIntentPrefetch({ ...OK, offeredAt, now: offeredAt + HELD_ROUTES_WINDOW_MS - 1 }), false, "just inside");
  assert.equal(shouldIntentPrefetch({ ...OK, offeredAt, now: offeredAt + HELD_ROUTES_WINDOW_MS }), true, "exactly at the boundary");
  assert.equal(shouldIntentPrefetch({ ...OK, offeredAt, now: offeredAt + HELD_ROUTES_WINDOW_MS + 1 }), true, "after");
});

test("the hover rest is 120 ms", () => {
  assert.equal(INTENT_HOVER_MS, 120, "a quick pass of the mouse must not prefetch");
});

test("PIN: useIntentPrefetch decides at the event from the pulse's cached state, the reach and the held record, then prefetches and marks", () => {
  const src = read("hooks/use-intent-prefetch.ts");
  assert.match(src, /answeredAtFromCache\(qc\.getQueryState\(POS_PULSE_KEYS\.all\), now\)/, "line proof comes from the pulse's cache state");
  assert.match(src, /offline: serverReach\.isOffline\(\)/, "the server-reach signal gates it");
  assert.match(src, /online: navigator\.onLine !== false/, "the browser's online flag gates it");
  assert.match(src, /offeredAt: heldRoutes\.offeredAt\(href\)/, "a repeat is judged from the held record");
  assert.match(src, /router\.prefetch\(href\);\s*heldRoutes\.mark\(href, now\);/, "an offer prefetches and marks");
  assert.match(src, /window\.setTimeout\([\s\S]*INTENT_HOVER_MS\)/, "hover waits INTENT_HOVER_MS");
  assert.match(src, /useEffect\(\(\) => clear, \[clear\]\)/, "the hover timer is cleared on unmount");
  assert.match(src, /onMouseLeave: clear/, "the hover timer is cleared on mouseleave");
  assert.ok(!/setInterval|useQuery\b|subscribe\(/.test(src), "no poll, query or subscription of its own");
});

test("PIN: AppLink forces prefetch={false} after the caller's props and chains the caller's handlers", () => {
  const src = read("components/layout/AppLink.tsx");
  assert.match(src, /\{\.\.\.rest\}\s*href=\{href\}\s*prefetch=\{false\}/, "rest first, then the forced prefetch={false}");
  assert.equal(src.match(/prefetch=/g)?.length, 1, "prefetch is set once");
  for (const [mine, theirs] of [["onPointerDown", "onPointerDown"], ["onMouseEnter", "onMouseEnter"], ["onMouseLeave", "onMouseLeave"]]) {
    assert.match(src, new RegExp(String.raw`intent\.${mine}\(\);\s*${theirs}\?\.\(e\);`), `${mine}: ours, then the caller's`);
  }
  assert.match(src, /onNavigate\?\.\(\{[\s\S]*?\}\);\s*if \(prevented\) return;\s*const result = beginNavigation\(/, "onNavigate: the caller's first (its preventDefault is recorded and stops the progress), then the shared navigation decision");
});

/** Every `<AppLink …>` opening tag, brace-aware (a `>` inside `{…}` does not end it). */
function appLinkTags(src: string): string[] {
  const tags: string[] = [];
  for (const m of src.matchAll(/<AppLink\b/g)) {
    let depth = 0;
    let end = m.index!;
    for (; end < src.length; end++) {
      const ch = src[end];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    tags.push(src.slice(m.index!, end + 1));
  }
  return tags;
}

test("PIN: every nav row site is an AppLink (sidebar, group sub-rows, tab bar, More sheet), never a plain Link, and never sets prefetch itself", () => {
  // Moved from lib/sidebar-paths.test.ts (P2 B4): these rows used to be next/link Links each saying prefetch={false};
  // AppLink (which absorbed IntentLink in P2 C2) forces it, so a row must not set it and must not fall back to a plain Link.
  const rows = [["AppSidebar", 1], ["SidebarSettingsGroup", 1], ["SidebarReportsGroup", 1], ["SidebarMenuGroup", 2], ["SidebarTablesGroup", 1], ["TabBar", 1], ["ProfileSheet", 2]] as const;
  for (const [file, expected] of rows) {
    const src = read(`components/layout/${file}.tsx`);
    assert.ok(!src.includes("next/link") && !/<Link\b/.test(src), `${file}: no plain Link among the nav rows`);
    assert.match(src, /import \{ AppLink \} from "@\/components\/layout\/AppLink";/, `${file}: imports AppLink`);
    const tags = appLinkTags(src);
    assert.equal(tags.length, expected, `${file}: expected ${expected} <AppLink> tags, found ${tags.length}`);
    for (const tag of tags) {
      assert.ok(tag.includes("href="), `landmark: a whole AppLink tag was read: ${tag}`);
      assert.ok(!/\bprefetch=/.test(tag), `${file}: a row must not set prefetch itself (AppLink forces false): ${tag}`);
    }
  }
  assert.match(read("components/layout/ProfileSheet.tsx"), /onClick=\{onNavigate\}/, "the More sheet still closes on tap");
});
