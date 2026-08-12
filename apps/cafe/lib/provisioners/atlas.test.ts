import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  ensureNextStandby,
  installAtlasProvisioner,
  __setAtlasDepsForTests,
} from "./atlas";
import {
  accessListBody,
  atlasConfigFromEnv,
  ATLAS_VERSIONED_JSON,
  buildLedgerUri,
  CLUSTER_POLL_MAX_ATTEMPTS,
  retryAfterMs,
  RETRY_AFTER_DEFAULT_MS,
  RETRY_AFTER_MAX_MS,
  type AtlasProvisionerConfig,
} from "./atlas-plan";
import {
  buildStandbyPushUpdate,
  mintNextStandbyTag,
  type RegistryUpdate,
} from "../ledger-scale-plan";
import {
  scaleCheck,
  setStandbyProvisioner,
  __setScaleDepsForTests,
} from "../ledger-scale";
import {
  setUriEncryptor,
  __resetRouterForTests,
  type StoredClusterRegistry,
} from "../cluster-router";

// F2 Step F2.8 — the Atlas provisioner, proven DB/HTTP-FREE. A stateful
// FakeAtlas stands in for the Admin API (projects/clusters/users/access list
// live across calls), so idempotency and crash-resume are provable by
// RE-RUNNING against the same fake org. The staging verify against a real test
// org (spec: "Verify (staging only)") is F2's integration pass — not here.

function fixtureDoc(overrides: Partial<StoredClusterRegistry> = {}): StoredClusterRegistry {
  return {
    _id: "cluster-registry",
    core: { id: "core", uri: "enc:mongodb://core/db", tag: "C" },
    ledgers: [
      { id: "l-a", uri: "enc:mongodb://a/db", tag: "A", from: null, to: "2026-04-01", active: false },
      { id: "l-a2", uri: "enc:mongodb://a2/db", tag: "A2", from: "2026-04-01", to: null, active: true },
    ],
    standby: [],
    ...overrides,
  };
}

const CFG: AtlasProvisionerConfig = {
  clientId: "sa-client",
  clientSecret: "sa-secret",
  orgId: "org-1",
  region: "AP_SOUTH_1",
  backingProvider: "AWS",
  ledgerDb: "pos",
  projectPrefix: "cafe",
};

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
}

/** Minimal stateful Admin-API fake: resources persist across calls/runs. */
class FakeAtlas {
  calls: Call[] = [];
  projects = new Map<string, { id: string }>(); // name → project
  clusters = new Map<string, { id: string; gets: number }>(); // pid/name
  users = new Map<string, { passwords: string[] }>(); // pid/username
  accessEntries = new Set<string>(); // pid
  tokensIssued = 0;
  /** GETs of a created cluster before it turns IDLE (0 = born IDLE). */
  creatingPollsBeforeIdle = 2;
  /** Queue of 429 injections: shift()ed per request; value = Retry-After. */
  rateLimitQueue: (string | null)[] = [];
  neverIdle = false;

  fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const path = url.replace("https://cloud.mongodb.com", "");
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    );
    const rawBody = typeof init?.body === "string" ? init.body : undefined;
    const isJson = headers["Content-Type"] === "application/json";
    const body = rawBody !== undefined && isJson ? JSON.parse(rawBody) : rawBody;
    this.calls.push({ method, path, headers, ...(body !== undefined ? { body } : {}) });

    if (this.rateLimitQueue.length > 0) {
      const ra = this.rateLimitQueue.shift();
      return json(429, {}, ra === null ? {} : { "Retry-After": ra ?? "" });
    }
    if (path === "/api/oauth/token" && method === "POST") {
      assert.equal(headers.Authorization, `Basic ${Buffer.from("sa-client:sa-secret").toString("base64")}`);
      assert.equal(headers["Content-Type"], "application/x-www-form-urlencoded");
      assert.equal(body, "grant_type=client_credentials");
      this.tokensIssued += 1;
      return json(200, { access_token: `tok-${this.tokensIssued}`, expires_in: 3600 });
    }
    // Every v2 call must carry the pinned version header + the bearer.
    assert.equal(headers.Accept, ATLAS_VERSIONED_JSON, `versioned Accept on ${path}`);
    assert.match(headers.Authorization ?? "", /^Bearer tok-\d+$/);

    let m: RegExpExecArray | null;
    if (path === "/api/atlas/v2/groups" && method === "POST") {
      const name = (body as { name: string }).name;
      assert.equal((body as { orgId: string }).orgId, "org-1");
      if (this.projects.has(name)) return json(409, { errorCode: "GROUP_ALREADY_EXISTS" });
      const proj = { id: `pid-${this.projects.size + 1}` };
      this.projects.set(name, proj);
      return json(201, proj);
    }
    if ((m = /^\/api\/atlas\/v2\/groups\/byName\/([^/]+)$/.exec(path)) && method === "GET") {
      const proj = this.projects.get(m[1]);
      return proj ? json(200, proj) : json(404, { errorCode: "GROUP_NOT_FOUND" });
    }
    if ((m = /^\/api\/atlas\/v2\/groups\/([^/]+)\/clusters$/.exec(path)) && method === "POST") {
      const name = (body as { name: string }).name;
      const key = `${m[1]}/${name}`;
      if (this.clusters.has(key)) return json(409, { errorCode: "DUPLICATE_CLUSTER_NAME" });
      this.clusters.set(key, { id: `cid-${this.clusters.size + 1}`, gets: 0 });
      return json(201, { id: this.clusters.get(key)?.id, stateName: "CREATING" });
    }
    if ((m = /^\/api\/atlas\/v2\/groups\/([^/]+)\/clusters\/([^/]+)$/.exec(path)) && method === "GET") {
      const c = this.clusters.get(`${m[1]}/${m[2]}`);
      if (!c) return json(404, { errorCode: "CLUSTER_NOT_FOUND" });
      c.gets += 1;
      const idle = !this.neverIdle && c.gets > this.creatingPollsBeforeIdle;
      return json(200, {
        id: c.id,
        stateName: idle ? "IDLE" : "CREATING",
        ...(idle ? { connectionStrings: { standardSrv: `mongodb+srv://${m[2]}.ab1cd.mongodb.net` } } : {}),
      });
    }
    if ((m = /^\/api\/atlas\/v2\/groups\/([^/]+)\/databaseUsers$/.exec(path)) && method === "POST") {
      const b = body as { username: string; password: string };
      const key = `${m[1]}/${b.username}`;
      if (this.users.has(key)) return json(409, { errorCode: "USER_ALREADY_EXISTS" });
      this.users.set(key, { passwords: [b.password] });
      return json(201, {});
    }
    if ((m = /^\/api\/atlas\/v2\/groups\/([^/]+)\/databaseUsers\/admin\/([^/]+)$/.exec(path)) && method === "PATCH") {
      const u = this.users.get(`${m[1]}/${m[2]}`);
      if (!u) return json(404, { errorCode: "USER_NOT_FOUND" });
      u.passwords.push((body as { password: string }).password);
      return json(200, {});
    }
    if ((m = /^\/api\/atlas\/v2\/groups\/([^/]+)\/accessList$/.exec(path)) && method === "POST") {
      if (this.accessEntries.has(m[1])) return json(409, { errorCode: "ATLAS_ENTRY_ALREADY_EXISTS" });
      this.accessEntries.add(m[1]);
      assert.deepEqual(body, accessListBody());
      return json(201, {});
    }
    throw new Error(`FakeAtlas: unhandled ${method} ${path}`);
  };
}
function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

interface Harness {
  fake: FakeAtlas;
  updates: RegistryUpdate[];
  sleeps: number[];
  docReads: number;
}
function install(cfg: {
  doc: StoredClusterRegistry | null;
  config?: AtlasProvisionerConfig | null;
  matchedCount?: number;
  /** Doc returned by re-reads AFTER a lost CAS. */
  freshDoc?: StoredClusterRegistry | null;
}): Harness {
  const fake = new FakeAtlas();
  const h: Harness = { fake, updates: [], sleeps: [], docReads: 0 };
  __setAtlasDepsForTests({
    fetchImpl: fake.fetchImpl,
    readRegistryDoc: async () => {
      h.docReads += 1;
      const doc = h.docReads > 1 && cfg.freshDoc !== undefined ? cfg.freshDoc : cfg.doc;
      return doc ? structuredClone(doc) : null;
    },
    updateRegistryDoc: async (upd) => {
      h.updates.push(upd);
      return cfg.matchedCount ?? 1;
    },
    sleep: async (ms) => {
      h.sleeps.push(ms);
    },
    randomSecret: () => "s3cr3t/+pw",
    config: () => (cfg.config === undefined ? CFG : cfg.config),
    now: () => 1_750_000_000_000,
  });
  return h;
}

