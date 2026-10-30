import "@/lib/hook-harness"; // installs the react / sonner stubs: MUST stay the first import
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { useEffect, useState } from "react";
import { MutationObserver, QueryClient, noop, type MutationObserverOptions } from "@tanstack/query-core";

import { mountHook, stubModule } from "@/lib/hook-harness";
import type { KitchenRow } from "@/lib/kitchen-board";
import type { KitchenOrderCard as Card } from "@/lib/kitchen-cards";
import { kitchenCard } from "@/lib/kitchen-header.fixtures";
import { stripComments } from "@/lib/source-pin-utils";

// U4 Task 4 (2026-10-30; owner Q7, inventory 12.1; Review Focus 1): each tap's in-flight flag clears when THAT tap's write
// ends. useKitchenActions runs for real (lib/hook-harness.ts) over the REAL use-kitchen.ts mutations (their optimistic
// writes, restores, error toasts, invalidates) on TanStack's real MutationObserver and QueryClient: only React's binding
// (useMutation as @tanstack/react-query writes it, its store subscription an effect) and the network (each POST a promise
// the test settles) are stand-ins. TanStack runs a per-call `mutate(vars, { onSettled })` only for the hook's LATEST call,
// so a second tap before the first write answered left the first control disabled until a reload (measured, 12.1).

interface Post {
  body: Record<string, unknown>;
  resolve: () => void;
  reject: (err: Error) => void;
}
const posts: Post[] = [];
const toasts: Array<{ message: string; undo?: () => void }> = [];
const errors: string[] = [];
// gcTime Infinity: no garbage-collection timer keeps the test process alive for TanStack's default 5 minutes.
const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity }, mutations: { gcTime: Infinity } } });

stubModule("@tanstack/react-query", {
  useQueryClient: () => client,
  useIsMutating: () => 0,
  useQuery: () => ({}),
  // @tanstack/react-query 5's useMutation, minus useSyncExternalStore (its subscription is an effect here).
  useMutation: (options: MutationObserverOptions<unknown, Error, unknown, unknown>) => {
    const [observer] = useState(() => new MutationObserver(client, options));
    useEffect(() => observer.subscribe(() => undefined), [observer]);
    const result = observer.getCurrentResult();
    return { ...result, mutate: (vars: unknown, opts?: object) => void observer.mutate(vars, opts).catch(noop), mutateAsync: result.mutate };
  },
});
stubModule("@/lib/api-client", {
  apiGet: async () => ({ cards: [], tabCount: 0, generatedAt: "" }),
  apiSend: (_url: string, _method: string, body: Record<string, unknown>) =>
    new Promise((resolve, reject) => posts.push({ body, resolve: () => resolve({ ok: true }), reject })),
});
stubModule("@/hooks/use-orders", { ORDER_KEYS: { mutation: ["orders", "mutation"] } });
const toast = Object.assign(
  (message: string, opts?: { action?: { onClick: () => void } }) => void toasts.push({ message, undo: opts?.action?.onClick }),
  { error: (m: string) => void errors.push(m), success: () => undefined, info: () => undefined },
);
stubModule("sonner", { toast });

const load = createRequire(__filename);
const { useKitchenActions } = load("@/hooks/use-kitchen-actions") as typeof import("@/hooks/use-kitchen-actions");
const { KITCHEN_KEYS } = load("@/hooks/use-kitchen") as typeof import("@/hooks/use-kitchen");

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const code = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
/** Lets every pending promise and TanStack's microtask chain run (the optimistic write awaits cancelQueries first). */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
};

const row = (ref: string, name: string, qty: number): KitchenRow => ({
  orderId: "order-t4", orderNo: "ORD-20261019-012", id: `order-t4:${ref}`, ref, name, qty, modifiers: [], round: 1,
  tableLabel: "T-4", selfOrder: false, firedAt: "2026-10-19T15:50:00.000Z", firedAtApprox: false, done: false,
});
const ZINGER = row("a", "Chicken Zinger", 2);
const SANDWICH = row("b", "Veg Sandwich", 1);
const CARD: Card = kitchenCard("T-4", 10, { orderId: "order-t4", lines: [ZINGER, SANDWICH], totalCount: 2, newestFiredAt: "2026-10-19T15:52:00.000Z" });

function scene() {
  posts.length = 0;
  toasts.length = 0;
  errors.length = 0;
  client.clear();
  client.setQueryData(KITCHEN_KEYS.all, { cards: [CARD], tabCount: 1, generatedAt: "" });
  const hook = mountHook(() => useKitchenActions());
  return {
    act: (fn: (a: ReturnType<typeof useKitchenActions>) => void) => hook.act(() => fn(hook.result())),
    line: (r: KitchenRow) => hook.result().lineInFlight(r.id),
    ready: () => hook.result().readyInFlight(CARD.orderId),
  };
}

