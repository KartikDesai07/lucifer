import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { isPublicPath } from "@/auth.config";
import { stripComments } from "@/lib/source-pin-utils";

// CR2.1 — the public (unauthenticated) QR-menu surface is the FIRST
// unauthenticated surface in this app, so these are the security regression
// net: source-read pins (readFileSync over the REAL source), the same
// technique as table-flow-paths.test.ts / customer-privacy-paths.test.ts —
// this repo has no React/route test framework by design. A pin that passes
// while the protected behaviour is broken is worse than none, so every claim
// below was re-checked against the landed source after being written.
//
// NOT duplicated here — already pinned elsewhere:
//   - lib/public-token.test.ts: mintPublicToken/mintUniquePublicToken's own
//     entropy and retry behavior.
//   - lib/public-menu.test.ts: PUBLIC_PRODUCT_FILTER's shape and
//     toPublicMenuItem/toPublicCategory/toPublicTable's exact key sets.
//   - lib/table-flow-paths.test.ts: GET/POST/PATCH /api/tables' non-CR2 pins
//     (sort order, requireAdmin on PATCH, displayOrder discipline).

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// These pins forbid/require CODE shapes, so they must look at code and not at
// prose — a comment explaining the rule would otherwise trip the very pin
// meant to enforce it. (This bit this repo once already on a banned-string pin.)

const SKIP_DIRS = new Set(["node_modules", ".next"]);
const CODE_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

// Walks a directory recursively and pushes every code file's absolute path
// onto `out` — used so a FOURTH public route (or public component) added
// later is checked automatically, not by hardcoding today's file list.
function walk(dirAbs: string, out: string[]): void {
  for (const entry of readdirSync(dirAbs)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = path.join(dirAbs, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      walk(abs, out);
    } else if (CODE_FILE_PATTERN.test(entry)) {
      out.push(abs);
    }
  }
}

function relPath(fileAbs: string): string {
  return path.relative(REPO_ROOT, fileAbs).split(path.sep).join("/");
}

const MIDDLEWARE = "apps/cafe/middleware.ts";
const AUTH_CONFIG = "apps/cafe/auth.config.ts";
const TABLES_ROUTE = "apps/cafe/app/api/tables/route.ts";
const TABLE_SCHEMA = "packages/shared/src/schemas/table.schema.ts";
const PUBLIC_TABLE_TOKEN_ROUTE = "apps/cafe/app/api/public/table/[token]/route.ts";
const PUBLIC_TABLES_ROUTE = "apps/cafe/app/api/public/tables/route.ts";
const PUBLIC_MENU_ROUTE = "apps/cafe/app/api/public/menu/route.ts";
const TABLE_MODEL = "apps/cafe/models/Table.ts";
const PRODUCT_MODEL = "apps/cafe/models/Product.ts";
const PRODUCT_SCHEMA = "packages/shared/src/schemas/product.schema.ts";
const PRODUCT_ITEM_ROUTE = "apps/cafe/app/api/products/[id]/route.ts";
const PRODUCT_FORM_SHEET = "apps/cafe/components/products/ProductFormSheet.tsx";

// ── 1. middleware.ts and auth.config.ts share ONE predicate ─────────────────

