/**
 * CB-7 S5 live legs of verify-reward-card-use-live.ts (kit file: the harness). (ops CLI support module, not app code.)
 *
 * Every leg drives the REAL route handlers (POST /api/orders, /items, /settle, /cancel, /items/void, /table, PUT
 * /api/orders/[id], POST /api/public/order-request, POST /api/order-requests/[id]/accept) with only the things a script
 * cannot have swapped: `@/lib/auth` (a signed-in admin), `botid/server` (never a bot), `next/headers` (the diner cookie)
 * and `next/server`'s `after` (needs a Next request scope). Validators, fences, claims and writes are the product's own.
 */
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import mongoose from "mongoose";

import { Customer } from "@/models/Customer";
import { Category } from "@/models/Category";
import { Product } from "@/models/Product";
import { Table } from "@/models/Table";
import { Order } from "@/models/Order";
import { Settings } from "@/models/Settings";
import { DinerSession } from "@/models/DinerSession";
import { PublicRateLimit } from "@/models/PublicRateLimit";
import { invalidateSettingsCache } from "@/lib/settings";
import { updateSettingsSchema } from "@/schemas";
import { LOYALTY_RULES_SCHEMA_VERSION } from "@pos/shared/loyalty-rules";
import type { RewardCardSnapshot } from "@pos/shared/reward-levels";
import { card as engineCard, newCustomer } from "./reward-levels-live-kit";

export type Rec = Record<string, unknown>;
export type Res = { status: number; body: { success: boolean; data?: Rec; error?: string } };
export type Scenario = (id: string, name: string, fn: () => Promise<void>) => Promise<void>;
// What every leg file receives from the main script.
export interface Ctx { api: Api; menu: Menu; scenario: Scenario }

export const STAFF_ID = "665f0000000000000000beef";
export const TABLE_TOKEN_1 = "7K3M9P2Q4R5S6T";
export const TABLE_TOKEN_2 = "8K3M9P2Q4R5S6T";
export const PROMO_CODE = "FLAT50";
export const RUNG_AT = 8;
const MS_PER_HOUR = 3_600_000;
const USE_BY_HOURS = 72;
const SESSION_HOURS = 24;
const BIG_CATEGORY_PRODUCTS = 201;
const GST_RATE = 5;

// ── Stubs ──────────────────────────────────────────────────────────────────────────────────────────────────────

const jar: { token: string | null } = { token: null };
/** The diner cookie the next call carries (null = signed out). */
export const setDinerCookie = (token: string | null): void => {
  jar.token = token;
};

export function installStubs(): void {
  const file = path.join(__dirname, "..", "lib", "auth.ts");
  const stub = new Module(file);
  stub.filename = file;
  stub.loaded = true;
  stub.exports = {
    auth: async () => ({ user: { id: STAFF_ID, name: "Live leg", role: "admin" } }),
    handlers: {},
    signIn: async () => undefined,
    signOut: async () => undefined,
  };
  require.cache[file] = stub;
  const loader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
  const real = loader._load;
  loader._load = function (this: unknown, request: string, parent: unknown, isMain: boolean): unknown {
    if (request === "botid/server") return { checkBotId: async () => ({ isBot: false }) };
    if (request === "next/headers") {
      return { cookies: async () => ({ get: () => (jar.token ? { value: jar.token } : undefined), set: () => undefined, delete: () => undefined }) };
    }
    const loaded = real.call(this, request, parent, isMain);
    if (request === "next/server") return { ...(loaded as Rec), after: () => undefined };
    return loaded;
  };
}

// ── The call shapes (what the POS / the diner phone / the staff tray send) ─────────────────────────────────────

type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const idp = (id: string) => ({ params: Promise.resolve({ id }) });
async function answer(pending: Response | Promise<Response>): Promise<Res> {
  const res = await pending;
  return { status: res.status, body: (await res.json()) as Res["body"] };
}
const jsonReq = (method: string, url: string, body: unknown): Request =>
  new Request(`http://127.0.0.1${url}`, { method, headers: { "content-type": "application/json", host: "127.0.0.1" }, body: JSON.stringify(body) });

