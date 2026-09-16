import mongoose, {
  type Connection,
  type ConnectOptions,
  type Model,
  type Schema,
} from "mongoose";

import { getOrderModel, orderSchema } from "@/models/order.ledger";
import { assertSchemaTtlAllowed } from "@/lib/ttl-guard";
import { counterSchema } from "@/models/Counter";
import { productSchema } from "@/models/Product";
import { categorySchema } from "@/models/Category";
import { customerSchema } from "@/models/Customer";
import { staffSchema } from "@/models/Staff";
import { settingsSchema } from "@/models/Settings";
import { tableSchema } from "@/models/Table";
import { reservationSchema } from "@/models/Reservation";
import { eventSchema } from "@/models/Event";

// ─────────────────────────────────────────────────────────────────────────────
// F2 Step F2.1 — the per-cluster connection registry (the foundational rewrite of
// v1's single cached connection). v1 `lib/db.ts` caches ONE `mongoose.connect()`
// on `global._mongoose`; F2 generalizes that exact survival trick to N pools — one
// `mongoose.createConnection()` per free Atlas M0, cached in a `globalThis` Map,
// lazy-connected, bounded, registering SCHEMAS (not bound models) per connection
// via `conn.model(name, schema)` (build-rule #21 / F2 §2.2/§3.1).
//
// This file owns ONLY the registry mechanics: open/cache/close a pool by id, and
// bind a model on a given pool. WHICH cluster a request routes to (CORE vs the
// active time-sharded LEDGER, date-window fan-out, orderId-tag targeting) is the
// F2.2 router (`lib/cluster-router.ts`) built on top of this. The v1 `connectDB()`
// + default-bound models stay live and untouched: the route cutover onto this
// registry is P2's job (the String-`orderId` rewrite, build-rules #44/#45). So the
// running cafe app stays green while this seam lands beneath it.
//
// Connection-cap math (F2 §2.3): total sockets = (warm instances) × (touched
// clusters) MUST stay under M0's hard 500-connection cap. Hence `maxPoolSize 5`
// (v1 used 10 for ONE cluster; there are now many), `minPoolSize 0`,
// `maxIdleTimeMS 60s` to shrink idle pools, and — critically — LAZY connect: a
// cluster opens ZERO sockets until a request actually routes to it.
// ─────────────────────────────────────────────────────────────────────────────

// Query hardening carried over verbatim from v1 `lib/db.ts`: `strictQuery` drops
// unknown filter keys. We deliberately do NOT enable a global `sanitizeFilter` — it
// wraps any `$`-bearing filter value in `$eq`, which BREAKS the legitimate operator
// queries the app relies on (date ranges, `$in`, `$regex`). Injection is prevented
// instead by Zod-validating every input to primitives + escapeRegex() on search.
mongoose.set("strictQuery", true);

/**
 * The minimal cluster locator the registry needs: a STABLE id (the Map key, also
 * the heartbeat/registry-doc id) + the connection URI. The F2.2 router's richer
 * descriptors (`{ id, uri, tag, role, from, to, active, … }` from the CORE registry
 * doc, F2 §3.5) structurally satisfy this — `getConn` only ever reads `id`/`uri`.
 */
export interface ClusterRef {
  id: string;
  uri: string;
}

/** Per-pool connection options (F2 §2.3 / §3.1). Bounded so the socket count stays
 *  provably under M0's 500-connection cap across many warm instances × clusters. */
export const CLUSTER_POOL_OPTIONS: ConnectOptions = {
  bufferCommands: false,
  maxPoolSize: 5,
  minPoolSize: 0,
  maxIdleTimeMS: 60_000,
  serverSelectionTimeoutMS: 5_000,
};

/** The 10 federated model names. `Order` lives on the LEDGER; the other 9 on CORE
 *  (F2 §3.2). The schema→model binding for `Order` is owned by F2c's
 *  `getOrderModel` accessor (#34) — never re-registered here. */
export const FEDERATED_MODELS = [
  "Order",
  "Counter",
  "Product",
  "Category",
  "Customer",
  "Staff",
  "Settings",
  "Table",
  "Reservation",
  "Event",
] as const;
export type ModelName = (typeof FEDERATED_MODELS)[number];

// The schema registry for every NON-Order model (schemas-not-models, #21). `Order`
// is excluded on purpose: F2c owns its shape + binding (#34), reached via
// `getOrderModel(conn)` below — never `conn.model('Order', someSchemaCopy)` here,
// which would risk a second, drifting Order schema. A total `Record` over the
// non-Order names means a future model can't be silently forgotten — TS flags it.
const SCHEMAS: Record<Exclude<ModelName, "Order">, Schema> = {
  Counter: counterSchema,
  Product: productSchema,
  Category: categorySchema,
  Customer: customerSchema,
  Staff: staffSchema,
  Settings: settingsSchema,
  Table: tableSchema,
  Reservation: reservationSchema,
  Event: eventSchema,
};

// TTL allowlist guard (F2.10, build-rule #23): every schema this registry can
// register — the 9 above plus F2c's canonical orderSchema — is asserted TTL-free
// at MODULE LOAD, so a forbidden TTL index (GST §36 retention) fails the boot
// and every test run, never a live cluster. The LEDGER computed collections
// (`daily-rollup.ledger.ts`) self-assert the same way; F3.7's Hub-side
// `heartbeats` index is the allowlisted exception, consulted from the same
// shared list (`@pos/shared/ttl-guard`).
for (const [name, schema] of Object.entries(SCHEMAS)) {
  assertSchemaTtlAllowed(name, schema);
}
assertSchemaTtlAllowed("Order", orderSchema);

