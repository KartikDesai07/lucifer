/**
 * Shared kit for the KOT kitchen order live leg (verify-kitchen-order-live.ts): the admin auth stub, the request
 * helpers that call the REAL route handlers exactly as a POS tab does, the QR request stager, the leg bookkeeping.
 * (console output is intentional - this is an ops CLI script, not app code.)
 */
import Module from "node:module";
import path from "node:path";
import mongoose from "mongoose";
import { Order } from "@/models/Order";
import { OrderRequest } from "@/models/OrderRequest";
import { Product } from "@/models/Product";
import { Table } from "@/models/Table";
import { PrintJob } from "@/models/PrintJob";
import { Category } from "@/models/Category";
import { buildRequestDoc, type IntakeTable } from "@/lib/order-request-intake";
import { priceRequestItems, type PricedProductSource } from "@/lib/public-pricing";
import { mintUniquePublicCode } from "@/lib/public-token";
import { PRINT_AGENT_HEADER, PRINT_DEVICE_ID_HEADER, PRINT_HEADER_ON } from "@pos/shared/print-agent-wire";
import type { CreatePublicOrderRequestInput } from "@pos/shared/schemas/public-order.schema";

export const SCRATCH_PREFIX = "pos_scratch_";
export const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}kitchenorder`;
const STAFF_ID = "665f0000000000000000beef";
const DEVICE = "live-kitchenorder-pos-tab";

/** Seeds the signed-in ADMIN stub into the CJS module cache BEFORE any route (and so @/lib/api-helpers) loads. */
export function stubAuth(): void {
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
}

// ── leg bookkeeping: one PASS/FAIL line per leg, every sub-check listed under it ──
let legFailed: string[] = [];
export const legResults: Array<{ name: string; ok: boolean }> = [];
export function check(label: string, ok: boolean): void {
  console.log(`    ${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) legFailed.push(label);
}
export async function leg(name: string, body: () => Promise<void>): Promise<void> {
  legFailed = [];
  console.log(`\n${name}`);
  try {
    await body();
  } catch (e) {
    legFailed.push(`threw: ${e instanceof Error ? e.message : String(e)}`);
  }
  const ok = legFailed.length === 0;
  legResults.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` (${legFailed.length} failed: ${legFailed.join("; ")})`}`);
}

// ── route calls, exactly as a POS tab makes them (print-agent headers: the routes make PrintJobs we read back) ──
export type Res<T> = { status: number; body: { success: boolean; data?: T; error?: string } };
export const idp = (id: string) => ({ params: Promise.resolve({ id }) });
export function request(method: string, url: string, body?: unknown): Request {
  const headers = { "content-type": "application/json", [PRINT_AGENT_HEADER]: PRINT_HEADER_ON, [PRINT_DEVICE_ID_HEADER]: DEVICE };
  return new Request(`http://live.test${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
export async function answer<T>(pending: Response | Promise<Response>): Promise<Res<T>> {
  const res = await pending;
  return { status: res.status, body: (await res.json()) as Res<T>["body"] };
}

// ── DB truth readers ──
export type Dish = { _id: string; name: string; price: number };
export type RawLine = { name: string; noKot?: unknown; kotRank?: unknown; kotRound?: number };
export const lineOf = (d: Dish, qty = 1) => ({ productId: d._id, name: d.name, price: d.price, qty });
export const rawOrder = (id: string) => Order.collection.findOne({ _id: new mongoose.Types.ObjectId(id) });
export const linesOf = async (id: string) => ((await rawOrder(id))?.items ?? []) as RawLine[];
export const rankOf = (lines: RawLine[], name: string, round?: number) =>
  lines.find((l) => l.name === name && (round === undefined || l.kotRound === round));
export const hasRank = (l: RawLine | undefined) => l !== undefined && "kotRank" in l;
export const kotJobNames = async (orderId: string, round: number): Promise<string[]> => {
  const job = await PrintJob.findOne({ jobKey: `kot:${orderId}:${round}` }).lean();
  const snap = job ? (JSON.parse(job.payload) as { snapshot?: { items?: Array<{ name: string; kotRound: number }> } }).snapshot : undefined;
  return (snap?.items ?? []).filter((i) => i.kotRound === round).map((i) => i.name);
};
export async function categoryRanks(): Promise<Record<string, unknown>> {
  const rows = await Category.collection.find({}).toArray();
  return Object.fromEntries(rows.map((c) => [String(c.name), "kotOrder" in c ? c.kotOrder : "-"]));
}
export async function menuOrders(): Promise<Record<string, unknown>> {
  const rows = await Category.collection.find({}).toArray();
  return Object.fromEntries(rows.map((c) => [String(c.name), c.order]));
}

/** Stages a pending table request exactly as POST /api/public/order-request does (real pricing + buildRequestDoc). */
export async function stageRequest(tableNo: string, mobile: string, dishes: Dish[]): Promise<string> {
  const items = dishes.map((d) => ({ productId: d._id, modifiers: [] as string[], qty: 1 }));
  const products = (await Product.find({ _id: { $in: dishes.map((d) => d._id) } })
    .select("name price discount available modifiers variations")
    .lean()) as unknown as PricedProductSource[];
  const priced = priceRequestItems(products, items);
  if ("error" in priced) throw new Error(`stageRequest: pricing failed - ${priced.error}`);
  const table = (await Table.findOne({ tableNo }).select("tableNo chargeAmount chargeLabel").lean()) as IntakeTable | null;
  if (!table) throw new Error(`stageRequest: table ${tableNo} not found`);
  const input: CreatePublicOrderRequestInput = { target: { kind: "table", token: "STAGE-TOKEN-UNUSED" }, items, name: "Kitchen order leg", mobile };
  const doc = buildRequestDoc(input, priced.lines, table, null, true);
  const shortCode = await mintUniquePublicCode((code) => OrderRequest.exists({ shortCode: code }).then(Boolean));
  return String((await OrderRequest.create({ ...doc, shortCode }))._id);
}
