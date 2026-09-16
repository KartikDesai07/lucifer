import { test } from "node:test";
import assert from "node:assert/strict";

import { createVercelClient } from "./vercel";
import type { RetryDeps } from "./provider-retry";

// DB-free tests for the F3.5 Vercel client: fake fetch + virtual clock, exact
// URL/body assertions per operation, and the shared 429 handling exercised
// through a real call path.

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function makeDeps(handler: Handler) {
  const calls: { method: string; url: string; body?: string; headers: Headers }[] = [];
  const sleeps: number[] = [];
  let clock = 1_750_000_000_000;
  const deps: Partial<RetryDeps> = {
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? "GET",
        url: String(url),
        body: typeof init?.body === "string" ? init.body : undefined,
        headers: new Headers(init?.headers),
      });
      return handler(String(url), init);
    }) as typeof fetch,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
  };
  return { deps, calls, sleeps };
}

function json(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

const CREDS = { token: "vtoken-1" };

test("createProject POSTs /v11/projects with the bearer token and framework", async () => {
  const { deps, calls } = makeDeps(() => json(200, { id: "prj_1", name: "pos-cafe-a" }));
  const vercel = createVercelClient(CREDS, deps);
  const project = await vercel.createProject("pos-cafe-a");
  assert.deepEqual(project, { id: "prj_1", name: "pos-cafe-a" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "https://api.vercel.com/v11/projects");
  assert.equal(calls[0].headers.get("Authorization"), "Bearer vtoken-1");
  assert.deepEqual(JSON.parse(calls[0].body!), { name: "pos-cafe-a", framework: "nextjs" });
});

test("teamId rides every call as a query param when present", async () => {
  const { deps, calls } = makeDeps(() => json(200, { id: "prj_1", name: "x" }));
  const vercel = createVercelClient({ token: "t", teamId: "team_9" }, deps);
  await vercel.createProject("x");
  assert.ok(calls[0].url.includes("teamId=team_9"), calls[0].url);
});

test("upsertEnv POSTs the env ARRAY with ?upsert=true and encrypted defaults", async () => {
  const { deps, calls } = makeDeps(() => json(201, {}));
  const vercel = createVercelClient(CREDS, deps);
  await vercel.upsertEnv("prj_1", [
    { key: "MONGODB_URI", value: "mongodb+srv://u:p@h/pos" },
    { key: "NEXT_PUBLIC_R2_PUBLIC_BASE_URL", value: "https://pub.example", type: "plain" },
  ]);
  const call = calls[0];
  const parsed = new URL(call.url);
  assert.equal(parsed.pathname, "/v10/projects/prj_1/env");
  assert.equal(parsed.searchParams.get("upsert"), "true");
  const body = JSON.parse(call.body!) as { key: string; type: string; target: string[] }[];
  assert.equal(body.length, 2);
  assert.equal(body[0].type, "encrypted"); // the secret-safe default
  assert.deepEqual(body[0].target, ["production", "preview"]);
  assert.equal(body[1].type, "plain");
});

test("upsertEnv with an empty list is a no-op (no HTTP call)", async () => {
  const { deps, calls } = makeDeps(() => json(201, {}));
  await createVercelClient(CREDS, deps).upsertEnv("prj_1", []);
  assert.equal(calls.length, 0);
});

test("deploy POSTs /v13/deployments targeting production; status GETs it back", async () => {
  const { deps, calls } = makeDeps((url) =>
    url.includes("/deployments/dpl_1")
      ? json(200, { id: "dpl_1", readyState: "READY", url: "pos-cafe-a.vercel.app" })
      : json(200, { id: "dpl_1", readyState: "QUEUED" }),
  );
  const vercel = createVercelClient(CREDS, deps);
  const started = await vercel.deploy({
    name: "pos-cafe-a",
    project: "prj_1",
    gitSource: { type: "github", repoId: 42, ref: "main" },
  });
  assert.deepEqual(started, { id: "dpl_1", readyState: "QUEUED", url: undefined });
  assert.equal(calls[0].url, "https://api.vercel.com/v13/deployments");
  const body = JSON.parse(calls[0].body!) as Record<string, unknown>;
  assert.equal(body.target, "production");
  assert.deepEqual(body.gitSource, { type: "github", repoId: 42, ref: "main" });

  const status = await vercel.deploymentStatus("dpl_1");
  assert.equal(status.readyState, "READY");
  assert.equal(calls[1].method, "GET");
  assert.equal(calls[1].url, "https://api.vercel.com/v13/deployments/dpl_1");
});

test("addDomain POSTs the domain; verifyDomain hits /verify; removeDomain DELETEs", async () => {
  const { deps, calls } = makeDeps((url, init) => {
    if ((init?.method ?? "GET") === "DELETE") return new Response(null, { status: 204 });
    if (url.includes("/verify")) return json(200, { name: "cafe.example.in", verified: true });
    return json(200, {
      name: "cafe.example.in",
      verified: false,
      verification: [{ type: "TXT", domain: "_vercel.cafe.example.in", value: "vc-123" }],
    });
  });
  const vercel = createVercelClient(CREDS, deps);

  const added = await vercel.addDomain("prj_1", "cafe.example.in");
  assert.equal(added.verified, false);
  assert.equal(added.verification?.[0].type, "TXT");
  assert.equal(new URL(calls[0].url).pathname, "/v10/projects/prj_1/domains");
  assert.deepEqual(JSON.parse(calls[0].body!), { name: "cafe.example.in" });

  const verified = await vercel.verifyDomain("prj_1", "cafe.example.in");
  assert.equal(verified.verified, true);
  assert.equal(
    new URL(calls[1].url).pathname,
    "/v9/projects/prj_1/domains/cafe.example.in/verify",
  );

  await vercel.removeDomain("prj_1", "cafe.example.in");
  assert.equal(calls[2].method, "DELETE");
  assert.equal(new URL(calls[2].url).pathname, "/v9/projects/prj_1/domains/cafe.example.in");
});

test("removeDomain treats 404 as already-removed (re-runnable runbook)", async () => {
  const { deps } = makeDeps(() => json(404, { error: { code: "not_found" } }));
  await createVercelClient(CREDS, deps).removeDomain("prj_1", "gone.example.in"); // must not throw
});

test("addDomain 409 (domain on ANOTHER project) is a real conflict — throws", async () => {
  const { deps } = makeDeps(() => json(409, { error: { code: "domain_already_in_use" } }));
  await assert.rejects(
    createVercelClient(CREDS, deps).addDomain("prj_1", "cafe.example.in"),
    /HTTP 409 domain_already_in_use/,
  );
});

test("upsertEnv tolerates a 201 with an empty/non-JSON body (defensive parse)", async () => {
  const { deps } = makeDeps(() => new Response("", { status: 201 }));
  // res.json() rejects on an empty body — the .catch fallback must hold.
  await createVercelClient(CREDS, deps).upsertEnv("prj_1", [{ key: "A", value: "1" }]);
});

test("upsertEnv fails loudly on a 201 carrying PARTIAL failures", async () => {
  const { deps } = makeDeps(() =>
    json(201, {
      created: [{ key: "GOOD" }],
      failed: [{ error: { code: "ENV_CONFLICT" } }],
    }),
  );
  await assert.rejects(
    createVercelClient(CREDS, deps).upsertEnv("prj_1", [
      { key: "GOOD", value: "1" },
      { key: "BAD", value: "2" },
    ]),
    /1\/2 env vars failed to upsert on prj_1 \(ENV_CONFLICT\)/,
  );
});

test("a 429 with Retry-After backs off exactly, then succeeds", async () => {
  let n = 0;
  const { deps, sleeps } = makeDeps(() => {
    n += 1;
    return n === 1
      ? json(429, { error: { code: "rate_limited" } }, { "Retry-After": "12" })
      : json(200, { id: "prj_1", name: "x" });
  });
  const project = await createVercelClient(CREDS, deps).createProject("x");
  assert.equal(project.id, "prj_1");
  assert.deepEqual(sleeps, [12_000]);
});

test("errors carry the Vercel error code only — never env values we sent", async () => {
  const SECRET = "mongodb+srv://user:pw@host/pos";
  const { deps } = makeDeps(() =>
    json(400, { error: { code: "ENV_VALUE_INVALID", message: "bad value" } }),
  );
  await assert.rejects(
    createVercelClient(CREDS, deps).upsertEnv("prj_1", [{ key: "MONGODB_URI", value: SECRET }]),
    (err: Error) => {
      assert.match(err.message, /HTTP 400 ENV_VALUE_INVALID/);
      assert.ok(!err.message.includes(SECRET), "env values must never leak into errors");
      return true;
    },
  );
});
