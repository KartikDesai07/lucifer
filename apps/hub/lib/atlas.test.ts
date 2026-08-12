import { test } from "node:test";
import assert from "node:assert/strict";

import { createAtlasClient } from "./atlas";
import type { RetryDeps } from "./provider-retry";

// DB-free tests for the F3.5 Hub Atlas client — the TOKEN + PROJECT half
// (cluster/user/accessList/srv ops live in lib/atlas-ops.test.ts, split per
// the 300-line rule). Fake fetch + a virtual clock (sleeps advance it), so the
// step-verify legs — "a simulated 429 backs off the exact Retry-After" and
// "token refresh fires before 3600s expiry" — are exact assertions.

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
  return { deps, calls, sleeps, advance: (ms: number) => void (clock += ms) };
}

function json(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers });
}
const token = (tok: string) => json(200, { access_token: tok, expires_in: 3600 });
const isTokenCall = (c: { url: string }) => c.url.endsWith("/api/oauth/token");
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Handler for the happy paths: token + whatever `routes` matches. */
function route(routes: (url: string, init?: RequestInit) => Response | undefined): Handler {
  return (url, init) => {
    if (url.endsWith("/api/oauth/token")) return token("tok-1");
    const hit = routes(url, init);
    if (!hit) throw new Error(`unexpected ${init?.method ?? "GET"} ${url}`);
    return hit;
  };
}

// ── Token cache + refresh ─────────────────────────────────────────────────────

test("one bearer serves many calls; Basic auth + form grant on the token call", async () => {
  const { deps, calls } = makeDeps(
    route((url) => (url.includes("/accessList") ? json(201, {}) : undefined)),
  );
  const atlas = createAtlasClient(CREDS, deps);
  await atlas.addAccessList("p1");
  await atlas.addAccessList("p1");

  const tokenCalls = calls.filter(isTokenCall);
  assert.equal(tokenCalls.length, 1, "second call reuses the cached bearer");
  assert.equal(
    tokenCalls[0].headers.get("Authorization"),
    `Basic ${Buffer.from("sa-id:sa-secret").toString("base64")}`,
  );
  assert.equal(tokenCalls[0].headers.get("Content-Type"), "application/x-www-form-urlencoded");
  assert.equal(tokenCalls[0].body, "grant_type=client_credentials");

  const apiCalls = calls.filter((c) => !isTokenCall(c));
  assert.equal(apiCalls.length, 2);
  for (const c of apiCalls) {
    assert.equal(c.headers.get("Authorization"), "Bearer tok-1");
    assert.equal(c.headers.get("Accept"), "application/vnd.atlas.2023-01-01+json");
  }
});

test("token refresh fires BEFORE the 3600s expiry — 300s early (60s base + 4×60s stacked-429 worst case)", async () => {
  let minted = 0;
  const { deps, calls, advance } = makeDeps((url) => {
    if (url.endsWith("/api/oauth/token")) {
      minted += 1;
      return token(`tok-${minted}`);
    }
    return json(201, {});
  });
  const atlas = createAtlasClient(CREDS, deps);

  await atlas.addAccessList("p1"); // mints tok-1 at NOW; expires NOW+3600s
  advance(3_299_000); // 1s BEFORE the expiry−300s boundary → still cached
  await atlas.addAccessList("p1");
  assert.equal(minted, 1);

  advance(1_000); // exactly expiry − 300s → refresh fires, a full retry-run early
  await atlas.addAccessList("p1");
  assert.equal(minted, 2);
  const last = calls[calls.length - 1];
  assert.equal(last.headers.get("Authorization"), "Bearer tok-2");
});

