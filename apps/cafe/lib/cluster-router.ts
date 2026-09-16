import { type Connection, type Model } from "mongoose";

import {
  getConn,
  modelFor,
  type ClusterRef,
  type ModelName,
} from "./cluster-registry";
import { ledgerTagOf, type IOrder } from "@/models/order.ledger";
import { cafeDateString } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// F2 Step F2.2 — the HYBRID placement router (built on the F2.1 connection
// registry). The registry (`lib/cluster-registry.ts`) owns "open/cache/bind a pool
// by cluster id"; THIS file owns "WHICH cluster does a request route to" — the CORE
// vs time-sharded LEDGER split, the active write-ledger, date-range fan-out
// resolution, and orderId-tag targeting (F2 §3.2 / Step F2.2).
//
// Placement (F2 §3.2 / build-rule #30 — physical isolation, NO tenantId in data):
//   • CORE   — the 8 reference/CRM/config models (Product, Category, Customer,
//              Staff, Settings, Table, Reservation, Event). Low growth; one M0 for
//              years; keeps every unique index valid (Customer.mobile, …).
//   • LEDGER — `Order` only + its `Counter`, time-sharded; exactly ONE is `active`;
//              each owns a `[from, to)` date window. The `<ledgerTag>` embedded in
//              `ORD-<tag>-YYYYMMDD-NNN` is the locator this router parses to target
//              ONE cluster (never scatter-gather a point read).
//
// Hot-reload WITHOUT redeploy (the runtime contract F3/F2.7 hot-add depends on,
// build-rule #18): the LEDGER pool is NOT baked into env. Deploy-time env carries
// ONLY the stable CORE bootstrap URI + tenant id; the dynamic ledger pool lives in
// a single `ClusterRegistry` doc ON CORE, which this router polls on a ~30s TTL. So
// when the manual paste-and-Connect flow (F3) or the ~70% roll-forward (F2.7) writes
// that doc, every warm runtime picks up the new ledger within one TTL — zero downtime.
//
// SEAMS this file deliberately does NOT implement (owned downstream):
//   • the URI vault — §3.5 stores cluster URIs ENCRYPTED; `decryptUri` is an
//     injectable seam (default identity) that F3's AES-256-GCM vault swaps in. F2.2
//     wires the call-site, not the crypto.
//   • the registry doc WRITE side — the ~70% roll-forward is F2.7
//     (`lib/ledger-scale.ts`); the paste-and-Connect validate-gate is F3. THIS
//     file still only READS the doc.
//   • order-create (F2.3) and the route cutover / paise rewrite (P2 #44/#45). The v1
//     `connectDB()` + default-bound models stay live; only the `getConnection` seam
//     (db.ts) is delegated here now, incrementally.
//
// Invariants kept: no cross-cluster `$lookup`/txn (#14 — every accessor binds one
// model on one cluster); schemas-not-models via the registry (#21); `Order` binds
// through F2c's canonical `getOrderModel` only (#34, enforced by the registry).
// ─────────────────────────────────────────────────────────────────────────────

// ── Model placement split (§3.2) ─────────────────────────────────────────────
/** Models that live on the single CORE cluster. */
export const CORE_MODELS = [
  "Product",
  "Category",
  "Customer",
  "Staff",
  "Settings",
  "Table",
  "Reservation",
  "Event",
] as const;
/** Models that live on a time-sharded LEDGER cluster (Order + its co-located Counter). */
export const LEDGER_MODELS = ["Order", "Counter"] as const;

export type CoreModelName = (typeof CORE_MODELS)[number];
export type LedgerModelName = (typeof LEDGER_MODELS)[number];

// Compile-time proof that CORE_MODELS ∪ LEDGER_MODELS covers EXACTLY the registry's
// federated model set: a model added to FEDERATED_MODELS but not placed here, or a
// name placed here that isn't federated, becomes a tsc error — never a silent
// mis-route (§3.2). `^_`-prefixed so it's an intentional unused binding.
type _Unplaced = Exclude<ModelName, CoreModelName | LedgerModelName>;
type _Foreign = Exclude<CoreModelName | LedgerModelName, ModelName>;
const _placementIsExhaustive: [_Unplaced] extends [never]
  ? [_Foreign] extends [never]
    ? true
    : { error: "a placed name is not a federated model"; foreign: _Foreign }
  : { error: "a federated model is not placed on CORE or LEDGER"; unplaced: _Unplaced } =
  true;

