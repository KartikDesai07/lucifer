import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import { openingSlipsOf, createOrderPrintJobs, type OrderPrintSlip } from "@/lib/print-order-jobs";
import { PrintHost } from "@/models/PrintHost";
import { PrintJob } from "@/models/PrintJob";
import type { Order } from "@/types";

// Print customization S7, Slice A: the server half of the token slip. DB-free: the REAL openingSlipsOf and
// createOrderPrintJobs (real routing builders, real payload schema, real key derivation) run over a fake
// PrintHost / PrintJob model surface, so what is asserted is the logic that makes the jobs, not a fake of it.
// The DB-truth (indexes, the duplicate-key collision on a real jobKey) is the live leg (verify:print:live).

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const raw = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const src = (rel: string): string => stripComments(raw(rel));
const count = (text: string, needle: string): number => text.split(needle).length - 1;

// ── openingSlipsOf: the ONE list of round-opening slips ──────────────────────

test("openingSlipsOf: an order with NO tokenNumber gets exactly [kot] for any round (tokens OFF is byte-identical to before S7)", () => {
  for (const round of [1, 2, 5]) assert.deepEqual(openingSlipsOf({}, round), [{ kind: "kot", round }]);
  const notOrders: unknown[] = [null, undefined, "7", 7, true, [], { tokenNumber: undefined }, { tokenNumber: null }, { tokenNumber: "7" }];
  for (const order of notOrders) assert.deepEqual(openingSlipsOf(order, 1), [{ kind: "kot", round: 1 }], `${JSON.stringify(order)} opens with the KOT alone`);
});

test("openingSlipsOf: round 1 of a tokened order is the KOT THEN the token; a later round is the KOT only", () => {
  assert.deepEqual(openingSlipsOf({ tokenNumber: 7 }, 1), [{ kind: "kot", round: 1 }, { kind: "token" }]);
  assert.deepEqual(openingSlipsOf({ tokenNumber: 0 }, 1), [{ kind: "kot", round: 1 }, { kind: "token" }], "token 0 is a number");
  for (const round of [2, 3, 9]) assert.deepEqual(openingSlipsOf({ tokenNumber: 7 }, round), [{ kind: "kot", round }], `round ${round}: an add-round never prints a token`);
});

test("openingSlipsOf: a QR self-order prints the token too (owner R13 answer), the order's source is never read", () => {
  assert.deepEqual(openingSlipsOf({ tokenNumber: 7, source: "self-order", receiver: "Self-order" }, 1), [{ kind: "kot", round: 1 }, { kind: "token" }]);
  const body = src("apps/cafe/lib/print-order-jobs.ts");
  const fn = body.slice(body.indexOf("export function openingSlipsOf("), body.indexOf("export function wireOrderOf("));
  assert.ok(fn.includes("opensWithToken("), "landmark: the rule is the shared one");
  assert.ok(!/source|SELF_ORDER/.test(fn), "openingSlipsOf has no source gate");
});

// ── the order the jobs are made in ───────────────────────────────────────────

test("SLIP_ORDER: kot, then token, then void, moved, bill - the token sits after the KOT and before the bill (values parsed from the raw source)", () => {
  const body = src("apps/cafe/lib/print-order-jobs.ts");
  const m = /const SLIP_ORDER: Record<OrderPrintSlip\["kind"\], number> = \{([^}]*)\};/.exec(body);
  assert.ok(m !== null, "landmark: the SLIP_ORDER literal is where it was");
  const rank: Record<string, number> = {};
  for (const pair of (m?.[1] ?? "").split(",")) {
    const [k, v] = pair.split(":").map((x) => x.trim());
    if (k) rank[k] = Number(v);
  }
  assert.deepEqual(Object.keys(rank).sort(), ["bill", "kot", "moved", "token", "void"], "every slip kind is ranked");
  assert.ok(rank.kot < rank.token && rank.token < rank.bill, "KOT -> token -> bill");
  assert.ok(rank.token < rank.void && rank.token < rank.moved, "the token also precedes the void and moved slips");
  assert.deepEqual(new Set(Object.values(rank)).size, 5, "no two kinds share a rank (a tie would leave the order to the sort)");
  assert.ok(body.includes("[...input.slips].sort((a, b) => SLIP_ORDER[a.kind] - SLIP_ORDER[b.kind]);"), "createOrderPrintJobs sorts by it before creating");
});

// ── createOrderPrintJobs over fake models ────────────────────────────────────