export interface Line { productId: string; name: string; price: number; qty: number; variation?: string }
export interface Api {
  create: (body: Rec) => Promise<Res>;
  addRound: (id: string, body: Rec) => Promise<Res>;
  settle: (id: string, body: Rec) => Promise<Res>;
  cancel: (id: string, reason: string) => Promise<Res>;
  put: (id: string, body: Rec) => Promise<Res>;
  voidLine: (id: string, body: Rec) => Promise<Res>;
  moveTable: (id: string, tableNo: string | null) => Promise<Res>;
  submitQr: (body: Rec) => Promise<Res>;
  accept: (requestId: string) => Promise<Res>;
}

export async function loadApi(): Promise<Api> {
  const create = await import("@/app/api/orders/route");
  const items = await import("@/app/api/orders/[id]/items/route");
  const settle = await import("@/app/api/orders/[id]/settle/route");
  const cancel = await import("@/app/api/orders/[id]/cancel/route");
  const one = await import("@/app/api/orders/[id]/route");
  const voidRoute = await import("@/app/api/orders/[id]/items/void/route");
  const table = await import("@/app/api/orders/[id]/table/route");
  const pub = await import("@/app/api/public/order-request/route");
  const accept = await import("@/app/api/order-requests/[id]/accept/route");
  const at = (handler: Handler, method: string, url: string, id: string, body: unknown) => answer(handler(jsonReq(method, url, body), idp(id)));
  return {
    create: (body) => answer(create.POST(jsonReq("POST", "/api/orders", body))),
    addRound: (id, body) => at(items.POST, "POST", `/api/orders/${id}/items`, id, body),
    settle: (id, body) => at(settle.POST, "POST", `/api/orders/${id}/settle`, id, body),
    cancel: (id, reason) => at(cancel.POST, "POST", `/api/orders/${id}/cancel`, id, { reason }),
    put: (id, body) => at(one.PUT, "PUT", `/api/orders/${id}`, id, body),
    voidLine: (id, body) => at(voidRoute.POST, "POST", `/api/orders/${id}/items/void`, id, body),
    moveTable: (id, tableNo) => at(table.POST, "POST", `/api/orders/${id}/table`, id, { tableNo }),
    submitQr: async (body) => {
      await PublicRateLimit.deleteMany({});
      return answer(pub.POST(jsonReq("POST", "/api/public/order-request", body)));
    },
    accept: (requestId) => at(accept.POST, "POST", `/api/order-requests/${requestId}/accept`, requestId, {}),
  };
}

// ── Menu, tables, settings ─────────────────────────────────────────────────────────────────────────────────────

export interface Menu {
  bev: string; snack: string; big: string;
  coffee: string; tea: string; cake: string; brownie: string; muffin: string;
}
export const line = (productId: string, name: string, price: number, qty = 1, variation?: string): Line => ({ productId, name, price, qty, ...(variation ? { variation } : {}) });
export const COFFEE_REGULAR = 120;
export const COFFEE_LARGE = 180;
export const coffeeLines = (menu: Menu): Line[] => [line(menu.coffee, "Cold Coffee", COFFEE_REGULAR, 1, "Regular"), line(menu.coffee, "Cold Coffee", COFFEE_LARGE, 1, "Large")];

export async function seedMenu(): Promise<Menu> {
  const bev = await Category.create({ name: "Beverages", order: 1 });
  const snack = await Category.create({ name: "Snacks", order: 2 });
  const big = await Category.create({ name: "Bulk", order: 3 });
  const mk = async (name: string, categoryId: unknown, price: number, extra: Rec = {}): Promise<string> =>
    String((await Product.create({ name, categoryId, price, discount: 0, available: true, isActive: true, image: "", modifiers: [], ...extra }))._id);
  const coffee = await mk("Cold Coffee", bev._id, COFFEE_REGULAR, { variations: [{ name: "Regular", price: COFFEE_REGULAR }, { name: "Large", price: COFFEE_LARGE }] });
  const tea = await mk("Masala Tea", bev._id, 100);
  const cake = await mk("Cake", snack._id, 100);
  const brownie = await mk("Brownie", snack._id, 150);
  const muffin = await mk("Muffin", snack._id, 80);
  await Table.create([
    { tableNo: "T1", status: "Available", publicToken: TABLE_TOKEN_1 },
    { tableNo: "T2", status: "Available", publicToken: TABLE_TOKEN_2 },
  ]);
  return { bev: String(bev._id), snack: String(snack._id), big: String(big._id), coffee, tea, cake, brownie, muffin };
}

