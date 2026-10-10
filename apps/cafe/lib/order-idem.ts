// Why a new file: nothing server-side replays an order write by its send key.
// The pure rule (is this the same round? was it cancelled?) is shared with the
// POS in @pos/shared/order-idem; this file is the cafe routes' half — the DB
// lookups and the exact envelope a replay answers with. Replays never claim
// and never write — with ONE exception: a Pay Now sale left unnumbered past
// BILL_NUMBER_SETTLE_MS gets its bill number from the replay (see
// createReplayVerdict). The routes return replays BEFORE their one publish, so
// a replay nudges nothing.
import type { IndexDefinition, IndexOptions, Types, mongo } from "mongoose";
import { Order } from "@/models/Order";
import { success, failure, serverError } from "@pos/shared/api";
import { issueBillNumbers, BILL_NUMBER_UNCONFIRMED } from "@/lib/slip-numbers";
import { billNumberingPlan, planHasWork, type BillNumberingPlan, type NumberableOrder } from "@/lib/gst-invoice";
import type { PrintConfig } from "@/lib/print";
import { idemReplayVerdict, kotRoundOfIdemKey, type IdemLine, type IdemStoredLine } from "@pos/shared/order-idem";

/** The opening items of a new order are always KOT round 1. */
const OPENING_ROUND = 1;
const REPLAY_REFUSED_STATUS = 409;
/** Retryable: the client treats a 5xx as uncertain and its next Send asks again. */
const REPLAY_PENDING_STATUS = 503;
const IDEM_KEY_FIELD = "idemKey";

/**
 * How long a landed Pay Now sale may lack its bill number before a replay
 * numbers it itself. The winning request numbers it inside its own <8 s route,
 * so 30 s is safely past that; before it, a replay only answers "still saving".
 */
export const BILL_NUMBER_SETTLE_MS = 30 * 1000;

/** A Pay Now sale that landed but does not hold its bill number yet. */
export const BILL_NUMBER_PENDING_ERROR = "The sale is still being saved. Tap Send again in a moment.";

/** The slice of an order a replay verdict reads (a lean doc satisfies it). */
interface ReplayableOrder {
  status: string;
  items: ReadonlyArray<IdemStoredLine>;
  voids?: ReadonlyArray<IdemStoredLine>;
  kotIdemKeys?: ReadonlyArray<string>;
  billNumber?: number;
}

function verdictResponse(order: ReplayableOrder, sent: ReadonlyArray<IdemLine>, round: number) {
  const verdict = idemReplayVerdict(order, sent, round);
  return verdict.kind === "replay" ? success(order) : failure(verdict.error, REPLAY_REFUSED_STATUS);
}

/** The round CAS term: a tab that already holds this key cannot take it again. */
export function idemGuardFilter(key: string | undefined): { kotIdemKeys?: { $ne: string } } {
  return key ? { kotIdemKeys: { $ne: key } } : {};
}

/** An E11000 raised by the idemKey unique index (not the orderId one). */
export function isIdemKeyDuplicate(e: unknown): boolean {
  if (typeof e !== "object" || e === null || (e as { code?: unknown }).code !== 11000) return false;
  const kp = (e as { keyPattern?: unknown }).keyPattern;
  return typeof kp === "object" && kp !== null && "idemKey" in kp;
}

type IndexSpec = [IndexDefinition, IndexOptions];

/** The idemKey index exactly as the Order schema declares it (pinned to the ledger's). */
export function idemKeyIndexSpec(schema: { indexes(): IndexSpec[] } = Order.schema): IndexSpec | undefined {
  return schema.indexes().find(([fields]) => Object.keys(fields).length === 1 && IDEM_KEY_FIELD in fields);
}

/** Builds ONLY that index — never the model's whole set, where one conflict fails all. */
export async function createIdemKeyIndex(
  collection: Pick<mongo.Collection, "createIndex">,
  schema?: { indexes(): IndexSpec[] },
): Promise<void> {
  const spec = idemKeyIndexSpec(schema);
  if (!spec) throw new Error("The Order schema declares no idemKey index");
  // Mongoose's index types are a superset of the driver's (direction aliases,
  // `unique: [true, message]`); the declared spec uses neither — the test pins
  // it to { idemKey: 1 } with a plain `unique: true`.
  await collection.createIndex(spec[0] as mongo.IndexSpecification, spec[1] as mongo.CreateIndexesOptions);
}

/**
 * One in-flight run shared by every caller; a success is kept for the
 * process, a failure is dropped so the NEXT call runs again (unlike
 * Model.init(), whose memoized rejection would stand for the instance's life).
 */
export function memoizeUntilFailure(run: () => Promise<void>): () => Promise<void> {
  let memo: Promise<void> | undefined;
  return () => {
    memo ??= Promise.resolve()
      .then(run)
      .catch((error: unknown) => {
        memo = undefined;
        throw error;
      });
    return memo;
  };
}

/**
 * autoIndex is not awaited by connectDB(): a cold-start pair of same-key
 * inserts racing the index build would both land, and the deferred build would
 * then fail and leave the index absent for good. So the first keyed lookup
 * builds the idemKey index itself, once per process.
 */