beforeEach(() => {
  __resetRouterForTests();
  __setAtlasDepsForTests(null);
});
afterEach(() => {
  __resetRouterForTests();
  __setAtlasDepsForTests(null);
  __setScaleDepsForTests(null);
  setStandbyProvisioner(null);
});

// ── Short-circuits (no Atlas traffic) ─────────────────────────────────────────

test("no Service-Account env → not-configured, zero HTTP + zero registry writes", async () => {
  const h = install({ doc: fixtureDoc(), config: null });
  assert.deepEqual(await ensureNextStandby(), { status: "not-configured" });
  assert.equal(h.fake.calls.length, 0);
  assert.equal(h.updates.length, 0);
});

test("bootstrap era (no registry doc) → no-registry-doc: F3's paste creates the doc, the API is never touched", async () => {
  const h = install({ doc: null });
  assert.deepEqual(await ensureNextStandby(), { status: "no-registry-doc" });
  assert.equal(h.fake.calls.length, 0);
  assert.equal(h.updates.length, 0);
});

test("a standby already warm → already-armed (the spec's idempotent re-run no-op)", async () => {
  const h = install({
    doc: fixtureDoc({ standby: [{ id: "l-a3", uri: "enc:x", tag: "A3", empty: true }] }),
  });
  assert.deepEqual(await ensureNextStandby(), { status: "already-armed" });
  assert.equal(h.fake.calls.length, 0);
  assert.equal(h.updates.length, 0);
});

// ── The full flow ─────────────────────────────────────────────────────────────

test("fresh org: token → project → M0 (TENANT) → poll IDLE → user → 0.0.0.0/0 → guarded standby push", async () => {
  const h = install({ doc: fixtureDoc() });
  const res = await ensureNextStandby();
  assert.deepEqual(res, {
    status: "pushed",
    tag: "A3", // minted by F2.7's single mint path over ledger tags A/A2
    projectId: "pid-1",
    clusterName: "ledger-a3",
  });

  // The exact call sequence (deterministic names keyed by the minted tag).
  assert.deepEqual(
    h.fake.calls.map((c) => `${c.method} ${c.path}`),
    [
      "POST /api/oauth/token",
      "POST /api/atlas/v2/groups",
      "GET /api/atlas/v2/groups/pid-1/clusters/ledger-a3", // absent → create
      "POST /api/atlas/v2/groups/pid-1/clusters",
      "GET /api/atlas/v2/groups/pid-1/clusters/ledger-a3", // CREATING
      "GET /api/atlas/v2/groups/pid-1/clusters/ledger-a3", // CREATING
      "GET /api/atlas/v2/groups/pid-1/clusters/ledger-a3", // IDLE
      "POST /api/atlas/v2/groups/pid-1/databaseUsers",
      "POST /api/atlas/v2/groups/pid-1/accessList",
    ],
  );
  assert.equal(h.fake.tokensIssued, 1); // one bearer reused across the run

  const projectBody = h.fake.calls[1].body as { name: string; orgId: string };
  assert.deepEqual(projectBody, { name: "cafe-ledger-a3", orgId: "org-1" });
  const clusterBody = h.fake.calls[3].body as Record<string, unknown>;
  assert.deepEqual(clusterBody, {
    name: "ledger-a3",
    clusterType: "REPLICASET",
    replicationSpecs: [
      {
        regionConfigs: [
          {
            providerName: "TENANT",
            backingProviderName: "AWS",
            regionName: "AP_SOUTH_1",
            priority: 7,
            electableSpecs: { instanceSize: "M0" },
          },
        ],
      },
    ],
  });
  const userBody = h.fake.calls[7].body as Record<string, unknown>;
  assert.deepEqual(userBody, {
    databaseName: "admin",
    username: "ledger_a3",
    password: "s3cr3t/+pw",
    roles: [{ roleName: "readWrite", databaseName: "pos" }],
  });

  // ONE registry write: the CAS-guarded push of the warm empty standby.
  assert.equal(h.updates.length, 1);
  assert.deepEqual(h.updates[0], {
    filter: {
      _id: "cluster-registry",
      "standby.0": { $exists: false },
      ledgers: { $not: { $elemMatch: { tag: "A3" } } },
    },
    update: {
      $push: {
        standby: {
          id: "cid-1",
          uri: "mongodb+srv://ledger_a3:s3cr3t%2F%2Bpw@ledger-a3.ab1cd.mongodb.net/pos?retryWrites=true&w=majority",
          tag: "A3",
          empty: true,
        },
      },
    },
  });
  // Poll pacing rode the sleep seam (2 CREATING polls).
  assert.deepEqual(h.sleeps, [15_000, 15_000]);
});