/** 201 cheap products in the "Bulk" category: past REWARD_SCOPE_PRODUCTS_MAX. Returns the ids so the leg can remove them. */
export async function fillBigCategory(menu: Menu): Promise<void> {
  const rows = Array.from({ length: BIG_CATEGORY_PRODUCTS }, (_, i) => ({ name: `Bulk ${i}`, categoryId: menu.big, price: 10, discount: 0, available: true, isActive: true, image: "", modifiers: [] }));
  await Product.insertMany(rows);
}
export const emptyBigCategory = (menu: Menu) => Product.deleteMany({ categoryId: menu.big });

export interface SettingsOpts { accounts?: boolean; levels?: boolean; gst?: boolean; blocked?: boolean; rungMinBill?: number; oncePromo?: boolean }
export const TN_GSTIN = "33ABCDE1234F1Z5";
/** Diner accounts ON + levels enabled + a flat Rs 100 rung at 8 stamps + the FLAT50 promo; options flip one thing. */
export async function seedSettings(opts: SettingsOpts = {}): Promise<Rec> {
  await Settings.deleteMany({});
  const parsed = updateSettingsSchema.safeParse({
    loyaltyRules: { v: LOYALTY_RULES_SCHEMA_VERSION, unitLabel: "stamp", milestones: [{ at: RUNG_AT, kind: "flat", value: 100, item: "", ...(opts.rungMinBill ? { minBill: opts.rungMinBill } : {}) }] },
    promoCodes: [{ code: PROMO_CODE, kind: "flat", value: 50, active: true, ...(opts.oncePromo ? { oncePerCustomer: true } : {}) }],
    ...(opts.gst ? { gstEnabled: true, gstNumber: "", gstRate: GST_RATE, gstMode: "exclusive" as const } : {}),
  });
  assert.ok(parsed.success, `settings fixture must parse: ${parsed.success ? "" : JSON.stringify(parsed.error.flatten())}`);
  await Settings.findOneAndUpdate({}, parsed.data, { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true });
  const level = { size: 3, slots: [{ step: 1, scratchDays: 7, useDays: 14, options: [{ kind: "bill-percent", id: "a1", weight: 1, min: 5, max: 10 }] }] };
  await Settings.collection.updateOne({}, { $set: {
    dinerAccountsEnabled: opts.accounts !== false,
    rewardLevels: { v: 1, enabled: opts.levels !== false, levels: [level] },
    ...(opts.blocked ? { gstNumber: TN_GSTIN } : {}),
  } });
  invalidateSettingsCache();
  return ((await Settings.collection.findOne({})) ?? {}) as Rec;
}

// ── Diners, cards, readers ─────────────────────────────────────────────────────────────────────────────────────

export interface Diner { id: string; mobile: string }
export const hoursFromNow = (h: number): Date => new Date(Date.now() + h * MS_PER_HOUR);