export const ensureIdemKeyIndex = memoizeUntilFailure(() => createIdemKeyIndex(Order.collection));

export interface CreateReplayDeps<T> {
  ensureIndex(): Promise<unknown>;
  findByKey(key: string): Promise<T | null>;
}

const CREATE_REPLAY_DEPS = {
  ensureIndex: ensureIdemKeyIndex,
  findByKey: (key: string) => Order.findOne({ idemKey: key }).lean(),
};

/**
 * The order this key already made, or null when the key is new. The index
 * ensure runs first, but its failure is NOT the create's: the lookup still
 * covers every sequential re-send, and the next request retries the ensure.
 */
export function findCreateReplay(key: string): ReturnType<typeof CREATE_REPLAY_DEPS.findByKey>;
export function findCreateReplay<T>(key: string, deps: CreateReplayDeps<T>): Promise<T | null>;
export async function findCreateReplay(
  key: string,
  deps: CreateReplayDeps<unknown> = CREATE_REPLAY_DEPS,
): Promise<unknown> {
  await deps.ensureIndex().catch(() => undefined);
  return deps.findByKey(key);
}

/** The slice of a create replay the numbering rule reads (a lean Order satisfies it). */
interface CreateReplayableOrder extends ReplayableOrder, NumberableOrder {
  _id: Types.ObjectId | string;
  updatedAt?: Date | string;
}

/** The two bill settings the rule reads — `printConfigOf(settings).bill`, as the insert winner reads them. */
type BillNumbering = Pick<PrintConfig["bill"], "showNumber" | "numberStart" | "resetMinutes">;

export interface ReplayNumberingDeps {
  now(): number;
  issueBillNumbers(id: Types.ObjectId | string, plan: BillNumberingPlan): Promise<unknown>;
}

const REPLAY_NUMBERING_DEPS: ReplayNumberingDeps = { now: () => Date.now(), issueBillNumbers };

/**
 * Past the settle window by the SERVER clock, counted from the order's LAST write (the later of createdAt and
 * updatedAt): a tab opened long ago that a settle just landed on is still being numbered by that settle (S10 review
 * M1). An unknown or unreadable time counts as young (never numbered).
 */
function settled(order: { createdAt?: Date | string; updatedAt?: Date | string }, now: number): boolean {
  const writes = [order.createdAt, order.updatedAt].filter((at) => at !== undefined).map((at) => new Date(at).getTime());
  const age = writes.length === 0 ? Number.NaN : now - Math.max(...writes);
  return age >= BILL_NUMBER_SETTLE_MS;
}

/**
 * The create replay's answer: 200 with the order, or a 409 when it was
 * cancelled / no longer matches this send. A numbered cafe's Pay Now sale is
 * numbered only AFTER its insert won, so a read in that gap finds no bill
 * number yet:
 *  - YOUNG (under BILL_NUMBER_SETTLE_MS): the winner may still be numbering it,
 *    and a second draw here would skip a number — answer the retryable 503.
 *  - OLDER: the winner's route is long over and its numbering failed (or the
 *    sale predates numbering being switched on), so the replay finishes it with
 *    the guarded issueBillNumbers, whose $exists:false sets cannot double-number.
 * Never a 200 that would print an unnumbered bill.
 */
export async function createReplayVerdict(
  order: CreateReplayableOrder,
  sent: ReadonlyArray<IdemLine>,
  bill: BillNumbering,
  deps: ReplayNumberingDeps = REPLAY_NUMBERING_DEPS,
) {
  // The insert winner's own rule (lib/gst-invoice): the daily bill number and a GST bill's invoice serial.
  const plan = billNumberingPlan(order, bill);
  if (!planHasWork(plan) || idemReplayVerdict(order, sent, OPENING_ROUND).kind !== "replay") {
    return verdictResponse(order, sent, OPENING_ROUND);
  }
  if (!settled(order, deps.now())) return failure(BILL_NUMBER_PENDING_ERROR, REPLAY_PENDING_STATUS);
  let numbered: unknown;
  try {
    numbered = await deps.issueBillNumbers(order._id, plan);
  } catch (error) {
    return serverError(BILL_NUMBER_UNCONFIRMED, error);
  }
  return numbered ? success(numbered) : failure(BILL_NUMBER_PENDING_ERROR, REPLAY_PENDING_STATUS);
}

/** Lookup + verdict in one, for a re-check after a lost claim or insert; null when the key is new. */
export async function createReplayResponse(key: string, sent: ReadonlyArray<IdemLine>, bill: BillNumbering) {
  const order = await findCreateReplay(key);
  return order ? createReplayVerdict(order, sent, bill) : null;
}

/** The round replay against a tab already read: null when this key never fired on it. */
export function roundReplayResponse(order: ReplayableOrder, key: string, sent: ReadonlyArray<IdemLine>) {
  const round = kotRoundOfIdemKey(order, key);
  return round === undefined ? null : verdictResponse(order, sent, round);
}

/** After a lost claim or CAS: re-read the tab once — did our own twin land this key? */
export async function roundReplayAfterMiss(id: string | Types.ObjectId, key: string, sent: ReadonlyArray<IdemLine>) {
  const order = await Order.findById(id).lean();
  return order ? roundReplayResponse(order, key, sent) : null;
}
