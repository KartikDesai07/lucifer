/**
 * Shared fixtures + helpers of the CB-7 S2 live leg (verify-reward-progress-live.ts): the enabled blob, the Settings
 * writer that bypasses the launch lock, the PIN-set / staff-reset update shapes copied from the routes (and pinned
 * to the route SOURCE so a drift fails the leg), a contention barrier and the dep wrappers. Split out only to keep
 * both files under the size cap. (ops CLI support module, not app code.)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { type Types } from "mongoose";

import { Customer } from "@/models/Customer";
import { Settings, type ISettings } from "@/models/Settings";
import { stripComments } from "@/lib/source-pin-utils";
import { REWARD_PROGRESS_DEPS, type ProgressOrder, type RewardProgressDeps } from "@/lib/reward-progress";
import type { ProgressRead } from "@/lib/reward-progress-plan";
import type { RewardLevelsConfig } from "@pos/shared/reward-levels";

export type Rec = Record<string, unknown>;

// The ladder: level 1 = size 3 with a box on EVERY step; level 2 = size 2 with a box on each step. So lifetime step
// 1,2,3 = L1 s1..s3 | 4 = L2 s1 | 5 = L2 s2 | 6 = L2 s1 again (the last level repeats, F5) | ...
export const L1_SIZE = 3;
export const L2_SIZE = 2;
export const BLOB: RewardLevelsConfig = {
  v: 1,
  enabled: true,
  levels: [
    {
      size: L1_SIZE,
      slots: [1, 2, 3].map((step) => ({
        step,
        scratchDays: 7,
        useDays: 14,
        options: [{ kind: "bill-percent" as const, id: `a${step}`, weight: 1, min: 5, max: 10 }],
      })),
    },
    {
      size: L2_SIZE,
      slots: [1, 2].map((step) => ({
        step,
        scratchDays: 9,
        useDays: 21,
        options: [{ kind: "bill-flat" as const, id: `b${step}`, weight: 1, min: 20, max: 50 }],
      })),
    },
  ],
};

// The env the real deps run with: a clean object, never process.env (a stray SCRATCH_CARDS_BLOCKED on the box
// cannot flip a result).
export const CLEAN_ENV = {} as unknown as NodeJS.ProcessEnv;
export const DEPS: RewardProgressDeps = { ...REWARD_PROGRESS_DEPS, env: CLEAN_ENV };
export const T0 = new Date("2026-10-01T10:00:00.000Z");
const MS_PER_MIN = 60_000;
export const after = (d: Date, minutes: number): Date => new Date(d.getTime() + minutes * MS_PER_MIN);

// Settings with the blob written STRAIGHT into the collection (the WRITE gate refuses enabled:true while the launch
// lock holds), read back through the model like the routes do.
export async function writeSettings(blob: unknown, extra: Rec = {}): Promise<ISettings> {
  await Settings.collection.deleteMany({});
  await Settings.collection.insertOne({ dinerAccountsEnabled: true, ...(blob === undefined ? {} : { rewardLevels: blob }), ...extra });
  const doc = await Settings.findOne({}).lean();
  assert.ok(doc, "the Settings document exists");
  return doc as unknown as ISettings;
}

let orderSeq = 0;
export const orderAt = (createdAt: Date, total = 250): ProgressOrder => ({ orderId: `LIVE-${String(++orderSeq).padStart(4, "0")}`, createdAt, total });

export const rawOf = async (id: Types.ObjectId): Promise<Rec> => ((await Customer.collection.findOne({ _id: id })) as Rec | null) ?? {};
export const cardsOf = async (id: Types.ObjectId): Promise<Rec[]> => (((await Customer.findById(id).select("+rewardCards").lean()) as Rec | null)?.rewardCards ?? []) as Rec[];

// ── The routes' update shapes, pinned to their source ───────────────────────────────────────────────────────────

const read = (rel: string): string => stripComments(readFileSync(path.join(process.cwd(), rel), "utf8")).replace(/\r\n/g, "\n");
const PIN_ROUTE = "app/api/public/diner/pin/route.ts";
const RESET_ROUTE = "app/api/customers/[id]/diner-pin/route.ts";
const CANCEL_ROUTE = "app/api/orders/[id]/cancel/route.ts";
const SETTLE_ROUTE = "app/api/orders/[id]/settle/route.ts";
const ORDERS_ROUTE = "app/api/orders/route.ts";
const ROUTE_NEEDLES: ReadonlyArray<readonly [string, string]> = [
  [PIN_ROUTE, "{ mobile, pinHash: { $exists: false } }"],
  [PIN_ROUTE, "{ $set: { pinHash, pinSetAt: setAt }, $min: { rewardsAnchorAt: setAt }, $inc: { pinVersion: 1 } }"],
  [RESET_ROUTE, "{ _id: id, pinHash: { $exists: true }, pinSetAt: { $exists: true }, rewardsAnchorAt: { $exists: false } }"],
  [RESET_ROUTE, '[{ $set: { rewardsAnchorAt: "$pinSetAt" } }]'],
  [RESET_ROUTE, '{ $unset: { pinHash: "", pinSetAt: "" }, $inc: { pinVersion: 1 } }'],
  [SETTLE_ROUTE, "runSettleFollowUps(old, updated, settings)"],
  [ORDERS_ROUTE, "runCreateFollowUps({"],
  [CANCEL_ROUTE, 'status: "Cancelled"'],
  [CANCEL_ROUTE, "reconcileLedger(old, updated)"],
];
export function assertRouteShapes(): void {
  for (const [file, needle] of ROUTE_NEEDLES) {
    assert.ok(read(file).includes(needle), `${file} no longer contains ${JSON.stringify(needle)} - this leg's call shape has drifted`);
  }
  // F4: nothing in the cancel route touches the ladder (landmark above: it really is the cancel CAS).
  const cancel = read(CANCEL_ROUTE);
  for (const field of ["cardSteps", "rewardCards", "cardStepOrders", "rewardsAnchorAt"]) {
    assert.equal(cancel.includes(field), false, `the cancel route must not touch ${field}`);
  }
}

// POST /api/public/diner/pin, minus auth/HTTP/hash: the same CAS filter, update and options.
export async function pinSetLikeRoute(mobile: string, setAt: Date): Promise<boolean> {
  const claimed = await Customer.findOneAndUpdate(
    { mobile, pinHash: { $exists: false } },
    { $set: { pinHash: "scratch-hash", pinSetAt: setAt }, $min: { rewardsAnchorAt: setAt }, $inc: { pinVersion: 1 } },
    { new: true },
  )
    .select("name mobile")
    .lean();
  return claimed !== null;
}

// DELETE /api/customers/[id]/diner-pin: the anchor copy, then the reset - in the route's order.
export async function resetLikeRoute(id: Types.ObjectId): Promise<void> {
  await Customer.updateOne(
    { _id: id, pinHash: { $exists: true }, pinSetAt: { $exists: true }, rewardsAnchorAt: { $exists: false } },
    [{ $set: { rewardsAnchorAt: "$pinSetAt" } }],
  );
  await Customer.findOneAndUpdate({ _id: id }, { $unset: { pinHash: "", pinSetAt: "" }, $inc: { pinVersion: 1 } }, { new: true })
    .select("_id")
    .lean();
}

// ── Contention ──────────────────────────────────────────────────────────────────────────────────────────────────

// Deps whose first `n` reads all wait for each other: every racer sees the SAME counter before any of them writes,
// so exactly one wins and the rest must take the classified-retry path. Counts reads/writes for the assertion.
export function barrierDeps(n: number): { deps: RewardProgressDeps; reads: () => number; writes: () => number } {
  let reads = 0;
  let writes = 0;
  let waiting = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const deps: RewardProgressDeps = {
    ...DEPS,
    readProgress: async (customerId): Promise<ProgressRead | null> => {
      reads += 1;
      const mine = reads;
      const value = await REWARD_PROGRESS_DEPS.readProgress(customerId);
      if (mine <= n) {
        waiting += 1;
        if (waiting === n) release();
        await gate;
      }
      return value;
    },
    writeStep: async (filter, update) => {
      writes += 1;
      return REWARD_PROGRESS_DEPS.writeStep(filter, update);
    },
  };
  return { deps, reads: () => reads, writes: () => writes };
}