test("crash-resume: every resource half-created by a dead run is ADOPTED (409→byName, GET-first, PATCH password) — and the pushed URI carries THIS run's password", async () => {
  // Run 1 dies after user creation: simulate by pre-populating the fake org.
  const h1 = install({ doc: fixtureDoc() });
  await ensureNextStandby();
  const fake = h1.fake;

  // Run 2 against the SAME fake org (registry push "never happened": doc still standby-empty).
  const h2: Harness = { fake, updates: [], sleeps: [], docReads: 0 };
  __setAtlasDepsForTests({
    fetchImpl: fake.fetchImpl,
    readRegistryDoc: async () => structuredClone(fixtureDoc()),
    updateRegistryDoc: async (upd) => {
      h2.updates.push(upd);
      return 1;
    },
    sleep: async () => {},
    randomSecret: () => "new-pass-2",
    config: () => CFG,
    now: () => 1_750_000_000_000,
  });
  fake.calls = [];
  const res = await ensureNextStandby();
  assert.equal(res.status, "pushed");
  assert.deepEqual(
    fake.calls.map((c) => `${c.method} ${c.path}`),
    [
      "POST /api/oauth/token",
      "POST /api/atlas/v2/groups", // 409 GROUP_ALREADY_EXISTS
      "GET /api/atlas/v2/groups/byName/cafe-ledger-a3", // adopt
      "GET /api/atlas/v2/groups/pid-1/clusters/ledger-a3", // already IDLE — no create, no poll
      "POST /api/atlas/v2/groups/pid-1/databaseUsers", // 409 USER_ALREADY_EXISTS
      "PATCH /api/atlas/v2/groups/pid-1/databaseUsers/admin/ledger_a3", // reset
      "POST /api/atlas/v2/groups/pid-1/accessList", // 409 tolerated
    ],
  );
  // The user's live password is the PATCHed one, and the pushed URI carries it.
  const passwords = fake.users.get("pid-1/ledger_a3")?.passwords ?? [];
  assert.equal(passwords[passwords.length - 1], "new-pass-2");
  const pushed = (h2.updates[0].update as { $push: { standby: { uri: string } } }).$push.standby;
  assert.match(pushed.uri, /ledger_a3:new-pass-2@/);
});

test("429s honor Retry-After through the sleep seam; exhaustion throws without leaking secrets", async () => {
  const h = install({ doc: fixtureDoc() });
  h.fake.rateLimitQueue = ["7", null]; // 7s, then a 429 with NO header → default
  const res = await ensureNextStandby();
  assert.equal(res.status, "pushed");
  assert.equal(h.sleeps[0], 7_000);
  assert.equal(h.sleeps[1], RETRY_AFTER_DEFAULT_MS);

  const h2 = install({ doc: fixtureDoc() });
  h2.fake.rateLimitQueue = ["1", "1", "1", "1", "1"]; // > RATE_LIMIT_MAX_RETRIES
  await assert.rejects(ensureNextStandby(), (err: Error) => {
    assert.match(err.message, /still 429 after 5 attempts/);
    assert.doesNotMatch(err.message, /s3cr3t|sa-secret/);
    return true;
  });
});

test("a cluster that never turns IDLE throws a bounded, resumable timeout", async () => {
  const h = install({ doc: fixtureDoc() });
  h.fake.neverIdle = true;
  await assert.rejects(ensureNextStandby(), /not IDLE after 60 polls/);
  assert.equal(h.sleeps.length, CLUSTER_POLL_MAX_ATTEMPTS);
  assert.equal(h.updates.length, 0); // nothing half-pushed into the registry
});

