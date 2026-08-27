import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// CR2.2 — the diner self-order (QR) flow lands a whole new bridge (a
// diner-submitted OrderRequest becoming a real Order) plus a whole new
// diner-facing surface (app/m/**, components/public/**). CR2.1's headline
// defect was a hook with ZERO call sites, so the wiring/reachability pins
// here are just as load-bearing as the security ones — a slice can satisfy
// every other spec line and still ship a dead button. Same readFileSync/
// stripComments technique as lib/public-surface-paths.test.ts (read there
// first) — this repo has no React/route test framework by design.
//
// NOT duplicated here — already pinned elsewhere:
//   - lib/order-request-accept.test.ts: acceptOrderRequest's own branch
//     behavior (CAS races, drift rejection, table-conflict, replay).
//   - lib/order-request-intake.test.ts / lib/public-pricing.test.ts /
//     lib/public-rate-limit.test.ts: those modules' own unit behavior.
//   - lib/order-request-model.test.ts: assertSchemaTtlAllowed itself.
//   - lib/public-surface-paths.test.ts: the QR-menu (CR2.1) surface's own
//     pins (isPublicPath, /api/public/table, /api/public/menu, etc).

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// These pins forbid/require CODE shapes, so they must look at code and not at
// prose — a comment explaining the rule would otherwise trip the very pin
// meant to enforce it (this bit this repo once already on a banned-string pin).

const SKIP_DIRS = new Set(["node_modules", ".next"]);
const CODE_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

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

// Returns the index of `needle` in `src`, asserting it was found — every
// ordering pin below composes these so a missing call fails with a clear
// message instead of a confusing "-1 < -1" pass.
function mustIndexOf(src: string, needle: string, label: string): number {
  const idx = src.indexOf(needle);
  assert.ok(idx >= 0, `expected to find ${label} (searched for ${JSON.stringify(needle)})`);
  return idx;
}

const ACCEPT_LIB = "apps/cafe/lib/order-request-accept.ts";
const ACCEPT_CORE = "apps/cafe/lib/order-request-accept-core.ts";
const ACCEPT_WRITE = "apps/cafe/lib/order-request-accept-write.ts";
const ACCEPT_PROMO = "apps/cafe/lib/order-request-accept-promo.ts";
// CR2.3 §20 mechanical split (S1b line-budget fix) — buildFallbackRequest's
// own fifth sibling.
const ACCEPT_FALLBACK = "apps/cafe/lib/order-request-accept-fallback.ts";
const PUBLIC_PRICING = "apps/cafe/lib/public-pricing.ts";
const PUBLIC_ORDER_REQUEST_ROUTE = "apps/cafe/app/api/public/order-request/route.ts";
const PUBLIC_ORDER_REQUEST_STATUS_ROUTE =
  "apps/cafe/app/api/public/order-request/[shortCode]/route.ts";
const STAFF_ACCEPT_ROUTE = "apps/cafe/app/api/order-requests/[id]/accept/route.ts";
const NEXT_CONFIG = "apps/cafe/next.config.ts";
const INSTRUMENTATION_CLIENT = "apps/cafe/instrumentation-client.ts";
const POS_PAGE = "apps/cafe/app/(dashboard)/pos/page.tsx";
const REQUESTS_PAGE = "apps/cafe/app/(dashboard)/requests/page.tsx";
const REQUESTS_BOARD = "apps/cafe/components/orders/RequestsBoard.tsx";
const ORDER_REQUEST_CARD = "apps/cafe/components/orders/OrderRequestCard.tsx";
const APP_SIDEBAR = "apps/cafe/components/layout/AppSidebar.tsx";
const REQUEST_COUNT_BADGE = "apps/cafe/components/orders/RequestCountBadge.tsx";
const ORDER_REQUESTS_ROUTE = "apps/cafe/app/api/order-requests/route.ts";
const USE_ORDER_REQUESTS = "apps/cafe/hooks/use-order-requests.ts";
const M_PAGE = "apps/cafe/app/m/page.tsx";
const M_TOKEN_PAGE = "apps/cafe/app/m/[token]/page.tsx";
const M_STATUS_PAGE = "apps/cafe/app/m/o/[shortCode]/page.tsx";
const PUBLIC_ORDER_FLOW = "apps/cafe/components/public/PublicOrderFlow.tsx";
const PUBLIC_CART = "apps/cafe/components/public/PublicCart.tsx";
const PUBLIC_ORDER_STATUS = "apps/cafe/components/public/PublicOrderStatus.tsx";
const ORDER_REQUEST_MODEL = "apps/cafe/models/OrderRequest.ts";
const SHARED_PUBLIC = "packages/shared/src/public.ts";
const SETTINGS_ROUTE = "apps/cafe/app/api/settings/route.ts";
const REJECT_ROUTE = "apps/cafe/app/api/order-requests/[id]/reject/route.ts";
const PUBLIC_RATE_LIMIT = "apps/cafe/lib/public-rate-limit.ts";
// CR2.2d split (D2) — the create/edit routes' own promo resolver + honeypot
// mimicry (create) and Zod schema/promo resolver/status guard (edit) moved
// here to keep the two route files under the ~300-line cap.
const ORDER_REQUEST_CREATE_LIB = "apps/cafe/lib/order-request-create.ts";
const ORDER_REQUEST_EDIT_LIB = "apps/cafe/lib/order-request-edit.ts";
// CR2.3 §20 (client slice S2) — the pulse's provider/layout reachability pins.
const DASHBOARD_LAYOUT = "apps/cafe/app/(dashboard)/layout.tsx";
const USE_POS_PULSE = "apps/cafe/hooks/use-pos-pulse.ts";

// ── A. Accept-bridge drift fence ────────────────────────────────────────────

test("PIN: order-request-accept.ts + order-request-accept-core.ts + order-request-accept-write.ts + order-request-accept-promo.ts (combined) import/use every write-path helper the bridge must mirror from POST /api/orders and POST /api/orders/[id]/items", () => {
  // CR2.2 fix round — recoverOrderCreate (the bumpOrderSequenceTo caller)
  // moved from -core.ts to -write.ts to stay under the ~300-line budget after
  // the fix landed; CR2.2d split moved the promo fence + note-line glue to a
  // FOURTH sibling (-promo.ts) and the add-round branch's own orchestration
  // + gstConfigDrifted/isSourceRequestIdsDuplicate into -write.ts. The
  // combined text now spans all FOUR sibling files so this pin keeps proving
  // the same invariant regardless of which file a given helper call
  // currently lives in.
  const combined =
    stripComments(readSrc(ACCEPT_LIB)) +
    "\n" +
    stripComments(readSrc(ACCEPT_CORE)) +
    "\n" +
    stripComments(readSrc(ACCEPT_WRITE)) +
    "\n" +
    stripComments(readSrc(ACCEPT_PROMO));

  // Money/GST helpers actually come from lib/receipt.ts (computeOrderTotals,
  // gstConfigFromOrder) and lib/order.ts (derivePayment) — verified against
  // the landed source, not assumed from the slice name alone.
  const requiredCalls = [
    "resolveTableCharge(",
    "computeOrderTotals(",
    "gstConfigFromOrder(",
    "derivePayment(",
    "nextOrderSequence(",
    "bumpOrderSequenceTo(",
    "nextSlipSequence(",
    "printedSlipNumber(",
    "voidGuardFilter(",
    "FREE_TABLE_FILTER",
    "priceRequestItems(",
  ];
  for (const needle of requiredCalls) {
    // Mutation this catches: the accept bridge silently forking its own copy
    // of money/numbering/guard logic instead of reusing the SAME helper the
    // order-write routes use — the two would then drift apart on the next
    // edit to either side.
    assert.ok(combined.includes(needle), `combined accept-bridge source must use ${needle}`);
  }

  // Exact import sources — pins WHICH module each helper is contracted to,
  // not just that the name appears somewhere in the file.
  assert.match(
    stripComments(readSrc(ACCEPT_LIB)),
    /import \{ computeOrderTotals, gstConfigFromOrder, gstConfigOfSettings \} from "@\/lib\/receipt";/,
    "computeOrderTotals/gstConfigFromOrder must come from lib/receipt.ts, not lib/order.ts",
  );
  assert.match(
    stripComments(readSrc(ACCEPT_LIB)),
    /import \{ derivePayment, ledgerContribution \} from "@\/lib\/order";/,
    "derivePayment must come from lib/order.ts",
  );
});

