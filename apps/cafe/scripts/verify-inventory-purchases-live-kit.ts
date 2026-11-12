/**
 * Harness of verify-inventory-purchases-live.ts (ops CLI support module, not app code): the scratch-DB guard, a
 * role-switchable auth stub, the route caller, the check printer and RAW collection handles (an independent path from
 * the routes). Import this module BEFORE any route: it installs the `@/lib/auth` stub on import.
 * (console output is intentional: ops CLI script, not app code.)
 */
import Module from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import mongoose from "mongoose";

export const SCRATCH_PREFIX = "pos_scratch_";
export const DB_NAME = `${SCRATCH_PREFIX}inventory_purchases`;
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;
const BODY_PRINT_MAX = 150;
const ROUTE_MISSING_STATUS = 0;
const STAFF_ID = "665f0000000000000000a001";
const ADMIN_ID = "665f0000000000000000a002";

export type Role = "admin" | "staff";
export type Body = Record<string, unknown>;
export type Res = { status: number; body: { success: boolean; data?: unknown; error?: string } };
export type Handler = (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;
export interface RouteModule { GET?: Handler; POST?: Handler; PATCH?: Handler; DELETE?: Handler }

let currentRole: Role = "admin";
export const as = (role: Role): void => {
  currentRole = role;
};

(function stubAuth(): void {
  const file = path.join(__dirname, "..", "lib", "auth.ts");
  const stub = new Module(file);
  stub.filename = file;
  stub.loaded = true;
  const who = () => (currentRole === "admin" ? { id: ADMIN_ID, name: "Live leg admin", role: "admin" } : { id: STAFF_ID, name: "Live leg staff", role: "staff" });
  stub.exports = { auth: async () => ({ user: who() }), handlers: {}, signIn: async () => undefined, signOut: async () => undefined };
  require.cache[file] = stub;
})();

let passed = 0;
let failed = 0;
export const tally = () => ({ passed, failed });

export function check(label: string, ok: boolean, res?: Res): void {
  if (ok) passed += 1;
  else failed += 1;
  const seen = res ? ` -> ${res.status} ${JSON.stringify(res.body).slice(0, BODY_PRINT_MAX)}` : "";
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}${seen}`);
}

export async function loadRoute(relative: string): Promise<RouteModule | null> {
  const abs = path.join(__dirname, "..", ...relative.split("/"));
  const mod: unknown = await import(pathToFileURL(abs).href).catch(() => null);
  return mod as RouteModule | null;
}

export function req(method: string, url: string, body?: unknown): Request {
  return new Request(`http://live.test${url}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function call(handler: Handler | undefined, request: Request, params: Record<string, string> = {}): Promise<Res> {
  if (!handler) return { status: ROUTE_MISSING_STATUS, body: { success: false, error: "route or handler missing" } };
  const res = await handler(request, { params: Promise.resolve(params) });
  const body = (await res.json().catch(() => ({ success: false, error: "non-JSON body" }))) as Res["body"];
  return { status: res.status, body };
}

const db = () => {
  const handle = mongoose.connection.db;
  if (!handle) throw new Error("not connected");
  return handle;
};
export const items = () => db().collection("stockitems");
export const entries = () => db().collection("stockentries");
export const suppliers = () => db().collection("suppliers");
export const oid = (hex: string) => new mongoose.Types.ObjectId(hex);
export const qtyOf = async (id: string) => (await items().findOne({ _id: oid(id) }))?.qty as number | undefined;
export const rateOf = async (id: string) => (await items().findOne({ _id: oid(id) }))?.lastRatePaise as number | undefined;
export const byRef = (ref: string) => entries().findOne({ clientRef: ref });
export const countRef = (ref: string) => entries().countDocuments({ clientRef: ref });
export const has = (o: object | null, key: string) => o !== null && key in o;
export const dataOf = (res: Res): Body => (res.body.data && !Array.isArray(res.body.data) ? (res.body.data as Body) : {});
export const listOf = (res: Res): Body[] => (Array.isArray(res.body.data) ? (res.body.data as Body[]) : []);
export const pageOf = (res: Res): { rows: Body[] } => (res.body.data ?? { rows: [] }) as { rows: Body[] };
export const firstLine = (e: object | null) => (e as { lines?: Array<Record<string, unknown>> } | null)?.lines?.[0];

// The exact-name guard: prefix AND the one name this leg owns.
export function scratchUri(): string {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX) || dbName !== DB_NAME) {
    throw new Error(`Refusing to run against "${dbName}": only ${DB_NAME} (a ${SCRATCH_PREFIX}* database) is allowed.`);
  }
  return uri;
}

export async function seedItem(name: string, unit: string, qty: number, archived = false): Promise<string> {
  const now = new Date();
  const doc: Body = { name, unit, qty, v: 1, createdAt: now, updatedAt: now };
  if (archived) doc.archived = true;
  return String((await items().insertOne(doc)).insertedId);
}

export async function seedSupplier(name: string, archived = false): Promise<string> {
  const now = new Date();
  const doc: Body = { name, v: 1, createdAt: now, updatedAt: now };
  if (archived) doc.archived = true;
  return String((await suppliers().insertOne(doc)).insertedId);
}

/** Every number a refused purchase must leave alone: the row count, each item's stock and last rate. */
export async function snapshot(ids: string[]): Promise<string> {
  const rows = [];
  for (const id of ids) rows.push([id, await qtyOf(id), await rateOf(id) ?? null]);
  return JSON.stringify([await entries().countDocuments(), rows]);
}
