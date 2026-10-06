/**
 * Print customization S8 live legs T1..T11 - the token board through the REAL routes. verify-token-live.ts owns the
 * scratch-prefix guard, the admin auth stub (seeded in the CJS cache BEFORE the routes load), the Product/Settings
 * fixtures and the final dropDatabase; it hands the loaded routes and its check() to runTokenBoardLegs(). (Console output is intentional.)
 */
import mongoose from "mongoose";
import { Order } from "@/models/Order";
import { KotTick } from "@/models/KotTick";
import { Settings } from "@/models/Settings";
import { invalidateSettingsCache } from "@/lib/settings";
import { slipDayStart } from "@pos/shared/slip-day";
import { MINUTES_PER_DAY, istMinuteOf } from "./verify-token-live-clock";

export type Check = (label: string, ok: boolean) => void;
export interface Routes {
  create: typeof import("@/app/api/orders/route");
  settle: typeof import("@/app/api/orders/[id]/settle/route");
  cancel: typeof import("@/app/api/orders/[id]/cancel/route");
  items: typeof import("@/app/api/orders/[id]/items/route");
  kitchen: typeof import("@/app/api/kitchen/route");
  tokens: typeof import("@/app/api/tokens/route");
  tokenId: typeof import("@/app/api/tokens/[id]/route");
  settings: typeof import("@/app/api/settings/route");
}
type Res<T = unknown> = { status: number; body: { success: boolean; data?: T; error?: string } };
type Card = { orderId: string; tokenNumber?: number; newestFiredAt: string; lines: Array<{ ref: string }> };
type Entry = { id: string; number: number; firedAt: string; readySince?: string };
type Board = { enabled: boolean; preparing: Entry[]; ready: Entry[]; generatedAt: string };
type Order1 = { _id: string; tokenNumber?: number };

export const PRODUCT_ID = "665f000000000000000000a1";
export const PRODUCT_PRICE = 120;
const SECRET_NAME = "Zxq Secret Diner";
const MINUTE = 60_000;
const NEAR_NOW_MS = 5_000;
const STALE_MINUTES = 120;
let baseReset = 0; // the restart time the setup chose (read at the start of the run); T6 / T11 put it back
const KITCHEN_SELECT_FIELDS = "orderId items kotRounds kotNumbers kotFiredAt tableNo parcel notes source createdAt".split(" ");

