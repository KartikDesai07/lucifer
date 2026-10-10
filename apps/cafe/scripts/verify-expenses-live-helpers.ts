/**
 * Shared types + raw-collection helpers for the Step EXP live leg
 * (verify-expenses-live.ts and its two case files). Raw reads/writes are an
 * independent path from the routes. Split out for the file-size cap.
 */
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import mongoose from "mongoose";
import type { ExpensePaymentMode } from "@pos/shared/expense";

export type Role = "admin" | "staff";
export type Json = { success: boolean; data?: unknown; error?: string; details?: unknown };
export type Res = { status: number; body: Json };
export type Body = Record<string, unknown>;

export const STAFF_ID = "665f0000000000000000a001";
export const ADMIN_ID = "665f0000000000000000a002";
export const GHOST = "665f0000000000000000beef"; // a valid ObjectId no row carries
export const STAFF_NAME = "Live leg staff";
export const ADMIN_NAME = "Live leg admin";

export interface Harness {
  setRole(role: Role): void;
  check(label: string, ok: boolean, res?: Res): void;
  expenses: {
    get(query?: string): Promise<Res>;
    post(body: unknown): Promise<Res>;
    patch(id: string, body: unknown): Promise<Res>;
    del(id: string): Promise<Res>;
  };
  categories: {
    get(): Promise<Res>;
    post(body: unknown): Promise<Res>;
    patch(id: string, body: unknown): Promise<Res>;
  };
  report: { get(query?: string): Promise<Res> };
}

/** What part 1 hands to part 2: the category ids, the seeded rows' ids and the day keys. */
export interface Ctx {
  cats: string[];
  today: string;
  d1: string;
  d2: string;
  id: { a: string; b: string; c: string; d: string; e: string; f: string; g: string; h: string };
}

const ObjectId = mongoose.Types.ObjectId;
const Int32 = mongoose.mongo.Int32;
export const DAY_MS = 86_400_000;
export const SETTLE_MS = 8; // lets createdAt differ between consecutive writes (the list sorts on it)

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const oid = (hex: string) => new ObjectId(hex);
function col(name: string) {
  const db = mongoose.connection.db;
  if (!db) throw new Error("not connected");
  return db.collection(name);
}
export const expensesCol = () => col("expenseentries");
export const categoriesCol = () => col("expensecategories");
export const storedExpense = (id: string) => expensesCol().findOne({ _id: oid(id) });
export const storedCategory = (id: string) => categoriesCol().findOne({ _id: oid(id) });
export const rowsOf = (res: Res): Body[] => (Array.isArray(res.body.data) ? (res.body.data as Body[]) : []);
export const dataOf = (res: Res): Body => (res.body.data && !Array.isArray(res.body.data) ? (res.body.data as Body) : {});
export const listRows = (res: Res): Body[] => (Array.isArray(dataOf(res).rows) ? (dataOf(res).rows as Body[]) : []);
export const idsOf = (res: Res): string[] => listRows(res).map((r) => String(r.id));
export const same = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);

/** A valid create body; `over` changes fields (a fresh clientRef per call unless given). */
export function expenseBody(categoryId: string, date: string, over: Body = {}): Body {
  return { name: "Milk", categoryId, date, amountPaise: 45050, paymentMode: "cash", clientRef: randomUUID(), ...over };
}

/** A raw row as the model would write it (Int32 paise), for seeding what a route cannot (old createdAt, deleted). */
export async function rawExpense(
  row: { name: string; categoryId: string; date: string; amountPaise: number; paymentMode: ExpensePaymentMode },
  by: { name: string; id: string },
  extra: Body = {},
): Promise<string> {
  const now = new Date();
  const res = await expensesCol().insertOne({
    ...row,
    categoryId: oid(row.categoryId),
    amountPaise: new Int32(row.amountPaise),
    createdBy: by.name,
    createdById: by.id,
    clientRef: randomUUID(),
    v: 1,
    createdAt: now,
    updatedAt: now,
    ...extra,
  });
  return String(res.insertedId);
}

