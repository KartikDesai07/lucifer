/**
 * Step EXP (expense management) live leg (2026-10-10). Drives the REAL route
 * handlers against a real mongod with `@/lib/auth` swapped for a signed-in stub
 * whose role is switchable (admin/staff) — the verify-areas-live.ts harness. The
 * cases live in verify-expenses-live-cases.ts (staff/validation/list) and
 * verify-expenses-live-cases-edit.ts (edit/delete/report/categories) — the
 * file-size split.
 *
 *   node --import tsx scripts/verify-expenses-live.ts
 *
 * The `expenseentries` / `expensecategories` collections are otherwise read and
 * written RAW (an independent path from the routes), and the route modules are
 * loaded dynamically behind a local interface, so a missing module is a clean
 * FAIL line (status 0), not a crash. Every check prints the observed status +
 * body.
 *
 * SAFETY: refuses any database without the scratch prefix, and only ever drops
 * the ONE database named DB_NAME (by exact name) at start and in finally.
 * (console output is intentional: ops CLI script, not app code.)
 */
import Module from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { ExpenseEntry } from "@/models/ExpenseEntry";
import { ExpenseCategory } from "@/models/ExpenseCategory";
import { runCases, ADMIN_ID, STAFF_ID, type Harness, type Json, type Res, type Role } from "./verify-expenses-live-cases";
import { runEditCases } from "./verify-expenses-live-cases-edit";

const SCRATCH_PREFIX = "pos_scratch_";
const DB_NAME = `${SCRATCH_PREFIX}expenses`;
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;
const BODY_PRINT_MAX = 150;
const ROUTE_MISSING_STATUS = 0;

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
  PATCH?: Handler;
  PUT?: Handler;
  DELETE?: Handler;
}

// A route file that does not exist yet loads as null, never as a crash.
async function loadRoute(relative: string): Promise<RouteModule | null> {
  const abs = path.join(__dirname, "..", ...relative.split("/"));
  const mod: unknown = await import(pathToFileURL(abs).href).catch(() => null);
  return mod as RouteModule | null;
}

let passed = 0;
let failed = 0;

// Prints the observed status + (truncated) body for every check, pass or fail.
function check(label: string, ok: boolean, res?: Res): void {
  if (ok) passed += 1;
  else failed += 1;
  const seen = res ? ` -> ${res.status} ${JSON.stringify(res.body).slice(0, BODY_PRINT_MAX)}` : "";
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${seen}`);
}

function req(method: string, url: string, body?: unknown): Request {
  return new Request(`http://live.test${url}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function call(handler: Handler | undefined, request: Request, params: Record<string, string> = {}): Promise<Res> {
  if (!handler) return { status: ROUTE_MISSING_STATUS, body: { success: false, error: "route or handler missing" } };
  const res = await handler(request, { params: Promise.resolve(params) });
  const body = (await res.json().catch(() => ({ success: false, error: "non-JSON body" }))) as Json;
  return { status: res.status, body };
}

async function buildHarness(): Promise<Harness> {
  const expensesRoute = await loadRoute("app/api/expenses/route.ts");
  const expenseItemRoute = await loadRoute("app/api/expenses/[id]/route.ts");
  const categoriesRoute = await loadRoute("app/api/expense-categories/route.ts");
  const categoryItemRoute = await loadRoute("app/api/expense-categories/[id]/route.ts");
  const reportRoute = await loadRoute("app/api/reports/expenses/route.ts");
  const loaded = (m: RouteModule | null) => (m ? "loaded" : "MISSING");
  console.log(
    `  routes: /api/expenses ${loaded(expensesRoute)}, /api/expenses/[id] ${loaded(expenseItemRoute)}, ` +
      `/api/expense-categories ${loaded(categoriesRoute)}, /api/expense-categories/[id] ${loaded(categoryItemRoute)}, ` +
      `/api/reports/expenses ${loaded(reportRoute)}`,
  );
  return {
    setRole: (role) => {
      currentRole = role;
    },
    check,
    expenses: {
      get: (query = "") => call(expensesRoute?.GET, req("GET", `/api/expenses${query}`)),
      post: (body) => call(expensesRoute?.POST, req("POST", "/api/expenses", body)),
      patch: (id, body) => call(expenseItemRoute?.PATCH, req("PATCH", `/api/expenses/${id}`, body), { id }),
      del: (id) => call(expenseItemRoute?.DELETE, req("DELETE", `/api/expenses/${id}`), { id }),
    },
    categories: {
      get: () => call(categoriesRoute?.GET, req("GET", "/api/expense-categories")),
      post: (body) => call(categoriesRoute?.POST, req("POST", "/api/expense-categories", body)),
      patch: (id, body) =>
        call(categoryItemRoute?.PATCH, req("PATCH", `/api/expense-categories/${id}`, body), { id }),
    },
    report: {
      get: (query = "") => call(reportRoute?.GET, req("GET", `/api/reports/expenses${query}`)),
    },
  };
}

// The exact-name guard: prefix AND the one name this leg owns. The connection
// is opened from the checked URI, so dropDatabase() can only hit that name.
function scratchUri(): string {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX) || dbName !== DB_NAME) {
    throw new Error(`Refusing to run against "${dbName}" — only ${DB_NAME} (a ${SCRATCH_PREFIX}* database) is allowed.`);
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
  const db = mongoose.connection.db;
  if (!db || mongoose.connection.name !== DB_NAME) throw new Error("Unexpected database — aborting.");
  console.log(`\nStep EXP expenses leg — live against ${DB_NAME}\n`);

  try {
    // The drop removed the indexes: build them from the models (clientRef unique, name collation).
    await ExpenseEntry.createIndexes();
    await ExpenseCategory.createIndexes();
    const harness = await buildHarness();
    const ctx = await runCases(harness);
    await runEditCases(harness, ctx);
  } finally {
    // Drop ONLY this scratch database, by exact name — never list or drop any other.
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
