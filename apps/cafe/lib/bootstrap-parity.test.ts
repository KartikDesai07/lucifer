import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import {
  MASTERS_PART_KEYS,
  mastersVersionOf,
  type MastersParts,
} from "@/lib/bootstrap-contract";
// The REAL module, not a fake: `listSpecConfig` is a pure function over the
// spec objects, and importing lib/masters.ts only REGISTERS the four model
// schemas — connectDB() is called inside listFromSpec, never at import time —
// so this stays a DB-free unit test (verified by probe: the import resolves
// and the function runs with no mongod running).
import {
  CATEGORY_LIST,
  PRODUCT_LIST,
  STAFF_LIST,
  TABLE_LIST,
  listSpecConfig,
  type MasterListSpec,
} from "@/lib/masters";

// CB-DL-1 S5.1 — GET /api/bootstrap must serve every master part through the
// SAME list function the corresponding master route uses. The type system does
// NOT catch a wholesale wrong-spec swap (lib/masters.ts's own comment says so:
// `listSpecConfig`'s TDoc is inferred from the spread, so passing PRODUCT_LIST
// to the categories route still typechecks), so the parity is pinned by reading
// the route SOURCE and harvesting which spec each route actually spreads.
//
// Same readSrc/stripComments idiom as lib/pos-pulse-paths.test.ts and
// lib/table-flow-paths.test.ts: source-read pins, no route/React framework in
// this repo by design. Every negative pin is paired with a positive landmark
// from the same source; banned needles are built by concatenation so the pin's
// own source line can never satisfy the grep it performs.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const readStripped = (rel: string): string => stripComments(readSrc(rel));

const CAFE = "apps/cafe/";
const MASTERS = CAFE + "lib/masters.ts";
const BOOTSTRAP_LIB = CAFE + "lib/bootstrap.ts";
const BOOTSTRAP_ROUTE = CAFE + "app/api/bootstrap/route.ts";
const CATEGORIES_ROUTE = CAFE + "app/api/categories/route.ts";
const PRODUCTS_ROUTE = CAFE + "app/api/products/route.ts";
const TABLES_ROUTE = CAFE + "app/api/tables/route.ts";
const STAFF_ROUTE = CAFE + "app/api/staff/route.ts";
const SETTINGS_ROUTE = CAFE + "app/api/settings/route.ts";
const EVENTS_ROUTE = CAFE + "app/api/events/route.ts";
const RESERVATIONS_ROUTE = CAFE + "app/api/reservations/route.ts";
const CRUD_ROUTE = CAFE + "lib/crud-route.ts";
const SETTINGS_LIB = CAFE + "lib/settings.ts";

// Needles for the ABSENCE pins, assembled at runtime so this file's own text
// never contains the literal it forbids (testing.md grep-gate rule).
const FIND_CALL = "." + "find(";
const AGGREGATE_CALL = "." + "aggregate(";
const COUNT_CALL = "count" + "Documents(";
const LIST_SPEC_KEY = "list" + "Spec";

// Brace matcher (same shape as lib/table-flow-paths.test.ts / customer-privacy-
// paths.test.ts): a naive indexOf("}") would truncate a spec/function body at
// the first nested closing brace.
function matchingBraceEnd(src: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("matchingBraceEnd: no matching closing brace found");
}

// The object literal assigned to `export const <NAME>: ... = { ... }`.
function specLiteral(src: string, name: string): string {
  const declIdx = src.indexOf("export const " + name);
  assert.ok(declIdx >= 0, `lib/masters.ts must declare export const ${name}`);
  const open = src.indexOf("{", declIdx);
  assert.ok(open >= 0, `${name} must be assigned an object literal`);
  return src.slice(open, matchingBraceEnd(src, open) + 1);
}

// Index of the first match, or -1. Both cache reads under pin are written with
// an explicit type argument (`cache.get<ISettings>(KEY)`), so an index lookup
// for the plain string `cache.get(` would silently report ABSENT and make an
// ordering pin vacuous rather than red — these lookups go through a regex.
function indexOfMatch(src: string, re: RegExp): number {
  const m = re.exec(src);
  return m ? m.index : -1;
}

