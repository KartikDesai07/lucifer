/**
 * Menu B2 live leg, case (7) — the R6 races. Split out of
 * verify-menu-orders-live.ts (300-line ceiling); that script owns the scratch
 * DB, the auth stub and the route handles, and passes the helpers in via
 * LegCtx (also used by the refusals file). This file imports no route and no auth: it only wraps the ONE model
 * read the route uses for its replay check, so a twin of the request can land
 * "after the route's first look, before its refusal".
 *
 * Create: the route's top replay read is `Order.findOne({ idemKey }).lean()`
 * (lib/order-idem.ts findCreateReplay). Round: the tab read is
 * `Order.findById(id).lean()` in the read wave, and the re-check is the same
 * call again (roundReplayAfterMiss). The wrapper lets the FIRST such read
 * resolve with the real (twin-less) answer, THEN lands the twin, so the
 * route's own re-check before its 409 is the only thing that can find it.
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { randomUUID } from "node:crypto";
import type { Types } from "mongoose";
import { Order } from "@/models/Order";
import { Product } from "@/models/Product";
import { buildKotIdemKeys } from "@pos/shared/order-idem";
import { issue, msg } from "./verify-menu-orders-live-refusals";

export interface Item { id: string; name: string; price: number }
export interface Line { productId: string; name: string; price: number; qty: number; variation?: string }
export interface OrderBody { _id: string; kotRounds?: number; kotIdemKeys?: string[]; items?: { productId: string; reward?: boolean; kotRound?: number }[] }
export interface Reply { status: number; body: { success: boolean; data?: OrderBody; error?: string } }
export interface Counters { order: number; kot: number; bill: number }

/** The helpers verify-menu-orders-live.ts hands to the split-out case files. */
export interface LegCtx {
  check(label: string, ok: boolean): void;
  create(items: Line[], extra?: Record<string, unknown>): Promise<Reply>;
  round(id: string, items: Line[], idemKey?: string, extra?: Record<string, unknown>): Promise<Reply>;
  mk(name: string, price?: number, extra?: Record<string, unknown>): Promise<Item>;
  ln(item: Item, qty?: number, extra?: Partial<Line>): Line;
  counters(): Promise<Counters>;
  snap(key?: string): Promise<unknown>;
  same(a: unknown, b: unknown): boolean;
  tabSnap(id: string): Promise<unknown>;
  openTab(extra?: Record<string, unknown>): Promise<string>;
  setProduct(item: { id: string }, set: Record<string, unknown>): Promise<unknown>;
  setRole(role: "admin" | "staff"): void;
  categoryId: Types.ObjectId;
}

type Fn = (...args: unknown[]) => unknown;
interface LeanQuery { lean(): PromiseLike<unknown> }

/**
 * Patches target[name]: the FIRST call `applies` to returns a `.lean()`
 * thenable that resolves with the real answer and only then runs `after`.
 * Every other call passes straight through. restore() puts the original back.
 */
function afterFirstLeanRead(target: object, name: string, applies: (args: unknown[]) => boolean, after: () => Promise<void>) {
  const rec = target as Record<string, Fn>;
  const own = Object.prototype.hasOwnProperty.call(target, name);
  const original = rec[name] as Fn;
  let fired = 0;
  rec[name] = (...args: unknown[]) => {
    if (fired > 0 || !applies(args)) return original.apply(target, args);
    fired += 1;
    const query = original.apply(target, args) as LeanQuery;
    return {
      lean: () => ({
        then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
          Promise.resolve(query.lean())
            .then(async (doc) => {
              await after();
              return doc;
            })
            .then(ok, bad),
      }),
    };
  };
  return {
    fired: () => fired,
    restore: () => {
      if (own) rec[name] = original;
      else delete rec[name];
    },
  };
}

const keyedFilter = (args: unknown[]): boolean =>
  typeof args[0] === "object" && args[0] !== null && "idemKey" in args[0];