test("PIN: middleware.ts and auth.config.ts both exempt the public path via the SAME shared predicate — neither hardcodes a bare \"/m\" literal that could drift", () => {
  const authSrc = stripComments(readSrc(AUTH_CONFIG));
  const middlewareSrc = stripComments(readSrc(MIDDLEWARE));

  assert.match(authSrc, /export function isPublicPath\(/, "auth.config.ts must export isPublicPath");
  // 2026-08-20: the import also carries BOTID_CLIENT_PATH_PREFIX (the BotID
  // challenge-asset exemption) — BOTH names must come from the shared module,
  // never re-derived literals.
  assert.match(
    authSrc,
    /import \{ BOTID_CLIENT_PATH_PREFIX, PUBLIC_MENU_PATH \} from "@pos\/shared\/public";/,
    "isPublicPath must be built from the shared PUBLIC_MENU_PATH + BOTID_CLIENT_PATH_PREFIX constants, not re-derived literals",
  );
  assert.match(
    authSrc,
    /pathname\.startsWith\(BOTID_CLIENT_PATH_PREFIX\)/,
    "isPublicPath must exempt BotID's challenge-asset prefix — middleware runs before withBotId's rewrites, so without this an anonymous diner's challenge script 307s to /login and the public order POST breaks on any device without a panel session",
  );

  assert.match(
    middlewareSrc,
    /import authConfig, \{ isPublicPath \} from "@\/auth\.config";/,
    "middleware.ts must IMPORT isPublicPath from auth.config.ts rather than redefining it",
  );
  assert.match(middlewareSrc, /isPublicPath\(pathname\)/, "middleware.ts must actually CALL isPublicPath, not just import it");

  // Mutation this catches: either file re-deriving the rule with a bare "/m"
  // literal (e.g. `pathname === "/m"`) instead of the shared predicate — a
  // literal cannot be kept in lock-step by the type system, only by developer
  // discipline, which is exactly what importing one function removes.
  assert.ok(!/["']\/m["']/.test(authSrc), 'auth.config.ts must never hardcode a bare "/m" literal');
  assert.ok(!/["']\/m["']/.test(middlewareSrc), 'middleware.ts must never hardcode a bare "/m" literal');
});

// ── 2. isPublicPath itself — edge-safe, importable, unit-testable here ──────

test('PIN: isPublicPath matches "/m", "/m/<anything>", and the BotID challenge prefix only — not "/menu", "/m-admin", "/mx", "/m2", "/", or the case-mismatched "/M"', () => {
  const cases: Array<[string, boolean]> = [
    ["/m", true],
    ["/m/anything", true],
    ["/m/0123456789ABCD", true],
    // 2026-08-20 field fix: BotID's same-origin challenge assets. Middleware
    // runs BEFORE withBotId's rewrites, so without this exemption every
    // anonymous diner's challenge script 307'd to /login and the public order
    // POST broke on any phone without a panel session cookie.
    ["/149e9513-01fa-4fb0-aad4-566afd725d1b/x/c.js", true],
    // The prefix match must not admit a sibling path that merely shares the
    // leading UUID characters without the trailing slash boundary.
    ["/149e9513-01fa-4fb0-aad4-566afd725d1bXX/c.js", false],
    ["/menu", false],
    ["/m-admin", false],
    ["/mx", false],
    ["/", false],
    ["/m2", false],
    // Mutation this catches: a case-insensitive comparison — path matching in
    // this app is deliberately case-sensitive, so "/M" must stay a 404/login
    // bounce, never an accidental alias for the public menu.
    ["/M", false],
  ];
  for (const [pathname, expected] of cases) {
    assert.equal(isPublicPath(pathname), expected, `isPublicPath(${JSON.stringify(pathname)}) should be ${expected}`);
  }
});

// ── 3. no auth helper anywhere under app/api/public/** ──────────────────────

test("PIN: no route under app/api/public/** calls requireAuth, requireAdmin, or auth() — a fourth public route added later is checked automatically, not by a hardcoded file list", () => {
  const dirAbs = path.join(REPO_ROOT, "apps/cafe/app/api/public");
  const files: string[] = [];
  walk(dirAbs, files);
  assert.ok(files.length > 0, "app/api/public must contain at least one route file to check — an empty glob would pass this test for the wrong reason");

  for (const fileAbs of files) {
    const rel = relPath(fileAbs);
    const src = stripComments(readFileSync(fileAbs, "utf8"));
    // Mutation this catches: copy-pasting an admin/staff route as a starting
    // point for a new public one and forgetting to strip its auth guard — any
    // of these three names appearing means this "public" route silently isn't.
    assert.ok(!/requireAuth/.test(src), `${rel} must not reference requireAuth`);
    assert.ok(!/requireAdmin/.test(src), `${rel} must not reference requireAdmin`);
    assert.ok(!/\bauth\(/.test(src), `${rel} must not call auth(...)`);
  }
});

// ── 4. POST /api/tables never reads publicToken from the body ──────────────

test("PIN: POST /api/tables never reads publicToken from the request body — it comes ONLY from mintUniquePublicToken, and createTableSchema is .strict() so an extra key can't even parse", () => {
  const src = stripComments(readSrc(TABLES_ROUTE));
  const postStart = src.indexOf("export async function POST");
  assert.ok(postStart >= 0, "POST handler must exist");
  const patchStart = src.indexOf("export async function PATCH", postStart);
  const postBody = patchStart >= 0 ? src.slice(postStart, patchStart) : src.slice(postStart);

  assert.match(
    postBody,
    /const publicToken = await mintUniquePublicToken\(/,
    "POST must mint the token via mintUniquePublicToken",
  );
  // Mutation this catches: reading `parsed.data.publicToken` (or any client
  // value) into the create call instead of the server-minted one — a client
  // could then choose or overwrite its own QR secret.
  assert.match(
    postBody,
    /Table\.create\(\{ \.\.\.parsed\.data, displayOrder, publicToken \}\)/,
    "the create call must use the server-minted `publicToken` binding, spread AFTER parsed.data so it always wins",
  );

  const schemaSrc = stripComments(readSrc(TABLE_SCHEMA));
  const schemaStart = schemaSrc.indexOf("export const createTableSchema");
  assert.ok(schemaStart >= 0, "createTableSchema must exist in table.schema.ts");
  const nextExportStart = schemaSrc.indexOf("export const patchTableSchema", schemaStart);
  const schemaBody = schemaSrc.slice(schemaStart, nextExportStart >= 0 ? nextExportStart : undefined);
  // Mutation this catches: dropping .strict() from createTableSchema — an
  // unstripped Zod object schema silently accepts and validates through any
  // extra key (including a client-sent `publicToken`) that the route itself
  // never reads back out, papering over exactly the mistake this pin exists for.
  assert.match(schemaBody, /\.strict\(\)/, "createTableSchema must be declared .strict()");
});

// ── 5. GET /api/public/table/[token]: validate-before-query, narrow select ──

test("PIN: GET /api/public/table/[token] validates isPublicToken BEFORE any Table.findOne, and its .select() excludes status, currentOrderId and publicToken", () => {
  const src = stripComments(readSrc(PUBLIC_TABLE_TOKEN_ROUTE));
  const validateIdx = src.indexOf("isPublicToken(token)");
  const findIdx = src.indexOf("Table.findOne(");
  assert.ok(validateIdx >= 0, "the route must call isPublicToken(token)");
  assert.ok(findIdx >= 0, "the route must call Table.findOne(");
  // Mutation this catches: querying Mongo before validating the token's
  // shape — a malformed token would then cost a real query on every request
  // instead of a cheap regex test that never reaches the DB.
  assert.ok(validateIdx < findIdx, "isPublicToken must be checked strictly BEFORE Table.findOne");

  const selectMatch = src.match(/\.select\("([^"]+)"\)/);
  assert.ok(selectMatch, "the query must call .select(\"...\") with a field list");
  const fields = selectMatch[1].split(/\s+/);
  // Mutation this catches: widening the projection to include status,
  // currentOrderId or the token itself — a diner does not need to know
  // occupancy, and echoing the token back would turn a captured response
  // page into a token oracle.
  for (const banned of ["status", "currentOrderId", "publicToken"]) {
    assert.ok(!fields.includes(banned), `.select() must not include "${banned}"`);
  }
  assert.ok(fields.includes("tableNo"), ".select() must include tableNo");
});

// ── 6. models/Table.ts: publicToken index is unique AND sparse ─────────────

test("PIN: models/Table.ts's publicToken index is declared unique AND sparse — sparse is what lets every pre-CR2 table (no token at all) coexist without colliding on null", () => {
  const src = stripComments(readSrc(TABLE_MODEL));
  // Mutation this catches: dropping either option. Losing `unique` lets two
  // tables print the same QR secret; losing `sparse` makes the SECOND
  // tokenless table fail to insert, because a plain unique index treats every
  // document missing the field as sharing the same null value.
  assert.match(
    src,
    /tableSchema\.index\(\{ publicToken: 1 \}, \{ unique: true, sparse: true \}\)/,
    "the publicToken index must be declared exactly `{ unique: true, sparse: true }`",
  );
});

// ── 7. models/Product.ts: publicVisible carries no default ─────────────────

test("PIN: models/Product.ts's publicVisible field carries no `default:` — absent must keep meaning \"visible\", and a default would flip every pre-CR2 product's meaning the moment it next saved", () => {
  const src = stripComments(readSrc(PRODUCT_MODEL));
  const fieldMatch = src.match(/publicVisible:\s*\{[^}]*\}/);
  assert.ok(fieldMatch, "publicVisible must be declared as a schema field");
  // Mutation this catches: adding `default: false` (or any default) to this
  // field — the model file's own comment explains why that silently rewrites
  // every existing product's meaning on its next save.
  assert.ok(!/default/.test(fieldMatch[0]), "the publicVisible field definition must never include `default:`");
  assert.match(fieldMatch[0], /type:\s*Boolean/, "publicVisible must be typed Boolean");
});

// ── 8. no Mongoose/model/DB reach from the diner-facing bundle (CR2.4 A13) ──
//
// CONTRACT CHANGE (CR2.4 S6, A13): the original CR2.1 ban list (models/
// table-admin/mongoose) is EXTENDED with @/lib/db, @/lib/settings and
// @/lib/public-appearance across BOTH trees, narrowed by exactly ONE keyed
// exemption — @/lib/public-appearance may be imported by the three named /m
// server entry points (layout + both pages) ONLY, because that module is the
// sole gateway CR2.4 opened into readSettings (A1: they need heroImage/
// logoPlacement, which no public API route carries). No file, including
// those three, may import @/lib/db or @/lib/settings DIRECTLY — the ONE path
// in is through public-appearance.ts, never around it.

const PUBLIC_APPEARANCE_LIB = "apps/cafe/lib/public-appearance.ts";
// The only three files the @/lib/public-appearance exemption covers — an
// exact list, not a directory-wide allowance, so a fourth /m route later
// added does NOT inherit server DB reach just by living under app/m/**.
const PUBLIC_APPEARANCE_EXEMPT_FILES = new Set([
  "apps/cafe/app/m/layout.tsx",
  "apps/cafe/app/m/page.tsx",
  "apps/cafe/app/m/[token]/page.tsx",
]);

test('PIN (A13): no file under app/m/** or components/public/** imports @/models/, lib/table-admin, mongoose, @/lib/db, or @/lib/settings — and @/lib/public-appearance is importable ONLY by the three named /m server entry points, each of which carries no "use client"', () => {
  const dirs = ["apps/cafe/app/m", "apps/cafe/components/public"];
  const alwaysBanned: Array<[RegExp, string]> = [
    [/from ["']@\/models\//, "@/models/"],
    [/from ["'][^"']*lib\/table-admin["']/, "lib/table-admin"],
    [/from ["']mongoose["']/, "mongoose"],
    [/from ["']@\/lib\/db["']/, "@/lib/db"],
    [/from ["']@\/lib\/settings["']/, "@/lib/settings"],
  ];
  const publicAppearancePattern = /from ["']@\/lib\/public-appearance["']/;

  let exemptFilesSeen = 0;
  for (const dir of dirs) {
    const dirAbs = path.join(REPO_ROOT, dir);
    const files: string[] = [];
    walk(dirAbs, files);
    assert.ok(files.length > 0, `${dir} must contain at least one file to check`);

    for (const fileAbs of files) {
      const rel = relPath(fileAbs);
      const rawSrc = readFileSync(fileAbs, "utf8");
      const src = stripComments(rawSrc);
      for (const [pattern, label] of alwaysBanned) {
        // Mutation this catches: a diner-facing component importing a model
        // (even type-only), the Mongoose package, or either of the two raw
        // DB-reach helpers directly — every one of these would either ship
        // the driver to a diner's phone or open a SECOND, unpinned path into
        // Settings alongside public-appearance.ts's single gateway.
        assert.ok(!pattern.test(src), `${rel} must not import from ${label}`);
      }

      const importsPublicAppearance = publicAppearancePattern.test(src);
      if (PUBLIC_APPEARANCE_EXEMPT_FILES.has(rel)) {
        exemptFilesSeen += 1;
        assert.ok(importsPublicAppearance, `${rel} is one of the three named exempt files and must import @/lib/public-appearance`);
        // Mutation this catches: one of these three server entry points
        // gaining a "use client" directive — a client component cannot await
        // readPublicAppearance(), and losing this guarantee would silently
        // turn the server-rendered theme into a client-side flash again.
        assert.ok(!/["']use client["']/.test(src), `${rel} must not carry "use client" — it is a server component reading Settings directly`);
      } else {
        // Mutation this catches: a FOURTH file (a new /m route, or any file
        // under components/public/**) reaching for @/lib/public-appearance
        // just because it lives near the exempt three — the exemption is
        // keyed to these exact three files, never the directory they sit in.
        assert.ok(!importsPublicAppearance, `${rel} must not import @/lib/public-appearance — only the three named /m server entry points may`);
      }
    }
  }
  assert.equal(
    exemptFilesSeen,
    PUBLIC_APPEARANCE_EXEMPT_FILES.size,
    "all three named exempt files must actually exist on disk and be visited by the walk — a renamed/moved file would silently drop out of this pin",
  );
});

test('PIN (A13): lib/public-appearance.ts\'s only @/lib or @/models import is { readSettings } from "@/lib/settings" — the single gateway the three exempt files above reach through must never widen on its own', () => {
  const src = stripComments(readSrc(PUBLIC_APPEARANCE_LIB));
  const libImports = [...src.matchAll(/from ["'](@\/(?:lib|models)\/[^"']+)["']/g)].map((m) => m[1]);
  assert.deepEqual(
    libImports,
    ["@/lib/settings"],
    "lib/public-appearance.ts must import from exactly one @/lib or @/models path: @/lib/settings",
  );
  assert.match(
    src,
    /import \{ readSettings \} from "@\/lib\/settings";/,
    "the one import must be the named readSettings binding",
  );
});

// ── 9. no dangerouslySetInnerHTML on the diner-facing surface ──────────────

test("PIN: dangerouslySetInnerHTML appears nowhere under app/m/** or components/public/** — this surface renders only data this app itself produced, never raw HTML", () => {
  const dirs = ["apps/cafe/app/m", "apps/cafe/components/public"];
  for (const dir of dirs) {
    const dirAbs = path.join(REPO_ROOT, dir);
    const files: string[] = [];
    walk(dirAbs, files);
    for (const fileAbs of files) {
      const rel = relPath(fileAbs);
      const src = readFileSync(fileAbs, "utf8");
      // Mutation this catches: introducing dangerouslySetInnerHTML anywhere on
      // this surface — even sourced from this app's own data, it is the one
      // React escape hatch that turns a stored string into live markup on an
      // unauthenticated page.
      assert.ok(!/dangerouslySetInnerHTML/.test(src), `${rel} must not use dangerouslySetInnerHTML`);
    }
  }
});

// ── 10. GET /api/public/tables: narrow select, no occupancy/charge fields ──

test("PIN: GET /api/public/tables selects only tableNo, maps through toPublicTable, and the file never mentions publicToken, chargeAmount, chargeLabel, currentOrderId or status", () => {
  const src = stripComments(readSrc(PUBLIC_TABLES_ROUTE));
  assert.match(src, /\.select\("tableNo"\)/, "the query must select exactly tableNo");
  assert.match(src, /\.map\(toPublicTable\)/, "the response must be shaped through toPublicTable, not hand-built");

  // Mutation this catches: widening the .select() (or bypassing toPublicTable
  // to hand-build the response) to carry ANY of these fields — even one
  // mentioned elsewhere in the file (a stray debug field, a wider select
  // string) would hand every diner in the room the QR secret or occupancy
  // state for every table at once, not just their own.
  for (const banned of ["publicToken", "chargeAmount", "chargeLabel", "currentOrderId", "status"]) {
    assert.ok(!new RegExp(`\\b${banned}\\b`).test(src), `the file must never mention "${banned}"`);
  }
});

// ── 11. GET /api/public/menu: readSettings, never getSettings ──────────────

test("PIN: GET /api/public/menu imports and calls readSettings, and never getSettings — the upsert getter WRITES on every call, which a public route must never let anonymous traffic trigger", () => {
  const src = stripComments(readSrc(PUBLIC_MENU_ROUTE));
  assert.match(
    src,
    /import \{ readSettings \} from "@\/lib\/settings";/,
    "the route must import readSettings from @/lib/settings",
  );
  assert.match(src, /readSettings\(\)/, "the route must actually call readSettings()");
  // Mutation this catches: swapping back to getSettings (or calling both) —
  // getSettings' $setOnInsert upsert mutates `updatedAt` on every call
  // (project lesson: mongoose-setoninsert-upsert-still-writes), and this
  // route has no login, no session and no rate limit standing between it and
  // that write on a 512MB M0.
  assert.ok(!/getSettings/.test(src), "the file must never reference getSettings");
});

// ── 12. the publicVisible null-sentinel triple, all three sides ────────────

test('PIN: the publicVisible null-sentinel triple holds on all three sides — schema nullable, route $unsets it via nullClearsFields, form sends null to re-show. Mutation this catches: any ONE side reverting re-introduces the "can never un-hide" bug', () => {
  const schemaSrc = stripComments(readSrc(PRODUCT_SCHEMA));
  assert.match(
    schemaSrc,
    /publicVisible:\s*z\.boolean\(\)\.nullable\(\)\.optional\(\)/,
    "updateProductSchema's publicVisible must be z.boolean().nullable().optional()",
  );

  const routeSrc = stripComments(readSrc(PRODUCT_ITEM_ROUTE));
  const nullClearsMatch = routeSrc.match(/nullClearsFields:\s*\[([^\]]*)\]/);
  assert.ok(nullClearsMatch, "products/[id]/route.ts must declare nullClearsFields");
  assert.match(nullClearsMatch[1], /"variations"/, 'nullClearsFields must include "variations"');
  assert.match(nullClearsMatch[1], /"publicVisible"/, 'nullClearsFields must include "publicVisible"');

  const formSrc = stripComments(readSrc(PRODUCT_FORM_SHEET));
  assert.match(
    formSrc,
    /publicVisible:\s*values\.publicVisible\s*\?\?\s*null/,
    "ProductFormSheet must send `values.publicVisible ?? null` on every edit submit",
  );
});
