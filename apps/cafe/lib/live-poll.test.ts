// Perf P1 Task 3 (F6, F7; the owner's D3, 2026-11-02) — the safety-net polls step back to 120 s while the realtime
// room is PROVEN up (lib/live-poll.ts), and the next tables fetch after a nudge reads past the route's 5 s per-instance
// cache (lib/tables-fresh-read.ts). Runtime checks of the two small modules, then source pins over every poll site.
// The health re-read per tick (livePoll over a real socket) is in realtime-down.test.ts, which has the fake WebSocket.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { stripComments } from "@/lib/source-pin-utils";
import { REFETCH_INTERVALS } from "@/lib/query";
import { REALTIME_RELAXED_POLL_MS, livePoll, livePollMs } from "@/lib/live-poll";
import { markTablesFreshRead, takeTablesFreshRead } from "@/lib/tables-fresh-read";

const src = (rel: string): string => stripComments(readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8"));

test("D3: with the room proven up every safety-net poll steps back to 120 s; otherwise it is exactly today's", () => {
  assert.equal(REALTIME_RELAXED_POLL_MS, 120_000, "D3: the owner's 120 s");
  for (const ms of [REFETCH_INTERVALS.LIVE_LISTS, REFETCH_INTERVALS.TABLES, REFETCH_INTERVALS.SUMMARY, REFETCH_INTERVALS.KITCHEN]) {
    assert.equal(livePollMs(ms, false), ms, `room down / flag off: today's ${ms} ms`);
    assert.equal(livePollMs(ms, true), 120_000, `room up: ${ms} ms → 120 s`);
  }
  assert.equal(livePollMs(300_000, true), 300_000, "a poll already slower than 120 s is never sped up");
  assert.equal(REFETCH_INTERVALS.POS_PULSE, 20_000, "the pulse is not a safety-net poll and never changes");
});

test("D3: livePoll fails closed — with no realtime URL configured it answers today's interval on every call", () => {
  assert.equal(process.env.NEXT_PUBLIC_REALTIME_URL, undefined, "precondition: this test runs with realtime off");
  const poll = livePoll(REFETCH_INTERVALS.LIVE_LISTS);
  assert.equal(typeof poll, "function", "a refetchInterval function, re-read on every tick (never a cached number)");
  assert.equal(poll(), REFETCH_INTERVALS.LIVE_LISTS, "realtime off: today's 30 s");
  assert.equal(poll(), REFETCH_INTERVALS.LIVE_LISTS, "and again on the next tick");
});

test("D3: tables-fresh-read is one-shot", () => {
  assert.equal(takeTablesFreshRead(), false, "nothing marked yet");
  markTablesFreshRead();
  markTablesFreshRead();
  assert.equal(takeTablesFreshRead(), true, "the next tables fetch after a nudge reads past the 5 s instance cache");
  assert.equal(takeTablesFreshRead(), false, "only that one");
});

// ── Source pins: every safety-net poll goes through livePoll( — the pulse never does ─────────────────────────────────

const POLL_SITES: ReadonlyArray<{ file: string; needle: RegExp; why: string }> = [
  { file: "hooks/use-tables.ts", needle: /refetchInterval: isMutating \? false : livePoll\(REFETCH_INTERVALS\.TABLES\),/, why: "the floor (30 s → 120 s), still paused by an order write" },
  { file: "hooks/use-orders.ts", needle: /refetchInterval: date \? false : livePoll\(REFETCH_INTERVALS\.SUMMARY\),/, why: "the day summary; a past day still never polls" },
  { file: "hooks/use-orders.ts", needle: /const poll = options\.refetchInterval \? livePoll\(options\.refetchInterval\) : undefined;\s*return useQuery\(\{/, why: "useOrders wraps its caller's number; callers stay unchanged" },
  { file: "hooks/use-orders.ts", needle: /refetchInterval: isMutating \? false : poll,/, why: "useOrders keeps its pause while an order write is in flight" },
  { file: "hooks/use-orders.ts", needle: /refetchInterval: isMutating \? false : \(query\) => \(onePageAtMost\(query\.state\.data\) \? livePoll\(REFETCH_INTERVALS\.LIVE_LISTS\)\(\) : false\),/, why: "the Orders list: one page only, paused by an order write" },
  { file: "hooks/use-dashboard.ts", needle: /refetchInterval: live \? livePoll\(REFETCH_INTERVALS\.SUMMARY\) : false,/, why: "the dashboard range; a past range still never polls" },
  { file: "hooks/use-dashboard.ts", needle: /refetchInterval: livePoll\(REFETCH_INTERVALS\.LIVE_LISTS\),/, why: "the dashboard's live strip" },
  { file: "hooks/use-kitchen.ts", needle: /refetchInterval: isMutating \? false : livePoll\(REFETCH_INTERVALS\.KITCHEN\),/, why: "the Kitchen board (10 s → 120 s), paused by an order write" },
  { file: "hooks/use-tokens.ts", needle: /refetchInterval: enabled \? livePoll\(REFETCH_INTERVALS\.KITCHEN\) : false,/, why: "the token board follows the Kitchen rule" },
];

test("PIN (D3, F6): every safety-net poll passes its interval through livePoll( and keeps its isMutating / enabled gate", () => {
  for (const site of POLL_SITES) {
    assert.match(src(site.file), site.needle, `${site.file}: ${site.why}`);
    assert.match(src(site.file), /import \{ livePoll \} from "@\/lib\/live-poll";/, `${site.file} imports livePoll`);
  }
  assert.equal((src("hooks/use-orders.ts").match(/livePoll\(/g) ?? []).length, 3, "use-orders.ts: exactly three poll sites");
  assert.equal((src("hooks/use-dashboard.ts").match(/livePoll\(/g) ?? []).length, 2, "use-dashboard.ts: exactly two poll sites");
});

test("PIN (D3): the pulse is not a safety-net poll — use-pos-pulse.ts never goes through livePoll", () => {
  const pulse = src("hooks/use-pos-pulse.ts");
  assert.match(pulse, /refetchInterval: REFETCH_INTERVALS\.POS_PULSE,/, "positive landmark: the pulse's own 20 s poll");
  assert.ok(!pulse.includes("livePoll"), "the pulse feeds printing and alerts: 20 s always, background too");
});

test("PIN (F7): the tables query reads /api/tables?fresh=1 when a nudge round asked for it, else the plain route", () => {
  const tables = src("hooks/use-tables.ts");
  assert.match(tables, /import \{ takeTablesFreshRead \} from "@\/lib\/tables-fresh-read";/, "use-tables.ts imports the one-shot flag");
  assert.match(
    tables,
    /queryFn: \(\) => apiGet<Table\[\]>\(takeTablesFreshRead\(\) \? `\/api\/tables\?\$\{TABLES_FRESH_PARAM\}=1` : "\/api\/tables"\),/,
    "the next tables fetch after a nudge reads past the per-instance cache; every other fetch stays the plain read",
  );
});
