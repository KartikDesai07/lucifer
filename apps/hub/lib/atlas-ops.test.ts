import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildSrvUri, CLUSTER_POLL_MAX_ATTEMPTS } from "./atlas-plan";
import { createAtlasClient } from "./atlas";
import type { RetryDeps } from "./provider-retry";

// DB-free tests for the F3.5 Hub Atlas client — the per-resource OPS half
// (token cache / createProject / serialization live in lib/atlas.test.ts,
// split per the 300-line rule): createM0, pollIdle, createDbUser,
// addAccessList, getSrvUri, plus error/secret hygiene and the grep gate.

const CREDS = { clientId: "sa-id", clientSecret: "sa-secret", orgId: "org-1" };
const NOW = 1_750_000_000_000;

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function makeDeps(handler: Handler) {
  const calls: { method: string; url: string; body?: string; headers: Headers }[] = [];
  const sleeps: number[] = [];
  let clock = NOW;
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

/** Handler for the happy paths: token + whatever `routes` matches. */
function route(routes: (url: string, init?: RequestInit) => Response | undefined): Handler {
  return (url, init) => {
    if (url.endsWith("/api/oauth/token")) {
      return json(200, { access_token: "tok-1", expires_in: 3600 });
    }
    const hit = routes(url, init);
    if (!hit) throw new Error(`unexpected ${init?.method ?? "GET"} ${url}`);
    return hit;
  };
}

// ── createM0 / pollIdle ───────────────────────────────────────────────────────

test("createM0 sends the free-tier body (TENANT + instanceSize M0); 409 = adopt", async () => {
  let body: Record<string, unknown> | null = null;
  const { deps, calls } = makeDeps(
    route((url, init) => {
      if (init?.method === "POST" && url.endsWith("/groups/p1/clusters")) {
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json(201, {});
      }
      return undefined;
    }),
  );
  const atlas = createAtlasClient(CREDS, deps);
  await atlas.createM0("p1", "core");
  const spec = (body! as { replicationSpecs: { regionConfigs: Record<string, unknown>[] }[] })
    .replicationSpecs[0].regionConfigs[0];
  assert.equal(spec.providerName, "TENANT");
  assert.deepEqual(spec.electableSpecs, { instanceSize: "M0" });
  assert.equal(spec.regionName, "AP_SOUTH_1");
  // The clusters resource deprecated 2023-01-01 — writes pin 2024-10-23, and
  // the versioned media type rides Content-Type too (the Atlas docs shape).
  const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/clusters"))!;
  assert.equal(post.headers.get("Accept"), "application/vnd.atlas.2024-10-23+json");
  assert.equal(post.headers.get("Content-Type"), "application/vnd.atlas.2024-10-23+json");

  const dup = makeDeps(
    route((url, init) =>
      init?.method === "POST" && url.endsWith("/clusters") ? json(409, {}) : undefined,
    ),
  );
  await createAtlasClient(CREDS, dup.deps).createM0("p1", "core"); // must not throw
});

test("pollIdle polls at the pinned interval until IDLE (cluster reads pin 2024-08-05)", async () => {
  let gets = 0;
  const { deps, calls, sleeps } = makeDeps(
    route((url, init) => {
      if ((init?.method ?? "GET") === "GET" && url.endsWith("/clusters/core")) {
        gets += 1;
        return gets < 3
          ? json(200, { stateName: "CREATING" })
          : json(200, { stateName: "IDLE", connectionStrings: { standardSrv: "mongodb+srv://h" } });
      }
      return undefined;
    }),
  );
  const atlas = createAtlasClient(CREDS, deps);
  const cluster = await atlas.pollIdle("p1", "core");
  assert.equal(cluster.stateName, "IDLE");
  assert.equal(gets, 3);
  assert.deepEqual(sleeps, [15_000, 15_000]);
  const get = calls.find((c) => c.method === "GET" && c.url.endsWith("/clusters/core"))!;
  assert.equal(get.headers.get("Accept"), "application/vnd.atlas.2024-08-05+json");
});

test("pollIdle succeeds when IDLE lands exactly on the LAST attempt (no off-by-one)", async () => {
  let gets = 0;
  const { deps, sleeps } = makeDeps(
    route((url) => {
      if (url.endsWith("/clusters/core")) {
        gets += 1;
        return gets < CLUSTER_POLL_MAX_ATTEMPTS
          ? json(200, { stateName: "CREATING" })
          : json(200, { stateName: "IDLE" });
      }
      return undefined;
    }),
  );
  const cluster = await createAtlasClient(CREDS, deps).pollIdle("p1", "core");
  assert.equal(cluster.stateName, "IDLE");
  assert.equal(gets, CLUSTER_POLL_MAX_ATTEMPTS);
  assert.equal(sleeps.length, CLUSTER_POLL_MAX_ATTEMPTS - 1);
});

test("pollIdle gives up after the bounded attempts with a resumable error", async () => {
  const { deps } = makeDeps(
    route((url) => (url.includes("/clusters/") ? json(200, { stateName: "CREATING" }) : undefined)),
  );
  const atlas = createAtlasClient(CREDS, deps);
  await assert.rejects(
    atlas.pollIdle("p1", "core"),
    new RegExp(`not IDLE after ${CLUSTER_POLL_MAX_ATTEMPTS} polls`),
  );
});

// ── createDbUser / addAccessList / getSrvUri ─────────────────────────────────

test("createDbUser scopes readWrite to the app db; 409 PATCH-resets the password", async () => {
  const USER = { username: "pos_user", password: "s3cret!", dbName: "pos" };
  let body: Record<string, unknown> | null = null;
  const { deps } = makeDeps(
    route((url, init) => {
      if (init?.method === "POST" && url.endsWith("/databaseUsers")) {
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json(201, {});
      }
      return undefined;
    }),
  );
  await createAtlasClient(CREDS, deps).createDbUser("p1", USER);
  assert.equal(body!.databaseName, "admin");
  assert.deepEqual(body!.roles, [{ roleName: "readWrite", databaseName: "pos" }]);

  const patched: string[] = [];
  const dup = makeDeps(
    route((url, init) => {
      if (init?.method === "POST" && url.endsWith("/databaseUsers")) return json(409, {});
      if (init?.method === "PATCH" && url.endsWith("/databaseUsers/admin/pos_user")) {
        patched.push(String(init.body));
        return json(200, {});
      }
      return undefined;
    }),
  );
  await createAtlasClient(CREDS, dup.deps).createDbUser("p1", USER);
  assert.deepEqual(patched, [JSON.stringify({ password: "s3cret!" })]);
});

test("addAccessList opens 0.0.0.0/0 with an ARRAY body; 409 is a no-op", async () => {
  let body: unknown;
  const { deps } = makeDeps(
    route((url, init) => {
      if (init?.method === "POST" && url.endsWith("/accessList")) {
        body = JSON.parse(String(init.body));
        return json(201, {});
      }
      return undefined;
    }),
  );
  await createAtlasClient(CREDS, deps).addAccessList("p1");
  assert.ok(Array.isArray(body));
  assert.equal((body as { cidrBlock: string }[])[0].cidrBlock, "0.0.0.0/0");

  const dup = makeDeps(
    route((url, init) =>
      init?.method === "POST" && url.endsWith("/accessList") ? json(409, {}) : undefined,
    ),
  );
  await createAtlasClient(CREDS, dup.deps).addAccessList("p1"); // must not throw
});

test("getSrvUri injects URL-encoded credentials into the bare standardSrv", async () => {
  const { deps } = makeDeps(
    route((url) =>
      url.endsWith("/clusters/core")
        ? json(200, {
            stateName: "IDLE",
            connectionStrings: { standardSrv: "mongodb+srv://core.ab12c.mongodb.net" },
          })
        : undefined,
    ),
  );
  const uri = await createAtlasClient(CREDS, deps).getSrvUri("p1", "core", {
    username: "pos_user",
    password: "p@ss/word",
    dbName: "pos",
  });
  assert.equal(
    uri,
    "mongodb+srv://pos_user:p%40ss%2Fword@core.ab12c.mongodb.net/pos?retryWrites=true&w=majority",
  );
});

test("getSrvUri fails closed on a missing cluster or a bare cluster without srv", async () => {
  const gone = makeDeps(
    route((url) => (url.includes("/clusters/") ? new Response("{}", { status: 404 }) : undefined)),
  );
  await assert.rejects(
    createAtlasClient(CREDS, gone.deps).getSrvUri("p1", "core", {
      username: "u",
      password: "p",
      dbName: "pos",
    }),
    /cluster core not found/,
  );

  const bare = makeDeps(
    route((url) => (url.includes("/clusters/") ? json(200, { stateName: "CREATING" }) : undefined)),
  );
  await assert.rejects(
    createAtlasClient(CREDS, bare.deps).getSrvUri("p1", "core", {
      username: "u",
      password: "p",
      dbName: "pos",
    }),
    /exposes no standardSrv/,
  );
});

// ── Error + secret hygiene ────────────────────────────────────────────────────

test("errors carry status + Atlas errorCode only — never the request body/password", async () => {
  const PASSWORD = "sup3r-secret-pw";
  const { deps } = makeDeps(
    route((url, init) =>
      init?.method === "POST" && url.endsWith("/databaseUsers")
        ? json(500, { errorCode: "UNEXPECTED_ERROR", detail: "boom" })
        : undefined,
    ),
  );
  await assert.rejects(
    createAtlasClient(CREDS, deps).createDbUser("p1", {
      username: "u",
      password: PASSWORD,
      dbName: "pos",
    }),
    (err: Error) => {
      assert.match(err.message, /HTTP 500 UNEXPECTED_ERROR/);
      assert.ok(!err.message.includes(PASSWORD), "password must never leak into errors");
      return true;
    },
  );
});

test("buildSrvUri rejects a malformed standardSrv WITHOUT echoing it", () => {
  assert.throws(
    () =>
      buildSrvUri("mongodb+srv://leaked-user:leaked-pw@host/db", {
        username: "u",
        password: "p",
        dbName: "pos",
      }),
    (err: Error) => {
      assert.match(err.message, /unexpected standardSrv shape/);
      assert.ok(!err.message.includes("leaked-pw"));
      return true;
    },
  );
});

test("F3.5 grep gate — no console.* in the provider client modules", () => {
  for (const rel of [
    "./provider-retry.ts",
    "./atlas-plan.ts",
    "./atlas.ts",
    "./vercel.ts",
    "./imagestore.ts",
  ]) {
    const src = readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.ok(!/\bconsole\s*\./.test(src), `${rel} must never log (credentials flow through)`);
  }
});
