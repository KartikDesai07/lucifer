/**
 * Staff PIN live leg (PIN lock, 2026-10-16). Drives the REAL route handlers against a real mongod
 * with `@/lib/auth` swapped for a signed-in stub whose role is switchable - the
 * verify-expenses-live.ts harness. Part A (set / shown to admins / never listed) is in
 * verify-staff-pin-live-cases.ts, part B (the PIN check itself) in verify-staff-pin-live-cases-signin.ts;
 * later tasks append parts to PARTS.
 *
 *   node --import tsx scripts/verify-staff-pin-live.ts
 *
 * SAFETY: refuses any database but DB_NAME (a pos_scratch_* name) and drops only that database,
 * by exact name, at start and in finally. (console output is intentional: ops CLI script.)
 */
import Module from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Staff } from "@/models/Staff";
import { runPartA } from "./verify-staff-pin-live-cases";
import { runPartB } from "./verify-staff-pin-live-cases-signin";
import { ADMIN_ID, STAFF_ID, type Harness, type Json, type Part, type Res, type Role } from "./verify-staff-pin-live-helpers";

const SCRATCH_PREFIX = "pos_scratch_";
const DB_NAME = `${SCRATCH_PREFIX}staffpin`;
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;
const BODY_PRINT_MAX = 150;
const ROUTE_MISSING_STATUS = 0;

// Later tasks append their parts here (C, D).
const PARTS: Part[] = [runPartA, runPartB];

let currentRole: Role = "admin";

function stubAuth(): void {
  const file = path.join(__dirname, "..", "lib", "auth.ts");
  const stub = new Module(file);
  stub.filename = file;
  stub.loaded = true;
  stub.exports = {
    auth: async () => ({
      user:
        currentRole === "admin"
          ? { id: ADMIN_ID, name: "Live leg admin", role: "admin" }
          : { id: STAFF_ID, name: "Live leg staff", role: "staff" },
    }),
    handlers: {},
    signIn: async () => undefined,
    signOut: async () => undefined,
  };
  require.cache[file] = stub;
}
stubAuth();

type Handler = (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;
interface RouteModule {
  GET?: Handler;
  POST?: Handler;
  PUT?: Handler;
}

// A route file that does not exist yet loads as null, never as a crash.
async function loadRoute(relative: string): Promise<RouteModule | null> {
  const abs = path.join(__dirname, "..", ...relative.split("/"));
  const mod: unknown = await import(pathToFileURL(abs).href).catch(() => null);
  return mod as RouteModule | null;
}

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, res?: Res): void {
  if (ok) passed += 1;
  else failed += 1;
  const seen = res ? ` -> ${res.status} ${JSON.stringify(res.body).slice(0, BODY_PRINT_MAX)}` : "";
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}${seen}`);
}

function req(method: string, url: string, body?: unknown): Request {
  return new Request(`http://live.test${url}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function call(
  handler: Handler | undefined,
  request: Request,
  params: Record<string, string> = {},
): Promise<Res & { cacheControl: string | null }> {
  if (!handler) {
    return { status: ROUTE_MISSING_STATUS, body: { success: false, error: "route or handler missing" }, cacheControl: null };
  }
  const res = await handler(request, { params: Promise.resolve(params) });
  const body = (await res.json().catch(() => ({ success: false, error: "non-JSON body" }))) as Json;
  return { status: res.status, body, cacheControl: res.headers.get("Cache-Control") };
}

async function buildHarness(): Promise<Harness> {
  const listRoute = await loadRoute("app/api/staff/route.ts");
  const itemRoute = await loadRoute("app/api/staff/[id]/route.ts");
  const pinRoute = await loadRoute("app/api/staff/[id]/pin/route.ts");
  const loaded = (m: RouteModule | null) => (m ? "loaded" : "MISSING");
  console.log(
    `  routes: /api/staff ${loaded(listRoute)}, /api/staff/[id] ${loaded(itemRoute)}, /api/staff/[id]/pin ${loaded(pinRoute)}`,
  );
  return {
    setRole: (role) => {
      currentRole = role;
    },
    check,
    staff: {
      list: () => call(listRoute?.GET, req("GET", "/api/staff")),
      create: (body) => call(listRoute?.POST, req("POST", "/api/staff", body)),
      update: (id, body) => call(itemRoute?.PUT, req("PUT", `/api/staff/${id}`, body), { id }),
      pin: (id) => call(pinRoute?.GET, req("GET", `/api/staff/${id}/pin`), { id }),
    },
  };
}

function scratchUri(): string {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX) || dbName !== DB_NAME) {
    throw new Error(`Refusing to run against "${dbName}" - only ${DB_NAME} (a ${SCRATCH_PREFIX}* database) is allowed.`);
  }
  return uri;
}

async function main(): Promise<void> {
  const uri = scratchUri();
  process.env.MONGODB_URI = uri;

  const scratch = await mongoose.createConnection(uri).asPromise();
  try {
    await scratch.dropDatabase();
  } finally {
    await scratch.close();
  }

  await connectDB();
  if (!mongoose.connection.db || mongoose.connection.name !== DB_NAME) throw new Error("Unexpected database - aborting.");
  console.log(`\nStaff PIN leg - live against ${DB_NAME}\n`);

  try {
    await Staff.createIndexes(); // the drop removed the unique username index
    const harness = await buildHarness();
    for (const part of PARTS) await part(harness);
  } finally {
    if (mongoose.connection.name === DB_NAME) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