// ── Cluster descriptors the router resolves to ───────────────────────────────
/** The CORE cluster (env-bootstrapped). `tag` is always `C`. */
export interface CoreRef extends ClusterRef {
  tag: string;
}
/**
 * A time-sharded LEDGER cluster. Structurally a `ClusterRef` (so the registry's
 * `getConn`/`modelFor` accept it directly) plus the shard metadata the router and
 * order-create (F2.3) need: the `tag` stamped into orderIds and the `[from, to)`
 * window (`null` = ±∞; the active ledger's `to` is `null`).
 */
export interface LedgerRef extends ClusterRef {
  tag: string;
  from: string | null;
  to: string | null;
  active: boolean;
}

/** The §3.5 registry doc shape, as STORED on CORE (URIs encrypted; F3 owns writes). */
export interface StoredClusterRegistry {
  _id?: string;
  core: { id: string; uri: string; tag: string };
  ledgers: Array<{
    id: string;
    uri: string;
    tag: string;
    from?: string | null;
    to?: string | null;
    active?: boolean;
    fillPct?: number;
    sizeBytes?: number;
    paused?: boolean;
  }>;
  standby?: Array<{ id: string; uri: string; tag?: string; empty?: boolean }>;
}

/** Runtime-resolved pool (URIs decrypted). `core` is env-authoritative, not the doc. */
interface ResolvedRegistry {
  ledgers: LedgerRef[];
  standby: ClusterRef[];
}

// ── Constants ────────────────────────────────────────────────────────────────
/** Stable Map key + registry id for the single CORE cluster (one per cafe runtime). */
export const CORE_CLUSTER_ID = "core";
/** Reserved tag of the CORE cluster — a ledger tag may never mint/collide with it. */
export const CORE_TAG = "C";
/** The tag the single-cluster bootstrap ledger carries until F3 writes a real doc. */
export const BOOTSTRAP_LEDGER_TAG = "A";
/** Singleton `ClusterRegistry` doc (`_id`) + its collection on CORE (F3 writes here). */
export const CLUSTER_REGISTRY_ID = "cluster-registry";
export const CLUSTER_REGISTRY_COLLECTION = "clusterRegistry";
/** Router polls the CORE registry doc no more than once per this window (§3.2 / #18). */
export const REGISTRY_TTL_MS = 30_000;

// ── CORE bootstrap (env-only; the anchor the doc read itself rides on) ────────
function coreBootstrapUri(): string {
  // Read lazily (inside the fn, not at module load) so importing this during
  // `next build` doesn't crash when env is unset — mirrors v1 db.ts.
  const uri = process.env.CORE_MONGODB_URI ?? process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "CORE_MONGODB_URI / MONGODB_URI is not set (CORE bootstrap URI required)",
    );
  }
  return uri;
}

/**
 * The CORE cluster ref, derived purely from env. NEVER reads the registry doc (the
 * doc lives ON core, so trusting the doc to reach core would be circular) — the
 * doc's `core` field is an informational mirror for the Hub only.
 */
export function core(): CoreRef {
  return { id: CORE_CLUSTER_ID, uri: coreBootstrapUri(), tag: CORE_TAG };
}

// ── Encrypted-URI seam (F3 vault swaps in AES-256-GCM; default identity) ──────
type UriDecryptor = (storedUri: string) => string;
const identityDecryptor: UriDecryptor = (u) => u;
let uriDecryptor: UriDecryptor = identityDecryptor;
/** F3 wires the vault decryptor here at boot; `null` restores identity. */
export function setUriDecryptor(fn: UriDecryptor | null): void {
  uriDecryptor = fn ?? identityDecryptor;
}
/** Apply the current vault decryptor to a STORED (doc) URI. Exported for the F2.7
 *  registry WRITE side (`lib/ledger-scale.ts`), which works on the STORED doc
 *  directly (it must persist encrypted URIs VERBATIM) yet needs dialable URIs for
 *  `db.stats()`/ping — the vault seam stays single-homed here. The bootstrap env
 *  URI never passes through this (it stays plaintext to reach CORE). */
export function decryptStoredUri(storedUri: string): string {
  return uriDecryptor(storedUri);
}

// The encrypt half of the same seam — for NEW secrets ENTERING the doc (F2.8's
// provisioner push; F3's paste flow). Distinct from the read side above: code
// that re-persists a URI it READ from the doc must keep it verbatim, never
// decrypt-then-re-encrypt (the F2.7 flip discipline).
type UriEncryptor = (plainUri: string) => string;
const identityEncryptor: UriEncryptor = (u) => u;
let uriEncryptor: UriEncryptor = identityEncryptor;
/** F3 wires the vault encryptor here at boot; `null` restores identity. */
export function setUriEncryptor(fn: UriEncryptor | null): void {
  uriEncryptor = fn ?? identityEncryptor;
}
/** Apply the current vault encryptor to a PLAINTEXT URI about to be persisted
 *  into the registry doc. Identity until F3's AES-256-GCM vault lands. */