type Stored = { _id: string; kind: string; jobKey?: string; label: string; payload: string; targetDeviceId: string };

function stub(target: object, key: string, impl: unknown): () => void {
  const holder = target as Record<string, unknown>;
  const had = Object.hasOwn(holder, key);
  const old = holder[key];
  holder[key] = impl;
  return () => {
    if (had) holder[key] = old;
    else delete holder[key];
  };
}

/** Fake PrintHost (one designated host) and PrintJob (create in call order, unique jobKey like the real sparse index). */
function withFakeQueue<T>(run: (created: Stored[]) => Promise<T>): Promise<T> {
  const created: Stored[] = [];
  const restores = [
    stub(PrintHost, "findOne", () => ({ select: () => ({ lean: async () => ({ deviceId: "host-1" }) }) })),
    stub(PrintJob, "create", async (doc: Omit<Stored, "_id">) => {
      if (doc.jobKey !== undefined && created.some((c) => c.jobKey === doc.jobKey)) throw Object.assign(new Error("dup"), { code: 11000 });
      const row = { ...doc, _id: `job-${created.length + 1}` };
      created.push(row);
      return row;
    }),
    stub(PrintJob, "findOne", (filter: { jobKey: string }) => ({
      select: () => ({ lean: async () => ({ ...created.find((c) => c.jobKey === filter.jobKey), status: "queued" }) }),
    })),
  ];
  return run(created).finally(() => restores.reverse().forEach((restore) => restore()));
}

function orderOf(overrides: Record<string, unknown>): Order {
  return {
    _id: "665f0a0000000000000000a1",
    orderId: "ORD-0001",
    customerName: "Walk-in",
    items: [{ productId: "p1", name: "Filter Coffee", price: 4000, qty: 2, modifiers: [], instructions: "", kotRound: 1 }],
    subtotal: 8000,
    discount: 0,
    total: 8000,
    paidAmount: 8000,
    payment: "Cash",
    status: "Completed",
    receiver: "Staff",
    tableNo: "T-4",
    kotRounds: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Order;
}

const makeJobs = (order: Order, slips: OrderPrintSlip[]) =>
  createOrderPrintJobs({ order, slips, originDeviceId: "phone-1", queuedBy: "Asha", nowMs: Date.UTC(2026, 0, 1) });

test("createOrderPrintJobs: Pay Now of a tokened order creates kot, token, bill IN THAT ORDER, however the slips were listed, with token:<id> as the token's key", async () => {
  await withFakeQueue(async (created) => {
    const order = orderOf({ tokenNumber: 7 });
    const refs = await makeJobs(order, [{ kind: "bill" }, ...openingSlipsOf(order, 1)]);
    assert.deepEqual(created.map((c) => c.kind), ["kot", "token", "bill"], "creation order = print order");
    assert.deepEqual(refs.map((r) => r.kind), ["kot", "token", "bill"]);
    assert.deepEqual(created.map((c) => c.jobKey), [`kot:${order._id}:1`, `token:${order._id}`, `bill:${order._id}`]);
    const token = created[1];
    assert.equal(token.label, "Token 7 · T-4");
    assert.equal(token.targetDeviceId, "host-1", "the token rides the bill's lane: the designated host");
    assert.equal(JSON.parse(token.payload).snapshot.tokenNumber, 7, "landmark: the stored snapshot carries the number it prints");
  });
});

test("createOrderPrintJobs: a held tab (no bill) is kot, token; tokens OFF is kot, bill with NO token job or key at all", async () => {
  await withFakeQueue(async (created) => {
    await makeJobs(orderOf({ tokenNumber: 7, status: "Pending" }), openingSlipsOf({ tokenNumber: 7 }, 1));
    assert.deepEqual(created.map((c) => c.kind), ["kot", "token"]);
  });
  await withFakeQueue(async (created) => {
    const off = orderOf({});
    assert.equal("tokenNumber" in off, false, "landmark: this order really has no token number");
    await makeJobs(off, [...openingSlipsOf(off, 1), { kind: "bill" }]);
    assert.deepEqual(created.map((c) => c.kind), ["kot", "bill"]);
    assert.equal(created.some((c) => c.jobKey?.startsWith("token:")), false);
  });
});

test("createOrderPrintJobs: round 2 of a tokened order makes the KOT only, and a replay of round 1 collides on the same token key (one token job, same id)", async () => {
  await withFakeQueue(async (created) => {
    const order = orderOf({ tokenNumber: 7, kotRounds: 2 });
    await makeJobs(order, openingSlipsOf(order, 2));
    assert.deepEqual(created.map((c) => c.kind), ["kot"], "an add-round never creates a token");
    const first = await makeJobs(order, openingSlipsOf(order, 1));
    const replay = await makeJobs(order, openingSlipsOf(order, 1));
    assert.equal(created.filter((c) => c.kind === "token").length, 1, "the replay made no second token job");
    assert.deepEqual(replay.map((r) => r.id), first.map((r) => r.id), "the replay answers the SAME job ids (adopt, not duplicate)");
  });
});

// ── call-site pins: exactly the three round-opening sites build the opening slips ──

const OPENING_SITES = [
  "apps/cafe/app/api/orders/route.ts",
  "apps/cafe/app/api/order-requests/[id]/accept/route.ts",
  "apps/cafe/lib/print-agent-server.ts",
];
const NO_TOKEN_SITES = [
  "apps/cafe/app/api/orders/[id]/items/route.ts",
  "apps/cafe/app/api/orders/[id]/items/void/route.ts",
  "apps/cafe/app/api/orders/[id]/settle/route.ts",
  "apps/cafe/app/api/orders/[id]/table/route.ts",
  "apps/cafe/app/api/orders/[id]/cancel/route.ts",
  "apps/cafe/lib/print-repair.ts",
];

test("PIN: each of the three opening-slip call sites (create, staff accept, the self-order kot-claim) calls openingSlipsOf( exactly once, with its own round", () => {
  for (const rel of OPENING_SITES) {
    const s = src(rel);
    assert.equal(count(s, "openingSlipsOf("), 1, `${rel}: exactly one call`);
    assert.match(s, /import \{[^}]*\bopeningSlipsOf\b[^}]*\} from "@\/lib\/print-order-jobs";/, `${rel}: imports it from print-order-jobs`);
    assert.equal(count(s, "createOrderPrintJobs("), 1, `${rel}: landmark: the one job-creation site it feeds`);
  }
  assert.ok(src(OPENING_SITES[0]).includes("slips: [...openingSlipsOf(numbered.value ?? landed, 1), ...(printsBillNow ? [{ kind: \"bill\" as const }] : [])],"), "create: round 1 of the order as answered, then the bill");
  assert.ok(src(OPENING_SITES[1]).includes("slips: openingSlipsOf(result.order, result.order.kotRounds),"), "accept: the round it just opened");
  assert.ok(src(OPENING_SITES[2]).includes("slips: openingSlipsOf(result.order, result.kotRound),"), "kot-claim: the round it just claimed");
});