test("a lost push CAS re-reads: our id present → already-armed; a foreign standby → raced (orphan logged)", async () => {
  const mine = {
    id: "cid-1",
    uri: "mongodb+srv://x",
    tag: "A3",
    empty: true,
  };
  const h1 = install({
    doc: fixtureDoc(),
    matchedCount: 0,
    freshDoc: fixtureDoc({ standby: [mine] }),
  });
  assert.equal((await ensureNextStandby()).status, "already-armed");
  assert.equal(h1.updates.length, 1);

  const h2 = install({
    doc: fixtureDoc(),
    matchedCount: 0,
    freshDoc: fixtureDoc({ standby: [{ id: "pasted-1", uri: "enc:y", empty: true }] }),
  });
  assert.equal((await ensureNextStandby()).status, "raced");
  assert.equal(h2.updates.length, 1);

  // The race the guard's tag clause exists for: between our read and our push,
  // a manual paste landed AND a flip promoted it under the SAME minted tag A3
  // (mintOrValidateStandbyTag derives A3 from the same doc state). The filter's
  // `ledgers $not $elemMatch {tag}` refuses server-side (matchedCount 0); the
  // re-read sees an A3 LEDGER, empty standby, our id nowhere → raced + orphan.
  install({
    doc: fixtureDoc(),
    matchedCount: 0,
    freshDoc: fixtureDoc({
      ledgers: [
        ...fixtureDoc().ledgers.map((l) => ({ ...l, active: false, to: l.to ?? "2026-07-06" })),
        { id: "pasted-1", uri: "enc:y", tag: "A3", from: "2026-07-05", to: null, active: true },
      ],
      standby: [],
    }),
  });
  const raced = await ensureNextStandby();
  assert.equal(raced.status, "raced");
  assert.equal(raced.tag, "A3"); // both writers minted the same tag — by design
});

// ── The write-side vault seam ─────────────────────────────────────────────────

test("the pushed URI passes through encryptUriForStore (identity today; F3's vault later)", async () => {
  setUriEncryptor((u) => `enc:${u}`);
  const h = install({ doc: fixtureDoc() });
  await ensureNextStandby();
  const pushed = (h.updates[0].update as { $push: { standby: { uri: string } } }).$push.standby;
  assert.match(pushed.uri, /^enc:mongodb\+srv:\/\/ledger_a3:/);
});

// ── Wiring into F2.7's setStandbyProvisioner ──────────────────────────────────

test("installAtlasProvisioner: configured → scaleCheck's nudge drives the REAL Atlas flow; unconfigured → false, manual prompt stays", async () => {
  const h = install({ doc: fixtureDoc() });
  assert.equal(installAtlasProvisioner(), true);
  // ≥70% active + NO standby → prompt-no-standby + a fire-and-forget nudge.
  __setScaleDepsForTests({
    readRegistryDoc: async () => fixtureDoc(),
    updateRegistryDoc: async () => 1,
    readStats: async () => ({ dataSize: 400 * 1024 * 1024, indexSize: 0 }),
    ping: async () => {},
    now: () => new Date("2026-07-05T04:30:00.000Z"),
  });
  const res = await scaleCheck();
  assert.equal(res.status, "prompt-no-standby");
  for (let i = 0; i < 200 && h.updates.length === 0; i += 1) {
    await new Promise((r) => setImmediate(r)); // the nudge is fire-and-forget
  }
  assert.equal(h.updates.length, 1, "the nudge ran the Atlas provisioner to a push");

  __setAtlasDepsForTests({ config: () => null });
  assert.equal(installAtlasProvisioner(), false);
});

// ── Pure helpers (atlas-plan + the ledger-scale-plan builders) ────────────────

test("retryAfterMs: delta-seconds, HTTP-date, clamps, and garbage default", () => {
  const now = Date.parse("2026-07-05T10:00:00.000Z");
  assert.equal(retryAfterMs("7", now), 7_000);
  assert.equal(retryAfterMs("0", now), 0);
  assert.equal(retryAfterMs("9999", now), RETRY_AFTER_MAX_MS);
  assert.equal(retryAfterMs("Sun, 05 Jul 2026 10:00:30 GMT", now), 30_000);
  assert.equal(retryAfterMs("Sun, 05 Jul 2026 09:00:00 GMT", now), 0); // past → 0
  assert.equal(retryAfterMs(null, now), RETRY_AFTER_DEFAULT_MS);
  assert.equal(retryAfterMs("soon", now), RETRY_AFTER_DEFAULT_MS);
});