// The type argument may itself be generic (`cache.get<LeanRow<TDoc>[]>(...)`),
// so the inner part cannot be `[^>]*` — it must be allowed to contain `>`, and
// is bounded instead by the `>(` that closes it on the same line.
const CACHE_GET_RE = /cache\.get(?:<[^\n]*?>)?\(/;
const CACHE_SET_RE = /cache\.set\(/;

// The body of `export async function <NAME>` / `export function <NAME>`, sliced
// to the next top-level `export` (same bounded single-function slice as
// lib/print-job-payload-parity.test.ts's receiptGstFunctionBody).
function functionBody(src: string, header: string): string {
  const start = src.indexOf(header);
  assert.ok(start >= 0, `source must contain ${header}`);
  const next = src.indexOf("\nexport ", start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

// ── 1. route <-> spec parity ────────────────────────────────────────────────

// Harvests the argument of every `listSpecConfig(<NAME>)` in a route source.
// Comparing the harvested NAME (rather than merely asserting the file mentions
// the spec) is what catches a wholesale swap: products/route.ts spreading
// listSpecConfig(CATEGORY_LIST) typechecks fine and would silently serve the
// wrong collection on both the route AND the bootstrap.
function harvestListSpecConfigArgs(src: string): string[] {
  const re = /listSpecConfig\(\s*([A-Za-z_$][\w$]*)\s*\)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

test("PIN: categories/route.ts spreads listSpecConfig(CATEGORY_LIST) and products/route.ts spreads listSpecConfig(PRODUCT_LIST) — exactly one spec each, harvested by name so a wholesale wrong-spec swap (which typechecks) fails here", () => {
  const catSrc = readStripped(CATEGORIES_ROUTE);
  const prodSrc = readStripped(PRODUCTS_ROUTE);

  assert.deepEqual(
    harvestListSpecConfigArgs(catSrc),
    ["CATEGORY_LIST"],
    "GET /api/categories must build its config from exactly listSpecConfig(CATEGORY_LIST)",
  );
  assert.deepEqual(
    harvestListSpecConfigArgs(prodSrc),
    ["PRODUCT_LIST"],
    "GET /api/products must build its config from exactly listSpecConfig(PRODUCT_LIST)",
  );

  // Positive landmarks: both routes are still the shared factory's, spread
  // FIRST so the spec-derived fields cannot be shadowed by a later literal.
  assert.match(catSrc, /createCollectionRoute\(\{\s*\.\.\.listSpecConfig\(CATEGORY_LIST\)/, "categories route must spread the spec config as the FIRST config field");
  assert.match(prodSrc, /createCollectionRoute\(\{\s*\.\.\.listSpecConfig\(PRODUCT_LIST\)/, "products route must spread the spec config as the FIRST config field");
});

test("PIN: listSpecConfig maps every spec field to the config field that must agree with it — `filter` is the ONE renamed field (-> baseFilter), so a transposition here would silently change what the filtered branch serves while every source pin stayed green", () => {
  // Behavioural, not a source read: the source pins above prove each route
  // spreads the RIGHT spec, and the spec literals are pinned below — but
  // nothing there would catch listSpecConfig itself copying the wrong field
  // into `baseFilter` (e.g. `baseFilter: spec.sort`). That mistake typechecks
  // whenever the two happen to be structurally compatible, and it would ship a
  // products list filtered by `{ category: 1, name: 1 }`.
  const specs: Array<[string, MasterListSpec<unknown>]> = [
    ["CATEGORY_LIST", CATEGORY_LIST as MasterListSpec<unknown>],
    ["PRODUCT_LIST", PRODUCT_LIST as MasterListSpec<unknown>],
    ["TABLE_LIST", TABLE_LIST as MasterListSpec<unknown>],
    ["STAFF_LIST", STAFF_LIST as MasterListSpec<unknown>],
  ];

  for (const [name, spec] of specs) {
    assert.deepStrictEqual(
      listSpecConfig(spec),
      {
        model: spec.model,
        cacheKey: spec.cacheKey,
        ttl: spec.ttl,
        sort: spec.sort,
        // The rename: a spec's `filter` is the factory's `baseFilter`.
        baseFilter: spec.filter,
        listSpec: spec,
      },
      `listSpecConfig(${name}) must map model/cacheKey/ttl/sort straight through, spec.filter -> baseFilter, and carry the spec itself as listSpec`,
    );
  }

  // The two fields a transposition would swap are DISTINCT on every real spec,
  // so the deepStrictEqual above genuinely discriminates: were filter and sort
  // ever equal, `baseFilter: spec.sort` would pass vacuously.
  for (const [name, spec] of specs) {
    assert.notDeepStrictEqual(
      spec.filter,
      spec.sort,
      `${name}'s filter and sort must differ, or the baseFilter mapping assert above cannot catch a transposition`,
    );
  }

  // Identity, not just structural equality: the factory must receive the SAME
  // spec object (its cached branch calls listFromSpec(config.listSpec)) and the
  // same registered model — a defensive copy would decouple the two branches.
  const productConfig = listSpecConfig(PRODUCT_LIST);
  assert.equal(productConfig.listSpec, PRODUCT_LIST, "listSpec must be the spec object itself, not a copy");
  assert.equal(productConfig.model, PRODUCT_LIST.model, "model must be the same registered Mongoose model the spec names");

  // No extra config field may ride along: the returned object is spread as the
  // FIRST config entry, so a stray key here would silently shadow one a route
  // sets after the spread.
  assert.deepStrictEqual(
    Object.keys(productConfig).sort(),
    ["baseFilter", "cacheKey", "listSpec", "model", "sort", "ttl"],
    "listSpecConfig must return exactly the six fields the route config expects",
  );
});

test("PIN: GET /api/tables serves the tables list via listTables() and runs no query of its own — the spec (TABLE_LIST) is the single description of that query", () => {
  const src = readStripped(TABLES_ROUTE);
  const getStart = src.indexOf("export async function GET");
  const nextExport = src.indexOf("export async function", getStart + 1);
  assert.ok(getStart >= 0 && nextExport > getStart, "tables/route.ts must declare GET followed by another exported handler");
  const getBody = src.slice(getStart, nextExport);

  assert.match(getBody, /return success\(await listTables\(\)\)/, "GET must return success(await listTables())");
  // Negative: no inline query in GET. POST/PATCH legitimately query the model,
  // which is why this is sliced to the GET body only.
  assert.ok(!getBody.includes(FIND_CALL), "GET /api/tables must not run its own model query — the spec's list function owns it");
  // Positive landmark on the same slice, so the negative cannot pass vacuously
  // against an empty/blinded read.
  assert.match(getBody, /requireAuth\(/, "positive landmark: GET /api/tables must still guard with requireAuth(");
});

test("PIN: GET /api/staff calls listStaff() AFTER requireAdmin( and runs no query of its own — the admin gate and the no-password projection both stay on the served path", () => {
  const src = readStripped(STAFF_ROUTE);
  const getStart = src.indexOf("export async function GET");
  const nextExport = src.indexOf("export async function", getStart + 1);
  assert.ok(getStart >= 0 && nextExport > getStart, "staff/route.ts must declare GET followed by another exported handler");
  const getBody = src.slice(getStart, nextExport);

  const adminIdx = getBody.indexOf("requireAdmin(");
  const listIdx = getBody.indexOf("listStaff(");
  assert.ok(adminIdx >= 0, "GET /api/staff must guard with requireAdmin(");
  assert.ok(listIdx >= 0, "GET /api/staff must call listStaff()");
  assert.ok(listIdx > adminIdx, "listStaff() must be called strictly AFTER the requireAdmin( gate in source order");

  assert.ok(!getBody.includes(FIND_CALL), "GET /api/staff must not run its own model query — STAFF_LIST's select(-password) must stay the only projection");
  assert.match(getBody, /return success\(await listStaff\(\)\)/, "positive landmark: GET must return success(await listStaff())");
});

test("PIN: GET /api/settings still resolves the singleton through getSettings() — settings deliberately has NO list spec, so its getter is the parity point the bootstrap shares", () => {
  const src = readStripped(SETTINGS_ROUTE);
  const getBody = functionBody(src, "export async function GET");
  assert.match(getBody, /await getSettings\(\)/, "GET /api/settings must await getSettings()");
  assert.match(getBody, /requireAuth\(/, "positive landmark: GET /api/settings must guard with requireAuth(");
});

// ── 2. the bootstrap calls the SAME symbols ─────────────────────────────────

test("PIN: lib/bootstrap.ts's part loaders are exactly {getSettings, listCategories, listProducts, listTables, listStaff} — one Promise.all, mastersVersionOf, and no query of its own", () => {
  const src = readStripped(BOOTSTRAP_LIB);

  // Harvest every master-getter call: the four list wrappers plus getSettings.
  const calls = new Set<string>();
  const listRe = /\b(list[A-Z]\w*)\(/g;
  let m: RegExpExecArray | null;
  while ((m = listRe.exec(src)) !== null) calls.add(m[1]);
  if (src.includes("getSettings(")) calls.add("getSettings");

  assert.deepEqual(
    [...calls].sort(),
    ["getSettings", "listCategories", "listProducts", "listStaff", "listTables"].sort(),
    "the bootstrap must load its parts through exactly the five functions the master routes use — no extra getter, none missing",
  );

  // One concurrent batch: a second Promise.all would mean a second round of
  // awaits (the plan's "one call replaces five" claim).
  assert.equal(src.split("Promise.all(").length - 1, 1, "buildBootstrap must issue exactly ONE Promise.all(");
  assert.match(src, /mastersVersionOf\(/, "the payload's mastersVersion must come from mastersVersionOf( — derived from the loaded parts, never an extra query");

  // Negatives: the bootstrap must never grow its own query. A find/aggregate/
  // countDocuments here would be a second description of a master list (drift)
  // or an extra M0 read per tab load, which the derived version exists to avoid.
  assert.ok(!src.includes(FIND_CALL), "lib/bootstrap.ts must never run its own model query");
  assert.ok(!src.includes(AGGREGATE_CALL), "lib/bootstrap.ts must never run an aggregate — mastersVersion is derived from the parts already loaded");
  assert.ok(!src.includes(COUNT_CALL), "lib/bootstrap.ts must never count documents — the row count folded into mastersVersion comes from the parts");
  // Positive landmark on the same source: the single up-front connect.
  assert.match(src, /await connectDB\(\)/, "positive landmark: buildBootstrap must await connectDB() once up front");
});

// ── 3. the bootstrap ROUTE ──────────────────────────────────────────────────

test("PIN: app/api/bootstrap/route.ts is force-dynamic, requireAuth-gated before buildBootstrap, admin-derived includeStaff, no-store on BOTH return paths, and runs no query or connect of its own", () => {
  const src = readStripped(BOOTSTRAP_ROUTE);

  assert.match(src, /export const dynamic = "force-dynamic";/, 'the route must declare export const dynamic = "force-dynamic"');

  const authIdx = src.indexOf("requireAuth(");
  const buildIdx = src.indexOf("buildBootstrap(");
  assert.ok(authIdx >= 0, "the route must call requireAuth(");
  assert.ok(buildIdx >= 0, "the route must call buildBootstrap(");
  assert.ok(buildIdx > authIdx, "buildBootstrap( must be reached strictly AFTER the requireAuth( gate — master data is never anonymous");
  assert.match(src, /if \("error" in authed\) return authed\.error;/, "requireAuth()'s error branch must be enforced (it returns an error-shaped value, it does not throw)");

  // D3a: the staff part is admin-only. Tolerant of quoting/spacing so a
  // formatter run cannot redden the pin, strict about the role compared.
  assert.match(
    src,
    /includeStaff\s*=\s*[\w.]*\brole\s*===\s*["']admin["']/,
    'includeStaff must be derived from a role === "admin" comparison — a non-admin session must get staff: null',
  );

  // Both exits no-store: the success path AND the error path. An HTTP-cached
  // 500 (or an HTTP-cached master payload) would outlive the in-process TTL.
  assert.match(src, /return noStore\(success\(await buildBootstrap\(/, "the success path must be wrapped in noStore(success(...))");
  assert.match(src, /return noStore\(serverError\("Failed to load master data", error\)\)/, 'the error path must be noStore(serverError("Failed to load master data", error))');
  assert.equal(src.split("return noStore(").length - 1, 2, "the route must have exactly two returns, both wrapped in noStore(");

  // Negatives: all DB work lives in buildBootstrap, so the route file itself
  // must neither query nor open the connection — otherwise the route and the
  // library could diverge on connect order or on what is actually served.
  assert.ok(!src.includes(FIND_CALL), "the bootstrap route file must run no model query of its own");
  assert.ok(!src.includes("connectDB("), "the bootstrap route must not connect — buildBootstrap owns the single connect");
});

// ── 4. spec truth in lib/masters.ts ─────────────────────────────────────────

test("PIN: each master spec's literal carries the exact filter/sort/select/cacheKey/TTL the five routes shipped with — the ONE description the routes and the bootstrap both read", () => {
  const src = readStripped(MASTERS);

  const category = specLiteral(src, "CATEGORY_LIST");
  assert.match(category, /filter:\s*\{\s*\}/, "CATEGORY_LIST must list ALL categories (empty filter)");
  assert.match(category, /sort:\s*\{ order: 1, name: 1 \}/, "CATEGORY_LIST must sort by order then name");
  assert.match(category, /cacheKey:\s*"categories"/, 'CATEGORY_LIST must cache under "categories"');
  assert.match(category, /ttl:\s*TTL\.CATEGORIES/, "CATEGORY_LIST must use TTL.CATEGORIES");

  const product = specLiteral(src, "PRODUCT_LIST");
  assert.match(product, /filter:\s*\{ isActive: true \}/, "PRODUCT_LIST must exclude archived (soft-deleted) products — the archived view is a separate uncached list");
  // CB-DL-2: Product dropped its denormalized `category` string in favour of
  // the sole `categoryId` link -- sorting by a category NAME no longer makes
  // sense server-side (the name now only exists via a join), so the spec
  // sorts by name alone. Moved from `{ category: 1, name: 1 }`.
  assert.match(product, /sort:\s*\{ name: 1 \}/, "PRODUCT_LIST must sort by name");
  assert.match(product, /cacheKey:\s*"products"/, 'PRODUCT_LIST must cache under "products"');
  assert.match(product, /ttl:\s*TTL\.PRODUCTS/, "PRODUCT_LIST must use TTL.PRODUCTS");

  const table = specLiteral(src, "TABLE_LIST");
  // The operator's hand arrangement wins; tableNo is only the tie-break.
  assert.match(table, /sort:\s*\{ displayOrder: 1, tableNo: 1 \}/, "TABLE_LIST must sort by displayOrder then tableNo");
  assert.match(table, /filter:\s*\{\s*\}/, "TABLE_LIST must list the whole floor plan (empty filter)");
  assert.match(table, /cacheKey:\s*"tables"/, 'TABLE_LIST must cache under "tables"');
  assert.match(table, /ttl:\s*TTL\.TABLES/, "TABLE_LIST must use TTL.TABLES");

  const staff = specLiteral(src, "STAFF_LIST");
  assert.match(staff, /select:\s*"-password"/, "STAFF_LIST must project away the password hash — a staff read NEVER carries it");
  assert.match(staff, /sort:\s*\{ name: 1 \}/, "STAFF_LIST must sort by name");
  assert.match(staff, /cacheKey:\s*"staff"/, 'STAFF_LIST must cache under "staff"');
  assert.match(staff, /ttl:\s*TTL\.STAFF/, "STAFF_LIST must use TTL.STAFF");
});

test("PIN: listFromSpec's order of operations is cache.get -> connectDB -> query -> cache.set — a cache hit must never open a DB connection (the same order the five routes shipped with)", () => {
  const src = readStripped(MASTERS);
  const body = functionBody(src, "export async function listFromSpec");

  const getIdx = indexOfMatch(body, CACHE_GET_RE);
  const connectIdx = body.indexOf("connectDB(");
  const findIdx = body.indexOf(FIND_CALL);
  const setIdx = indexOfMatch(body, CACHE_SET_RE);

  assert.ok(getIdx >= 0, "listFromSpec must read the cache");
  assert.ok(connectIdx >= 0, "listFromSpec must connect before querying");
  assert.ok(findIdx >= 0, "listFromSpec must query the spec's model");
  assert.ok(setIdx >= 0, "listFromSpec must write the cache");

  assert.ok(getIdx < connectIdx, "the cache read must come BEFORE connectDB() — a cache hit needs no DB (free-tier connection discipline)");
  assert.ok(connectIdx < findIdx, "connectDB() must come before the query");
  assert.ok(findIdx < setIdx, "the cache is written only after the query returns");
  assert.match(body, /if \(cached\) return cached;/, "positive landmark: the cache hit must return early");
});

// ── 5. crud-route's spec branch is additive; events/reservations unchanged ──

test("PIN: crud-route's listSpec branch is guarded by a truthiness check on config.listSpec, and the inline find(query).sort(config.sort).lean() path still exists — events/reservations must run exactly the code they always ran", () => {
  const src = readStripped(CRUD_ROUTE);

  const guardIdx = src.indexOf("config." + LIST_SPEC_KEY);
  const delegateIdx = src.indexOf("listFromSpec(");
  assert.ok(guardIdx >= 0, "the factory must consult config.listSpec");
  assert.ok(delegateIdx >= 0, "the factory must be able to delegate to listFromSpec(");
  assert.ok(
    guardIdx < delegateIdx,
    "the delegation must sit behind a truthiness check on config.listSpec — a spec-less collection must fall through to the inline path",
  );
  assert.match(
    src,
    /if \(!filtered && config\.listSpec\) \{/,
    "the spec branch must be gated on BOTH an unfiltered request and a present spec (a filtered read still bypasses the cache and runs its own query)",
  );

  // The untouched path: this is what events/reservations (and every filtered
  // read) still execute.
  assert.match(
    src,
    /await config\.model\.find\(query\)\.sort\(config\.sort\)\.lean\(\)/,
    "the inline find(query).sort(config.sort).lean() path must remain — it is the only path for the spec-less collections",
  );
});

test("PIN: app/api/events/route.ts and app/api/reservations/route.ts declare no list spec — the two listFilter-driven collections were explicitly out of scope, so their GET must keep running the factory's inline query", () => {
  for (const rel of [EVENTS_ROUTE, RESERVATIONS_ROUTE]) {
    // RAW source for the absence check: a spec sneaking in via a commented-out
    // line would be a signal worth reddening on, and a stripped read could
    // blind the scan.
    const raw = readSrc(rel);
    assert.ok(!raw.includes(LIST_SPEC_KEY), `${rel} must not declare a list spec`);
    // Positive landmark on the same raw source.
    assert.ok(raw.includes("createCollectionRoute("), `positive landmark: ${rel} must still be built by createCollectionRoute(`);
  }
});

// ── 6. mastersVersionOf — pure behaviour ────────────────────────────────────

// Fixture rows are shaped only as far as mastersVersionOf reads them (an
// `updatedAt`), so the cast is at the test boundary, not in the assertions.
const partsOf = (p: Partial<Record<string, unknown>>): MastersParts =>
  ({
    settings: null,
    categories: [],
    products: [],
    tables: [],
    staff: null,
    ...p,
  }) as unknown as MastersParts;

test("PIN: mastersVersionOf folds count + max updatedAt per part, in MASTERS_PART_KEYS order, accepting both Date and ISO-string stamps", () => {
  const version = mastersVersionOf(
    partsOf({
      settings: { updatedAt: new Date(1_700_000_000_000) },
      categories: [
        { updatedAt: new Date(1_700_000_001_000) },
        { updatedAt: "2023-11-14T22:13:22.000Z" }, // = 1700000002000
      ],
      products: [{ updatedAt: new Date(1_700_000_003_000) }],
      tables: [],
      staff: [{ updatedAt: new Date(1_700_000_004_000) }],
    }),
  );

  assert.equal(
    version,
    "settings:1:1700000000000|categories:2:1700000002000|products:1:1700000003000|tables:0:0|staff:1:1700000004000",
  );
  // Key order is the contract's, not the literal's insertion order.
  assert.deepEqual([...MASTERS_PART_KEYS], ["settings", "categories", "products", "tables", "staff"]);
});

test("PIN: a HARD delete changes mastersVersion even when the surviving rows' max updatedAt is identical — the row COUNT is why (a category/table/staff delete bumps no updatedAt anywhere)", () => {
  const before = mastersVersionOf(
    partsOf({
      categories: [
        { updatedAt: new Date(1_700_000_005_000) }, // the newest row survives
        { updatedAt: new Date(1_700_000_001_000) }, // this one is deleted
      ],
    }),
  );
  const after = mastersVersionOf(
    partsOf({ categories: [{ updatedAt: new Date(1_700_000_005_000) }] }),
  );

  assert.notEqual(before, after, "dropping a row must change the version string");
  assert.match(before, /categories:2:1700000005000/, "before: two rows, max unchanged");
  assert.match(after, /categories:1:1700000005000/, "after: one row, the SAME max — only the count moved");
});

test("PIN: a null part contributes <key>:0:0 (no settings document yet; staff omitted for a non-admin), and a row with no updatedAt still counts but contributes 0", () => {
  const empty = mastersVersionOf(partsOf({}));
  assert.match(empty, /settings:0:0/, "a null settings part must read settings:0:0");
  assert.match(empty, /staff:0:0/, "a null staff part (non-admin session) must read staff:0:0");
  assert.equal(empty, "settings:0:0|categories:0:0|products:0:0|tables:0:0|staff:0:0");

  const unstamped = mastersVersionOf(
    partsOf({ tables: [{ tableNo: "T1" }, { tableNo: "T2", updatedAt: "not a date" }] }),
  );
  assert.match(unstamped, /tables:2:0/, "rows without a usable updatedAt must still be COUNTED, contributing 0 to the max");
});

// ── 7. getSettings reads before it writes ───────────────────────────────────

test("PIN: getSettings() reads FIRST (findOne before findOneAndUpdate) with connectDB before the read, keeps the $setOnInsert upsert as the create branch, and checks the cache before anything — a $setOnInsert upsert is NOT a no-op (timestamps:true rewrites updatedAt on every cache miss)", () => {
  const src = readStripped(SETTINGS_LIB);
  const body = functionBody(src, "export async function getSettings");

  const cacheIdx = indexOfMatch(body, CACHE_GET_RE);
  const connectIdx = body.indexOf("connectDB(");
  const findOneIdx = body.indexOf("findOne(");
  const upsertIdx = body.indexOf("findOneAndUpdate(");

  assert.ok(cacheIdx >= 0, "getSettings must consult the cache");
  assert.ok(connectIdx >= 0, "getSettings must connectDB() itself (render paths call it without a route's connect)");
  assert.ok(findOneIdx >= 0, "getSettings must READ the singleton");
  assert.ok(upsertIdx >= 0, "getSettings must keep its upsert as the create branch");

  assert.ok(cacheIdx < connectIdx, "the cache check must come first — a cache hit must not open a connection");
  assert.ok(connectIdx < findOneIdx, "connectDB() must come before the read");
  assert.ok(
    findOneIdx < upsertIdx,
    "the read must come BEFORE the upsert — an unconditional $setOnInsert upsert rewrites updatedAt on every cache miss, which is one needless M0 write per cache window and makes any updatedAt-derived version churn forever",
  );
  assert.match(body, /\$setOnInsert/, "positive landmark: the create branch is still the atomic $setOnInsert upsert on the empty filter");
});

test("PIN: readSettings() is still the write-free twin — it reads the singleton and never upserts (the root layout's metadata renders on the PUBLIC /login page)", () => {
  const src = readStripped(SETTINGS_LIB);
  const body = functionBody(src, "export async function readSettings");

  assert.match(body, /findOne\(\)/, "positive landmark: readSettings must read the singleton with findOne()");
  assert.ok(
    !body.includes("findOneAndUpdate("),
    "readSettings must never upsert — anonymous traffic must not be able to drive a write against a 512MB M0 with no backups",
  );
});

// ── 8. file-length ceilings ─────────────────────────────────────────────────

test("PIN: the CB-DL-1 server files stay under the 300-line ceiling", () => {
  const MAX_LINES = 300;
  for (const rel of [MASTERS, BOOTSTRAP_LIB, CRUD_ROUTE, BOOTSTRAP_ROUTE]) {
    const lines = readSrc(rel).split("\n").length;
    assert.ok(lines <= MAX_LINES, `${rel} is ${lines} lines — the ceiling is ${MAX_LINES} (split it, do not raise the pin)`);
  }
});
