import "@/lib/hook-harness"; // installs the react / sonner stubs: MUST stay the first import
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";

import { mountHook, stubModule, type MountedHook } from "@/lib/hook-harness";
import type { KitchenOrderCard as Card } from "@/lib/kitchen-cards";
import { kitchenCard } from "@/lib/kitchen-header.fixtures";
import { KITCHEN_RISE_NONE, kitchenRiseOf, kitchenRiseSpent } from "@/lib/kitchen-rise";
import { stripComments } from "@/lib/source-pin-utils";

// U4 Task 4 (2026-10-30; design 6.3 Motion, values 7): a card rises (the HTML's rise .35s) on the answer that brings it —
// the first paint, a newly fired order, a card back by the lost-ticket rule — never on a filter change. The record of seen
// ids lives in the board body, fed by every card of each answer (before the header's filter). The pure record first, then
// KitchenBoardBody's REAL body run through lib/hook-harness.ts (its ref and effect), reading the `rise` each card gets.

const load = createRequire(__filename);
// The harness's hooks over the real React, so the component files (lucide icons, the kit) load and JSX builds real
// elements; the body's own useRef / useEffect are the harness's.
const fake = load("react") as Record<string, unknown>;
const real = load(load.resolve("react")) as Record<string, unknown>; // by its file path: the stub table keys on "react"
stubModule("react", { ...real, useState: fake.useState, useRef: fake.useRef, useMemo: fake.useMemo, useCallback: fake.useCallback, useEffect: fake.useEffect });
(globalThis as { React?: unknown }).React = real;
const { KitchenBoardBody } = load("@/components/kitchen/KitchenBoardBody") as typeof import("@/components/kitchen/KitchenBoardBody");
const { KitchenOrderCard } = load("@/components/kitchen/KitchenOrderCard") as typeof import("@/components/kitchen/KitchenOrderCard");

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const code = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const A = kitchenCard("T-4", 12);
const B = kitchenCard("Walk-In", 8);
const C = kitchenCard("T-6", 0);
const ids = (set: ReadonlySet<string>): string[] => [...set].sort();
/** A fresh answer holding these cards (a refetch builds new objects). */
const answer = (...cards: Card[]): Card[] => cards.map((c) => ({ ...c }));

// ── The record (lib/kitchen-rise.ts) ─────────────────────────────────────────────────────────────────────────────────

test("kitchenRiseOf: the first answer raises every card; the same answer again is the same record; spent, nothing rises", () => {
  const first = answer(A, B);
  const r1 = kitchenRiseOf(KITCHEN_RISE_NONE, first);
  assert.deepEqual(ids(r1.rising), ids(new Set([A.orderId, B.orderId])), "the first paint: every card rises");
  assert.deepEqual(ids(r1.seen), ids(new Set([A.orderId, B.orderId])), "every card of the answer is seen");
  assert.equal(kitchenRiseOf(r1, first), r1, "the same answer (a re-render, StrictMode's second pass): the same record");
  assert.equal(kitchenRiseOf(r1, undefined), r1, "no answer yet: unchanged");
  const spent = kitchenRiseSpent(r1);
  assert.deepEqual([spent.rising.size, ids(spent.seen)], [0, ids(r1.seen)], "on screen: nothing rises any more, the ids stay");
  assert.equal(kitchenRiseSpent(spent), spent, "spending twice changes nothing");
});

test("kitchenRiseOf: only a card not in the previous answer rises (a new order, a card back by the lost-ticket rule)", () => {
  const r1 = kitchenRiseSpent(kitchenRiseOf(KITCHEN_RISE_NONE, answer(A, B)));
  const ticked = kitchenRiseOf(r1, answer(A, B));
  assert.equal(ticked.rising.size, 0, "a new answer with the same cards (a tick, a poll): nothing rises");
  const fired = kitchenRiseOf(kitchenRiseSpent(ticked), answer(A, B, C));
  assert.deepEqual(ids(fired.rising), [C.orderId], "a newly fired order rises, the others do not");
  const gone = kitchenRiseOf(kitchenRiseSpent(fired), answer(A, B));
  assert.equal(gone.rising.size, 0, "a card leaves (Mark ready): nothing rises");
  assert.deepEqual(ids(kitchenRiseOf(kitchenRiseSpent(gone), answer(A, B, C)).rising), [C.orderId], "it comes back: it rises again");
});

// ── The board body, run (KitchenBoardBody's ref of seen ids and its effect) ─────────────────────────────────────────