test("PIN: add-round, void, settle, move, cancel and the repair sweep NEVER build a token (no openingSlipsOf( and no token slip literal), each paired with a landmark that the file still makes its own slips", () => {
  const sites: Array<[string, string]> = [
    [NO_TOKEN_SITES[0], "createOrderPrintJobs("],
    [NO_TOKEN_SITES[1], "createOrderPrintJobs("],
    [NO_TOKEN_SITES[2], "createOrderPrintJobs("],
    [NO_TOKEN_SITES[3], "createOrderPrintJobs("],
    [NO_TOKEN_SITES[4], "export async function"],
    [NO_TOKEN_SITES[5], "createOrderPrintJobs("],
  ];
  for (const [rel, landmark] of sites) {
    const s = src(rel);
    assert.ok(s.includes(landmark), `${rel}: landmark ${landmark} is present`);
    assert.equal(count(s, "openingSlipsOf("), 0, `${rel}: no opening-slip list`);
    assert.ok(!/kind: "token"/.test(s) && !s.includes("tokenPrintJob("), `${rel}: no token slip`);
  }
});

test("PIN: repo-wide, openingSlipsOf( is called from exactly the three opening-slip files (outside its definition and test files)", () => {
  const roots = ["app", "lib", "hooks", "components"].map((d) => path.join(REPO_ROOT, "apps/cafe", d));
  const callers: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) && name !== "print-order-jobs.ts") {
        if (stripComments(readFileSync(full, "utf8")).includes("openingSlipsOf(")) callers.push(path.relative(REPO_ROOT, full).split(path.sep).join("/"));
      }
    }
  };
  roots.forEach(walk);
  assert.deepEqual(callers.sort(), [...OPENING_SITES].sort());
  assert.ok(src("apps/cafe/lib/print-order-jobs.ts").includes("export function openingSlipsOf("), "landmark: the definition is where the scan skipped");
});
