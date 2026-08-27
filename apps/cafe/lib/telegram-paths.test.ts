import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { updateSettingsSchema } from "@pos/shared/schemas/settings.schema";
import { stripComments } from "@/lib/source-pin-utils";

// CR2.3b §21.10 (AS AMENDED) — the Telegram integration's security regression
// net: source-read pins (readFileSync over REAL source), same technique as
// lib/public-surface-paths.test.ts / lib/public-hardening-paths.test.ts. Every
// pin below corresponds to a named threat (W1-W10, §21.10) the design review
// actually surfaced or the phase file explicitly calls out — a pin that
// passes while the protected behaviour is broken is worse than none, so every
// claim here was re-checked against the landed source after being written.
// If a pin below and the plan text ever disagree, the disagreement is
// reported, never silently resolved by bending either side.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// Pins forbid/require CODE shapes, so they must look at code and not at
// prose — a comment explaining the rule would otherwise trip the very pin
// meant to enforce it (this repo already got bitten once on a banned-string
// pin: both the config.ts and notify.ts header comments say "No console.*",
// and the plain lib/telegram/format.test.ts's own "mobile" pin only covers
// two of the eight lib/telegram/*.ts files).

const SKIP_DIRS = new Set(["node_modules", ".next"]);

function walk(dirAbs: string, pattern: RegExp, out: string[]): void {
  for (const entry of readdirSync(dirAbs)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = path.join(dirAbs, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      walk(abs, pattern, out);
    } else if (pattern.test(entry)) {
      out.push(abs);
    }
  }
}

function relPath(fileAbs: string): string {
  return path.relative(REPO_ROOT, fileAbs).split(path.sep).join("/");
}

const WEBHOOK_ROUTE = "apps/cafe/app/api/telegram/webhook/route.ts";
const INSTRUMENTATION_CLIENT = "apps/cafe/instrumentation-client.ts";
const SETTINGS_MODEL = "apps/cafe/models/Settings.ts";
const TELEGRAM_CONFIG = "apps/cafe/lib/telegram/config.ts";
const WEBHOOK_CORE = "apps/cafe/lib/telegram/webhook-core.ts";
const SHARED_SETTINGS_SCHEMA = "packages/shared/src/schemas/settings.schema.ts";
const SETTINGS_FORM = "apps/cafe/components/settings/SettingsForm.tsx";
const ORDER_REQUEST_CREATE_ROUTE = "apps/cafe/app/api/public/order-request/route.ts";
const ORDER_REQUEST_EDIT_ROUTE = "apps/cafe/app/api/public/order-request/[shortCode]/route.ts";

// ── W1 — webhook control order ──────────────────────────────────────────────

test("PIN W1: the webhook route's FULL strict control chain — secret-header presence < host gate < config read (getTelegramConfig) < body read (req.text) < Zod parse < the first DB write (hitRateLimit) — a reorder ANYWHERE in this chain would let unauthenticated or unvalidated work run ahead of a cheaper check that could have rejected it first", () => {
  const src = stripComments(readSrc(WEBHOOK_ROUTE));

  const headerIdx = src.indexOf("req.headers.get(TELEGRAM_SECRET_HEADER)");
  const hostGateIdx = src.indexOf("resolveTenantFromHost(");
  const configReadIdx = src.indexOf("getTelegramConfig()");
  const bodyReadIdx = src.indexOf("await req.text()");
  const zodIdx = src.indexOf("telegramUpdateSchema.safeParse(");
  const rateLimitIdx = src.indexOf("hitRateLimit(");

  assert.ok(headerIdx >= 0, "the secret-header presence check must exist");
  assert.ok(hostGateIdx >= 0, "the host gate (resolveTenantFromHost) must exist");
  assert.ok(configReadIdx >= 0, "the config/DB read (getTelegramConfig) must exist");
  assert.ok(bodyReadIdx >= 0, "the body read (req.text()) must exist");
  assert.ok(zodIdx >= 0, "the Zod parse (telegramUpdateSchema.safeParse) must exist");
  assert.ok(rateLimitIdx >= 0, "the first DB write (hitRateLimit) must exist");

  // Mutation this catches: moving any earlier, cheaper check AFTER a later,
  // costlier one — an attacker with no secret (or a well-formed-looking but
  // bogus body) could then drive a host lookup, a DB read, a full body
  // buffer, a Zod parse, or a rate-limit counter write before being rejected
  // by a check that was cheaper and should have run first.
  assert.ok(headerIdx < hostGateIdx, "header presence must run BEFORE the host gate");
  assert.ok(hostGateIdx < configReadIdx, "the host gate must run BEFORE the config/DB read");
  assert.ok(configReadIdx < bodyReadIdx, "the config/DB read must run BEFORE the body read");
  assert.ok(bodyReadIdx < zodIdx, "the body read must run BEFORE the Zod parse");
  assert.ok(zodIdx < rateLimitIdx, "the Zod parse must run BEFORE the first DB write (hitRateLimit)");
});