/** A REVEALED card from the real engine, outcome overridden. `over.validUntil` also moves keepUntil (it follows it). */
export function revealed(over: Partial<RewardCardSnapshot> = {}): RewardCardSnapshot {
  const validUntil = over.validUntil ?? hoursFromNow(USE_BY_HOURS);
  return { ...engineCard({}, new Date()), status: "revealed", revealedAt: hoursFromNow(-1), kind: "bill-flat", value: 100, ...over, validUntil, keepUntil: validUntil };
}
export async function diner(cards: RewardCardSnapshot[], extra: Rec = {}): Promise<Diner> {
  const id = await newCustomer(cards, extra);
  const row = (await Customer.collection.findOne({ _id: id })) as Rec;
  return { id: String(id), mobile: String(row.mobile) };
}
export async function dinerSession(d: Diner): Promise<string> {
  const token = `live${Math.random().toString(36).slice(2, 12)}`;
  await DinerSession.create({ _id: token, customerId: d.id, mobile: d.mobile, at: new Date(), expiresAt: hoursFromNow(SESSION_HOURS) });
  return token;
}
export const rawOrder = async (id: string): Promise<Rec> => ((await Order.collection.findOne({ _id: new mongoose.Types.ObjectId(id) })) ?? {}) as Rec;
export const ordersOf = (customerId: string) => Order.collection.countDocuments({ customerId: new mongoose.Types.ObjectId(customerId) });
export async function cardOf(d: Diner, cardId: string): Promise<Rec> {
  const row = (await Customer.collection.findOne({ _id: new mongoose.Types.ObjectId(d.id) })) as Rec | null;
  const found = ((row?.rewardCards ?? []) as Rec[]).find((c) => c.id === cardId);
  assert.ok(found, `landmark: card ${cardId} is on the diner's row`);
  return found;
}
/** The card is exactly as seeded: revealed, nothing spent on it. (The positive landmark is `status === "revealed"`.) */
export async function assertCardUntouched(d: Diner, c: RewardCardSnapshot, what: string): Promise<void> {
  const stored = await cardOf(d, c.id);
  assert.equal(stored.status, "revealed", `${what}: the card must still be revealed`);
  for (const key of ["usedAt", "orderId"]) assert.equal(key in stored, false, `${what}: the card must carry no ${key}`);
  assert.deepEqual(stored.keepUntil, c.validUntil, `${what}: keepUntil must still equal validUntil`);
}

// ── Open-tab and race helpers ──────────────────────────────────────────────────────────────────────────────────

/** The counter's create for an open tab, exactly the POS shape: Unpaid / Pending, money echoed (the server re-prices). */
export function tabBody(d: Diner | null, lines: Line[], extra: Rec = {}): Rec {
  const sum = lines.reduce((s, l) => s + l.price * l.qty, 0);
  return { customerName: "Card Diner", ...(d ? { customerId: d.id } : {}), items: lines, subtotal: sum, discount: 0, total: sum, paidAmount: 0, payment: "Unpaid", status: "Pending", receiver: "Live leg", ...extra };
}
export async function openTab(api: Api, d: Diner | null, lines: Line[], extra: Rec = {}): Promise<string> {
  const res = await api.create(tabBody(d, lines, extra));
  assert.equal(res.status, 201, `fixture: the counter create must open the tab (got ${res.status}: ${res.body.error ?? ""})`);
  return String(res.body.data!._id);
}
/** The POS add-round payload (use-pos-tab): the live discount (the reward preview while a pick is made), kind null, no extras. */
export function roundBody(lines: Line[], extra: Rec = {}): Rec {
  return { items: lines, discount: 0, discountKind: null, extraCharges: [], ...extra };
}
/** The POS settle payload (use-pos-tab settlePayload): the stored discount echoed, kind null, the tab's own echoes. */
export function settleBody(tab: Rec, extra: Rec = {}): Rec {
  return { payment: "Cash", discount: tab.discount ?? 0, discountKind: null, expectedTotal: tab.total, expectedVoids: 0, ...extra };
}

type Updater = (filter: Rec, ...rest: unknown[]) => unknown;
/**
 * Runs `before` (once per card CLAIM) after the claim's inputs are fixed and just BEFORE its CAS executes: a concurrent
 * writer landing in the real window between the route's read and its writes. Only a claim (an `$elemMatch` of a
 * revealed card) is held; every other Customer.updateOne passes straight through. Returns the restore function.
 */
export function beforeCardClaim(before: () => Promise<void>): () => void {
  const model = Customer as unknown as { updateOne: Updater };
  const real = model.updateOne.bind(Customer);
  model.updateOne = (filter, ...rest) => {
    const match = (filter.rewardCards as { $elemMatch?: Rec } | undefined)?.$elemMatch;
    return match?.status === "revealed" ? before().then(() => real(filter, ...rest)) : real(filter, ...rest);
  };
  return () => {
    model.updateOne = real;
  };
}
/** A barrier for n racers: every call waits until n have arrived. */
export function barrier(n: number): () => Promise<void> {
  let arrived = 0;
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (open = resolve));
  return async () => {
    arrived += 1;
    if (arrived >= n) open();
    await gate;
  };
}