test("Q7: two ticks whose writes answer B then A — both rows come back enabled; one POST per tap; today's toast words", async () => {
  const s = scene();
  s.act((a) => a.onToggleLine(ZINGER, true));
  await settle();
  s.act((a) => a.onToggleLine(SANDWICH, true));
  await settle();
  assert.deepEqual(
    posts.map((p) => p.body),
    [{ action: "tick", orderId: "order-t4", ref: "a", done: true }, { action: "tick", orderId: "order-t4", ref: "b", done: true }],
    "one POST per tap, today's bodies",
  );
  assert.deepEqual([s.line(ZINGER), s.line(SANDWICH)], [true, true], "both rows disabled while their writes run");
  posts[1].resolve();
  await settle();
  assert.deepEqual([s.line(ZINGER), s.line(SANDWICH)], [true, false], "B answered: B enabled, A still running");
  posts[0].resolve();
  await settle();
  assert.equal(s.line(ZINGER), false, "A answered: A enabled again (today it stayed disabled until a reload)");
  assert.deepEqual(toasts.map((t) => t.message), ["2 × Chicken Zinger marked done", "1 × Veg Sandwich marked done"], "the tick toasts' words");
  assert.ok(toasts.every((t) => typeof t.undo === "function"), "each with its Undo");
  assert.equal(posts.length, 2, "no extra request");
});

test("Q7: Mark ready, then its Undo while the Ready write runs — the card's button comes back enabled once its write ends", async () => {
  const s = scene();
  s.act((a) => a.onReady(CARD));
  await settle();
  assert.deepEqual(posts.map((p) => p.body), [{ action: "ready", orderId: "order-t4", ready: true, seenFiredAt: CARD.newestFiredAt }], "today's Ready body");
  assert.deepEqual(toasts.map((t) => t.message), ["T-4 marked ready — 2 lines not ticked"], "today's Ready toast, named by the card's code");
  assert.equal(s.ready(), true, "disabled while its write runs");
  s.act(() => toasts[0].undo?.());
  await settle();
  assert.deepEqual(posts[1]?.body, { action: "ready", orderId: "order-t4", ready: false }, "the Undo: one POST, today's body");
  posts[1].resolve();
  await settle();
  assert.equal(s.ready(), true, "the Undo answered first: the Ready write still runs");
  posts[0].resolve();
  await settle();
  assert.equal(s.ready(), false, "the Ready answered: enabled again (today it stayed disabled until a reload)");
  assert.equal(posts.length, 2, "two taps, two POSTs");
});

test("Q7: a refused tick raises today's error toast, restores the line and enables its row; nothing unhandled", async () => {
  const s = scene();
  s.act((a) => a.onToggleLine(ZINGER, true));
  await settle();
  const ticked = client.getQueryData<{ cards: Card[] }>(KITCHEN_KEYS.all)?.cards[0].lines[0].done;
  assert.equal(ticked, true, "the optimistic tick shows at once");
  posts[0].reject(new Error("Tab not found or already settled"));
  await settle();
  assert.deepEqual(errors, ["Tab not found or already settled"], "the hook-level onError's toast, today's words");
  assert.equal(client.getQueryData<{ cards: Card[] }>(KITCHEN_KEYS.all)?.cards[0].lines[0].done, false, "the exact snapshot restored");
  assert.equal(s.line(ZINGER), false, "its row enabled again");
});

test("the in-flight guard: a second tap on the same row before its write answers sends nothing; an un-tick has no toast", async () => {
  const s = scene();
  s.act((a) => a.onToggleLine(ZINGER, true));
  await settle();
  s.act((a) => a.onToggleLine(ZINGER, false));
  await settle();
  assert.equal(posts.length, 1, "one POST: the row is in flight");
  posts[0].resolve();
  await settle();
  s.act((a) => a.onToggleLine({ ...ZINGER, done: true }, false));
  await settle();
  assert.deepEqual(posts[1]?.body, { action: "tick", orderId: "order-t4", ref: "a", done: false }, "the un-tick's POST");
  assert.equal(toasts.length, 1, "no toast for an un-tick (today's)");
  posts[1].resolve();
  await settle();
  s.act(() => toasts[0].undo?.());
  await settle();
  assert.deepEqual(posts[2]?.body, { action: "tick", orderId: "order-t4", ref: "a", done: false }, "the tick toast's Undo: one POST");
});

test("useKitchenActions' source: each flag clears from its own write (mutateAsync), never a per-call onSettled", () => {
  const src = code("hooks/use-kitchen-actions.ts");
  assert.match(src, /tick\s*\.mutateAsync\(\{ orderId: row\.orderId, ref: row\.ref, done \}\)\s*\.catch\(\(\) => undefined\)\s*\.finally\(/, "the tick's own write");
  assert.match(src, /ready\s*\.mutateAsync\(\{ orderId: card\.orderId, ready: true, seenFiredAt: card\.newestFiredAt \}\)\s*\.catch\(\(\) => undefined\)\s*\.finally\(/, "the Ready's own write");
  assert.ok(!src.includes("onSettled"), "no per-call onSettled (TanStack runs it for the latest call only)");
});