export function encryptUriForStore(plainUri: string): string {
  return uriEncryptor(plainUri);
}

// ── Registry doc load (30s TTL, decrypt, bootstrap fallback) ──────────────────
// Clock seam — `Date.now()` by default; tests inject a controllable clock to drive
// the TTL deterministically (the file's injectable-seam pattern, cf. the opener /
// provider / decryptor seams). Never used by application code.
let clock: () => number = () => Date.now();
let cache: { reg: ResolvedRegistry; at: number } | null = null;
type RegistryProvider = () => Promise<StoredClusterRegistry | null>;
let registryProvider: RegistryProvider | null = null;

async function readRegistryDoc(): Promise<StoredClusterRegistry | null> {
  if (registryProvider) return registryProvider();
  // Raw collection read — F2.2 only READS; F3 owns the typed write-side schema +
  // vault. The DB-free unit test injects `registryProvider`; the live CORE read is
  // asserted in F2's seeded-M0 integration pass (the order.ledger/registry split).
  const conn = await getConn(core());
  // Singleton per cafe (§3.5 "single doc per cafe"; physical isolation #30 — no
  // tenantId filter). Empty-filter read returns that one doc; F3 upserts it keyed by
  // `_id: CLUSTER_REGISTRY_ID`. (Empty filter also dodges the driver typing `_id` as
  // ObjectId, which our string `_id` is not.)
  const doc = await conn.collection(CLUSTER_REGISTRY_COLLECTION).findOne({});
  return (doc as StoredClusterRegistry | null) ?? null;
}

/** Single-cluster bridge: CORE doubles as the one active ledger (SAME pool id, so
 *  `getConn(core())` and `getConn(ledger)` coalesce). This is the honest v1/F1
 *  "single connection, both roles" behaviour until F3 writes a real registry doc. */
function bootstrapRegistry(): ResolvedRegistry {
  const c = core();
  const ledger: LedgerRef = {
    id: c.id,
    uri: c.uri,
    tag: BOOTSTRAP_LEDGER_TAG,
    from: null,
    to: null,
    active: true,
  };
  return { ledgers: [ledger], standby: [] };
}

function resolveRegistry(doc: StoredClusterRegistry): ResolvedRegistry {
  if (!Array.isArray(doc.ledgers) || doc.ledgers.length === 0) {
    // A doc that EXISTS but is broken: do NOT collapse to bootstrap (that would
    // misroute writes to CORE) — fail loudly.
    throw new Error("[cluster-router] registry doc has no ledgers");
  }
  return {
    ledgers: doc.ledgers.map((l) => ({
      id: l.id,
      uri: uriDecryptor(l.uri),
      tag: l.tag,
      from: l.from ?? null,
      to: l.to ?? null,
      active: l.active === true,
    })),
    standby: (doc.standby ?? []).map((s) => ({
      id: s.id,
      uri: uriDecryptor(s.uri),
    })),
  };
}

async function loadRegistry(): Promise<ResolvedRegistry> {
  const now = clock();
  if (cache && now - cache.at < REGISTRY_TTL_MS) return cache.reg;
  let reg: ResolvedRegistry;
  try {
    const doc = await readRegistryDoc();
    // Doc DEFINITIVELY absent (null) = the single-cluster era (F3 hasn't run) →
    // bootstrap. A READ ERROR is different (transient/unknown topology) and is
    // handled in catch: serve stale if we have it, else throw — never guess.
    reg = doc ? resolveRegistry(doc) : bootstrapRegistry();
  } catch (err) {
    if (cache) {
      console.error(
        "[cluster-router] registry reload failed; serving stale topology:",
        err,
      );
      return cache.reg; // keep stale `at` so the NEXT call retries promptly
    }
    throw new Error(
      `[cluster-router] cannot read CORE registry and have no cached topology: ${
        (err as Error).message
      }`,
    );
  }
  cache = { reg, at: now };
  return reg;
}

// ── Placement resolvers ───────────────────────────────────────────────────────
function activeLedger(reg: ResolvedRegistry): LedgerRef {
  const actives = reg.ledgers.filter((l) => l.active);
  if (actives.length === 1) return actives[0];
  // Zero or many active ledgers = a corrupt manifest. Refuse to place a write
  // rather than land an order on the wrong (or no) cluster on a no-backup tier.
  throw new Error(
    `[cluster-router] expected exactly one active ledger, found ${actives.length}`,
  );
}

/** The single `active` ledger — where NEW orders are placed (F2.3 stamps its tag). */
export async function ledgerForWrite(): Promise<LedgerRef> {
  return activeLedger(await loadRegistry());
}

