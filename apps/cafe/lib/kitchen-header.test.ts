// U4 Task 2 (2026-10-30): the Kitchen header's rules — the type filter, the second line, the time words, the refresh
// strip's rule (owner Q2 / Q3; design 6.1, 6.2, 6.4, 6.5, 11 in docs/superpowers/specs/2026-10-30-kitchen-match-html-design.md;
// values 2.3, 9.3 in docs/superpowers/specs/2026-10-29-kitchen-html-values.md) — then source pins on the page that wires
// them (Review Focus 2 and 5). The filter's and the strip's looks and the board's states: lib/kitchen-filter-states.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";
import { KITCHEN_STALE_MS } from "./kitchen-board";
import {
  KITCHEN_EMPTY_FILTER_TEXT,
  KITCHEN_FILTERS,
  averageWaitMinutes,
  filterCards,
  kitchenAgeWords,
  kitchenFilterOf,
  kitchenHeaderLine,
  kitchenStale,
} from "./kitchen-header";
import { KITCHEN_NOW as NOW, kitchenCard as card } from "./kitchen-header.fixtures";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const code = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const count = (s: string, needle: string): number => s.split(needle).length - 1;

const PAGE = "app/(dashboard)/kitchen/page.tsx";

// ── The type filter (owner Q2; design 6.1) ──────────────────────────────────────────────────────────────────────────

test("KITCHEN_FILTERS: All · Tables · Walk-In (U1's Open orders words), in that order", () => {
  assert.deepEqual(
    KITCHEN_FILTERS.map((f) => [f.key, f.label]),
    [["all", "All"], ["tables", "Tables"], ["walkin", "Walk-In"]],
    "owner Q2: the three tabs, keys and words",
  );
});

test("kitchenFilterOf: a table card is Tables; the server's no-table label 'Walk-In' is Walk-In, a parcel with no table too", () => {
  assert.equal(kitchenFilterOf(card("T-4", 3)), "tables", "a table card");
  assert.equal(kitchenFilterOf(card("Walk-In", 3)), "walkin", "no table (lib/kitchen-board.ts: tableNo ?? 'Walk-In')");
  assert.equal(kitchenFilterOf(card("Walk-In", 3, { parcel: true })), "walkin", "owner Q2: a parcel with no table counts under Walk-In");
  assert.equal(kitchenFilterOf(card("Walk-In", 3, { tokenNumber: 12 })), "walkin", "a token order with no table is Walk-In");
  assert.equal(kitchenFilterOf(card("Garden 2", 3, { parcel: true })), "tables", "a parcel at a table is a table card (its code is the table's name)");
});

test("filterCards: All keeps the board as it is; Tables / Walk-In keep their cards in board order; a poll's new card joins", () => {
  const t3 = card("T-3", 30);
  const walk = card("Walk-In", 20, { parcel: true });
  const t6 = card("T-6", 10);
  const board = [t3, walk, t6];
  assert.equal(filterCards(board, "all"), board, "All: the same array (nothing filtered, nothing copied)");
  assert.deepEqual(filterCards(board, "tables"), [t3, t6], "Tables: the table cards, oldest first as given");
  assert.deepEqual(filterCards(board, "walkin"), [walk], "Walk-In: the walk-in / parcel card");
  assert.deepEqual(filterCards([t3, t6], "walkin"), [], "Walk-In with only table cards: none (the filtered-empty box)");
  // Review Focus 2: a poll adds a matching card -> it shows (the filter runs over every answer, nothing is kept).
  const arrived = card("Walk-In", 1);
  assert.deepEqual(filterCards([t3, t6, arrived], "walkin"), [arrived], "a walk-in card arriving with the next poll shows under Walk-In");
});

test("KITCHEN_EMPTY_FILTER_TEXT: 'No orders here' (design 6.5 / 11: the HTML's 'No tickets here' in our unit)", () => {
  assert.equal(KITCHEN_EMPTY_FILTER_TEXT, "No orders here", "the filtered-empty box's words");
});

// ── Time words and the average (design 6.4, 6.2; values 9.3) ──────────────────────────────────────────────────────

test("kitchenAgeWords: Now under a minute, '{m} min' under an hour, '{h}h {m}m' from an hour (design 6.4)", () => {
  const cases: Array<[number, string]> = [
    [0, "Now"], [0.4, "Now"], [-3, "Now"], [1, "1 min"], [1.9, "1 min"], [59, "59 min"], [59.9, "59 min"],
    [60, "1h 0m"], [75, "1h 15m"], [600, "10h 0m"],
  ];
  for (const [minutes, words] of cases) assert.equal(kitchenAgeWords(minutes), words, `${minutes} minutes -> "${words}"`);
});