// GAP the spec's literal name list could not cover as written: neither
// order-request-accept.ts nor order-request-accept-core.ts imports
// checkItemVariations directly — priceRequestItems (lib/public-pricing.ts)
// owns variation validity and the accept bridge reuses IT, one hop removed.
// This pins that the reuse chain itself is real (public-pricing.ts really
// does call the shared checkItemVariations, not a forked copy) rather than
// forcing a false claim about which file imports what.
test("PIN: lib/public-pricing.ts (priceRequestItems' own module) reuses checkItemVariations from lib/variations — the accept bridge's variation-check reuse is one hop through here, not a direct import", () => {
  const src = stripComments(readSrc(PUBLIC_PRICING));
  assert.match(
    src,
    /import \{ checkItemVariations \} from "@\/lib\/variations";/,
    "public-pricing.ts must import checkItemVariations from lib/variations, not re-implement it",
  );
  assert.match(src, /checkItemVariations\(/, "public-pricing.ts must actually call checkItemVariations");
});

// ── A2. CR2.3 mechanical split — fallback-builder reachability ─────────────

test("PIN: CR2.3 mechanical split — order-request-accept-fallback.ts exports buildFallbackRequest, and order-request-accept-core.ts's finalizeAccept reaches it through a REAL cross-module import (CR2.1's dead-hook lesson, run again on a split instead of a whole feature)", () => {
  const fallbackSrc = stripComments(readSrc(ACCEPT_FALLBACK));
  assert.match(
    fallbackSrc,
    /export function buildFallbackRequest\(/,
    "order-request-accept-fallback.ts must export buildFallbackRequest",
  );

  const coreSrc = stripComments(readSrc(ACCEPT_CORE));
  assert.match(
    coreSrc,
    /import \{ buildFallbackRequest \} from "@\/lib\/order-request-accept-fallback";/,
    "order-request-accept-core.ts must import buildFallbackRequest from the sibling it was split into",
  );
  // Mutation this catches: the split landing as inert dead code — the new
  // file exports the builder but core.ts never actually calls the import (or
  // silently keeps its own copy instead).
  assert.match(
    coreSrc,
    /buildFallbackRequest\(order, requestId, actor, new Date\(\)\)/,
    "finalizeAccept must still call buildFallbackRequest with the same args",
  );
});

// ── B. Repair-before-recreate ordering ──────────────────────────────────────

test("PIN: acceptOrderRequest's findByRequestId repair lookup runs BEFORE the order-create call — a crash between the order write and the request mark must be repaired, never double-billed", () => {
  const src = stripComments(readSrc(ACCEPT_LIB));
  const repairIdx = mustIndexOf(src, "await findByRequestId(requestId)", "the step-3 repair lookup");
  // Mutation this catches: reordering so a retried accept mints a SECOND
  // Order for a request that already has one from a prior crashed attempt.
  const createIdx = mustIndexOf(src, "Order.create(", "the order-creation call");
  assert.ok(repairIdx < createIdx, "findByRequestId must run strictly before Order.create");
});

// ── C. Add-round guard completeness ─────────────────────────────────────────

test('PIN: buildAddRoundFilter carries ALL FIVE CAS terms — status:"Pending", payment:"Unpaid", the kotRounds echo, voidGuardFilter(, and acceptGuardFilter( — dropping any one reopens a race this filter exists to close', () => {
  const src = stripComments(readSrc(ACCEPT_CORE));
  const start = mustIndexOf(src, "export function buildAddRoundFilter", "buildAddRoundFilter");
  const nextExport = src.indexOf("\nexport ", start + 1);
  const body = nextExport >= 0 ? src.slice(start, nextExport) : src.slice(start);

  // Mutation this catches (per-term): CR1.3's reciprocal-CAS lesson — a new
  // guard field added to ONE writer of Order.items but not this one lets a
  // round-fire re-bill a voided/settled/already-accepted line.
  assert.match(body, /status:\s*"Pending"/, 'buildAddRoundFilter must guard status:"Pending"');
  assert.match(body, /payment:\s*"Unpaid"/, 'buildAddRoundFilter must guard payment:"Unpaid"');
  assert.match(body, /kotRounds:\s*old\.kotRounds/, "buildAddRoundFilter must echo the tab's own kotRounds");
  assert.match(body, /voidGuardFilter\(/, "buildAddRoundFilter must spread voidGuardFilter(...)");
  assert.match(body, /acceptGuardFilter\(/, "buildAddRoundFilter must spread acceptGuardFilter(...)");
});

// ── D. Public POST control order + honeypot-before-create ──────────────────

test("PIN: POST /api/public/order-request runs its controls in the documented order — checkBotId, then the host gate, then body-size (.text), then JSON.parse, then the rate limit — never reordered past each other", () => {
  const src = stripComments(readSrc(PUBLIC_ORDER_REQUEST_ROUTE));
  const botIdx = mustIndexOf(src, "checkBotId(", "the BotID check");
  const hostIdx = mustIndexOf(src, "resolveTenantFromHost(", "the host gate");
  const textIdx = mustIndexOf(src, ".text(", "the body-size read (req.text())");
  const parseIdx = mustIndexOf(src, "JSON.parse(", "the JSON parse");
  const rateIdx = mustIndexOf(src, "hitRateLimit(", "the rate limit");

  // Mutation this catches: touching the body (parsing it, or even reading its
  // byte length) before the bot/host gates run — an unwanted client would
  // then get real work done (parsing, allocation) before being turned away.
  assert.ok(botIdx < hostIdx, "checkBotId must run before the host gate");
  assert.ok(hostIdx < textIdx, "the host gate must run before the body is read at all");
  assert.ok(textIdx < parseIdx, "the size cap (.text()) must run before JSON.parse");
  assert.ok(parseIdx < rateIdx, "parsing/shape-validation must run before the rate limit is charged");
});

test("PIN: the honeypot field is lifted off the RAW body (pre-Zod) and handled BEFORE OrderRequest.create — a bot that fills `hp` gets a pretend success, never a stored row", () => {
  const src = stripComments(readSrc(PUBLIC_ORDER_REQUEST_ROUTE));
  // The hp read happens on the raw parsed object, BEFORE the Zod schema (which
  // deliberately no longer knows the field — an over-long hp must never 400,
  // that would be a tell). `delete bodyObj.hp` keeps .strict() satisfied.
  const hpReadIdx = mustIndexOf(src, "bodyObj?.hp", "the raw-body honeypot read");
  const hpDeleteIdx = mustIndexOf(src, "delete bodyObj.hp", "the pre-Zod hp strip");
  const zodIdx = mustIndexOf(src, "safeParse(", "the Zod parse");
  assert.ok(hpReadIdx < zodIdx, "the honeypot read must happen before Zod sees the body");
  assert.ok(hpDeleteIdx < zodIdx, "hp must be stripped before the .strict() schema parses");
  // Mutation this catches: moving the honeypot branch after the request is
  // already persisted — the pretend-success promise in the file's own
  // control-order comment would then be false, and a bot's junk row would
  // sit in the collection (and the tray) exactly like a real diner's.
  const createIdx = mustIndexOf(src, "OrderRequest.create(", "the OrderRequest persist call");
  assert.ok(hpReadIdx < createIdx, "the honeypot check must run before OrderRequest.create");
});

// ── E. No client-supplied table name / no IP-keyed rate limit ──────────────

test("PIN: POST /api/public/order-request never reads a client-sent table NAME and never rate-limits by IP — the bucket key is the table TOKEN or the shared parcel bucket", () => {
  const src = stripComments(readSrc(PUBLIC_ORDER_REQUEST_ROUTE));
  // Mutation this catches: trusting `parsed.data.tableNo` / `body.tableNo` /
  // `raw` for the table identity instead of resolving it server-side from the
  // opaque publicToken — a client-named table lets a diner spam or read a
  // table they were never scanned into (§6.2's TABLE_NAME_BLOCKED_ERROR
  // exists client-side for exactly this; the server must never undo it).
  assert.ok(
    !/tableNo\s*[:=]\s*(parsed|body|raw)/.test(src),
    "the route must never read tableNo off parsed/body/raw",
  );
  // Mutation this catches: keying the rate limit on the caller's IP — a
  // cafe's WiFi is one shared egress, so an IP-keyed limit either starves
  // every diner in the room over one table's traffic or does nothing at all
  // (file-level comment, control #7).
  assert.ok(!/x-forwarded-for/.test(src), "the route must never read x-forwarded-for");
  assert.ok(!/req\.ip\b/.test(src), "the route must never read req.ip");

  assert.match(
    src,
    /const bucket = data\.target\.kind === "table" \? data\.target\.token : PARCEL_BUCKET_KEY;/,
    "the rate-limit bucket must be the table token or PARCEL_BUCKET_KEY",
  );
});

// ── F. Settings-getter discipline across the three routes ──────────────────

test("PIN: the public POST route calls readSettings and never getSettings; the staff accept route calls getSettings (the upserting getter is correct on an authenticated write path)", () => {
  const postSrc = stripComments(readSrc(PUBLIC_ORDER_REQUEST_ROUTE));
  assert.match(postSrc, /readSettings\(\)/, "POST /api/public/order-request must call readSettings()");
  // Mutation this catches: swapping back to getSettings on an anonymous
  // write path — its $setOnInsert upsert mutates updatedAt on every call
  // (project lesson: mongoose-setoninsert-upsert-still-writes), and this
  // route has no session standing between a scripted client and that write.
  assert.ok(!/getSettings/.test(postSrc), "POST /api/public/order-request must never reference getSettings");

  const statusSrc = stripComments(readSrc(PUBLIC_ORDER_REQUEST_STATUS_ROUTE));
  // CR2.2b: the file now hosts the diner-edit PATCH too, whose re-quote
  // legitimately calls readSettings() — but the anonymous-write risk this pin
  // exists for (getSettings' $setOnInsert upsert mutating updatedAt on every
  // call — project lesson: mongoose-setoninsert-upsert-still-writes) still
  // holds for EVERY handler in the file, so the getSettings ban is absolute.
  assert.ok(!/getSettings/.test(statusSrc), ".../[shortCode] must never reference getSettings");
  assert.match(statusSrc, /readSettings\(\)/, "the PATCH re-quote must read settings via readSettings()");
  // And the GET handler itself must still not read settings — scope the check
  // to the GET function body (everything before the PATCH export).
  const patchIdx = mustIndexOf(statusSrc, "export async function PATCH", "the PATCH export");
  const getIdx = mustIndexOf(statusSrc, "export async function GET", "the GET export");
  assert.ok(getIdx < patchIdx, "GET must be declared before PATCH for this pin's slicing to hold");
  assert.ok(
    !/readSettings\(\)/.test(statusSrc.slice(getIdx, patchIdx)),
    "the GET handler itself must not read settings",
  );

  const acceptSrc = stripComments(readSrc(STAFF_ACCEPT_ROUTE));
  assert.match(
    acceptSrc,
    /getSettings\(\)/,
    "the staff-side accept route must call getSettings — it is authenticated (requireAuth) and correct here",
  );
});

// ── G. Status-GET oracle hygiene ────────────────────────────────────────────

test("PIN: GET /api/public/order-request/[shortCode] validates isPublicCode BEFORE OrderRequest.findOne, and its response literal carries exactly PublicOrderRequestStatusData's field set — no mobile, acceptedOrderId or customerName", () => {
  const src = stripComments(readSrc(PUBLIC_ORDER_REQUEST_STATUS_ROUTE));
  const validateIdx = mustIndexOf(src, "isPublicCode(shortCode)", "the isPublicCode shape check");
  // Mutation this catches: querying Mongo before validating the code's shape
  // — a malformed code would then cost a real query on every request instead
  // of a cheap regex test that never reaches the DB (mirrors the table-token
  // route's own pin in public-surface-paths.test.ts).
  const findIdx = mustIndexOf(src, "OrderRequest.findOne(", "the OrderRequest lookup");
  assert.ok(validateIdx < findIdx, "isPublicCode must be checked strictly before OrderRequest.findOne");

  // Never leak these three fields — checked on the FULL file (comments too
  // reference them, deliberately, in this file's own docstring), so this
  // must run on the STRIPPED source or the docstring itself would trip it.
  for (const banned of ["mobile", "acceptedOrderId", "customerName"]) {
    assert.ok(!new RegExp(`\\b${banned}\\b`).test(src), `the file must never mention "${banned}"`);
  }

  // Field-list parity: every key this route ever assigns onto `data` must be
  // a real PublicOrderRequestStatusData field, and vice versa — read BOTH
  // sides from source so a field added to one and not the other fails here
  // instead of silently drifting.
  const sharedSrc = stripComments(readSrc(SHARED_PUBLIC));
  const ifaceStart = mustIndexOf(
    sharedSrc,
    "export interface PublicOrderRequestStatusData {",
    "the PublicOrderRequestStatusData interface",
  );
  const ifaceEnd = sharedSrc.indexOf("}", ifaceStart);
  const ifaceBody = sharedSrc.slice(ifaceStart, ifaceEnd);
  const ifaceFields = [...ifaceBody.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]).sort();

  const literalStart = mustIndexOf(
    src,
    "const data: PublicOrderRequestStatusData = {",
    "the response literal",
  );
  const literalEnd = src.indexOf("};", literalStart);
  const literalBody = src.slice(literalStart, literalEnd);
  const literalFields = [...literalBody.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  // Omit-empty extras assigned conditionally after the literal (`data.x = `).
  const conditionalFields = [...src.slice(literalEnd).matchAll(/\bdata\.(\w+)\s*=/g)].map((m) => m[1]);
  const routeFields = [...new Set([...literalFields, ...conditionalFields])].sort();

  assert.deepEqual(
    routeFields,
    ifaceFields,
    "the fields this route ever assigns onto `data` must exactly match PublicOrderRequestStatusData's field set",
  );
});

// ── H. Config pins ───────────────────────────────────────────────────────

test("PIN: next.config.ts wraps withBotId, gives /m/:path* (but not the global /:path*) a Content-Security-Policy, and instrumentation-client.ts protects exactly POST /api/public/order-request", () => {
  const configSrc = stripComments(readSrc(NEXT_CONFIG));
  assert.match(configSrc, /withBotId\(/, "next.config.ts must call withBotId(...)");

  const headersStart = mustIndexOf(configSrc, "async headers()", "the headers() config function");
  const headersEnd = configSrc.indexOf("async rewrites()", headersStart);
  const headersBody = headersEnd >= 0 ? configSrc.slice(headersStart, headersEnd) : configSrc.slice(headersStart);

  const globalEntryMatch = headersBody.match(/\{\s*source:\s*"\/:path\*",\s*headers:\s*(\w+)\s*\}/);
  assert.ok(globalEntryMatch, 'headers() must declare a source: "/:path*" entry');
  const mEntryMatch = headersBody.match(/\{\s*source:\s*"\/m\/:path\*",\s*headers:\s*(\w+)\s*\}/);
  assert.ok(mEntryMatch, 'headers() must declare a source: "/m/:path*" entry');

  // Mutation this catches: the CSP block meant only for the small,
  // purpose-built /m surface instead leaking onto every route (which would
  // white-screen the admin panel — the exact risk securityHeaders' own
  // comment explains) or, the opposite mistake, never actually reaching /m.
  const publicHeadersVar = mEntryMatch![1];
  const publicHeadersDeclStart = mustIndexOf(
    configSrc,
    `const ${publicHeadersVar} =`,
    `the ${publicHeadersVar} declaration`,
  );
  const publicHeadersDeclEnd = configSrc.indexOf(";", publicHeadersDeclStart);
  const publicHeadersDecl = configSrc.slice(publicHeadersDeclStart, publicHeadersDeclEnd);
  assert.match(
    publicHeadersDecl,
    /Content-Security-Policy/,
    "the /m/:path* entry's headers array must include Content-Security-Policy",
  );

  const globalHeadersVar = globalEntryMatch![1];
  const globalHeadersDeclStart = mustIndexOf(
    configSrc,
    `const ${globalHeadersVar} =`,
    `the ${globalHeadersVar} declaration`,
  );
  const globalHeadersDeclEnd = configSrc.indexOf("];", globalHeadersDeclStart);
  const globalHeadersDecl = configSrc.slice(globalHeadersDeclStart, globalHeadersDeclEnd);
  assert.ok(
    !/Content-Security-Policy/.test(globalHeadersDecl),
    "the global /:path* entry's headers array must NOT include Content-Security-Policy",
  );

  const clientSrc = stripComments(readSrc(INSTRUMENTATION_CLIENT));
  assert.match(clientSrc, /initBotId\(/, "instrumentation-client.ts must call initBotId(...)");
  assert.match(
    clientSrc,
    /path:\s*"\/api\/public\/order-request",\s*method:\s*"POST"/,
    'instrumentation-client.ts must protect POST "/api/public/order-request"',
  );
  // CR2.2b review finding: BotID FAILS CLOSED for any route checkBotId() runs
  // on without a protect entry (vercel.com/docs/botid/get-started — no client
  // signal is ever collected), so the diner-edit PATCH MUST be listed or every
  // real diner's "Save changes" 403s in production while staying green in dev.
  // BotID has no [param] syntax — the trailing * wildcard is the documented
  // dynamic-route form; method-scoping keeps the cancel POST uncovered.
  assert.match(
    clientSrc,
    /path:\s*"\/api\/public\/order-request\/\*",\s*method:\s*"PATCH"/,
    'instrumentation-client.ts must protect PATCH "/api/public/order-request/*" (the diner edit route)',
  );
});

// ── I. Reachability (the CR2.1 lesson) ──────────────────────────────────────

test("PIN: pos/page.tsx no longer renders the order-request tray (owner request — moved to a full-screen page reached from the sidebar), and the moved hook/component chain (usePendingOrderRequests -> RequestsPage -> RequestsBoard -> OrderRequestCard -> useAcceptOrderRequest/useRejectOrderRequest) has real call sites, not a dead import", () => {
  const posSrc = stripComments(readSrc(POS_PAGE));
  // Mutation this catches: the button/tray reappearing on the POS screen —
  // the owner explicitly asked for it to go AWAY in favour of the sidebar
  // entry + full-screen page (CR2.1's own lesson run in reverse: a removed
  // surface silently coming back is just as much a regression as a dead one).
  assert.ok(
    !/OrderRequestTray/.test(posSrc),
    "pos/page.tsx must never reference OrderRequestTray again — the button was removed on owner request",
  );

  const pageSrc = stripComments(readSrc(REQUESTS_PAGE));
  assert.match(
    pageSrc,
    /import \{ usePendingOrderRequests, useAcceptOrderRequest \} from "@\/hooks\/use-order-requests";/,
    "app/(dashboard)/requests/page.tsx must import usePendingOrderRequests and useAcceptOrderRequest",
  );
  assert.match(pageSrc, /usePendingOrderRequests\(/, "the requests page must actually call usePendingOrderRequests");
  assert.match(pageSrc, /useAcceptOrderRequest\(/, "the requests page must actually call useAcceptOrderRequest");
  assert.match(
    pageSrc,
    /import \{ RequestsBoard \} from "@\/components\/orders\/RequestsBoard";/,
    "the requests page must import RequestsBoard",
  );
  assert.match(pageSrc, /<RequestsBoard\b/, "the requests page must render <RequestsBoard");
  // Mutation this catches (CR2.1's own defect, recurring): a component that
  // imports cleanly and typechecks but is never actually placed in the JSX
  // tree, or wired to the wrong callback — either way, dead on arrival.
  assert.match(
    pageSrc,
    /queueKotRound\(order\)/,
    "the requests page must call queueKotRound on an accepted order, or the KOT never queues",
  );

  const boardSrc = stripComments(readSrc(REQUESTS_BOARD));
  assert.match(
    boardSrc,
    /import \{ OrderRequestCard \} from "@\/components\/orders\/OrderRequestCard";/,
    "RequestsBoard must import OrderRequestCard",
  );
  assert.match(boardSrc, /<OrderRequestCard\b/, "RequestsBoard must render <OrderRequestCard");

  const cardSrc = stripComments(readSrc(ORDER_REQUEST_CARD));
  assert.match(cardSrc, /useRejectOrderRequest\(/, "OrderRequestCard must call useRejectOrderRequest");

  // Each of the hooks file's three exports must have >=1 call site OUTSIDE
  // its own file, searched across the two directories that plausibly consume
  // it — a hook can typecheck and export cleanly while having zero callers.
  const hooksExports = ["usePendingOrderRequests", "useAcceptOrderRequest", "useRejectOrderRequest"];
  const searchDirs = ["apps/cafe/components/orders", "apps/cafe/app/(dashboard)"];
  const searchFiles: string[] = [];
  for (const dir of searchDirs) walk(path.join(REPO_ROOT, dir), searchFiles);
  const hooksFileAbs = path.join(REPO_ROOT, USE_ORDER_REQUESTS);

  for (const hookName of hooksExports) {
    let callSites = 0;
    for (const fileAbs of searchFiles) {
      if (fileAbs === hooksFileAbs) continue;
      const src = stripComments(readFileSync(fileAbs, "utf8"));
      const matches = src.match(new RegExp(`\\b${hookName}\\(`, "g"));
      callSites += matches?.length ?? 0;
    }
    // Mutation this catches: CR2.1's exact defect — a hook wired up, typed,
    // exported, and never once called from anywhere reachable in the UI.
    assert.ok(callSites >= 1, `${hookName} must have at least one call site outside ${USE_ORDER_REQUESTS}`);
  }
});

test('PIN: AppSidebar declares an "Order Requests" nav entry directly after "New Order", pointing at /requests, and renders <RequestCountBadge /> beside it — the sidebar entry is the ONLY way in now that the POS button is gone', () => {
  const src = stripComments(readSrc(APP_SIDEBAR));
  const newOrderIdx = mustIndexOf(
    src,
    '{ title: "New Order", url: "/pos", icon: ShoppingCart },',
    "the New Order nav entry",
  );
  const nextEntryIdx = src.indexOf("{ title:", newOrderIdx + 1);
  assert.ok(nextEntryIdx > newOrderIdx, "an entry must follow New Order in the items array");
  const nextEntryEnd = src.indexOf("},", nextEntryIdx) + 2;
  const nextEntry = src.slice(nextEntryIdx, nextEntryEnd);
  // Mutation this catches: the new entry landing anywhere else in the list —
  // the owner asked for it directly below New Order, not just "somewhere".
  assert.match(
    nextEntry,
    /title:\s*"Order Requests"/,
    'the entry directly after "New Order" must be titled "Order Requests"',
  );
  assert.match(nextEntry, /url:\s*"\/requests"/, 'the "Order Requests" entry must link to /requests');

  assert.match(
    src,
    /import \{ RequestCountBadge \} from "@\/components\/orders\/RequestCountBadge";/,
    "AppSidebar must import RequestCountBadge",
  );
  assert.match(src, /<RequestCountBadge\s*\/>/, "AppSidebar must render <RequestCountBadge /> for the row");

  // CR2.3 §20 — the badge's OWN 20s poll (usePendingRequestCount, ?count=1)
  // retired in favour of the shared PosPulseProvider pulse; re-pointed here
  // rather than deleted outright, so a regression back to the old poll still
  // fails loudly.
  const badgeSrc = stripComments(readSrc(REQUEST_COUNT_BADGE));
  assert.match(
    badgeSrc,
    /import \{ usePosPulseContext \} from "@\/components\/layout\/PosPulseProvider";/,
    "RequestCountBadge must import usePosPulseContext",
  );
  assert.match(badgeSrc, /usePosPulseContext\(/, "RequestCountBadge must actually call usePosPulseContext");
  assert.ok(
    !/usePendingRequestCount/.test(badgeSrc),
    "RequestCountBadge must never revert to its own usePendingRequestCount poll",
  );

  const hookSrc = stripComments(readSrc(USE_ORDER_REQUESTS));
  assert.ok(
    !/export function usePendingRequestCount/.test(hookSrc),
    "hooks/use-order-requests.ts must no longer export usePendingRequestCount — no remaining caller (dead-code lesson)",
  );

  const routeSrc = stripComments(readSrc(ORDER_REQUESTS_ROUTE));
  // Mutation this catches: the retired ?count=1 branch creeping back in with
  // no caller left to use it (dead-code lesson) — GET now always answers
  // with the doc list.
  assert.ok(
    !/searchParams\.get\("count"\)/.test(routeSrc),
    "GET /api/order-requests must no longer branch on ?count — usePendingRequestCount's only caller is gone",
  );
  assert.match(routeSrc, /requireAuth\(\)/, "GET /api/order-requests must still require auth");
});

test("PIN: both /m entry pages render <PublicOrderFlow, PublicOrderFlow renders <PublicCart and <PublicItemSheet, PublicCart fetches /api/public/order-request and calls pushMyCode, and /m/o/[shortCode] renders <PublicOrderStatus after validating isPublicCode", () => {
  // CR2.4 (A1) re-point: both pages now ALSO pass a `chrome` prop (the
  // server-read hero/logoPlacement chrome) beside their pre-CR2.4 props —
  // these regexes still pin the SAME render + the SAME `token` prop on the
  // token page, just tolerant of the added prop rather than requiring the
  // tag to close immediately after it.
  const mPageSrc = stripComments(readSrc(M_PAGE));
  assert.match(mPageSrc, /<PublicOrderFlow\s+chrome=\{chrome\}\s*\/>/, "app/m/page.tsx must render <PublicOrderFlow chrome={chrome} />");

  const mTokenPageSrc = stripComments(readSrc(M_TOKEN_PAGE));
  assert.match(
    mTokenPageSrc,
    /<PublicOrderFlow token=\{token\} chrome=\{chrome\}\s*\/>/,
    "app/m/[token]/page.tsx must render <PublicOrderFlow token={token} chrome={chrome} />",
  );

  const flowSrc = stripComments(readSrc(PUBLIC_ORDER_FLOW));
  assert.match(flowSrc, /<PublicCart\b/, "PublicOrderFlow must render <PublicCart");
  assert.match(flowSrc, /<PublicItemSheet\b/, "PublicOrderFlow must render <PublicItemSheet");

  const cartSrc = stripComments(readSrc(PUBLIC_CART));
  assert.match(
    cartSrc,
    /ORDER_REQUEST_ENDPOINT = "\/api\/public\/order-request";/,
    'PublicCart must target "/api/public/order-request"',
  );
  assert.match(cartSrc, /fetch\(ORDER_REQUEST_ENDPOINT/, "PublicCart must actually fetch that endpoint");
  assert.match(cartSrc, /pushMyCode\(/, "PublicCart must call pushMyCode on a successful submit");

  const statusPageSrc = stripComments(readSrc(M_STATUS_PAGE));
  const isCodeIdx = mustIndexOf(statusPageSrc, "isPublicCode(shortCode)", "the isPublicCode shape check");
  const renderIdx = mustIndexOf(statusPageSrc, "<PublicOrderStatus", "the <PublicOrderStatus render");
  // Mutation this catches: rendering the status page for a malformed
  // shortCode instead of 404ing at the page boundary (mirrors /m/[token]'s
  // own discipline).
  assert.ok(isCodeIdx < renderIdx, "isPublicCode must be checked before <PublicOrderStatus renders");
});

// ── J. Print discipline on the staff tray ───────────────────────────────────

test("PIN: OrderRequestCard never calls useReactToPrint or window.print — the CONTAINING screen owns the one print bridge, never the reusable card itself (previously the POS screen's tray; now app/(dashboard)/requests/page.tsx, which DOES legitimately own its own bridge — pinned separately below)", () => {
  const src = stripComments(readSrc(ORDER_REQUEST_CARD));
  // Mutation this catches: a second react-to-print instance fighting
  // whichever screen's own fixed-id iframe (lib/print.ts's print-chain note,
  // CR1.2) — two concurrent print jobs silently kill one of them.
  assert.ok(!/useReactToPrint\(/.test(src), "OrderRequestCard must not call useReactToPrint");
  assert.ok(!/window\.print\(/.test(src), "OrderRequestCard must not call window.print");
});

test("PIN: app/(dashboard)/requests/page.tsx calls the shared useKotPrintBridge hook in KOT-only mode (no `receipt:` argument) — never a receipt job (an accept never collects money); the guard-ref/effect discipline itself now lives in, and is pinned on, use-kot-print-bridge.ts (print-paths.test.ts)", () => {
  // CR2.3 S0 split — this page's own hand-copied useReactToPrint/guard-ref
  // pair collapsed onto the same shared hook pos/page.tsx uses, so the
  // discipline has exactly one owner instead of two hand-synced copies.
  const src = stripComments(readSrc(REQUESTS_PAGE));

  // Mutation this catches: a second, hand-rolled useReactToPrint/guard-ref
  // pair creeping back in alongside the shared hook.
  assert.ok(!/useReactToPrint\(/.test(src), "the requests page must not call useReactToPrint directly — only through useKotPrintBridge");
  assert.match(
    src,
    /import \{ useKotPrintBridge \} from "@\/hooks\/use-kot-print-bridge";/,
    "the requests page must import useKotPrintBridge",
  );

  const callIdx = mustIndexOf(src, "useKotPrintBridge({", "the useKotPrintBridge call");
  const callEnd = src.indexOf("});", callIdx);
  assert.ok(callEnd > callIdx, "the useKotPrintBridge call must close with });");
  const callArgs = src.slice(callIdx, callEnd);
  // Mutation this catches: this page ALSO wiring up a receipt print — an
  // accept never collects money, so there is nothing to bill and no receipt
  // to print. Passing a `receipt:` argument is what turns that job on.
  assert.ok(!/receipt:/.test(callArgs), "the requests page's useKotPrintBridge call must omit the `receipt` argument (KOT-only mode)");
  assert.ok(!/shouldPrintReceipt/.test(src), "the requests page must never reference shouldPrintReceipt");
});

// ── K. Public-component bans extended: no TanStack Query under components/public ─

test("PIN: no file under components/public/** imports @tanstack/react-query — the diner surface fetches with plain fetch/apiGet, never a query client, mirroring the no-Mongoose/no-dangerouslySetInnerHTML bans in public-surface-paths.test.ts", () => {
  const dirAbs = path.join(REPO_ROOT, "apps/cafe/components/public");
  const files: string[] = [];
  walk(dirAbs, files);
  assert.ok(files.length > 0, "components/public must contain at least one file to check");

  for (const fileAbs of files) {
    const rel = relPath(fileAbs);
    const src = stripComments(readFileSync(fileAbs, "utf8"));
    // Mutation this catches: a diner-facing component reaching for
    // useQuery/useMutation instead of the surface's established plain-fetch
    // pattern (PublicOrderStatus's own file comment explains why: apiGet
    // collapses a 404 and a network throw into the SAME Error, which this
    // surface cannot afford to conflate).
    assert.ok(
      !/from ["']@tanstack\/react-query["']/.test(src),
      `${rel} must not import from @tanstack/react-query`,
    );
  }
});

// ── L. Wire-contract parity ──────────────────────────────────────────────

test("PIN: PublicOrderRequestCreatedData is imported by BOTH the POST route and PublicCart; PublicOrderRequestStatusData is imported by BOTH the status GET route and PublicOrderStatus", () => {
  // The type name appears AND the file imports something from
  // @pos/shared/public — together enough to pin "this file types against
  // the shared contract" without over-fitting the exact destructure
  // formatting on either side.
  const importsType = (rel: string, typeName: string) => {
    const src = stripComments(readSrc(rel));
    // Mutation this catches: the UI (or the route) hand-rolling its own
    // shape for the 201/200 payload instead of typing against the ONE
    // contract both sides share — a field renamed on one side would then
    // typecheck cleanly on the other and only break at runtime.
    assert.match(src, new RegExp(`\\b${typeName}\\b`), `${rel} must reference ${typeName}`);
    assert.match(src, /from "@pos\/shared\/public"/, `${rel} must import from @pos/shared/public`);
  };

  importsType(PUBLIC_ORDER_REQUEST_ROUTE, "PublicOrderRequestCreatedData");
  importsType(PUBLIC_CART, "PublicOrderRequestCreatedData");
  importsType(PUBLIC_ORDER_REQUEST_STATUS_ROUTE, "PublicOrderRequestStatusData");
  importsType(PUBLIC_ORDER_STATUS, "PublicOrderRequestStatusData");
});

// ── M. Model fence: no TTL on OrderRequest ──────────────────────────────────

test("PIN: models/OrderRequest.ts declares no expireAfterSeconds/expires anywhere — belt over ttl-guard's suspenders (this model is deliberately unfederated, so the registry TTL sweep never walks it)", () => {
  const src = readSrc(ORDER_REQUEST_MODEL); // full source, comments included on purpose
  // Mutation this catches: adding a TTL index directly on this schema — the
  // platform allows exactly ONE registry TTL index (Heartbeat) per
  // shared.md; this model's own file comment says its test pins
  // assertSchemaTtlAllowed directly, and this is the second, independent net.
  assert.ok(!/expireAfterSeconds/.test(src), "models/OrderRequest.ts must never declare expireAfterSeconds");
  assert.ok(!/\bexpires\s*:/.test(src), "models/OrderRequest.ts must never declare an `expires:` schema option");
});

// ── N. CR2.2 arbiter-confirmed UI fixes ─────────────────────────────────────

test("PIN: RequestsPage, RequestsBoard and OrderRequestCard never use dangerouslySetInnerHTML — extends the §6.7 walk (public-surface-paths.test.ts) to the STAFF surfaces where diner-typed text (notes, reject reasons) renders", () => {
  for (const [rel, src] of [
    [REQUESTS_PAGE, stripComments(readSrc(REQUESTS_PAGE))],
    [REQUESTS_BOARD, stripComments(readSrc(REQUESTS_BOARD))],
    [ORDER_REQUEST_CARD, stripComments(readSrc(ORDER_REQUEST_CARD))],
  ] as const) {
    // Mutation this catches: a diner's own free-text note or a staff-typed
    // reject reason rendered as raw HTML instead of React's own escaping —
    // the public-surface pin only walks app/m/**+components/public/**, which
    // never sees this staff-side render path at all.
    assert.ok(!/dangerouslySetInnerHTML/.test(src), `${rel} must not use dangerouslySetInnerHTML`);
  }
});

test('PIN: usePendingOrderRequests fetches "?status=open" (pending + accepting), not "?status=pending" — a stranded "accepting" row must stay visible in the tray for Retry accept', () => {
  const src = stripComments(readSrc(USE_ORDER_REQUESTS));
  // Mutation this catches: reverting to "pending" — an interrupted accept
  // (crash, closed tab) leaves its request stuck at "accepting" with no way
  // for staff to ever see or retry it again.
  assert.match(
    src,
    /apiGet<TrayOrderRequest\[\]>\("\/api\/order-requests\?status=open"\)/,
    'usePendingOrderRequests must fetch "/api/order-requests?status=open"',
  );
  // Scoped to usePendingOrderRequests' OWN function body (not the whole
  // file) — CR2.3 §20 retired usePendingRequestCount/?count=1 (the sidebar
  // badge now reads openCount off PosPulseProvider's shared pulse instead),
  // so this pin re-anchors to the next export actually declared after
  // usePendingOrderRequests now, which still proves the same thing: this
  // hook's OWN fetch call never regresses to "status=pending".
  const fnStart = mustIndexOf(src, "export function usePendingOrderRequests", "usePendingOrderRequests");
  const fnEnd = src.indexOf("\nexport interface UseAcceptOrderRequestOptions", fnStart);
  assert.ok(fnEnd > fnStart, "UseAcceptOrderRequestOptions must be declared after usePendingOrderRequests");
  const fnBody = src.slice(fnStart, fnEnd);
  assert.ok(!/status=pending/.test(fnBody), "usePendingOrderRequests must not fetch status=pending");
});

test("PIN: CR2.3 §20 reachability — the dashboard layout renders PosPulseProvider AND RequestAlertBar, and both pos/page.tsx and requests/page.tsx call useSelfOrderAutoPrint (CR2.1's dead-hook lesson, run again on the pulse slice)", () => {
  const layoutSrc = stripComments(readSrc(DASHBOARD_LAYOUT));
  assert.match(
    layoutSrc,
    /import \{ PosPulseProvider \} from "@\/components\/layout\/PosPulseProvider";/,
    "the dashboard layout must import PosPulseProvider",
  );
  assert.match(layoutSrc, /<PosPulseProvider>/, "the dashboard layout must render <PosPulseProvider>");
  assert.match(
    layoutSrc,
    /import \{ RequestAlertBar \} from "@\/components\/orders\/RequestAlertBar";/,
    "the dashboard layout must import RequestAlertBar",
  );
  assert.match(layoutSrc, /<RequestAlertBar\s*\/>/, "the dashboard layout must render <RequestAlertBar />");

  const posSrc = stripComments(readSrc(POS_PAGE));
  assert.match(
    posSrc,
    /import \{ useSelfOrderAutoPrint \} from "@\/hooks\/use-self-order-auto-print";/,
    "pos/page.tsx must import useSelfOrderAutoPrint",
  );
  assert.match(posSrc, /useSelfOrderAutoPrint\(\{/, "pos/page.tsx must actually call useSelfOrderAutoPrint");

  const requestsSrc = stripComments(readSrc(REQUESTS_PAGE));
  assert.match(
    requestsSrc,
    /import \{ useSelfOrderAutoPrint \} from "@\/hooks\/use-self-order-auto-print";/,
    "requests/page.tsx must import useSelfOrderAutoPrint",
  );
  assert.match(
    requestsSrc,
    /useSelfOrderAutoPrint\(\{/,
    "requests/page.tsx must actually call useSelfOrderAutoPrint",
  );
  assert.match(
    requestsSrc,
    /import \{ DeviceAlertSettings \} from "@\/components\/orders\/DeviceAlertSettings";/,
    "requests/page.tsx must import DeviceAlertSettings",
  );
  assert.match(
    requestsSrc,
    /<DeviceAlertSettings\s*\/>/,
    "requests/page.tsx must render <DeviceAlertSettings />",
  );
});

test("PIN: CR2.3 §20 — use-pos-pulse.ts is the ONLY refetchInterval in the pulse's own module, and it polls REFETCH_INTERVALS.POS_PULSE with refetchIntervalInBackground:true (v5 pauses hidden-tab polling otherwise)", () => {
  const src = stripComments(readSrc(USE_POS_PULSE));
  const intervalMatches = src.match(/refetchInterval:/g) ?? [];
  assert.equal(
    intervalMatches.length,
    1,
    "use-pos-pulse.ts must declare exactly one refetchInterval — a second poller in this module would double the pulse's own request rate",
  );
  assert.match(
    src,
    /refetchInterval:\s*REFETCH_INTERVALS\.POS_PULSE/,
    "usePosPulse must poll on REFETCH_INTERVALS.POS_PULSE (20s), not a hand-rolled constant",
  );
  assert.match(
    src,
    /refetchIntervalInBackground:\s*true/,
    "usePosPulse must set refetchIntervalInBackground:true, or a merely-unfocused staff tab silently stops alerting",
  );
  assert.match(
    src,
    /"\/api\/order-requests\/pulse"/,
    "usePosPulse must fetch the pulse endpoint at /api/order-requests/pulse",
  );
});

test("PIN: PublicCart imports publicCartTotals from @pos/shared/public and computes its displayed total ONLY through it — no `subtotal +` hand-math anywhere in the file", () => {
  const src = stripComments(readSrc(PUBLIC_CART));
  assert.match(
    src,
    /publicCartTotals/,
    "PublicCart must reference publicCartTotals",
  );
  assert.match(src, /from "@pos\/shared\/public"/, "PublicCart must import from @pos/shared/public");
  // Mutation this catches: a `const total = subtotal + chargeAmount` (or any
  // other `subtotal +` sum) creeping back in alongside — or instead of — the
  // shared helper, which is exactly the exclusive-GST display bug this fix
  // exists to close (the diner total would then silently exclude tax).
  assert.ok(!/subtotal\s*\+/.test(src), "PublicCart must not hand-compute a total via `subtotal +`");
});

test("PIN: the accept success path checks `replayed` BEFORE calling onAccepted — a replayed accept must never re-queue a KOT that already printed", () => {
  const cardSrc = stripComments(readSrc(ORDER_REQUEST_CARD));
  const successIdx = mustIndexOf(cardSrc, "onSuccess: (result)", "the mutate() onSuccess callback");
  const replayedIdx = mustIndexOf(cardSrc, "result.replayed", "the replayed check");
  const onAcceptedIdx = mustIndexOf(cardSrc, "onAccepted(result.order)", "the onAccepted call");
  // Mutation this catches: calling onAccepted unconditionally (or checking
  // replayed AFTER the call) — the caller's queueKotRound would then fire a
  // second print job for a request some earlier attempt already accepted.
  assert.ok(
    successIdx < replayedIdx && replayedIdx < onAcceptedIdx,
    "onSuccess must check result.replayed strictly before calling onAccepted",
  );

  const hookSrc = stripComments(readSrc(USE_ORDER_REQUESTS));
  assert.match(
    hookSrc,
    /replayed:\s*boolean/,
    "AcceptResult must type replayed as a boolean, not leave it untyped/any",
  );

  // CR2.2 fix round (stranded acceptingId) — the acceptingId reset moved OFF
  // this card's own per-call onSettled (tied to THIS card's lifecycle, and
  // able to silently never fire once the accepted request drops out of the
  // list) and onto the shared mutation's own HOOK-level onSettled, which
  // always runs regardless of which card initiated the call.
  assert.ok(
    !/onSettled:\s*\(\)\s*=>\s*onAcceptingChange\(null\)/.test(cardSrc),
    "OrderRequestCard must no longer reset acceptingId via a per-call onSettled — that IS the stranding bug this fix closes",
  );
  assert.match(
    hookSrc,
    /options\?\.onSettled\?\.\(\)/,
    "useAcceptOrderRequest's own onSettled must invoke the caller-supplied options.onSettled",
  );
  // The fix's own wiring moved from the POS-screen tray onto the full-screen
  // page that replaced it (owner request) — same discipline, new file.
  const pageSrc = stripComments(readSrc(REQUESTS_PAGE));
  assert.match(
    pageSrc,
    /useAcceptOrderRequest\(\{\s*onSettled:\s*\(\)\s*=>\s*setAcceptingId\(null\)\s*\}\)/,
    "app/(dashboard)/requests/page.tsx must wire onSettled: () => setAcceptingId(null) into the ONE shared useAcceptOrderRequest instance",
  );
});

// ── O. CR2.2 fix round — settings/public-menu coupling + honeypot hardening ─

test("PIN: PUT /api/settings invalidates the public menu cache too — restaurantName/allowTableChange/gst all ride the public menu payload", () => {
  const src = stripComments(readSrc(SETTINGS_ROUTE));
  // Mutation this catches: a settings save that only clears its OWN cache
  // key, leaving a stale restaurantName/allowTableChange/gst on the public
  // QR menu for up to its own TTL.
  assert.match(src, /PUBLIC_MENU_CACHE_KEY/, "app/api/settings/route.ts must reference PUBLIC_MENU_CACHE_KEY");
});

test('PIN: the public order-request route\'s honeypot trigger accepts ANY non-empty `hp` value, not only a string ("!== undefined" source shape)', () => {
  const src = stripComments(readSrc(PUBLIC_ORDER_REQUEST_ROUTE));
  // Mutation this catches: reverting to `typeof bodyObj?.hp === "string"`,
  // which lets a bot that sends a non-string hp (an object/number/bool) slip
  // through as an honest request instead of tripping the honeypot.
  assert.match(
    src,
    /bodyObj\?\.hp !== undefined && bodyObj\.hp !== ""/,
    'the honeypot trigger must read `bodyObj?.hp !== undefined && bodyObj.hp !== ""`',
  );
});

test("PIN: the honeypot branch peeks the rate limit (never increments) before doing buildHoneypotResponse's own DB reads", () => {
  const src = stripComments(readSrc(PUBLIC_ORDER_REQUEST_ROUTE));
  const peekIdx = mustIndexOf(src, "peekRateLimit(", "the honeypot metering peek");
  const buildIdx = mustIndexOf(src, "await buildHoneypotResponse(data)", "the priced honeypot simulation");
  // Mutation this catches: doing the full Table/Product/Settings simulation
  // BEFORE (or without) checking whether this bucket is already spent — a bot
  // filling `hp` would then get unmetered query work forever.
  assert.ok(peekIdx < buildIdx, "peekRateLimit must be checked before buildHoneypotResponse runs");

  const limitSrc = stripComments(readSrc(PUBLIC_RATE_LIMIT));
  assert.match(
    limitSrc,
    /export async function peekRateLimit\(/,
    "lib/public-rate-limit.ts must export peekRateLimit",
  );
  assert.ok(!/\$inc/.test((limitSrc.match(/export async function peekRateLimit\([\s\S]*?\n\}/) ?? [""])[0]),
    "peekRateLimit's own body must never $inc — it only reads",
  );
});

// ── P. CR2.2b §17.C — edit-request (PATCH) pins ─────────────────────────────

test('PIN: PATCH /api/public/order-request/[shortCode] exists, checkBotId runs before the body is read, and the honeypot is lifted pre-Zod — same discipline as POST', () => {
  const src = stripComments(readSrc(PUBLIC_ORDER_REQUEST_STATUS_ROUTE));
  const patchStart = mustIndexOf(src, "export async function PATCH", "the PATCH handler");
  const patchBody = src.slice(patchStart);

  const botIdx = mustIndexOf(patchBody, "checkBotId(", "PATCH's own checkBotId call");
  const textIdx = mustIndexOf(patchBody, ".text(", "PATCH's own body-size read");
  // Mutation this catches: touching the body before the bot check runs — an
  // unwanted client would then get real work done before being turned away.
  assert.ok(botIdx < textIdx, "checkBotId must run before PATCH reads the request body");

  const hpReadIdx = mustIndexOf(patchBody, "bodyObj?.hp", "the raw-body honeypot read");
  const hpDeleteIdx = mustIndexOf(patchBody, "delete bodyObj.hp", "the pre-Zod hp strip");
  const zodIdx = mustIndexOf(patchBody, "safeParse(", "PATCH's own Zod parse");
  assert.ok(hpReadIdx < zodIdx, "PATCH's honeypot read must happen before Zod sees the body");
  assert.ok(hpDeleteIdx < zodIdx, "hp must be stripped before PATCH's schema parses");
});

test('PIN: PATCH\'s CAS filter targets {_id, status:"pending"}, and the route calls tableChargeAppliesOnEditNow + quoteRequestTotals for its own edit-time charge decision', () => {
  const src = stripComments(readSrc(PUBLIC_ORDER_REQUEST_STATUS_ROUTE));
  const patchStart = mustIndexOf(src, "export async function PATCH", "the PATCH handler");
  const patchBody = src.slice(patchStart);

  // Mutation this catches: a CAS filter that drops the status:"pending"
  // guard, letting an edit land on a request staff already claimed.
  assert.match(
    patchBody,
    /OrderRequest\.updateOne\(\s*\{\s*_id:\s*\w+\._id,\s*status:\s*"pending"\s*\}/,
    'the CAS filter must be { _id, status: "pending" }',
  );
  assert.match(
    patchBody,
    /tableChargeAppliesOnEditNow\(/,
    "PATCH must call tableChargeAppliesOnEditNow (the edit-time charge-carrier rule, never create's tableChargeAppliesNow)",
  );
  assert.match(patchBody, /quoteRequestTotals\(/, "PATCH must call quoteRequestTotals to re-price the edit");
});

test("PIN: buildRequestDoc (lib/order-request-intake.ts) delegates its money math to quoteRequestTotals, rather than forking the create-path quote logic", () => {
  const src = stripComments(readSrc("apps/cafe/lib/order-request-intake.ts"));
  const fnStart = mustIndexOf(src, "export function buildRequestDoc", "buildRequestDoc");
  const fnBody = src.slice(fnStart);
  // Mutation this catches: buildRequestDoc re-growing its own inline copy of
  // the items/charge/totals math instead of calling the shared function the
  // PATCH route also depends on — the two quote paths could then silently drift.
  assert.match(fnBody, /quoteRequestTotals\(/, "buildRequestDoc must call quoteRequestTotals");
});

test("PIN: GET /api/public/order-request/[shortCode] maps the stored items onto PublicStatusItem[] on the status response", () => {
  // CR2.3b S8 split — the item-mapping block moved to toStatusItems()
  // (lib/order-request-edit.ts) to keep the route under the ~300-line cap;
  // re-pointed here, CR2.2d style: same meaning, moved target, never
  // weakened to a mere import check.
  const src = stripComments(readSrc(PUBLIC_ORDER_REQUEST_STATUS_ROUTE));
  assert.match(src, /toStatusItems\(/, "GET must call toStatusItems to build the response's items field");

  const editLib = stripComments(readSrc(ORDER_REQUEST_EDIT_LIB));
  assert.match(editLib, /PublicStatusItem/, "lib/order-request-edit.ts must reference PublicStatusItem");
  assert.match(editLib, /\bitems\.map\(/, "toStatusItems must map the stored items onto PublicStatusItem[]");
});

test("PIN: PATCH's honeypot skip rides the FULL real path (after quoteRequestTotals, before the CAS write) and its pretend body reuses the real quote — review 2026-08-20: an early hp branch was unmetered attacker-keyed DB work AND a totals tell", () => {
  const src = stripComments(readSrc(PUBLIC_ORDER_REQUEST_STATUS_ROUTE));
  const patchStart = mustIndexOf(src, "export async function PATCH", "the PATCH handler");
  const patchBody = src.slice(patchStart);

  const quoteIdx = mustIndexOf(patchBody, "quoteRequestTotals(", "the real re-quote");
  const hpSkipIdx = mustIndexOf(patchBody, "if (hpFilled)", "the honeypot skip branch");
  const casIdx = mustIndexOf(patchBody, "OrderRequest.updateOne(", "the CAS write");
  // Mutation this catches: the pretend branch drifting back BEFORE the load/
  // rate/Zod/pricing work (unmetered probe) or AFTER the write (stored spam).
  assert.ok(quoteIdx < hpSkipIdx, "the hp skip must come after the real quote is computed");
  assert.ok(hpSkipIdx < casIdx, "the hp skip must short-circuit strictly before the CAS write");
  assert.ok(
    /if \(hpFilled\)[\s\S]{0,400}quote\.quotedTotal/.test(patchBody),
    "the pretend response must carry the REAL quote's total (no hand-rolled subtotal tell)",
  );
});

test("PIN: a promo is gated SERVER-side to a table's first order of a session, on BOTH the create and the edit path — the client hiding the control is never the defence (review 2026-08-20: one flat code re-applied per round zeroed a whole tab)", () => {
  // CR2.2d split (D2) — resolveRequestPromo/resolveEditPromo (and the gate
  // inside each) moved to their own sibling libs; re-pointed here, same
  // regex, same meaning.
  const post = stripComments(readSrc(ORDER_REQUEST_CREATE_LIB));
  assert.match(
    post,
    /if \(!chargeApplies\) return \{ error: PROMO_SESSION_OPEN \}/,
    "the create route's promo resolver must refuse a promo once the table session is open",
  );
  const patch = stripComments(readSrc(ORDER_REQUEST_EDIT_LIB));
  // A NEW code is gated; an ALREADY-STORED one is exempt (it was granted when
  // the session did start here, and re-resolving it is how drift is caught).
  assert.match(patch, /const isNewCode = normalizePromoCode\(/, "the edit route's promo resolver must tell a new code from the stored one");
  assert.match(
    patch,
    /if \(isNewCode && !chargeApplies\) return \{ error: PROMO_SESSION_OPEN \}/,
    "the edit route's promo resolver must refuse a NEW promo once the table session is open",
  );
});

test("PIN: a rejected promo costs no order-request slot, and the honeypot answers a rejected promo with the SAME 422 the real path does", () => {
  const post = stripComments(readSrc(PUBLIC_ORDER_REQUEST_ROUTE));
  // Mutation this catches: dropping the refund — eight typo'd codes then lock
  // every phone on that table's QR out of ordering for the whole window.
  assert.match(post, /await refundRateLimit\(bucket, now\)/, "a promo rejection must hand its metered slot back");
  const refundIdx = mustIndexOf(post, "refundRateLimit(bucket, now)", "the refund call");
  const failIdx = post.indexOf("failure(promo.error, 422)", refundIdx);
  assert.ok(failIdx > refundIdx, "the refund must run before the 422 is returned");
  // Mutation this catches: the honeypot 201ing a code the real path 422s —
  // one probe then tells the pretend path apart.
  assert.match(post, /if \("promoError" in pretend\) return noStore\(failure\(pretend\.promoError, 422\)\)/, "the honeypot must mirror the promo 422");
});

test("PIN: promo money is whole-rupee only — computeOrderTotals rounds the stored discount, so a fractional configured value would make every request using it fail the accept-side compare forever", () => {
  const schema = stripComments(readSrc("packages/shared/src/schemas/settings.schema.ts"));
  assert.match(schema, /value: z\.number\(\)\.int\(/, "a promo value must be an integer");
  assert.match(schema, /minSubtotal: z\.number\(\)\.int\(/, "a promo minimum must be an integer");
});

test("PIN: the diner's edit screen classifies a promo 422 by its MESSAGE, never by whether the diner touched the control — the server re-resolves a STORED code against the new subtotal, so an untouched promo can fail on its own", () => {
  const src = stripComments(readSrc("apps/cafe/components/public/PublicStatusItems.tsx"));
  const idx = mustIndexOf(src, "isPromoErrorMessage(envelope.error)", "the promo-422 classification");
  const before = src.slice(Math.max(0, idx - 200), idx);
  // Mutation this catches: re-adding the "touched" precondition, which sent a
  // real promo reason into the generic banner with a useless refresh hint.
  assert.ok(
    !/promoDraft !== promoSeedRef\.current &&\s*$/.test(before.trimEnd() + "\n"),
    "the classification must not be gated on the draft having changed",
  );
});

test("PIN: the promo-code feature is REACHABLE end to end — the staff editor renders inside the settings form, the diner control renders on BOTH the cart and the pending-edit screen, and the promo reaches the staff card through the tray projection (CR2.1's dead-hook lesson)", () => {
  const settingsForm = stripComments(readSrc("apps/cafe/components/settings/SettingsForm.tsx"));
  assert.match(settingsForm, /<PromoCodesFields/, "SettingsForm must actually render the promo editor");
  assert.match(
    settingsForm,
    /from "@\/components\/settings\/PromoCodesFields"/,
    "and import it from its own module",
  );

  const cart = stripComments(readSrc(PUBLIC_CART));
  assert.match(cart, /<PublicPromoField/, "the cart must render the diner promo control");
  const statusItems = stripComments(readSrc("apps/cafe/components/public/PublicStatusItems.tsx"));
  assert.match(statusItems, /<PublicPromoField/, "the pending-edit screen must render it too");
  // Mutation this catches: the client computing a discount itself — money is
  // the server's answer, the client only ever sends the CODE (project lesson:
  // client-money-must-encode-intent).
  assert.ok(
    !/quotedDiscount\s*=\s*[^;]*[*/]/.test(cart),
    "the cart must never compute a discount amount itself",
  );

  // The staff card can only show what the tray PROJECTION carries — the
  // model having the field is not enough (this exact gap was caught in review).
  const tray = stripComments(readSrc("apps/cafe/lib/order-request-tray.ts"));
  assert.match(tray, /promoCode: doc\.promoCode/, "toTrayRequest must project promoCode");
  assert.match(tray, /quotedDiscount: doc\.quotedDiscount/, "toTrayRequest must project quotedDiscount");
  const card = stripComments(readSrc(ORDER_REQUEST_CARD));
  assert.match(card, /request\.promoCode/, "the staff card must show the promo it was quoted with");
});

test("PIN: the diner's status GET exposes the stored promo so a code applied in an earlier round stays visible and removable, and the edit UI seeds its draft from it (never a hardcoded null)", () => {
  const route = stripComments(readSrc(PUBLIC_ORDER_REQUEST_STATUS_ROUTE));
  const patchStart = mustIndexOf(route, "export async function PATCH", "the PATCH handler");
  const getBody = route.slice(0, patchStart);
  assert.match(getBody, /data\.promoCode = request\.promoCode/, "GET must expose the stored promo code");
  assert.match(getBody, /data\.quotedDiscount = request\.quotedDiscount/, "GET must expose the quoted discount");

  const statusItems = stripComments(readSrc("apps/cafe/components/public/PublicStatusItems.tsx"));
  // Mutation this catches: reverting the seed to a constant null, which made a
  // previously-applied promo invisible (and so un-removable) on the edit screen.
  assert.match(
    statusItems,
    /useRef<string \| null>\(promoCode \?\? null\)/,
    "the promo seed must come from the server value",
  );
});

test("PIN: PATCH gates edits to items ALREADY on the request, and only then re-prices with the accept bridge's isActive-only filter (never the public-menu filter, which made hiding one item freeze the whole request)", () => {
  const src = stripComments(readSrc(PUBLIC_ORDER_REQUEST_STATUS_ROUTE));
  const patchStart = mustIndexOf(src, "export async function PATCH", "the PATCH handler");
  const patchBody = src.slice(patchStart);

  const memberIdx = mustIndexOf(patchBody, "ordered.has(", "the membership check");
  const findIdx = mustIndexOf(patchBody, "Product.find(", "the re-pricing query");
  // Mutation this catches: dropping the membership gate while keeping the
  // looser product filter — a crafted PATCH could then order a product the
  // operator deliberately hid from the public menu.
  assert.ok(memberIdx < findIdx, "membership must be enforced before the looser product query runs");
  assert.ok(
    !/PUBLIC_PRODUCT_FILTER/.test(patchBody),
    "PATCH must not re-price with the create-time public-menu filter",
  );
  assert.match(patchBody, /isActive: true/, "PATCH must re-price with the accept bridge's isActive-only filter");
});

test("PIN: PATCH's table-gone 409 fires ONLY when no tab is open on that tableNo — with one, the accept bridge takes the add-round branch and never reads the Table row", () => {
  const src = stripComments(readSrc(PUBLIC_ORDER_REQUEST_STATUS_ROUTE));
  const patchStart = mustIndexOf(src, "export async function PATCH", "the PATCH handler");
  const patchBody = src.slice(patchStart);
  // Mutation this catches: reverting to a bare `if (!table) 409`, which
  // refuses edits staff could still accept (freed-then-renamed table with a
  // live bill still on it).
  assert.match(
    patchBody,
    /if \(!table && !\(await hasOpenTabNow\(/,
    "the table-gone refusal must be conditioned on there being no open tab",
  );
});

test("PIN: the diner status page never lets a poll issued before a save overwrite the saved lines, and a failed save's error is not wiped by the reseed effect", () => {
  const statusSrc = stripComments(readSrc("apps/cafe/components/public/PublicOrderStatus.tsx"));
  // Mutation this catches: dropping the issued-before-adopt guard — a poll in
  // flight during the PATCH lands after its 200 and reverts the diner's
  // just-saved quantities/total for up to a full poll interval.
  assert.match(statusSrc, /issuedAt < adoptedAt\.current/, "stale poll responses must be dropped");
  assert.match(statusSrc, /adoptedAt\.current = Date\.now\(\)/, "a successful save must stamp the adopt time");

  const itemsSrc = stripComments(readSrc("apps/cafe/components/public/PublicStatusItems.tsx"));
  const effectIdx = mustIndexOf(itemsSrc, "seedRef.current = seeded", "the reseed effect");
  const effectEnd = itemsSrc.indexOf("function updateQty", effectIdx);
  // Mutation this catches: setError(null) creeping back into the reseed
  // effect, which erased the diner's only explanation ~one RTT after a failed
  // save (the forced re-poll reseeds through this very effect).
  assert.ok(
    !/setError\(null\)/.test(itemsSrc.slice(effectIdx, effectEnd)),
    "the reseed effect must not clear a save error",
  );
});

test('PIN: PATCH\'s note keeps three-way semantics (absent = keep, "" = clear, text = replace) and the age gate refuses pending rows past the 12h cutoff', () => {
  const src = stripComments(readSrc(PUBLIC_ORDER_REQUEST_STATUS_ROUTE));
  const patchStart = mustIndexOf(src, "export async function PATCH", "the PATCH handler");
  const patchBody = src.slice(patchStart);

  // Mutation this catches: reverting to unconditional replace — every
  // qty-only edit from a client that doesn't round-trip the note would then
  // silently delete a kitchen note (the allergy-note failure, review HIGH #1).
  // CR2.3b S8 split — the note write moved into buildEditUpdate
  // (lib/order-request-edit.ts) alongside the rest of the CAS $set/$unset
  // builder, to keep the route under the ~300-line cap; re-pointed here,
  // same meaning, moved target (never weakened to a mere call-site check).
  const editLib = stripComments(readSrc(ORDER_REQUEST_EDIT_LIB));
  assert.match(
    editLib,
    /noteInput !== undefined/,
    "the note write must be guarded on key PRESENCE, never truthiness alone",
  );
  assert.match(
    patchBody,
    /PUBLIC_REQUEST_PENDING_TTL_MS/,
    "PATCH must age-gate on the same 12h cutoff the accept bridge and prune sweep enforce",
  );
  // The GET must expose the stored note so the edit UI CAN round-trip it.
  const getBody = src.slice(0, patchStart);
  assert.match(getBody, /request\.note/, "GET must return the stored note for the edit UI to round-trip");
});

test('PIN: app/api/order-requests/[id]/reject/route.ts re-checks findByRequestId AFTER its CAS lands, and hands a raced row back to "accepting" instead of leaving it wrongly "rejected"', () => {
  const src = stripComments(readSrc(REJECT_ROUTE));
  const casIdx = mustIndexOf(
    src,
    'status: { $in: ["pending", "accepting"] } }',
    "the reject route's own CAS filter",
  );
  const recheckIdx = mustIndexOf(src, "const raced = await findByRequestId(id)", "the post-CAS re-check");
  // Mutation this catches: never re-checking after the CAS lands — a reject
  // that raced an accept's own order-write would then leave the row
  // permanently "rejected" against a real, billed Order.
  assert.ok(casIdx < recheckIdx, "the post-CAS re-check must run strictly after the CAS attempt");
  assert.match(
    src,
    /status: "rejected" \},\s*\{ \$set: \{ status: "accepting" \} \}/,
    'a raced reject must CAS the row from "rejected" back to "accepting"',
  );
});

// ── Q. CR2.2c §17.E — promo-code pins ───────────────────────────────────────

test("PIN: POST and PATCH /api/public/order-request resolve a promo code ONLY via the shared resolvePromoDiscount — never a re-implemented percent/flat calculation on the route layer", () => {
  // CR2.2d split (D2) — resolvePromoDiscount is now called from the sibling
  // resolver libs, not the route files themselves; each pair is combined so
  // the pin still proves the same invariant regardless of which of the two
  // files the call currently lives in.
  const postCombined =
    stripComments(readSrc(PUBLIC_ORDER_REQUEST_ROUTE)) + "\n" + stripComments(readSrc(ORDER_REQUEST_CREATE_LIB));
  const patchCombined =
    stripComments(readSrc(PUBLIC_ORDER_REQUEST_STATUS_ROUTE)) + "\n" + stripComments(readSrc(ORDER_REQUEST_EDIT_LIB));

  for (const [rel, src] of [
    ["PUBLIC_ORDER_REQUEST_ROUTE + " + ORDER_REQUEST_CREATE_LIB, postCombined],
    ["PUBLIC_ORDER_REQUEST_STATUS_ROUTE + " + ORDER_REQUEST_EDIT_LIB, patchCombined],
  ] as const) {
    assert.match(src, /resolvePromoDiscount\(/, `${rel} must call resolvePromoDiscount`);
    // Mutation this catches: a route re-deriving the percent/flat math by hand
    // (e.g. `Math.floor(subtotal * value / 100)`) instead of going through the
    // ONE shared resolver — the two would then silently drift apart.
    assert.ok(!/Math\.floor\(/.test(src), `${rel} must never compute a percent floor itself`);
    assert.ok(!/value\s*\/\s*100/.test(src), `${rel} must never hand-derive a percent amount`);
  }
});

test("PIN: the accept bridge re-resolves the promo from LIVE ctx.settings.promoCodes — never trusts the stored quotedDiscount as a money INPUT to computeOrderTotals", () => {
  const acceptSrc = stripComments(readSrc(ACCEPT_LIB));
  const writeSrc = stripComments(readSrc(ACCEPT_WRITE));
  const promoSrc = stripComments(readSrc(ACCEPT_PROMO));
  const combined = acceptSrc + "\n" + writeSrc + "\n" + promoSrc;

  // CR2.2d split — resolvePromoDiscount's call site moved from -core.ts to
  // the new -promo.ts sibling (resolveAcceptPromo, alongside PROMO_DRIFT_ERROR).
  assert.match(promoSrc, /resolvePromoDiscount\(/, "order-request-accept-promo.ts must call resolvePromoDiscount");
  // Mutation this catches: sourcing promoCodes from the stored REQUEST instead
  // of the live Settings the accept context carries — a code deactivated
  // between quote and accept would then never be caught.
  assert.match(
    acceptSrc,
    /ctx\.settings\?\.promoCodes/,
    "order-request-accept.ts must resolve against ctx.settings?.promoCodes (LIVE settings), not the request's own stored field",
  );
  // Mutation this catches: `discount: request.quotedDiscount` (or the
  // add-round equivalent) plugged straight into computeOrderTotals — the
  // request's own quotedDiscount is only what the diner was PROMISED, never
  // a money input the bridge trusts directly.
  assert.ok(
    !/discount:\s*request\.quotedDiscount/.test(combined),
    "the accept bridge must never pass request.quotedDiscount directly as a computeOrderTotals discount",
  );
});

test("PIN: computeOrderTotals is the ONE totals function on the promo-aware create/edit routes — neither imports it directly, both reach it only through quoteRequestTotals/buildRequestDoc", () => {
  const postSrc = stripComments(readSrc(PUBLIC_ORDER_REQUEST_ROUTE));
  const patchSrc = stripComments(readSrc(PUBLIC_ORDER_REQUEST_STATUS_ROUTE));
  for (const [rel, src] of [
    [PUBLIC_ORDER_REQUEST_ROUTE, postSrc],
    [PUBLIC_ORDER_REQUEST_STATUS_ROUTE, patchSrc],
  ] as const) {
    // Mutation this catches: a route importing computeOrderTotals directly to
    // "help" with the promo discount instead of going through the ONE shared
    // quote path (quoteRequestTotals/buildRequestDoc) both routes already share.
    assert.ok(
      !/computeOrderTotals/.test(src),
      `${rel} must never reference computeOrderTotals directly — only via quoteRequestTotals/buildRequestDoc`,
    );
  }
});

// ── R. SPEC P4 — per-customer usage cap pins ────────────────────────────────

test("PIN: SPEC P4 — the promo redemption fence claim runs BEFORE the order write, in BOTH accept branches (create/parcel in order-request-accept.ts, add-round in order-request-accept-write.ts)", () => {
  const acceptSrc = stripComments(readSrc(ACCEPT_LIB));
  const fenceIdx = mustIndexOf(acceptSrc, "claimPromoRedemption(", "the create/parcel branch's fence claim");
  const createIdx = mustIndexOf(acceptSrc, "Order.create(", "the order-creation call");
  assert.ok(fenceIdx < createIdx, "claimPromoRedemption must run before Order.create in order-request-accept.ts");

  const writeSrc = stripComments(readSrc(ACCEPT_WRITE));
  const fenceIdx2 = mustIndexOf(writeSrc, "claimPromoRedemption(", "the add-round branch's fence claim");
  const writeIdx = mustIndexOf(
    writeSrc,
    "applyAddRound(openTab, update, requestId, ctx.actor)",
    "the add-round write call",
  );
  assert.ok(fenceIdx2 < writeIdx, "claimPromoRedemption must run before applyAddRound's write, in the add-round branch");
});

test("PIN: SPEC P4 — both the create and edit routes' promo resolvers run the PromoRedemption existence courtesy check when a resolved code carries oncePerCustomer", () => {
  const createSrc = stripComments(readSrc(ORDER_REQUEST_CREATE_LIB));
  assert.match(createSrc, /if \(resolved\.oncePerCustomer\)/, "resolveRequestPromo must branch on resolved.oncePerCustomer");
  assert.match(createSrc, /PromoRedemption\.exists\(/, "resolveRequestPromo must check PromoRedemption.exists");

  const editSrc = stripComments(readSrc(ORDER_REQUEST_EDIT_LIB));
  assert.match(editSrc, /if \(resolved\.oncePerCustomer\)/, "resolveEditPromo must branch on resolved.oncePerCustomer");
  assert.match(editSrc, /PromoRedemption\.exists\(/, "resolveEditPromo must check PromoRedemption.exists");
});

test("PIN: SPEC P4 + review MED #4 — the reject path never CLAIMS the fence it's refusing, and every DEFINITE reject writer RELEASES a claim this request holds with no order behind it (accept-core reject, staff reject route, diner cancel)", () => {
  const src = stripComments(readSrc(ACCEPT_CORE));
  const fnStart = mustIndexOf(src, "export async function reject(", "the reject function");
  const nextExport = src.indexOf("\nexport ", fnStart + 1);
  const body = nextExport >= 0 ? src.slice(fnStart, nextExport) : src.slice(fnStart);
  // Mutation this catches: a rejection claiming (or reading) the fence — only
  // the release helper (keyed requestId + orderId-absent) may appear here.
  assert.ok(
    !/claimPromoRedemption|PromoRedemption\.create/.test(body),
    "reject() must never CLAIM the fence",
  );
  assert.match(body, /releasePromoRedemption\(/, "reject() must hand a claimed-but-orderless fence back");

  // The two TERMINAL reject writers release too — a customer's
  // once-per-customer code must never stay consumed by a request that ended
  // with no order (review MED #4).
  const staffReject = stripComments(readSrc(REJECT_ROUTE));
  assert.match(staffReject, /releasePromoRedemption\(/, "the staff reject route must release after its CAS lands");
  const cancel = stripComments(
    readSrc("apps/cafe/app/api/public/order-request/[shortCode]/cancel/route.ts"),
  );
  assert.match(cancel, /releasePromoRedemption\(/, "the diner cancel route must release after its CAS lands");
  // And the release helper itself must be scoped so it can never free a
  // redemption whose order actually landed.
  const promoLib = stripComments(readSrc("apps/cafe/lib/order-request-accept-promo.ts"));
  assert.match(
    promoLib,
    /deleteOne\(\{ requestId, orderId: \{ \$exists: false \} \}\)/,
    "releasePromoRedemption must key on requestId + orderId-absent",
  );
});

test("PIN: review MAJORs 2026-08-20 — the fence awaits its unique-index build (cold-start rule) and every fence touchpoint keys on the CANONICAL mobile; claims are gated on a REAL discount; the edit courtesy check excludes this request's own claim; PROMO_ALREADY_USED is never rate-refunded (usage oracle stays metered)", () => {
  const promoLib = stripComments(readSrc("apps/cafe/lib/order-request-accept-promo.ts"));
  const initIdx = mustIndexOf(promoLib, "await PromoRedemption.init()", "the index-build await");
  const createIdx = mustIndexOf(promoLib, "PromoRedemption.create(", "the fence create");
  assert.ok(initIdx < createIdx, "init() must be awaited before the fence create (crud-route/due-payment precedent)");
  assert.match(promoLib, /canonicalPromoMobile\(mobile\)/, "the claim must key on the canonical mobile");

  const createLib = stripComments(readSrc("apps/cafe/lib/order-request-create.ts"));
  assert.match(createLib, /canonicalPromoMobile\(data\.mobile\)/, "the create courtesy check must use the canonical mobile");
  const editLib = stripComments(readSrc("apps/cafe/lib/order-request-edit.ts"));
  assert.match(editLib, /canonicalPromoMobile\(stored\.mobile\)/, "the edit courtesy check must use the canonical mobile");
  assert.match(
    editLib,
    /requestId: \{ \$ne: String\(stored\._id\) \}/,
    "the edit courtesy check must exclude THIS request's own claim (review MED #3)",
  );

  // Claim only when a discount actually applied — a zero-resolving flagged
  // code must not burn the customer's single use (review LOW #6).
  const acceptLib = stripComments(readSrc(ACCEPT_LIB));
  const acceptWrite = stripComments(readSrc(ACCEPT_WRITE));
  for (const [name, srcSide] of [["accept.ts", acceptLib], ["accept-write.ts", acceptWrite]] as const) {
    assert.match(
      srcSide,
      /promo\.oncePerCustomer && promo\.discount > 0/,
      `${name}'s fence gate must require a nonzero discount`,
    );
  }

  // The oracle answer costs a slot on BOTH public write paths (review MED #5).
  const post = stripComments(readSrc(PUBLIC_ORDER_REQUEST_ROUTE));
  assert.match(
    post,
    /if \(promo\.error !== PROMO_ALREADY_USED\) await refundRateLimit\(bucket, now\)/,
    "POST must refund promo 422s EXCEPT the usage oracle",
  );
  const patch = stripComments(readSrc(PUBLIC_ORDER_REQUEST_STATUS_ROUTE));
  assert.match(
    patch,
    /if \(promo\.error !== PROMO_ALREADY_USED\) await refundRateLimit\(bucket, now\)/,
    "PATCH must refund promo 422s EXCEPT the usage oracle (POST parity)",
  );
});