let r: Routes;
let ck: Check;
const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
const oid = (id: string) => new mongoose.Types.ObjectId(id);
const req = (method: string, url: string, body?: unknown) =>
  new Request(`http://live.test${url}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
async function answer<T>(pending: Response | Promise<Response>): Promise<Res<T>> {
  const res = await pending;
  return { status: res.status, body: (await res.json()) as Res<T>["body"] };
}
const lineOf = (qty = 1) => ({ productId: PRODUCT_ID, name: "Tea", price: PRODUCT_PRICE, qty });
async function create(extra: Record<string, unknown> = {}): Promise<{ id: string; token?: number; status: number }> {
  const payload = { customerName: SECRET_NAME, items: [lineOf()], subtotal: PRODUCT_PRICE, total: PRODUCT_PRICE, payment: "Unpaid", status: "Pending", receiver: "Live leg", ...extra };
  const out = await answer<Order1>(await r.create.POST(req("POST", "/api/orders", payload)));
  return { id: String(out.body.data?._id), token: out.body.data?.tokenNumber, status: out.status };
}
const payNow = () => create({ payment: "Cash", status: "Completed" });
const idp = (id: string) => ({ params: Promise.resolve({ id }) });
const addRound = (id: string) => answer(r.items.POST(req("POST", `/api/orders/${id}/items`, { items: [lineOf()] }), idp(id)));
const settleOrder = (id: string) => answer(r.settle.POST(req("POST", `/api/orders/${id}/settle`, { payment: "Cash" }), idp(id)));
const cancelOrder = (id: string) => answer(r.cancel.POST(req("POST", `/api/orders/${id}/cancel`, { reason: "Live leg cancel" }), idp(id)));
const kitchenCards = async (): Promise<Card[]> => (await answer<{ cards: Card[] }>(await r.kitchen.GET())).body.data?.cards ?? [];
const cardOf = async (id: string) => (await kitchenCards()).find((c) => c.orderId === id);
const boardRes = async () => answer<Board>(await r.tokens.GET());
const board = async (): Promise<Board> => (await boardRes()).body.data as Board;
const where = async (id: string): Promise<"preparing" | "ready" | "none"> => {
  const b = await board();
  return b.preparing.some((e) => e.id === id) ? "preparing" : b.ready.some((e) => e.id === id) ? "ready" : "none";
};
const entryOf = async (id: string) => { const b = await board(); return [...b.preparing, ...b.ready].find((e) => e.id === id); };
const kitchenPost = (body: unknown) => answer(r.kitchen.POST(req("POST", "/api/kitchen", body)));
const tokenPost = (id: string, body: unknown) => answer(r.tokenId.POST(req("POST", `/api/tokens/${id}`, body), idp(id)));
async function setSettings(patch: Record<string, unknown>): Promise<void> {
  await Settings.updateOne({}, { $set: patch });
  invalidateSettingsCache();
}
const rawOrder = (id: string) => Order.collection.findOne({ _id: oid(id) });
async function backdate(id: string, minutes: number): Promise<void> {
  const doc = await rawOrder(id);
  const shift = (d: Date) => new Date(d.getTime() - minutes * MINUTE);
  const $set: Record<string, unknown> = { createdAt: shift(doc!.createdAt as Date) };
  if (Array.isArray(doc!.kotFiredAt)) $set.kotFiredAt = (doc!.kotFiredAt as Date[]).map(shift);
  await Order.collection.updateOne({ _id: oid(id) }, { $set });
}
const tickOf = (id: string) => KotTick.collection.findOne({ _id: id as unknown as mongoose.Types.ObjectId });
const nearNow = (iso: string | undefined) => iso !== undefined && Math.abs(Date.now() - new Date(iso).getTime()) < NEAR_NOW_MS;

async function t1(): Promise<string> {
  console.log("T1 Pay Now token order (tokens on)");
  const o = await payNow();
  const card = await cardOf(o.id);
  const b = await board();
  const entry = b.preparing.find((e) => e.id === o.id);
  ck("201 with a token number; Kitchen GET card carries the same tokenNumber", o.status === 201 && typeof o.token === "number" && card?.tokenNumber === o.token);
  ck("GET /api/tokens lists it in preparing with its number", entry?.number === o.token && !b.ready.some((e) => e.id === o.id));
  ck("entry keys are exactly {id, number, firedAt}", JSON.stringify(Object.keys(entry ?? {}).sort()) === JSON.stringify(["firedAt", "id", "number"]));
  const raw = JSON.stringify(b);
  const leaked = ["customerName", "total", "items", "subtotal", "paidAmount", "receiver", SECRET_NAME, '"Tea"'].filter((s) => raw.includes(s));
  ck("board top-level keys are exactly enabled/preparing/ready/generatedAt", JSON.stringify(Object.keys(b).sort()) === JSON.stringify(["enabled", "generatedAt", "preparing", "ready"]));
  ck(`landmark: the order really holds that customerName and the board does carry "number"`, (await rawOrder(o.id))?.customerName === SECRET_NAME && raw.includes('"number"'));
  ck(`no customerName/total/items/name leak anywhere in the stringified board (leaked: ${leaked.join(",") || "none"})`, leaked.length === 0);
  return o.id;
}

async function t2(id: string): Promise<void> {
  console.log("T2 Kitchen Ready on an order back-dated 15 min - the clear timer runs from the mark (K2)");
  await backdate(id, 15);
  const card = await cardOf(id);
  ck("landmark: back-dated card still on Kitchen GET before Ready", card !== undefined && Date.now() - new Date(card.newestFiredAt).getTime() > 14 * MINUTE);
  const res = await kitchenPost({ action: "ready", orderId: id, ready: true, seenFiredAt: card!.newestFiredAt });
  const entry = (await board()).ready.find((e) => e.id === id);
  const tick = await tickOf(id);
  ck("Kitchen POST ready 200; the card leaves Kitchen GET", res.status === 200 && (await cardOf(id)) === undefined);
  ck("board lists it in ready (not preparing) with readySince within seconds of now", entry !== undefined && nearNow(entry.readySince) && (await where(id)) === "ready");
  ck("firedAt on the entry is still the old (15 min) fire instant; readyAt old, readyMarkedAt ~ now", Date.now() - new Date(entry!.firedAt).getTime() > 14 * MINUTE && Date.now() - (tick?.readyAt as Date).getTime() > 14 * MINUTE && nearNow((tick?.readyMarkedAt as Date).toISOString()));
}

async function t3(id: string): Promise<void> {
  console.log("T3 Collected / uncollected");
  const done = await tokenPost(id, { action: "collected" });
  const gone = await where(id);
  const undo = await tokenPost(id, { action: "uncollected" });
  ck("collected 200 -> gone from both lists", done.status === 200 && gone === "none");
  ck("uncollected 200 -> back in ready; collectedAt $unset (field absent, not null)", undo.status === 200 && (await where(id)) === "ready" && !("collectedAt" in ((await tickOf(id)) ?? {})));
}

async function t4(id: string): Promise<void> {
  console.log("T4 Clear-after: default 10 minutes, then 20 through the real PUT /api/settings");
  const markAgo = (min: number) => KotTick.updateOne({ _id: id }, { $set: { readyMarkedAt: new Date(Date.now() - min * MINUTE) } });
  await markAgo(9);
  ck("landmark: marked 9 min ago is still ready (default 10)", (await where(id)) === "ready");
  await markAgo(11);
  ck("marked 11 min ago -> hidden from the board", (await where(id)) === "none");
  ck("the clear is board-only: the kitchen card stays gone", (await cardOf(id)) === undefined);
  const put = await answer(r.settings.PUT(req("PUT", "/api/settings", { tokenReadyClearMinutes: 20 })));
  ck("PUT /api/settings {tokenReadyClearMinutes: 20} 200 -> the same token is visible again", put.status === 200 && (await where(id)) === "ready");
}

async function t5(): Promise<void> {
  console.log("T5 Cancel route (admin)");
  const o = await payNow();
  ck("landmark: a fresh Pay Now order is on Kitchen GET and preparing", (await cardOf(o.id)) !== undefined && (await where(o.id)) === "preparing");
  const res = await cancelOrder(o.id);
  ck("cancel 200, order Cancelled", res.status === 200 && (await rawOrder(o.id))?.status === "Cancelled");
  ck("gone from Kitchen GET and from the board", (await cardOf(o.id)) === undefined && (await where(o.id)) === "none");
  const after = await tokenPost(o.id, { action: "ready" });
  ck("POST /api/tokens/[id] ready -> 404", after.status === 404 && !(await tickOf(o.id)));
}

async function t6(): Promise<void> {
  console.log("T6 Business-day window follows numberResetMinutes (restart times chosen from the clock)");
  // Paid orders older than 2 h are stale-hidden whatever the window says, so the window is proved with instants inside the
  // last 2 h at ANY hour: a restart time whose day began 60 min ago, and one 2 min later.
  const lo = { reset: istMinuteOf(Date.now() - 60 * MINUTE) };
  const hi = { reset: (lo.reset + 2) % MINUTES_PER_DAY };
  await setSettings({ numberResetMinutes: lo.reset });
  const [loAt, hiAt] = [slipDayStart(new Date(), lo.reset), slipDayStart(new Date(), hi.reset)];
  const [today, old] = [await payNow(), await payNow()];
  await Order.collection.updateOne({ _id: oid(old.id) }, { $set: { createdAt: new Date(loAt.getTime() - 20 * MINUTE) } });
  ck("landmark: today's order is on Kitchen GET and the board", (await cardOf(today.id)) !== undefined && (await where(today.id)) === "preparing");
  const oldDoc = await rawOrder(old.id);
  ck("landmark: the earlier order is Completed and under 2 h old, so only the window can exclude it", oldDoc?.status === "Completed" && Date.now() - (oldDoc.createdAt as Date).getTime() < STALE_MINUTES * MINUTE);
  ck("an order created 20 min before the day's start is excluded from both", (await cardOf(old.id)) === undefined && (await where(old.id)) === "none");
  ck(`the two windows differ (starts ${loAt.toISOString()} vs ${hiAt.toISOString()})`, loAt.getTime() < hiAt.getTime());
  await Order.collection.updateOne({ _id: oid(old.id) }, { $set: { createdAt: new Date((loAt.getTime() + hiAt.getTime()) / 2) } });
  await setSettings({ numberResetMinutes: hi.reset });
  ck(`createdAt strictly between the starts: the later window (reset ${hi.reset}) excludes it`, (await cardOf(old.id)) === undefined && (await where(old.id)) === "none");
  await setSettings({ numberResetMinutes: lo.reset });
  ck(`the earlier window (reset ${lo.reset}) includes it, on Kitchen GET and on the board`, (await cardOf(old.id)) !== undefined && (await where(old.id)) === "preparing");
  await setSettings({ numberResetMinutes: baseReset });
}

type Call = { coll: string; method: string; args: unknown[] };
async function capture(fn: () => Promise<void>): Promise<Call[]> {
  const calls: Call[] = [];
  mongoose.set("debug", (coll: string, method: string, ...args: unknown[]) => { calls.push({ coll, method, args }); });
  try { await fn(); } finally { mongoose.set("debug", false); }
  return calls;
}

async function t7(): Promise<void> {
  console.log("T7 Tokens OFF - the kitchen query is exactly today's");
  const paid = await payNow();
  const tab = await create({ customerName: "Plain tab" });
  await setSettings({ tokenEnabled: false });
  const calls = await capture(async () => { await kitchenCards(); });
  const orderFinds = calls.filter((c) => c.coll === "orders");
  const [filter, options] = (orderFinds[0]?.args ?? []) as [unknown, Record<string, unknown> | undefined];
  const projection = (options?.projection ?? {}) as Record<string, number>;
  ck("exactly one orders query, a find", orderFinds.length === 1 && orderFinds[0].method === "find");
  ck("filter is exactly {status:Pending, payment:Unpaid, kotRounds:{$gte:1}} (key for key)", JSON.stringify(filter) === JSON.stringify({ status: "Pending", payment: "Unpaid", kotRounds: { $gte: 1 } }));
  ck("projection is the KITCHEN_ORDER_SELECT fields incl. parcel, no tokenNumber", JSON.stringify(Object.keys(projection).sort()) === JSON.stringify([...KITCHEN_SELECT_FIELDS].sort()) && "parcel" in projection && !("tokenNumber" in projection));
  ck("sort {createdAt:1}, limit 100", JSON.stringify(options?.sort) === JSON.stringify({ createdAt: 1 }) && options?.limit === 100);
  ck("exactly one kotticks find", calls.filter((c) => c.coll === "kotticks").length === 1 && calls.filter((c) => c.coll === "kotticks")[0].method === "find");
  ck("landmark: the open tab's card is on the board, the paid token order's is not", (await cardOf(tab.id)) !== undefined && (await cardOf(paid.id)) === undefined);
  const post = await kitchenPost({ action: "ready", orderId: paid.id, ready: true });
  ck("Kitchen POST ready on the paid token order -> 404, nothing written", post.status === 404 && !(await tickOf(paid.id)));
  let res: Res<Board> | undefined;
  const boardCalls = await capture(async () => { res = await boardRes(); });
  ck("GET /api/tokens -> enabled:false, empty lists, and no orders query", res?.body.data?.enabled === false && res.body.data.preparing.length === 0 && boardCalls.filter((c) => c.coll === "orders").length === 0);
  await setSettings({ tokenEnabled: true });
}

async function t8(): Promise<void> {
  console.log("T8 Races, both directions, and concurrent upserts");
  const a = await payNow();
  await tokenPost(a.id, { action: "ready" });
  await sleep(5);
  await tokenPost(a.id, { action: "collected" });
  ck("ready then collected -> hidden", (await where(a.id)) === "none");
  await sleep(5);
  await tokenPost(a.id, { action: "ready" });
  ck("then a LATER ready mark -> ready again (collectedAt still stored, older)", (await where(a.id)) === "ready" && (await tickOf(a.id))?.collectedAt !== undefined);
  const b = await payNow();
  await tokenPost(b.id, { action: "collected" });
  ck("landmark: collected before any ready leaves it preparing", (await where(b.id)) === "preparing");
  await sleep(5);
  await tokenPost(b.id, { action: "ready" });
  ck("collected then a later ready -> ready", (await where(b.id)) === "ready");
  const c = await payNow();
  ck("landmark: the KotTick doc does not exist yet", (await KotTick.countDocuments({ _id: c.id })) === 0);
  const calls = Array.from({ length: 10 }, (_, i) =>
    i % 5 === 0 ? kitchenPost({ action: "ready", orderId: c.id, ready: true }) : tokenPost(c.id, { action: i % 2 === 0 ? "ready" : "collected" }));
  const settled = await Promise.allSettled(calls);
  const statuses = settled.map((s) => (s.status === "fulfilled" ? s.value.status : -1));
  const tick = await tickOf(c.id);
  ck(`10 concurrent upserts: none rejected, all 200 (statuses ${statuses.join(",")}), no E11000`, statuses.every((s) => s === 200));
  ck("exactly one KotTick doc, readyAt + readyMarkedAt + collectedAt all stored", (await KotTick.countDocuments({ _id: c.id })) === 1 && !!tick?.readyAt && !!tick.readyMarkedAt && !!tick.collectedAt);
}

async function t9(): Promise<void> {
  console.log("T9 Lost ticket - an open token tab");
  const tab = await create();
  const card = await cardOf(tab.id);
  ck("landmark: open (Send, Unpaid) token tab is on the kitchen board and preparing", typeof tab.token === "number" && card !== undefined && (await where(tab.id)) === "preparing");
  await kitchenPost({ action: "ready", orderId: tab.id, ready: true, seenFiredAt: card!.newestFiredAt });
  ck("Kitchen ready -> card gone, board ready", (await cardOf(tab.id)) === undefined && (await where(tab.id)) === "ready");
  await sleep(20);
  const round = await addRound(tab.id);
  ck("add a round through the real items route (200) -> back in preparing, kitchen card back", round.status === 200 && (await where(tab.id)) === "preparing" && (await cardOf(tab.id)) !== undefined);
  const settled = await settleOrder(tab.id);
  ck("settle through the real route (200, order Completed)", settled.status === 200 && (await rawOrder(tab.id))?.status === "Completed");
  ck("a paid order's new round stays on the Kitchen token arm, and preparing on the board", (await cardOf(tab.id)) !== undefined && (await where(tab.id)) === "preparing");
  const firedAt = (await entryOf(tab.id))!.firedAt;
  const ready = await tokenPost(tab.id, { action: "ready", seenFiredAt: firedAt });
  ck("POST /api/tokens/[id] ready (seenFiredAt = entry.firedAt) -> gone from the kitchen, ready on the board", ready.status === 200 && (await cardOf(tab.id)) === undefined && (await where(tab.id)) === "ready");
}

async function t10(): Promise<void> {
  console.log("T10 Kitchen tick on a paid token card");
  const o = await payNow();
  const card = await cardOf(o.id);
  const ref = card!.lines[0].ref;
  const tick = (done: boolean) => kitchenPost({ action: "tick", orderId: o.id, ref, done });
  const on = await tick(true);
  ck("tokens on: tick on a paid token card -> 200, ref stored", on.status === 200 && ((await tickOf(o.id))?.refs as string[] | undefined)?.includes(ref) === true);
  await setSettings({ tokenEnabled: false });
  const off = await tick(false);
  ck("tokens off: the same tick -> 404, ref NOT pulled", off.status === 404 && ((await tickOf(o.id))?.refs as string[] | undefined)?.includes(ref) === true);
}

async function t11(): Promise<void> {
  console.log("T11 Paid stale-out: a paid order fired 2 h ago leaves the Kitchen board and the list; open tabs stay");
  // A restart time 12 h before the IST clock time puts the day start 12 h ago: the 2-3 h back-dated orders are in the window at any hour.
  const resetMinutes = istMinuteOf(Date.now() - 12 * 60 * MINUTE);
  await setSettings({ tokenEnabled: true, numberResetMinutes: resetMinutes });
  ck("landmark: the business day started more than 4 h ago, so the back-dated orders are inside it", Date.now() - slipDayStart(new Date(), resetMinutes).getTime() > 4 * 60 * MINUTE);
  const stale = await payNow();
  const nearly = await payNow();
  const open = await create();
  const covered = await payNow();
  await Promise.all([backdate(stale.id, STALE_MINUTES + 1), backdate(nearly.id, STALE_MINUTES - 1), backdate(open.id, 3 * 60), backdate(covered.id, 3 * 60)]);
  ck("a Pay Now order back-dated 121 min is absent from Kitchen GET and from /api/tokens", (await cardOf(stale.id)) === undefined && (await where(stale.id)) === "none");
  ck("landmark: it still exists, Completed, with its token (hidden, not deleted)", (await rawOrder(stale.id))?.status === "Completed" && typeof stale.token === "number");
  ck("a Pay Now order back-dated 119 min is on Kitchen GET and preparing", (await cardOf(nearly.id)) !== undefined && (await where(nearly.id)) === "preparing");
  ck("an OPEN (Send, Unpaid) token tab back-dated 3 h is still on Kitchen GET and still preparing", (await cardOf(open.id)) !== undefined && (await where(open.id)) === "preparing");
  const marked = await tokenPost(covered.id, { action: "ready" });
  ck("a 3 h-old paid order marked Ready now: 200, gone from the kitchen, ready on the board (stale does not apply to a covered order)", marked.status === 200 && (await cardOf(covered.id)) === undefined && (await where(covered.id)) === "ready");
  const settled = await settleOrder(open.id);
  ck("settling that open tab: 200; as a paid order with a 3 h-old round it now leaves both lists", settled.status === 200 && (await cardOf(open.id)) === undefined && (await where(open.id)) === "none");
  await setSettings({ numberResetMinutes: baseReset });
}

export async function runTokenBoardLegs(routes: Routes, check: Check): Promise<void> {
  r = routes;
  ck = check;
  baseReset = ((await Settings.findOne().lean())?.numberResetMinutes as number | undefined) ?? 0;
  const id = await t1();
  await t2(id);
  await t3(id);
  await t4(id);
  await t5();
  await t6();
  await t7();
  await t8();
  await t9();
  await t10();
  await t11();
}