// ── W2 — no session auth, no BotID, absent from the protect list ───────────

test("PIN W2: the webhook route calls no requireAuth/requireAdmin/auth(, and imports no botid module — its only gate is the minted secret header", () => {
  const src = stripComments(readSrc(WEBHOOK_ROUTE));
  // Mutation this catches: someone "hardening" this route by bolting a
  // session check onto it — Telegram's servers can never hold a session, so
  // that would just make every real webhook delivery 401.
  assert.ok(!/requireAuth/.test(src), "the webhook route must not reference requireAuth");
  assert.ok(!/requireAdmin/.test(src), "the webhook route must not reference requireAdmin");
  assert.ok(!/\bauth\(/.test(src), "the webhook route must not call auth(...)");
  assert.ok(!/from ["']botid/.test(src), "the webhook route must not import any botid module");
});

test("PIN W2: instrumentation-client.ts's BotID protect list never names the Telegram webhook path — checkBotId() FAILS CLOSED for unlisted paths, so registering it here would 403 every real Telegram delivery", () => {
  const src = stripComments(readSrc(INSTRUMENTATION_CLIENT));
  // Mutation this catches: someone copy-pasting the protect-list pattern onto
  // /api/telegram/webhook "for consistency" — Telegram's servers cannot run a
  // browser challenge, so BotID would silently 403 every real delivery with
  // no client-side signal ever collected for the path.
  assert.ok(!/telegram/i.test(src), "instrumentation-client.ts must never mention telegram");
});

// ── W3 — the frozen unauthenticated-route inventory ─────────────────────────

test("PIN W3: the app's full unauthenticated-route inventory (guard = requireAuth/requireAdmin/auth( OR imports createCollectionRoute/createItemRoute from @/lib/crud-route) is EXACTLY the frozen nine — a route not on this list is a pre-existing hole to REPORT, never to silently freeze", () => {
  const apiDirAbs = path.join(REPO_ROOT, "apps/cafe/app/api");
  const routeFiles: string[] = [];
  walk(apiDirAbs, /^route\.ts$/, routeFiles);
  assert.ok(routeFiles.length > 40, "app/api must contain a substantial number of route files, or this walk found the wrong directory");

  // runGuard (lib/crud-route.ts:30-32) runs requireAuth/requireAdmin inside
  // EVERY verb the two factories generate, so a route that only imports the
  // factory never spells "requireAuth" itself — the OR clause is load-bearing,
  // not an alternative reading (§21.10: 7 factory-guarded routes would
  // false-trip the naive predicate without it).
  const FACTORY_IMPORT = /import\s*\{[^}]*\b(createCollectionRoute|createItemRoute)\b[^}]*\}\s*from\s*["']@\/lib\/crud-route["']/;

  function isGuarded(src: string): boolean {
    if (/requireAuth|requireAdmin|\bauth\(/.test(src)) return true;
    return FACTORY_IMPORT.test(src);
  }

  const unguarded = routeFiles
    .filter((abs) => !isGuarded(stripComments(readFileSync(abs, "utf8"))))
    .map(relPath)
    .sort();

  const FROZEN_NINE = [
    "apps/cafe/app/api/auth/[...nextauth]/route.ts",
    "apps/cafe/app/api/health/route.ts",
    "apps/cafe/app/api/public/menu/route.ts",
    "apps/cafe/app/api/public/order-request/[shortCode]/cancel/route.ts",
    "apps/cafe/app/api/public/order-request/[shortCode]/route.ts",
    "apps/cafe/app/api/public/order-request/route.ts",
    "apps/cafe/app/api/public/table/[token]/route.ts",
    "apps/cafe/app/api/public/tables/route.ts",
    "apps/cafe/app/api/telegram/webhook/route.ts",
  ].sort();

  // Mutation this catches: a NEW route file landing with no guard and no
  // review catching it — the failure message names the extra path so a
  // reviewer reports it as a hole rather than this test silently widening the
  // frozen list to match whatever exists today.
  assert.deepEqual(
    unguarded,
    FROZEN_NINE,
    `unauthenticated route set changed. Extra/missing paths vs the frozen nine: ${JSON.stringify(
      { extra: unguarded.filter((p) => !FROZEN_NINE.includes(p)), missing: FROZEN_NINE.filter((p) => !unguarded.includes(p)) },
    )} — if this is a NEW unauthenticated route, STOP and report it as a hole; do not just add it to this list`,
  );
});

// ── W4 — the *Enc fields stay select:false, one reader ──────────────────────

test("PIN W4: models/Settings.ts declares BOTH telegramBotTokenEnc and telegramWebhookSecretEnc as { select: false } — dropping either would let a plain findOne() (getSettings/readSettings, or any admin listing route) echo a live bot token", () => {
  const src = stripComments(readSrc(SETTINGS_MODEL));
  for (const field of ["telegramBotTokenEnc", "telegramWebhookSecretEnc"]) {
    const fieldMatch = src.match(new RegExp(`${field}:\\s*\\{[^}]*\\}`));
    assert.ok(fieldMatch, `${field} must be declared as a schema field`);
    assert.match(fieldMatch[0], /select:\s*false/, `${field} must be declared { select: false }`);
  }
});

test("PIN W4: the `+telegramBotTokenEnc +telegramWebhookSecretEnc` projection string appears, IN CODE, in EXACTLY ONE file across apps/cafe's lib/** and app/** — widening that projection anywhere else would let a second code path read the sealed creds it has no business opening", () => {
  const files: string[] = [];
  walk(path.join(REPO_ROOT, "apps/cafe/lib"), /\.tsx?$/, files);
  walk(path.join(REPO_ROOT, "apps/cafe/app"), /\.tsx?$/, files);
  // Exclude test files: this file (and models/Settings.ts's own header
  // comment) legitimately QUOTE the projection string in prose/pins without
  // being a second reader of it — stripComments plus the test-file exclusion
  // keeps the pin looking at real .select() call sites only.
  const productionFiles = files.filter((abs) => !abs.endsWith(".test.ts"));

  const PROJECTION = "+telegramBotTokenEnc +telegramWebhookSecretEnc";
  const hits = productionFiles
    .filter((abs) => stripComments(readFileSync(abs, "utf8")).includes(PROJECTION))
    .map(relPath);

  assert.deepEqual(
    hits,
    [TELEGRAM_CONFIG],
    `the +telegramBotTokenEnc +telegramWebhookSecretEnc projection must appear in exactly lib/telegram/config.ts, found: ${JSON.stringify(hits)}`,
  );
});

// ── W5 — the settings PUT surface can neither write nor clear the creds ────

test("PIN W5: packages/shared's settings.schema.ts source names neither telegramBotTokenEnc nor telegramWebhookSecretEnc — the PUT /api/settings surface must never even TYPE those fields, let alone accept them", () => {
  const src = readSrc(SHARED_SETTINGS_SCHEMA);
  assert.ok(!/telegramBotTokenEnc/.test(src), "settings.schema.ts must never reference telegramBotTokenEnc");
  assert.ok(!/telegramWebhookSecretEnc/.test(src), "settings.schema.ts must never reference telegramWebhookSecretEnc");
});

test("PIN W5: a runtime parse of {telegramPaused:true, telegramBotTokenEnc:\"x\"} through updateSettingsSchema STRIPS the unknown Enc key rather than rejecting the whole PUT — settingsSchema is a plain (non-strict) z.object, so this is the actual documented Zod behaviour, not a design choice this file invented", () => {
  const parsed = updateSettingsSchema.safeParse({ telegramPaused: true, telegramBotTokenEnc: "x" });
  assert.equal(parsed.success, true, "the partial parse must succeed (non-strict Zod strips, it does not reject)");
  if (!parsed.success) return;
  assert.equal(parsed.data.telegramPaused, true, "the legitimate telegramPaused field must survive the parse");
  assert.ok(
    !("telegramBotTokenEnc" in parsed.data),
    "the unknown telegramBotTokenEnc key must be STRIPPED from the parsed output — a settings PUT can never smuggle a credential in through this surface",
  );
});

// ── W6 — after( fires exactly twice, only on success, never awaited ────────

test("PIN W6: `after(` appears in EXACTLY the two public order-request routes, and NOWHERE else under app/api — a third call site would mean an event fired outside the two documented seams", () => {
  const files: string[] = [];
  walk(path.join(REPO_ROOT, "apps/cafe/app/api"), /\.tsx?$/, files);

  const hits = new Map<string, number>();
  for (const abs of files) {
    const src = stripComments(readFileSync(abs, "utf8"));
    const count = src.split("after(").length - 1;
    if (count > 0) hits.set(relPath(abs), count);
  }

  assert.deepEqual(
    Object.fromEntries(hits),
    { [ORDER_REQUEST_CREATE_ROUTE]: 1, [ORDER_REQUEST_EDIT_ROUTE]: 1 },
    `after( must appear exactly once in each of the two public order-request routes and nowhere else, found: ${JSON.stringify(Object.fromEntries(hits))}`,
  );
});

test("PIN W6: neither public order-request route ever AWAITS the Telegram call — `after(` must fire fire-and-forget, and a request path must never block the diner's response on a Telegram fan-out", () => {
  for (const routeFile of [ORDER_REQUEST_CREATE_ROUTE, ORDER_REQUEST_EDIT_ROUTE]) {
    const src = stripComments(readSrc(routeFile));
    assert.ok(!/await after\(/.test(src), `${routeFile} must never write "await after("`);
    assert.ok(!/await notifyRequestEvent\(/.test(src), `${routeFile} must never write "await notifyRequestEvent(" — it belongs INSIDE the after() callback, never awaited on the response path`);
  }
});

// ── W7 — no console.*, no leaked catch bindings ─────────────────────────────

test("PIN W7: no production file under lib/telegram/** or app/api/telegram/** contains console.* — the pasted bot token must be unloggable even on an error path, and a comment merely SAYING 'no console.*' must not satisfy this pin", () => {
  const files: string[] = [];
  walk(path.join(REPO_ROOT, "apps/cafe/lib/telegram"), /\.ts$/, files);
  walk(path.join(REPO_ROOT, "apps/cafe/app/api/telegram"), /\.ts$/, files);
  const productionFiles = files.filter((abs) => !abs.endsWith(".test.ts"));
  assert.ok(productionFiles.length >= 8, "the Telegram production surface must contain at least the 8 lib files + 9 route files");

  for (const abs of productionFiles) {
    const src = stripComments(readFileSync(abs, "utf8"));
    assert.ok(!/console\./.test(src), `${relPath(abs)} must not call console.* — comments explaining the "no console" rule are stripped before this check, so this is a REAL call site`);
  }
});

test("PIN W7: every catch block under app/api/telegram/** is written bindingless (`catch {`), never `catch (e)` — the caught object can never be passed to a response/serverError call if the syntax gives it no name", () => {
  const files: string[] = [];
  walk(path.join(REPO_ROOT, "apps/cafe/app/api/telegram"), /\.ts$/, files);
  let catchBlockCount = 0;
  for (const abs of files) {
    const src = stripComments(readFileSync(abs, "utf8"));
    catchBlockCount += (src.match(/\bcatch\s*\{/g) ?? []).length;
    // Mutation this catches: `catch (err) { ... serverError(msg, err) }` — the
    // pasted bot token could then ride the caught error object into a
    // response body or a future log line.
    assert.ok(!/catch\s*\(/.test(src), `${relPath(abs)} must declare every catch block bindingless (catch {), never catch (e)`);
  }
  assert.ok(catchBlockCount > 0, "the admin telegram routes must contain at least one catch block for this pin to mean anything");
});

// ── W8 — the Settings form's third tab ──────────────────────────────────────

test("PIN W8: SettingsForm.tsx carries the four-tab union type (CR2.4 added \"appearance\") and routes telegram*-prefixed field errors to the integrations tab", () => {
  const src = stripComments(readSrc(SETTINGS_FORM));
  assert.match(
    src,
    /type SettingsTab = "general" \| "appearance" \| "print" \| "integrations";/,
    'SettingsForm must declare exactly the four-tab union `"general" | "appearance" | "print" | "integrations"`',
  );
  assert.match(
    src,
    /firstField\.startsWith\("telegram"\)\s*\n?\s*\?\s*"integrations"/,
    'onInvalid must route a telegram*-prefixed field error to the "integrations" tab',
  );
});

test("PIN W8: IntegrationsFields is rendered as its OWN component file, imported by SettingsForm — the third tab is not inlined JSX", () => {
  const src = stripComments(readSrc(SETTINGS_FORM));
  assert.match(
    src,
    /import \{ IntegrationsFields \} from "@\/components\/settings\/IntegrationsFields";/,
    "SettingsForm must import IntegrationsFields from its own file",
  );
  assert.match(src, /<IntegrationsFields\s+control=\{control\}\s*\/>/, "SettingsForm must actually render <IntegrationsFields control={control} />");
});

// ── W9 — the webhook never answers 429 or 5xx ───────────────────────────────

test("PIN W9: the webhook route's code contains no 429 and no 5xx status literal — its only non-200 status is 401 (plus the host gate's 404) — a non-2xx here would invite Telegram to redeliver and amplify whatever triggered it", () => {
  const src = stripComments(readSrc(WEBHOOK_ROUTE));
  assert.ok(!/\b429\b/.test(src), "the webhook route must never use the literal 429");
  assert.ok(!/\b5\d\d\b/.test(src), "the webhook route must never use a 5xx status literal");
  // Sanity: the 401/404 the pin ABOVE claims are the only non-200s must
  // actually be present, or this pin would pass for the wrong reason.
  assert.match(src, /\bfailure\([^)]*,\s*401\)/, "the webhook route must call failure(..., 401) for a missing/mismatched secret");
});

// ── W10 — the diner's mobile never rides a Telegram message ────────────────

test("PIN W10: no production file under lib/telegram/** references 'mobile' in any form — the diner's phone number is deliberately omitted, not masked, from every Telegram message (§21.6d)", () => {
  const files: string[] = [];
  walk(path.join(REPO_ROOT, "apps/cafe/lib/telegram"), /\.ts$/, files);
  const productionFiles = files.filter((abs) => !abs.endsWith(".test.ts"));
  assert.ok(productionFiles.length >= 8, "lib/telegram/** must contain at least the 8 spec'd production files");

  for (const abs of productionFiles) {
    const src = readFileSync(abs, "utf8");
    // Mutation this catches: a future "helpful" addition that threads
    // `summary.mobile` or `maskMobile(...)` into notify.ts/format.ts — a
    // Telegram chat has no staff `role` for the panel's own masking helper to
    // check, so ANY form of the number here is a forwardable-surface leak.
    assert.ok(!/mobile/i.test(src), `${relPath(abs)} must not reference "mobile" in any form`);
  }
});

// ── Extra: the kill switch must survive a disconnect ────────────────────────

test("PIN: clearTelegramCreds's $unset field list never includes telegramPaused — disconnecting the bot must not silently un-mute a cafe that had paused sends", () => {
  const src = stripComments(readSrc(TELEGRAM_CONFIG));
  const fieldsMatch = src.match(/TELEGRAM_CRED_FIELDS\s*=\s*\[([\s\S]*?)\]\s*as const;/);
  assert.ok(fieldsMatch, "TELEGRAM_CRED_FIELDS must be declared as a const array");
  assert.ok(
    !/telegramPaused/.test(fieldsMatch[1]),
    "TELEGRAM_CRED_FIELDS must never include telegramPaused — that is a Settings kill-switch toggle, not a credential",
  );
});

// ── Extra: the webhook's pure dispatch core stays DB-free ──────────────────

test("PIN: lib/telegram/webhook-core.ts imports no mongoose, no @/models/*, and no @/lib/db — dispatchUpdate is a PURE core over injected ports, so its own test can stay entirely DB-free", () => {
  const src = stripComments(readSrc(WEBHOOK_CORE));
  assert.ok(!/from ["']mongoose["']/.test(src), "webhook-core.ts must not import mongoose");
  assert.ok(!/from ["']@\/models\//.test(src), "webhook-core.ts must not import from @/models/");
  assert.ok(!/from ["']@\/lib\/db["']/.test(src), "webhook-core.ts must not import connectDB from @/lib/db");
});
