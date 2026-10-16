/**
 * Staff PIN live leg (PIN lock, 2026-10-16). Drives the REAL route handlers against a real mongod
 * with `@/lib/auth` swapped for a signed-in stub whose role is switchable - the
 * verify-expenses-live.ts harness. Part A (set / shown to admins / never listed) is in
 * verify-staff-pin-live-cases.ts, part B (the PIN check itself) in verify-staff-pin-live-cases-signin.ts,
 * part C (the device's remembered people: the two sign-in routes) in verify-staff-pin-live-cases-device.ts;
 * later tasks append parts to PARTS. `next/headers` is swapped too (part C's routes use cookies()).
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
import { RequestCookies, ResponseCookies } from "next/dist/server/web/spec-extension/cookies";
import { connectDB } from "@/lib/db";
import { Staff } from "@/models/Staff";
import { runPartA } from "./verify-staff-pin-live-cases";
import { runPartB } from "./verify-staff-pin-live-cases-signin";
import { runPartC } from "./verify-staff-pin-live-cases-device";
import { runPartD } from "./verify-staff-pin-live-cases-settings";
import {
  ADMIN_ID,
  STAFF_ID,
  type Harness,
  type Json,
  type Part,
  type Res,
  type Role,
  type RouteRes,
  type StubUser,
} from "./verify-staff-pin-live-helpers";

const SCRATCH_PREFIX = "pos_scratch_";
const DB_NAME = `${SCRATCH_PREFIX}staffpin`;
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;
const BODY_PRINT_MAX = 150;
const ROUTE_MISSING_STATUS = 0;
const KNOWN_HOST = "localhost"; // resolves to the local "dev" tenant (lib/tenant.ts)

const PARTS: Part[] = [runPartA, runPartB, runPartC, runPartD];

let currentRole: Role = "admin";
let signedIn: StubUser | null | undefined; // undefined: the role's fixed user

function stubAuth(): void {
  const file = path.join(__dirname, "..", "lib", "auth.ts");
  const stub = new Module(file);
  stub.filename = file;
  stub.loaded = true;
  stub.exports = {
    auth: async () => {
      if (signedIn === null) return null;
      return {
        user:
          signedIn ??
          (currentRole === "admin"
            ? { id: ADMIN_ID, name: "Live leg admin", role: "admin" }
            : { id: STAFF_ID, name: "Live leg staff", role: "staff" }),
      };
    },
    handlers: {},
    signIn: async () => undefined,
    signOut: async () => undefined,
  };
  require.cache[file] = stub;
}
stubAuth();

// next/headers: cookies() throws outside a Next request scope, so each call gets a jar made of Next's own
// cookie classes (the ones its request store wraps): reads come from the call's Cookie header, and writes
// serialize into the Set-Cookie lines Next appends to a route's answer.
let jar = { read: new RequestCookies(new Headers()), written: new Headers() };

function stubHeaders(): void {
  const loader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
  const real = loader._load;
  loader._load = function (this: unknown, request: string, parent: unknown, isMain: boolean): unknown {
    if (request !== "next/headers") return real.call(this, request, parent, isMain);
    return {
      cookies: async () => {
        const out = new ResponseCookies(jar.written);
        return {
          get: (name: string) => jar.read.get(name),
          set: (...args: Parameters<ResponseCookies["set"]>) => out.set(...args),
        };
      },
    };
  };
}
stubHeaders();

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

function req(method: string, url: string, body?: unknown, extra: Record<string, string> = {}): Request {
  const headers: Record<string, string> = { ...extra };
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`http://live.test${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function call(
  handler: Handler | undefined,
  request: Request,
  params: Record<string, string> = {},
): Promise<RouteRes> {
  if (!handler) {
    return {
      status: ROUTE_MISSING_STATUS,
      body: { success: false, error: "route or handler missing" },
      cacheControl: null,
      setCookie: [],
    };
  }
  jar = { read: new RequestCookies(request.headers), written: new Headers() };
  const res = await handler(request, { params: Promise.resolve(params) });
  const body = (await res.json().catch(() => ({ success: false, error: "non-JSON body" }))) as Json;
  return {
    status: res.status,
    body,
    cacheControl: res.headers.get("Cache-Control"),
    setCookie: [...res.headers.getSetCookie(), ...jar.written.getSetCookie()],
  };
}

const withCookie = (cookie: string | undefined): Record<string, string> => (cookie ? { cookie } : {});

async function buildHarness(): Promise<Harness> {
  const listRoute = await loadRoute("app/api/staff/route.ts");
  const itemRoute = await loadRoute("app/api/staff/[id]/route.ts");
  const pinRoute = await loadRoute("app/api/staff/[id]/pin/route.ts");
  const settingsRoute = await loadRoute("app/api/settings/route.ts");
  const knownRoute = await loadRoute("app/api/sign-in/known/route.ts");
  const rememberRoute = await loadRoute("app/api/sign-in/remember/route.ts");
  const loaded = (m: RouteModule | null) => (m ? "loaded" : "MISSING");
  console.log(
    `  routes: /api/staff ${loaded(listRoute)}, /api/staff/[id] ${loaded(itemRoute)}, /api/staff/[id]/pin ${loaded(pinRoute)}, ` +
      `/api/sign-in/known ${loaded(knownRoute)}, /api/sign-in/remember ${loaded(rememberRoute)}`,
  );
  return {
    setRole: (role) => {
      currentRole = role;
      signedIn = undefined;
    },
    signInAs: (user) => {
      signedIn = user;
    },
    check,
    staff: {
      list: () => call(listRoute?.GET, req("GET", "/api/staff")),
      create: (body) => call(listRoute?.POST, req("POST", "/api/staff", body)),
      update: (id, body) => call(itemRoute?.PUT, req("PUT", `/api/staff/${id}`, body), { id }),
      pin: (id) => call(pinRoute?.GET, req("GET", `/api/staff/${id}/pin`), { id }),
    },
    settings: {
      get: () => call(settingsRoute?.GET, req("GET", "/api/settings")),
      update: (body) => call(settingsRoute?.PUT, req("PUT", "/api/settings", body)),
    },
    signInRoutes: {
      known: ({ cookie, host = KNOWN_HOST } = {}) =>
        call(knownRoute?.GET, req("GET", "/api/sign-in/known", undefined, { host, ...withCookie(cookie) })),
      remember: (cookie) => call(rememberRoute?.POST, req("POST", "/api/sign-in/remember", undefined, withCookie(cookie))),
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