test("averageWaitMinutes: the mean of the cards' exact ages, then rounded (values 9.3); null for no card", () => {
  assert.equal(averageWaitMinutes([card("T-1", 4), card("T-2", 2), card("T-3", 24)], NOW), 10, "ages 4, 2, 24 -> 10");
  assert.equal(averageWaitMinutes([card("T-1", 1.9), card("T-2", 1.9)], NOW), 2, "exact ms (1.9, 1.9 -> 2), not floored minutes (1, 1 -> 1)");
  const seed = [4, 2, 24, 14, 9, 22, 7].map((age, i) => card(`T-${i + 1}`, age));
  assert.equal(averageWaitMinutes(seed, NOW), 12, "the HTML's seed: 11.71 -> 12 (values 0.1)");
  assert.equal(averageWaitMinutes([], NOW), null, "no card: no average");
  // A device clock behind the server: a card fired "in the future" counts as 0, as its pill shows (Now), never negative.
  assert.equal(averageWaitMinutes([card("T-1", -3), card("T-2", 3)], NOW), 2, "a negative age counts as 0: (0 + 3) / 2 = 1.5 -> 2");
});

// ── The second line (owner Q3; design 6.2, 11) ─────────────────────────────────────────────────────────────────────

test("kitchenHeaderLine: '{n} active order(s) · average wait {m} · Updated …'; no average with no card", () => {
  assert.equal(
    kitchenHeaderLine({ cards: [card("T-7", 4)], updatedAtMs: NOW, nowMs: NOW }),
    "1 active order · average wait 4 min · Updated just now",
    "one card: singular (the HTML's '1 active tickets' is not copied, values 10 #2)",
  );
  assert.equal(kitchenHeaderLine({ cards: [], updatedAtMs: NOW, nowMs: NOW }), "0 active orders · Updated just now", "none: the average is left out");
  assert.equal(
    kitchenHeaderLine({ cards: [card("T-1", 4), card("T-2", 2), card("T-3", 24)], updatedAtMs: NOW - 70_000, nowMs: NOW }),
    "3 active orders · average wait 10 min · Updated 1 min ago",
    "3 cards, the last good answer 70s old",
  );
  assert.equal(kitchenHeaderLine({ cards: [card("T-1", 75)], updatedAtMs: NOW, nowMs: NOW }), "1 active order · average wait 1h 15m · Updated just now", "the hour form");
  // Ruling K3: an average under a minute reads "0 min" (the HTML's own words for an average of 0, values 2.3), never the
  // pill's "Now" ("average wait Now" does not read as a duration); the pill keeps "Now" (kitchenAgeWords above).
  assert.equal(kitchenHeaderLine({ cards: [card("T-1", 0.2)], updatedAtMs: NOW, nowMs: NOW }), "1 active order · average wait 0 min · Updated just now", "under a minute: 0 min (ruling K3)");
  assert.equal(kitchenHeaderLine({ cards: [card("T-1", 0.2), card("T-2", 0.6)], updatedAtMs: NOW, nowMs: NOW }), "2 active orders · average wait 0 min · Updated just now", "a mean of 0.4 min rounds to 0: 0 min");
  assert.equal(kitchenHeaderLine({ cards: [card("T-1", 0.4), card("T-2", 0.8)], updatedAtMs: NOW, nowMs: NOW }), "2 active orders · average wait 1 min · Updated just now", "a mean of 0.6 min rounds to 1: 1 min");
  assert.equal(kitchenHeaderLine({ cards: [card("T-1", -3)], updatedAtMs: NOW, nowMs: NOW }), "1 active order · average wait 0 min · Updated just now", "a clock behind the server: 0 min, never negative");
  assert.equal(kitchenHeaderLine({ cards: [card("T-1", 4)], updatedAtMs: NOW - 3_700_000, nowMs: NOW }), "1 active order · average wait 4 min · Updated over an hour ago", "U3's words");
});

test("Review Focus 2: the line counts and averages what is shown (the filter), not the whole board", () => {
  const board = [card("T-3", 30), card("Walk-In", 20, { parcel: true }), card("T-6", 10)];
  const line = (filter: "all" | "tables" | "walkin") => kitchenHeaderLine({ cards: filterCards(board, filter), updatedAtMs: NOW, nowMs: NOW });
  assert.equal(line("all"), "3 active orders · average wait 20 min · Updated just now", "All: every card");
  assert.equal(line("tables"), "2 active orders · average wait 20 min · Updated just now", "Tables: 30 and 10");
  assert.equal(line("walkin"), "1 active order · average wait 20 min · Updated just now", "Walk-In: the parcel");
  assert.equal(
    kitchenHeaderLine({ cards: filterCards([card("T-3", 30)], "walkin"), updatedAtMs: NOW, nowMs: NOW }),
    "0 active orders · Updated just now",
    "a filter that matches nothing: 0, no average (the HTML counts the whole board, values 10 #6: not copied)",
  );
});