/** Normalize a Date or date string to a comparable `YYYYMMDD` key. Accepts both
 *  `YYYY-MM-DD` and `YYYYMMDD` strings (dashes stripped); Dates use the cafe (IST)
 *  day so the key lines up with how orderIds derive their `YYYYMMDD` segment. */
export function toDayKey(d: Date | string): string {
  if (d instanceof Date) return cafeDateString(d).replace(/-/g, "");
  return d.replace(/\D/g, "");
}

/** The normalized `[lo, hi]` day-key pair of a query range (swapped ranges
 *  tolerated). THE single normalization both the ledger resolution below and the
 *  F2.4 read service's `_id`-range builder ride on — so the legs a range resolves
 *  to and the orderId range scanned on them can never disagree. */
export function dayKeyRange(
  from: Date | string,
  to: Date | string,
): { lo: string; hi: string } {
  const a = toDayKey(from);
  const b = toDayKey(to);
  return a <= b ? { lo: a, hi: b } : { lo: b, hi: a };
}

/**
 * The ledgers whose `[from, to)` window overlaps the inclusive query range
 * `[from, to]`. `null` window bounds are ±∞. A multi-ledger result is what the
 * report fan-out (F2.6) iterates; a single-ledger result returns directly.
 */
export async function ledgersForDate(
  from: Date | string,
  to: Date | string,
): Promise<LedgerRef[]> {
  const { lo, hi } = dayKeyRange(from, to);
  const { ledgers } = await loadRegistry();
  return ledgers.filter((l) => {
    const wFrom = l.from == null ? null : toDayKey(l.from);
    const wTo = l.to == null ? null : toDayKey(l.to);
    // window [wFrom, wTo) overlaps query [lo, hi] ⟺ wFrom ≤ hi AND wTo > lo
    const startsByQueryEnd = wFrom === null || wFrom <= hi;
    const endsAfterQueryStart = wTo === null || wTo > lo;
    return startsByQueryEnd && endsAfterQueryStart;
  });
}

/**
 * Target the ONE ledger that holds an order, parsed from its `<ledgerTag>` via
 * F2c's `ledgerTagOf` (never re-derive the regex, #34). Returns `null` for a
 * malformed id or a tag absent from the current registry (caller 404s).
 */
export async function ledgerFromOrderId(orderId: string): Promise<LedgerRef | null> {
  const tag = ledgerTagOf(orderId);
  if (!tag) return null;
  const { ledgers } = await loadRegistry();
  return ledgers.find((l) => l.tag === tag) ?? null;
}

// ── Typed model accessors (thin wrappers over the registry's modelFor) ────────
/** Bind a CORE model on the single CORE pool. */
export function coreModel(name: CoreModelName): Promise<Model<unknown>> {
  return modelFor(core(), name);
}

/** Bind a LEDGER model (`Order`/`Counter`) on a resolved ledger's pool. `Order`
 *  returns the F2c-typed `Model<IOrder>` (it binds through `getOrderModel`). */
export function ledgerModel(
  cluster: ClusterRef,
  name: "Order",
): Promise<Model<IOrder>>;
export function ledgerModel(
  cluster: ClusterRef,
  name: LedgerModelName,
): Promise<Model<unknown>>;
export function ledgerModel(
  cluster: ClusterRef,
  name: LedgerModelName,
): Promise<Model<IOrder>> | Promise<Model<unknown>> {
  return modelFor(cluster, name) as Promise<Model<unknown>>;
}

// ── Connection wrappers (the F1 `getConnection` seam delegates to these) ──────
export async function coreConnection(): Promise<Connection> {
  return getConn(core());
}
export async function ledgerWriteConnection(): Promise<Connection> {
  return getConn(await ledgerForWrite());
}

// ── Test seams (never called by application code) ─────────────────────────────
/** Inject a fixture registry doc provider (bypasses the live CORE read); clears the
 *  TTL cache so the fixture takes effect immediately. `null` restores the CORE read. */
export function __setRegistryProviderForTests(fn: RegistryProvider | null): void {
  registryProvider = fn;
  cache = null;
}
/** Inject a controllable clock (ms) to drive the registry TTL deterministically;
 *  `null` restores `Date.now`. Never called by application code. */
export function __setClockForTests(fn: (() => number) | null): void {
  clock = fn ?? (() => Date.now());
}
/** Reset all router module state (cache, provider, vault seams, clock) between tests. */
export function __resetRouterForTests(): void {
  cache = null;
  registryProvider = null;
  uriDecryptor = identityDecryptor;
  uriEncryptor = identityEncryptor;
  clock = () => Date.now();
}