async function raceCreate(ctx: LegCtx, control: boolean): Promise<void> {
  const label = control ? "control (a DIFFERENT key)" : "same key";
  const item = await ctx.mk(control ? "Race Control Tea" : "Race Tea");
  const real = await ctx.create([ctx.ln(item)], { idemKey: randomUUID() });
  const base = await Order.findById(real.body.data?._id).lean();
  if (!base) throw new Error("fixture order missing");
  await Product.updateOne({ _id: item.id }, { $set: { available: false } });
  const twinKey = randomUUID();
  const sendKey = control ? randomUUID() : twinKey;
  const ordersBefore = await Order.countDocuments({});
  const c0 = await ctx.counters();
  const landTwin = async () => {
    const { _id: _drop, orderId: _oid, ...rest } = base;
    await Order.collection.insertOne({ ...rest, orderId: `TWIN-${randomUUID().slice(0, 8)}`, idemKey: twinKey });
  };
  const hook = afterFirstLeanRead(Order, "findOne", keyedFilter, landTwin);
  let res: Reply;
  try {
    res = await ctx.create([ctx.ln(item)], { idemKey: sendKey });
  } finally {
    hook.restore();
  }
  const twin = await Order.findOne({ idemKey: twinKey }).lean();
  ctx.check(`create race, ${label}: the wrapper fired exactly once and the twin landed`, hook.fired() === 1 && twin !== null);
  ctx.check(`create race, ${label}: one order added (the twin), no counter moved`, (await Order.countDocuments({})) === ordersBefore + 1 && JSON.stringify(await ctx.counters()) === JSON.stringify(c0));
  if (control) {
    ctx.check("create race, control: a different key finds no twin → 409 with the out-of-stock copy, no order under that key", res.status === 409 && res.body.error === msg(issue("out", item.name)) && (await Order.countDocuments({ idemKey: sendKey })) === 0);
  } else {
    ctx.check("create race: the retry answers 200 with the TWIN's _id (the re-check before the 409 found it)", res.status === 200 && res.body.data?._id === String(twin?._id));
  }
}

async function raceRound(ctx: LegCtx, control: boolean): Promise<void> {
  const label = control ? "control (a DIFFERENT key)" : "same key";
  const anchor = await ctx.mk(control ? "Race Control Anchor" : "Race Anchor");
  const item = await ctx.mk(control ? "Race Control Round Tea" : "Race Round Tea");
  const tab = await ctx.create([ctx.ln(anchor)]);
  const tabId = String(tab.body.data?._id);
  const opened = await Order.findById(tabId).lean();
  await Product.updateOne({ _id: item.id }, { $set: { available: false } });
  const twinKey = randomUUID();
  const sendKey = control ? randomUUID() : twinKey;
  const c0 = await ctx.counters();
  // The twin: the same round, fired by the first try, with its key on the tab.
  const landTwin = async () => {
    await Order.updateOne(
      { _id: tabId },
      {
        $set: { kotRounds: 2, kotIdemKeys: buildKotIdemKeys(opened?.kotIdemKeys, 2, twinKey) },
        $push: { items: { productId: item.id, name: item.name, price: item.price, qty: 1, kotRound: 2 } },
      },
    );
  };
  const hook = afterFirstLeanRead(Order, "findById", (args) => String(args[0]) === tabId, landTwin);
  let res: Reply;
  try {
    res = await ctx.round(tabId, [ctx.ln(item)], sendKey);
  } finally {
    hook.restore();
  }
  const after = await Order.findById(tabId).lean();
  const fired = after?.items.filter((i) => String(i.productId) === item.id && i.kotRound === 2).length;
  ctx.check(`round race, ${label}: the wrapper fired exactly once; the twin's round 2 is on the tab exactly once`, hook.fired() === 1 && after?.kotRounds === 2 && fired === 1);
  ctx.check(`round race, ${label}: no counter moved (no ticket drawn)`, JSON.stringify(await ctx.counters()) === JSON.stringify(c0));
  if (control) {
    ctx.check("round race, control: a different key finds no twin → 409 with the out-of-stock copy; the key is not on the tab", res.status === 409 && res.body.error === msg(issue("out", item.name)) && !(after?.kotIdemKeys ?? []).includes(sendKey));
  } else {
    ctx.check("round race: the retry answers 200 replaying round 2 (the re-check before the 409 found the twin)", res.status === 200 && res.body.data?.kotRounds === 2 && res.body.data?.kotIdemKeys?.[1] === twinKey);
  }
}

/** Case (7): create then round, the twin-lands race and its control each. */
export async function raceCases(ctx: LegCtx): Promise<void> {
  await raceCreate(ctx, false);
  await raceCreate(ctx, true);
  await raceRound(ctx, false);
  await raceRound(ctx, true);
}
