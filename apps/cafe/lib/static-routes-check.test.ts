import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  nonStaticStaffRoutes,
  prerenderedPublicRoutes,
  printersRefreshProblem,
  staffRoutes,
} from "../scripts/static-routes-check.mjs";
import { stripComments } from "@/lib/source-pin-utils";

// The pure part of scripts/static-routes-check.mjs, run on small inline fixtures shaped like Next 15.5's
// app-path-routes-manifest.json and prerender-manifest.json. The script itself (reading .next) is run after a build.

const here = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(path.join(here, "..", rel), "utf8");

const ROUTES = {
  "/(dashboard)/page": "/",
  "/(dashboard)/customers/page": "/customers",
  "/(dashboard)/orders/page": "/orders",
  "/(dashboard)/printers/page": "/printers",
  "/(auth)/login/page": "/login",
  "/m/page": "/m",
  "/m/orders/page": "/m/orders",
  "/api/health/route": "/api/health",
};
const entry = (srcRoute: string, revalidate: number | false = false) => ({ srcRoute, initialRevalidateSeconds: revalidate });
const PRERENDERED = {
  version: 4,
  routes: { "/": entry("/"), "/customers": entry("/customers"), "/orders": entry("/orders"), "/printers": entry("/printers", 600) },
  dynamicRoutes: {},
};

test("staffRoutes lists only the (dashboard) pages, with their URL paths", () => {
  assert.deepEqual(staffRoutes(ROUTES), ["/", "/customers", "/orders", "/printers"], "only /(dashboard)/.../page keys count");
});

test("nonStaticStaffRoutes: all prerendered gives none", () => {
  assert.deepEqual(nonStaticStaffRoutes(PRERENDERED, ROUTES), [], "every staff route is prerendered");
});

test("nonStaticStaffRoutes: one dynamic staff route is the only one listed; /login, /m/*, /api/* never are", () => {
  const manifest = { ...PRERENDERED, routes: { "/": entry("/"), "/orders": entry("/orders"), "/printers": entry("/printers", 600) } };
  assert.deepEqual(nonStaticStaffRoutes(manifest, ROUTES), ["/customers"], "only /customers is missing");
  const none = { version: 4, routes: {}, dynamicRoutes: {} };
  assert.deepEqual(nonStaticStaffRoutes(none, ROUTES), ["/", "/customers", "/orders", "/printers"], "public and api routes are never listed");
});

test("prerenderedPublicRoutes: /login and /m routes must not be prerendered", () => {
  assert.deepEqual(prerenderedPublicRoutes(PRERENDERED, ROUTES), [], "dynamic public routes pass");
  const bad = { ...PRERENDERED, routes: { ...PRERENDERED.routes, "/login": entry("/login"), "/m/orders": entry("/m/orders") } };
  assert.deepEqual(prerenderedPublicRoutes(bad, ROUTES), ["/login", "/m/orders"], "frozen public pages are listed");
  const viaSrc = { ...PRERENDERED, routes: { ...PRERENDERED.routes, "/m": entry("/m") } };
  assert.deepEqual(prerenderedPublicRoutes(viaSrc, ROUTES), ["/m"], "/m itself counts");
});

test("printersRefreshProblem: /printers must be prerendered with a 600 s refresh", () => {
  assert.equal(printersRefreshProblem(PRERENDERED), null, "600 s passes");
  const wrong = { ...PRERENDERED, routes: { ...PRERENDERED.routes, "/printers": entry("/printers", false) } };
  assert.match(String(printersRefreshProblem(wrong)), /600/, "no refresh is a problem");
  const gone = { ...PRERENDERED, routes: { "/": entry("/") } };
  assert.match(String(printersRefreshProblem(gone)), /printers/, "missing is a problem");
});

test("PIN: /login and the /m layout stay dynamic by their own export (the root layout no longer decides it)", () => {
  for (const rel of ["app/(auth)/login/page.tsx", "app/m/layout.tsx"]) {
    const src = stripComments(readSrc(rel));
    assert.match(src, /export const dynamic = "force-dynamic";/, `${rel} must export dynamic = "force-dynamic": it reads Settings per request`);
  }
});