test("a token that outlives its slack cannot expire inside one worst-case 429 run", async () => {
  // The F3.5 review scenario: the request starts just inside the cached
  // window, then eats the maximum stacked rate-limit waits (4 × 60s). With
  // the 300s slack the SAME bearer is still valid on the final attempt.
  let minted = 0;
  let posts = 0;
  const { deps, sleeps, advance } = makeDeps((url) => {
    if (url.endsWith("/api/oauth/token")) {
      minted += 1;
      return token(`tok-${minted}`);
    }
    posts += 1;
    return posts <= 4
      ? new Response("{}", { status: 429, headers: { "Retry-After": "60" } })
      : json(201, {});
  });
  const atlas = createAtlasClient(CREDS, deps);
  // The first call mints at NOW, then eats four 429s and succeeds on attempt 5
  // — all on the one bearer, which stays valid throughout.
  await atlas.addAccessList("p1");
  assert.equal(minted, 1);
  assert.deepEqual(sleeps, [60_000, 60_000, 60_000, 60_000]);
  // 240s elapsed on the virtual clock; the token (3600s) is still cached and
  // safely clear of expiry: the NEXT call at +3059s of remaining life re-mints
  // only once past the 300s boundary.
  advance(3_600_000 - 240_000 - 300_000 - 1_000); // 1s inside the cached window
  await atlas.addAccessList("p1");
  assert.equal(minted, 1);
  advance(1_000); // boundary crossed
  await atlas.addAccessList("p1");
  assert.equal(minted, 2);
});

// ── createProject ─────────────────────────────────────────────────────────────

test("createProject POSTs {name, orgId} and returns the new id", async () => {
  const { deps, calls } = makeDeps(
    route((url, init) =>
      init?.method === "POST" && url.endsWith("/api/atlas/v2/groups")
        ? json(201, { id: "proj-1" })
        : undefined,
    ),
  );
  const atlas = createAtlasClient(CREDS, deps);
  assert.equal(await atlas.createProject("pos-cafe-a"), "proj-1");
  const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/groups"));
  assert.deepEqual(JSON.parse(post!.body!), { name: "pos-cafe-a", orgId: "org-1" });
});

test("createProject 409 ADOPTS the existing project byName (resume)", async () => {
  const { deps, calls } = makeDeps(
    route((url, init) => {
      if (init?.method === "POST" && url.endsWith("/groups")) return json(409, {});
      if (url.endsWith("/groups/byName/pos-cafe-a")) return json(200, { id: "proj-existing" });
      return undefined;
    }),
  );
  const atlas = createAtlasClient(CREDS, deps);
  assert.equal(await atlas.createProject("pos-cafe-a"), "proj-existing");
  assert.ok(calls.some((c) => c.url.endsWith("/groups/byName/pos-cafe-a")));
});

test("createProject honors the exact Retry-After on a 429", async () => {
  let posts = 0;
  const { deps, sleeps } = makeDeps(
    route((url, init) => {
      if (init?.method === "POST" && url.endsWith("/groups")) {
        posts += 1;
        return posts === 1
          ? new Response("{}", { status: 429, headers: { "Retry-After": "30" } })
          : json(201, { id: "proj-1" });
      }
      return undefined;
    }),
  );
  const atlas = createAtlasClient(CREDS, deps);
  assert.equal(await atlas.createProject("pos-cafe-a"), "proj-1");
  assert.deepEqual(sleeps, [30_000]);
});

test("project creation is serialized across client instances", async () => {
  let release!: (r: Response) => void;
  const gate = new Promise<Response>((resolve) => (release = resolve));
  const creates: string[] = [];
  const { deps } = makeDeps((url, init) => {
    if (url.endsWith("/api/oauth/token")) return token("t");
    if (init?.method === "POST" && url.endsWith("/groups")) {
      creates.push((JSON.parse(String(init.body)) as { name: string }).name);
      return creates.length === 1 ? gate : json(201, { id: "p2" });
    }
    throw new Error(`unexpected ${init?.method} ${url}`);
  });
  const clientA = createAtlasClient(CREDS, deps);
  const clientB = createAtlasClient({ ...CREDS, orgId: "org-2" }, deps);

  const a = clientA.createProject("proj-a");
  const b = clientB.createProject("proj-b");
  await settle();
  await settle();
  assert.deepEqual(creates, ["proj-a"], "B must not issue its POST while A is in flight");

  release(json(201, { id: "p1" }));
  assert.equal(await a, "p1");
  assert.equal(await b, "p2");
  assert.deepEqual(creates, ["proj-a", "proj-b"]);
});