// ── The strip's rule (Review Focus 5; design 6.2: today's Stale rule) ──────────────────────────────────────────────

test("kitchenStale: the last good answer at least KITCHEN_STALE_MS (60s) old; never before a first answer", () => {
  assert.equal(KITCHEN_STALE_MS, 60_000, "landmark: today's 60s");
  assert.equal(kitchenStale(0, NOW), false, "never loaded (dataUpdatedAt 0): no strip (the first-load error keeps its error screen)");
  assert.equal(kitchenStale(NOW - 59_999, NOW), false, "59.999s: fresh");
  assert.equal(kitchenStale(NOW - 60_000, NOW), true, "60s: stale");
  assert.equal(kitchenStale(NOW - 600_000, NOW), true, "10 min: stale");
  assert.equal(kitchenStale(NOW + 5_000, NOW), false, "an answer newer than the page's 30s clock: fresh");
});

// ── The page (design 6.1, 6.2; Review Focus 2 and 5) ─────────────────────────────────────────────────────────────────

test("the page: the strip is kitchen-page's first child, above the board; it shows on kitchenStale and Try again refetches", () => {
  const src = code(PAGE);
  const strip =
    '<RefreshStrip\n        ui="kitchen"\n        show={kitchenStale(board.dataUpdatedAt, nowMs)}\n        message="Couldn\'t refresh the kitchen board. Showing the last update."\n        onRetry={() => void board.refetch()}\n      />';
  assert.equal(count(src, "<RefreshStrip"), 1, "one strip");
  const open = '<div data-ui="kitchen-page" className={KITCHEN_PAGE_CLASS}>';
  const page = src.indexOf(open);
  const at = src.indexOf(strip);
  const board = src.indexOf('<div data-ui="kitchen-board" className={KITCHEN_BOARD_CLASS}>');
  assert.ok(page >= 0 && at > page && board > at, "kitchen-page, then the strip, then the board (it never scrolls away)");
  assert.ok(/^\s*$/.test(src.slice(page + open.length, at)), "the strip is the page's first child");
  assert.ok(/^\s*$/.test(src.slice(at + strip.length, board)), "the board follows it directly (flush)");
});

test("the page: the second line is kitchenHeaderLine over the shown cards; 'Loading orders…' before the first answer; none on error / offline (P48)", () => {
  const src = code(PAGE);
  assert.ok(
    src.includes(
      'description={board.data !== undefined ? kitchenHeaderLine({ cards, updatedAtMs: board.dataUpdatedAt, nowMs }) : board.isLoading ? "Loading orders…" : undefined}',
    ),
    "design 6.2: the line once loaded, today's loading words while loading, nothing on the error / offline branches",
  );
  assert.ok(src.includes("const nowMs = now.getTime();"), "the page's 30s clock drives the freshness, the average and the strip");
  for (const gone of ["KitchenFreshnessChip", "tabCount", "itemCount", "open tabs", "Every fired order, oldest first"]) {
    assert.ok(!src.includes(gone), `design 11: "${gone}" leaves the page`);
  }
});

test("the page: the filter is page state reset per visit; below 720px the board shows All; the body knows when the filter hides cards", () => {
  const src = code(PAGE);
  assert.ok(src.includes('const [filter, setFilter] = useState<KitchenFilter>("all");'), "state in the page: every visit starts at All (design 6.1)");
  assert.ok(src.includes('const wide = useMediaQuery("(min-width: 720px)");'), "the control's own breakpoint (max-tab:hidden = below 720px)");
  assert.ok(src.includes("const allCards = board.data?.cards ?? [];"), "the whole board");
  assert.ok(src.includes('const cards = filterCards(allCards, wide ? filter : "all");'), "Review Focus 2: below 720px (or before the width is known) All, whatever was chosen at 820");
  assert.ok(src.includes("cards={cards}") && src.includes("filtered={cards.length < allCards.length}"), "the body draws the shown cards and knows the filter hid some");
  assert.ok(
    src.includes('actions={<><KitchenTypeFilter value={filter} onChange={setFilter} /><NowServingLink variant="button" /></>}'),
    "design 6.1: the header's actions, the filter then Now Serving",
  );
  for (const imp of [
    'import { useMediaQuery } from "@/hooks/use-media-query";',
    'import { filterCards, kitchenHeaderLine, kitchenStale, type KitchenFilter } from "@/lib/kitchen-header";',
    'import { RefreshStrip } from "@/components/shared/RefreshStrip";',
    'import { KitchenTypeFilter } from "@/components/kitchen/KitchenTypeFilter";',
  ]) {
    assert.ok(src.includes(imp), `the page imports: ${imp}`);
  }
});