// Cache the pool Map on the Node global so it survives hot reloads in dev and is
// reused across warm serverless invocations — the same survival trick v1's
// `global._mongoose` used, generalized from one connection to a Map of N. (The F2
// plan §3.1/§4 refers to this global as `__clusters`; `__clusterConns` is the same
// cache under a more precise, collision-free name.)
declare global {
  var __clusterConns: Map<string, Connection> | undefined;
}
const conns: Map<string, Connection> = (globalThis.__clusterConns ??= new Map());

// Connection opener — overridable in unit tests so the registry's pooling/binding
// logic is provable DB-free on this box (the authoritative live socket/$type
// assertions run against a seeded M0 in F2's integration pass, mirroring
// order.ledger.test's "static guard now, live assertion in F2" split, F2c §1/§10).
type ConnectionOpener = (uri: string, opts: ConnectOptions) => Connection;
const defaultOpener: ConnectionOpener = (uri, opts) =>
  mongoose.createConnection(uri, opts);
let openConnection: ConnectionOpener = defaultOpener;

/** TEST SEAM ONLY — inject a fake connection opener; pass `null` to restore the
 *  real `mongoose.createConnection`. Never called by application code. */
export function __setConnectionOpenerForTests(
  opener: ConnectionOpener | null,
): void {
  openConnection = opener ?? defaultOpener;
}

/**
 * Lazily open (or return the cached) bounded connection pool for one cluster.
 * `createConnection` returns a Connection immediately, NOT a promise — readiness is
 * awaited via `conn.asPromise()` (idempotent: every caller awaits the same initial
 * connection). Untouched clusters open zero sockets. On a failed INITIAL connect the
 * dead handle is evicted + closed so a later call re-dials a fresh pool (mirrors v1
 * `db.ts` nulling its cached promise on failure).
 */
export async function getConn(cluster: ClusterRef): Promise<Connection> {
  let conn = conns.get(cluster.id);
  if (!conn) {
    // INVARIANT: this whole block stays await-free. `createConnection` returns
    // synchronously (fire-and-forget connect), and `conns.set` runs BEFORE the first
    // `await` (below) — so two concurrent getConn(sameId) callers coalesce onto one
    // pool. Introducing an await between `conns.get` and `conns.set` would let them
    // each open a pool and leak a socket against M0's 500-connection cap.
    conn = openConnection(cluster.uri, CLUSTER_POOL_OPTIONS);
    // An EventEmitter with no 'error' listener THROWS on an error event and crashes
    // the process — attach one BEFORE the asPromise() await, so mongoose's deferred
    // initial-connect error emit always finds a listener. (Surfaced via the host's
    // function logs, matching the shared `serverError` convention.) The 'disconnected'
    // → mark-cluster-down health hook + the per-cluster `db.stats()` heartbeat are
    // F2.7/F2.9, not the registry's job (a deliberate divergence from §F2.1's
    // `markDown` pseudocode); mongoose auto-reconnects a transient blip, so we do NOT
    // evict on it.
    conn.on("error", (err) => {
      console.error(`[cluster-registry] connection error on ${cluster.id}:`, err);
    });
    conns.set(cluster.id, conn);
  }
  try {
    await conn.asPromise();
  } catch (err) {
    // Failed INITIAL connect: evict + close so a later call re-dials a fresh pool
    // (mirrors v1 db.ts nulling its cached promise on failure). BOTH guarded by the
    // identity check so that when two callers share the same failing connection, only
    // the one still owning the Map entry tears it down — no double-close.
    if (conns.get(cluster.id) === conn) {
      conns.delete(cluster.id);
      void conn.close().catch(() => {});
    }
    throw err;
  }
  return conn;
}

/**
 * Return the model `name` bound on `cluster`'s pool, compiling it once per
 * connection (`conn.models[name] ?? conn.model(name, schema)` — no recompile,
 * no OverwriteModelError). `Order` is bound through F2c's canonical `getOrderModel`
 * accessor so this registry never re-derives the Order shape (#34); every other
 * model binds from the central SCHEMAS map (schemas-not-models, #21). The F2.2
 * router wraps this as typed `coreModel(name)` / `ledgerModel(cluster,name)`.
 */
export async function modelFor(
  cluster: ClusterRef,
  name: ModelName,
): Promise<Model<unknown>> {
  const conn = await getConn(cluster);
  if (name === "Order") return getOrderModel(conn) as unknown as Model<unknown>;
  const cached = conn.models[name];
  if (cached) return cached;
  return conn.model(name, SCHEMAS[name]) as unknown as Model<unknown>;
}

/**
 * Close every pooled connection and clear the registry. A shutdown / TEST helper —
 * application routes NEVER call this (a warm instance keeps its pools hot across
 * requests; that reuse is the whole point of the global Map).
 */
export async function disconnectAll(): Promise<void> {
  const all = [...conns.values()];
  conns.clear();
  await Promise.all(all.map((c) => c.close().catch(() => {})));
}