type BodyProps = Parameters<typeof KitchenBoardBody>[0];
function scene(first: Card[]): { hook: MountedHook<ReactNode>; show(boardCards: Card[] | undefined, cards?: Card[]): Record<string, boolean> } {
  let props: BodyProps = {
    isLoading: false, hasData: true, isError: false, isPaused: false, boardCards: first, cards: first, filtered: false,
    now: new Date(), onToggleLine: () => {}, onReady: () => {}, lineInFlight: () => false, readyInFlight: () => false, onRetry: () => {},
  };
  const hook = mountHook(() => KitchenBoardBody(props));
  return {
    hook,
    show(boardCards, cards = boardCards ?? []) {
      props = { ...props, boardCards, cards, filtered: cards.length < (boardCards?.length ?? 0), hasData: boardCards !== undefined };
      hook.rerender();
      return riseOf(hook.result());
    },
  };
}
/** Each KitchenOrderCard element the body built: its card's id → the rise it was given. */
function riseOf(tree: ReactNode): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const walk = (node: ReactNode): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object" || !("props" in node)) return;
    const el = node as ReactElement<{ card?: Card; rise?: boolean; children?: ReactNode }>;
    if (el.type === KitchenOrderCard && el.props.card) out[el.props.card.orderId] = el.props.rise === true;
    walk(el.props.children);
  };
  walk(tree);
  return out;
}

test("KitchenBoardBody: the first paint raises every card; a filter change and its way back raise none", () => {
  const first = answer(A, B);
  const s = scene(first);
  assert.deepEqual(riseOf(s.hook.result()), { [A.orderId]: true, [B.orderId]: true }, "the first paint: every card rises");
  assert.deepEqual(s.show(first, [first[1]]), { [B.orderId]: false }, "Walk-In chosen: the card shown does not rise again");
  assert.deepEqual(s.show(first), { [A.orderId]: false, [B.orderId]: false }, "back to All: the card hidden a moment ago does not rise");
  assert.deepEqual(s.show(first), { [A.orderId]: false, [B.orderId]: false }, "a re-render (the 30s clock): none");
});

test("KitchenBoardBody: a poll that adds an order raises that card only; one that left and came back rises again", () => {
  const s = scene(answer(A, B));
  assert.deepEqual(s.show(answer(A, B, C)), { [A.orderId]: false, [B.orderId]: false, [C.orderId]: true }, "the new order rises");
  assert.deepEqual(s.show(answer(A, B, C)), { [A.orderId]: false, [B.orderId]: false, [C.orderId]: false }, "the next poll: none");
  s.show(answer(A, B));
  assert.deepEqual(s.show(answer(A, B, C)), { [A.orderId]: false, [B.orderId]: false, [C.orderId]: true }, "back by the lost-ticket rule: it rises");
});

test("KitchenBoardBody: a new order hidden by the filter does not rise when a later filter change shows it", () => {
  const s = scene(answer(A, B));
  const withC = answer(A, B, C);
  assert.deepEqual(s.show(withC, [withC[1]]), { [B.orderId]: false }, "the poll brings C while Walk-In is chosen (C is a table card)");
  assert.deepEqual(s.show(withC), { [A.orderId]: false, [B.orderId]: false, [C.orderId]: false }, "All again: a filter change never rises");
});

test("KitchenBoardBody: no answer yet raises nothing and records nothing; the first answer then raises every card", () => {
  const s = scene([]);
  s.show(undefined);
  const first = answer(A, B);
  assert.deepEqual(s.show(first), { [A.orderId]: true, [B.orderId]: true }, "the first cards after an empty board rise");
});

test("KitchenBoardBody's source: one permanent wrapper (U3 VC-3); the record fed by every card of the answer", () => {
  const src = code("components/kitchen/KitchenBoardBody.tsx");
  assert.match(src, /const rise = useRef\(KITCHEN_RISE_NONE\);/, "a ref of the seen ids");
  assert.match(src, /rise\.current = kitchenRiseOf\(rise\.current, boardCards\);/, "fed by the answer's cards, before the filter");
  assert.match(src, /useEffect\(\(\) => \{\s*rise\.current = kitchenRiseSpent\(rise\.current\);\s*\}, \[boardCards\]\);/, "spent once on screen");
  assert.match(src, /rise=\{rise\.current\.rising\.has\(card\.orderId\)\}/, "each card is told whether it rises");
  const wrapper = src.indexOf('<div data-ui="kitchen-cards">');
  assert.ok(wrapper > 0 && wrapper < src.indexOf("<KitchenBoardStates"), "the body's one permanent wrapper holds every state and the grid");
  assert.match(code("app/(dashboard)/kitchen/page.tsx"), /boardCards=\{board\.data\?\.cards\}/, "the page hands the body every card of the answer");
});
