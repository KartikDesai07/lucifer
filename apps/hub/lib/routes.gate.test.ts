import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

import { PANEL_GATED, PANEL_GATE_OPTS } from "./panel-gate";
import { INGEST_GATED } from "./ingest-gate";

// STRUCTURAL enforcement of "gate every route" (F3.4 / §E). This is NOT a name
// scan (a file could mention requirePanelAccess yet leave a handler ungated).
// It IMPORTS every app/api/**/route.ts and asserts each exported HTTP-verb
// handler is a withPanelGate(...) result (carries the PANEL_GATED marker) — so a
// new route that forgets the wrapper FAILS THE BUILD. Only the explicit public
// allowlist (the login endpoint + health + the HMAC-verified ingest) is exempt —
// and the ingest route gets its OWN structural check below (INGEST_GATED).

// Every Next.js App Router HTTP export — incl. HEAD/OPTIONS, so a hand-written
// ungated OPTIONS/HEAD handler on a non-public route can't slip past the check.
const HTTP_VERBS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

// Public by design: /api/auth/[...nextauth] IS the login endpoint (Auth.js owns
// it); /api/health is the unauthenticated liveness probe; /api/ingest/heartbeat
// (F3.7) is machine-to-machine — the caller is the CF Worker, not a HubUser, so
// the panel gate cannot apply, and its wall is the fail-closed HMAC in
// withIngestGate (asserted STRUCTURALLY by the dedicated test below).
const PUBLIC_ROUTE_DIRS = [
  path.join("auth", "[...nextauth]"),
  "health",
  path.join("ingest", "heartbeat"),
];

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "app", "api");

/** Recursively collect every route.ts under app/api, with its dir relative to api. */
function collectRoutes(dir: string, rel = ""): Array<{ file: string; rel: string }> {
  const out: Array<{ file: string; rel: string }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectRoutes(abs, path.join(rel, entry.name)));
    } else if (entry.name === "route.ts") {
      out.push({ file: abs, rel });
    }
  }
  return out;
}

function isPublic(rel: string): boolean {
  return PUBLIC_ROUTE_DIRS.some((p) => rel === p || rel.endsWith(`${path.sep}${p}`) || rel === p);
}

test("every non-public app/api route exports only PANEL_GATED handlers", async () => {
  const routes = collectRoutes(apiDir);
  assert.ok(routes.length >= 3, `expected to find route files, found ${routes.length}`);

  let checkedGated = 0;
  for (const { file, rel } of routes) {
    const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    const exportedVerbs = HTTP_VERBS.filter((v) => typeof mod[v] === "function");
    assert.ok(exportedVerbs.length > 0, `${rel}/route.ts exports no HTTP handler`);

    if (isPublic(rel)) continue;

    for (const verb of exportedVerbs) {
      const handler = mod[verb] as Record<PropertyKey, unknown>;
      assert.equal(
        handler[PANEL_GATED],
        true,
        `${rel || "."}/route.ts export ${verb} is NOT wrapped in withPanelGate — every non-public route must be gated`,
      );
      checkedGated += 1;
    }
  }
  assert.ok(checkedGated >= 2, `expected to verify gated handlers, checked ${checkedGated}`);
});

test("the public allowlist is minimal and intentional (auth + health + the HMAC ingest only)", () => {
  assert.deepEqual(PUBLIC_ROUTE_DIRS, [
    path.join("auth", "[...nextauth]"),
    "health",
    path.join("ingest", "heartbeat"),
  ]);
});

test("the ingest route is STRUCTURALLY behind the HMAC gate (INGEST_GATED) and exports only POST", async () => {
  const mod = (await import(
    pathToFileURL(path.join(apiDir, "ingest", "heartbeat", "route.ts")).href
  )) as Record<string, unknown>;
  const exportedVerbs = HTTP_VERBS.filter((v) => typeof mod[v] === "function");
  assert.deepEqual(exportedVerbs, ["POST"], "the ingest surface is POST-only");
  const handler = mod.POST as Record<PropertyKey, unknown>;
  assert.equal(
    handler[INGEST_GATED],
    true,
    "POST /api/ingest/heartbeat must be wrapped in withIngestGate — public ≠ open",
  );
});

// R9 (F3.8 post-review fix wave): the F3.8 task routes' step-up posture pinned
// structurally via PANEL_GATE_OPTS — the CLAIM-time step-up for an 'open' task
// is computed per-call inside the run route handler (A1), not on the wrapper,
// so the wrapper itself must carry stepUp:false for both GET /api/tasks and
// POST /api/tasks/[id]/run; only the dismiss route's wrapper is stepUp:true.
test("R9: F3.8 task routes carry the expected PANEL_GATE_OPTS — dismiss stepUp:true, run + tasks GET stepUp:false", async () => {
  const tasksMod = (await import(pathToFileURL(path.join(apiDir, "tasks", "route.ts")).href)) as Record<string, unknown>;
  const runMod = (await import(
    pathToFileURL(path.join(apiDir, "tasks", "[id]", "run", "route.ts")).href
  )) as Record<string, unknown>;
  const dismissMod = (await import(
    pathToFileURL(path.join(apiDir, "tasks", "[id]", "dismiss", "route.ts")).href
  )) as Record<string, unknown>;

  const tasksGet = tasksMod.GET as Record<PropertyKey, unknown>;
  const runPost = runMod.POST as Record<PropertyKey, unknown>;
  const dismissPost = dismissMod.POST as Record<PropertyKey, unknown>;

  assert.deepEqual(tasksGet[PANEL_GATE_OPTS], { stepUp: false }, "GET /api/tasks is a list read — no fresh step-up");
  assert.deepEqual(
    runPost[PANEL_GATE_OPTS],
    { stepUp: false },
    "POST /api/tasks/[id]/run's wrapper carries no step-up — the machine/route compute a fresh claim-time step-up only for an OPEN task (A1)",
  );
  assert.deepEqual(dismissPost[PANEL_GATE_OPTS], { stepUp: true }, "POST /api/tasks/[id]/dismiss is step-up gated (A9)");
});