test("buildLedgerUri injects URL-encoded creds + db; refuses a cred-bearing or pathed SRV without echoing it", () => {
  assert.equal(
    buildLedgerUri("mongodb+srv://c1.ab.mongodb.net", "u@x", "p/w:1", "pos"),
    "mongodb+srv://u%40x:p%2Fw%3A1@c1.ab.mongodb.net/pos?retryWrites=true&w=majority",
  );
  assert.equal(
    buildLedgerUri(" mongodb+srv://c1.ab.mongodb.net/ ", "u", "p", "pos"),
    "mongodb+srv://u:p@c1.ab.mongodb.net/pos?retryWrites=true&w=majority",
  );
  for (const bad of ["mongodb://c1.ab.mongodb.net", "mongodb+srv://u:p@evil", "mongodb+srv://evil/db?x=1"]) {
    assert.throws(
      () => buildLedgerUri(bad, "u", "p", "pos"),
      (err: Error) => {
        assert.ok(!err.message.includes(bad), "the refused SRV string is never echoed");
        return /unexpected standardSrv shape/.test(err.message);
      },
    );
  }
});

test("atlasConfigFromEnv: null without SA creds; defaults + TENANT_ID prefix fallback with them", () => {
  const saved = { ...process.env };
  try {
    delete process.env.ATLAS_SA_CLIENT_ID;
    delete process.env.ATLAS_SA_CLIENT_SECRET;
    delete process.env.ATLAS_ORG_ID;
    assert.equal(atlasConfigFromEnv(), null);
    process.env.ATLAS_SA_CLIENT_ID = "id";
    process.env.ATLAS_SA_CLIENT_SECRET = "sec";
    process.env.ATLAS_ORG_ID = "org";
    delete process.env.ATLAS_REGION;
    delete process.env.ATLAS_BACKING_PROVIDER;
    delete process.env.ATLAS_LEDGER_DB;
    delete process.env.ATLAS_PROJECT_PREFIX;
    process.env.TENANT_ID = "lucky-cafe";
    assert.deepEqual(atlasConfigFromEnv(), {
      clientId: "id",
      clientSecret: "sec",
      orgId: "org",
      region: "AP_SOUTH_1",
      backingProvider: "AWS",
      ledgerDb: "pos",
      projectPrefix: "lucky-cafe",
    });
  } finally {
    process.env = saved;
  }
});

test("mintNextStandbyTag rides F2.7's A-series over ledger AND pre-minted standby tags", () => {
  assert.equal(mintNextStandbyTag(fixtureDoc()), "A3");
  assert.equal(
    mintNextStandbyTag(fixtureDoc({ standby: [{ id: "s", uri: "u", tag: "A3" }] })),
    "A4",
  );
  assert.equal(mintNextStandbyTag(fixtureDoc({ ledgers: [], standby: [] })), "A");
});

test("buildStandbyPushUpdate guards on an EMPTY standby slot and an untaken tag (universal $not+$elemMatch, never a misreadable bare $ne)", () => {
  const entry = { id: "cid-9", uri: "enc:u", tag: "A3", empty: true };
  assert.deepEqual(buildStandbyPushUpdate(fixtureDoc(), entry), {
    filter: {
      _id: "cluster-registry",
      "standby.0": { $exists: false },
      // Must NOT match a doc where ANY ledger already carries the tag — the
      // paste-then-flip race mints the SAME next tag from the same doc state.
      // Server-side matching is pinned in the seeded-M0 integration pass.
      ledgers: { $not: { $elemMatch: { tag: "A3" } } },
    },
    update: { $push: { standby: entry } },
  });
});

test("concurrent in-process calls single-flight into ONE Atlas run", async () => {
  const h = install({ doc: fixtureDoc() });
  const [a, b] = await Promise.all([ensureNextStandby(), ensureNextStandby()]);
  assert.deepEqual(a, b);
  assert.equal(a.status, "pushed");
  assert.equal(h.fake.tokensIssued, 1);
  assert.equal(h.updates.length, 1); // one run, one push — not two
});
