// CB-DL-1 S5.5 — the `migrate:links` refusal matrix, against the REAL parser.
//
// scripts/migrate-links/args.ts takes every filesystem/env/clock touch through
// an injected ArgsDeps, so the shipped parseMigrateArgs runs here verbatim with
// fakes in place of fs/env/mongodump/now/cwd. This is the only gate standing
// between a fat-fingered `--apply` and a live cluster, so each refusal gets its
// own case and each message is asserted, not just `ok === false`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  BACKUP_MAX_AGE_MS,
  RESET_DEFAULT_COLLECTIONS,
  RESET_DEFAULT_KEYWORD,
  parseMigrateArgs,
  scrubUri,
  type ArgsDeps,
  type ParseMigrateArgsResult,
} from "../scripts/migrate-links/args";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const SCRIPT_DIR = "apps/cafe/scripts/migrate-links";
const ENTRY = "apps/cafe/scripts/migrate-links.ts";
const CENSUS_FILES = ["census-orders.ts", "census-refs.ts"];
const APPLY_FILES = ["apply-categories.ts", "apply-reset.ts", "apply-run.ts"];

const NOW = Date.parse("2026-09-09T10:00:00.000Z");
const CWD = "/work/cafe";
const URI = "mongodb://127.0.0.1:27017/pos_scratch_links";
const DB = "pos_scratch_links";
const FRESH_BACKUP = "/backups/dump.gz";

// This repo augments NodeJS.ProcessEnv with required keys (NODE_ENV among
// them), so a fake env is built by cloning the real shape and clearing the one
// variable these cases care about — never a bare object cast.
function fakeEnv(over: { MONGODB_URI?: string } = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.MONGODB_URI;
  if (over.MONGODB_URI !== undefined) env.MONGODB_URI = over.MONGODB_URI;
  return env;
}

function deps(over: Partial<ArgsDeps> = {}): ArgsDeps {
  return {
    env: fakeEnv(),
    existsSync: () => true,
    statSync: () => ({ mtimeMs: NOW - 1000 }),
    hasMongodump: () => true,
    now: NOW,
    cwd: CWD,
    ...over,
  };
}

function mustFail(result: ParseMigrateArgsResult, label: string): string {
  assert.equal(result.ok, false, `${label}: expected a refusal, got ok:true`);
  assert.ok(!result.ok);
  return result.error;
}

function mustPass(result: ParseMigrateArgsResult, label: string) {
  assert.equal(result.ok, true, `${label}: expected ok:true, got error ${result.ok ? "" : result.error}`);
  assert.ok(result.ok);
  return result.args;
}

// ── URI and db name ─────────────────────────────────────────────────────────

test("migrate-links args: no --uri and no MONGODB_URI is refused, naming the flag", () => {
  const error = mustFail(parseMigrateArgs([], deps()), "no uri anywhere");
  assert.match(error, /--uri/, "the refusal must name --uri so the operator knows what to pass");
  assert.match(error, /MONGODB_URI/, "the refusal must also name the env var it accepts instead");
});

test("migrate-links args: MONGODB_URI is used when --uri is absent, and --uri wins when both are present", () => {
  const fromEnv = mustPass(parseMigrateArgs([], deps({ env: fakeEnv({ MONGODB_URI: URI }) })), "env uri");
  assert.equal(fromEnv.uri, URI, "the env URI must be used when no --uri is passed");
  assert.equal(fromEnv.dbName, DB, "the db name must be parsed off the env URI");

  const flagUri = "mongodb://127.0.0.1:27017/other_db";
  const fromFlag = mustPass(
    parseMigrateArgs(["--uri", flagUri], deps({ env: fakeEnv({ MONGODB_URI: URI }) })),
    "flag uri",
  );
  assert.equal(fromFlag.uri, flagUri, "an explicit --uri must win over the environment");
  assert.equal(fromFlag.dbName, "other_db", "and the db name must come from the flag's URI");
});

test("migrate-links args: the db name is parsed from mongodb:// and mongodb+srv://, including a URI carrying a query string", () => {
  const plain = mustPass(parseMigrateArgs(["--uri", "mongodb://user:pw@host:27017/plain_db"], deps()), "mongodb://");
  assert.equal(plain.dbName, "plain_db", "the path segment after the host is the db name");

  const srv = mustPass(
    parseMigrateArgs(["--uri", "mongodb+srv://user:pw@cluster0.abcde.mongodb.net/srv_db?retryWrites=true&w=majority"], deps()),
    "mongodb+srv:// with query",
  );
  assert.equal(srv.dbName, "srv_db", "a mongodb+srv URI's query string must not become part of the db name");

  const srvNoQuery = mustPass(parseMigrateArgs(["--uri", "mongodb+srv://cluster0.abcde.mongodb.net/srv_db"], deps()), "srv no query");
  assert.equal(srvNoQuery.dbName, "srv_db");
});

test("migrate-links args: a URI with an empty db path is refused — the census must never guess a database", () => {
  for (const bad of ["mongodb://127.0.0.1:27017", "mongodb://127.0.0.1:27017/", "mongodb+srv://cluster0.abcde.mongodb.net/?retryWrites=true"]) {
    const error = mustFail(parseMigrateArgs(["--uri", bad], deps()), `empty db path in ${bad}`);
    assert.match(error, /database name/i, `the refusal for ${bad} must say the database name could not be determined`);
  }
});

test("migrate-links args: an unknown flag is refused and NAMED (a typo like --aply must not silently read as a dry run)", () => {
  const error = mustFail(parseMigrateArgs(["--uri", URI, "--aply"], deps()), "unknown flag");
  assert.match(error, /Unknown flag/, "the refusal must say the flag is unknown");
  assert.match(error, /--aply/, "the refusal must quote the offending flag back");
});

// ── dry run is the default ──────────────────────────────────────────────────

test("migrate-links args: the default is a DRY RUN (apply false), and an explicit --dry-run is accepted as a no-op", () => {
  const implicit = mustPass(parseMigrateArgs(["--uri", URI], deps()), "implicit dry run");
  assert.equal(implicit.apply, false, "apply must default to false — this build never writes");
  assert.equal(implicit.backup, null, "no backup is needed for a dry run");
  assert.equal(implicit.confirm, null, "no confirmation is needed for a dry run");

  const explicit = mustPass(parseMigrateArgs(["--uri", URI, "--dry-run"], deps()), "explicit dry run");
  assert.equal(explicit.apply, false, "an explicit --dry-run must not error and must not set apply");
});

// ── the --apply gate chain ──────────────────────────────────────────────────

test("migrate-links args: --apply without --backup is refused, naming the mongodump archive it wants", () => {
  const error = mustFail(parseMigrateArgs(["--uri", URI, "--apply"], deps()), "apply without backup");
  assert.match(error, /--backup/, "the refusal must name --backup");
  assert.match(error, /mongodump/, "the refusal must say what kind of file it wants");
});

test("migrate-links args: --apply --backup auto is refused when mongodump is missing, pointing at MongoDB Database Tools", () => {
  const error = mustFail(
    parseMigrateArgs(["--uri", URI, "--apply", "--backup", "auto"], deps({ hasMongodump: () => false })),
    "backup auto without mongodump",
  );
  assert.match(error, /MongoDB Database Tools/, "the refusal must name the tools package the operator has to install");
  assert.match(error, /mongodump/, "the refusal must name the binary it looked for");
});

test("migrate-links args: --backup <path> that does not exist is refused, quoting the path", () => {
  const error = mustFail(
    parseMigrateArgs(["--uri", URI, "--apply", "--backup", FRESH_BACKUP], deps({ existsSync: () => false })),
    "missing backup file",
  );
  assert.match(error, /Backup file not found/, "the refusal must say the backup file was not found");
  assert.ok(error.includes(FRESH_BACKUP), "the refusal must quote the path it looked at");
});

test("migrate-links args: a backup older than BACKUP_MAX_AGE_MS is refused; exactly AT the limit is still accepted (the gate is `>`)", () => {
  assert.equal(BACKUP_MAX_AGE_MS, 60 * 60 * 1000, "BACKUP_MAX_AGE_MS must be the 60 minutes the runbook promises");

  const stale = mustFail(
    parseMigrateArgs(
      ["--uri", URI, "--apply", "--backup", FRESH_BACKUP, "--confirm", DB],
      deps({ statSync: () => ({ mtimeMs: NOW - BACKUP_MAX_AGE_MS - 1 }) }),
    ),
    "stale backup",
  );
  assert.match(stale, /older than 60 minutes/, "the refusal must state the 60-minute rule in the words the runbook uses");
  assert.match(stale, /fresh mongodump/, "the refusal must tell the operator to take a fresh dump");

  const atLimit = parseMigrateArgs(
    ["--uri", URI, "--apply", "--backup", FRESH_BACKUP, "--confirm", DB],
    deps({ statSync: () => ({ mtimeMs: NOW - BACKUP_MAX_AGE_MS }) }),
  );
  assert.equal(atLimit.ok, true, "a backup exactly BACKUP_MAX_AGE_MS old must still pass — the gate is strictly greater than");
});

test("migrate-links args: a fresh backup with no --confirm is refused, and a --confirm that does not match the URI's db names the real db", () => {
  const noConfirm = mustFail(parseMigrateArgs(["--uri", URI, "--apply", "--backup", FRESH_BACKUP], deps()), "no confirm");
  assert.match(noConfirm, /--confirm/, "the refusal must name --confirm");
  assert.match(noConfirm, /database name in the URI/, "the refusal must say WHAT to repeat back");

  const mismatch = mustFail(
    parseMigrateArgs(["--uri", URI, "--apply", "--backup", FRESH_BACKUP, "--confirm", "prod_pos"], deps()),
    "confirm mismatch",
  );
  assert.match(mismatch, /--confirm does not match/, "the refusal must say the confirmation did not match");
  assert.ok(
    mismatch.includes(DB),
    `the refusal must name the database the URI actually points at (${DB}) — that is how a wrong-cluster --apply is caught`,
  );
  assert.ok(!mismatch.includes(URI), "the refusal must NOT echo the URI itself (it carries credentials)");
});

test("migrate-links args: with every gate satisfied the parse succeeds with apply:true and carries the backup path and confirmation through", () => {
  const args = mustPass(
    parseMigrateArgs(["--uri", URI, "--apply", "--backup", FRESH_BACKUP, "--confirm", DB], deps()),
    "all gates satisfied",
  );
  assert.equal(args.apply, true, "apply must be true once every gate passed");
  assert.equal(args.backup, FRESH_BACKUP, "the backup path must ride through to the entry script");
  assert.equal(args.confirm, DB, "the confirmation must ride through");
  assert.equal(args.dbName, DB, "the parsed db name must ride through");
  assert.equal(args.uri, URI, "the URI must ride through unmodified");

  // CB-DL-2: the full args shape, including the three fields args.ts gained
  // (reset, createMissingCategories, dropLegacyCategory) — a deepEqual so a
  // future field silently missing from this object cannot pass unnoticed.
  assert.deepEqual(
    args,
    {
      uri: URI,
      dbName: DB,
      apply: true,
      backup: FRESH_BACKUP,
      confirm: DB,
      out: args.out,
      reset: null,
      createMissingCategories: false,
      dropLegacyCategory: false,
    },
    "the full MigrateArgs shape (all gates satisfied, no --reset/--create-missing-categories/--drop-legacy-category passed) must match exactly",
  );

  // --backup auto with mongodump installed is the other passing shape.
  const autoArgs = mustPass(
    parseMigrateArgs(["--uri", URI, "--apply", "--backup", "auto", "--confirm", DB], deps()),
    "backup auto with mongodump present",
  );
  assert.equal(autoArgs.backup, "auto", "--backup auto must ride through as the literal 'auto'");
  assert.equal(autoArgs.apply, true);
});

// ── CB-DL-2: --reset, --create-missing-categories, --drop-legacy-category ──

test("migrate-links args: --reset default expands to the 7-item RESET_DEFAULT_COLLECTIONS list, in order", () => {
  assert.deepEqual(
    RESET_DEFAULT_COLLECTIONS,
    ["orders", "duepayments", "orderrequests", "promoredemptions", "printjobs", "counters", "customers"],
    "RESET_DEFAULT_COLLECTIONS must be the exact 7-item list the GO-LIVE doc and the owner both read",
  );
  assert.equal(RESET_DEFAULT_KEYWORD, "default", "the keyword that expands to the default list must be 'default'");

  const args = mustPass(
    parseMigrateArgs(
      ["--uri", URI, "--apply", "--backup", FRESH_BACKUP, "--confirm", DB, "--reset", RESET_DEFAULT_KEYWORD],
      deps(),
    ),
    "--reset default",
  );
  assert.deepEqual(args.reset, [...RESET_DEFAULT_COLLECTIONS], "--reset default must expand to the full list, in order");
});

test("migrate-links args: --reset with an explicit comma list keeps only the named collections, in the order given", () => {
  const args = mustPass(
    parseMigrateArgs(
      ["--uri", URI, "--apply", "--backup", FRESH_BACKUP, "--confirm", DB, "--reset", "orders,customers"],
      deps(),
    ),
    "--reset orders,customers",
  );
  assert.deepEqual(args.reset, ["orders", "customers"], "an explicit comma list must ride through as given, not sorted or deduped");
});

test("migrate-links args: --reset with an unknown collection name is refused, naming the offending collection", () => {
  const error = mustFail(
    parseMigrateArgs(
      ["--uri", URI, "--apply", "--backup", FRESH_BACKUP, "--confirm", DB, "--reset", "orders,bogus"],
      deps(),
    ),
    "--reset orders,bogus",
  );
  assert.ok(
    error.includes("Unknown collection in --reset: bogus"),
    `the refusal must quote the exact offending name, got: ${error}`,
  );
});

test("migrate-links args: --reset default without --apply is refused, and the refusal names --reset", () => {
  const error = mustFail(
    parseMigrateArgs(["--uri", URI, "--reset", RESET_DEFAULT_KEYWORD], deps()),
    "--reset default without --apply",
  );
  assert.ok(error.includes("--reset needs --apply"), `the refusal must say --reset needs --apply verbatim, got: ${error}`);
});

test("migrate-links args: --reset is absent by default, and both new booleans default false and flip true on their flags", () => {
  const withoutReset = mustPass(parseMigrateArgs(["--uri", URI], deps()), "no --reset");
  assert.equal(withoutReset.reset, null, "reset must be null when --reset is never passed");
  assert.equal(withoutReset.createMissingCategories, false, "createMissingCategories must default false");
  assert.equal(withoutReset.dropLegacyCategory, false, "dropLegacyCategory must default false");

  // C10: --create-missing-categories and --drop-legacy-category both need
  // --apply (like --reset does), so this pin exercises the flip with every
  // --apply gate satisfied rather than the ungated parse.
  const withBoth = mustPass(
    parseMigrateArgs(
      [
        "--uri", URI,
        "--apply",
        "--backup", FRESH_BACKUP,
        "--confirm", DB,
        "--create-missing-categories",
        "--drop-legacy-category",
      ],
      deps(),
    ),
    "both new flags passed",
  );
  assert.equal(withBoth.createMissingCategories, true, "--create-missing-categories must flip the flag true");
  assert.equal(withBoth.dropLegacyCategory, true, "--drop-legacy-category must flip the flag true");
});

// C10: a refusal matrix — each of the three mutating flags fails ON ITS OWN
// (without --apply) with a message naming that exact flag, so a future
// refactor cannot silently drop one guard while keeping the others.
test("migrate-links args: --reset / --create-missing-categories / --drop-legacy-category each refuse without --apply, naming the offending flag", () => {
  const resetError = mustFail(
    parseMigrateArgs(["--uri", URI, "--reset", RESET_DEFAULT_KEYWORD], deps()),
    "--reset alone",
  );
  assert.ok(resetError.includes("--reset needs --apply"), `got: ${resetError}`);

  const createError = mustFail(
    parseMigrateArgs(["--uri", URI, "--create-missing-categories"], deps()),
    "--create-missing-categories alone",
  );
  assert.ok(
    createError.includes("--create-missing-categories needs --apply"),
    `the refusal must name --create-missing-categories verbatim, got: ${createError}`,
  );

  const dropError = mustFail(
    parseMigrateArgs(["--uri", URI, "--drop-legacy-category"], deps()),
    "--drop-legacy-category alone",
  );
  assert.ok(
    dropError.includes("--drop-legacy-category needs --apply"),
    `the refusal must name --drop-legacy-category verbatim, got: ${dropError}`,
  );
});

// C33: --apply --dry-run must never silently run the full destructive apply
// just because the operator also typed --dry-run (the runbook tells them to
// run a --dry-run census right after --apply, making this a realistic
// keystroke) — this must be a parse refusal naming both flags. A bare
// --dry-run (no --apply) must keep working exactly as before.
test("migrate-links args: --apply --dry-run is refused naming both flags; a bare --dry-run still parses as apply:false", () => {
  const error = mustFail(
    parseMigrateArgs(["--uri", URI, "--apply", "--backup", FRESH_BACKUP, "--confirm", DB, "--dry-run"], deps()),
    "--apply --dry-run",
  );
  assert.match(error, /--apply/, "the refusal must name --apply");
  assert.match(error, /--dry-run/, "the refusal must name --dry-run");

  const bareDryRun = mustPass(parseMigrateArgs(["--uri", URI, "--dry-run"], deps()), "bare --dry-run");
  assert.equal(bareDryRun.apply, false, "a bare --dry-run (no --apply) must still parse fine with apply:false");
});

// C3: the --backup auto archive must be written OUTSIDE the repo (os.tmpdir()),
// never under process.cwd() — `migrate:links` is a cafe-workspace npm script,
// so a cwd-based path would put a full dump of the live database inside this
// public repo. Source pin (autoBackup is not exported; this is the entry
// script's private helper) — negative (no cwd-joined path) paired with the
// positive landmark that the tmpdir-based archive name shape survives.
test("PIN: autoBackup builds its archive path from os.tmpdir(), never cwd (RAW source; negative paired with the positive landmark the archive basename shape)", () => {
  const src = readSrc(ENTRY);
  assert.ok(src.includes('import { tmpdir } from "node:os"'), "positive landmark: migrate-links.ts must import tmpdir from node:os");
  const fnStart = src.indexOf("function autoBackup(");
  assert.ok(fnStart >= 0, "positive landmark: autoBackup must exist");
  const fnEnd = src.indexOf("\n}", fnStart);
  const fnBody = src.slice(fnStart, fnEnd > 0 ? fnEnd : src.length);
  assert.ok(fnBody.includes("tmpdir()"), "positive landmark: autoBackup must call tmpdir()");
  assert.equal(fnBody.includes("${cwd}"), false, "autoBackup must not build its path from a cwd variable");
  assert.equal(fnBody.includes(", cwd:"), false, "autoBackup must not accept a cwd parameter at all");
  assert.match(
    fnBody,
    /migrate-links-backup-\$\{dbName\}-\$\{stamp\}\.archive\.gz/,
    "positive landmark: the archive basename shape (migrate-links-backup-<db>-<stamp>.archive.gz) must survive the move to tmpdir",
  );
});

// ── the report path ─────────────────────────────────────────────────────────

test("migrate-links args: --out is honoured verbatim, and the default report path is cwd-based, db-named and timestamped with no colons", () => {
  const explicit = mustPass(parseMigrateArgs(["--uri", URI, "--out", "/tmp/report.json"], deps()), "--out honoured");
  assert.equal(explicit.out, "/tmp/report.json", "an explicit --out must be used verbatim");

  const args = mustPass(parseMigrateArgs(["--uri", URI], deps()), "default out");
  assert.ok(args.out.startsWith(`${CWD}/`), `the default report must land in the injected cwd, got ${args.out}`);
  assert.match(
    args.out,
    /migrate-links-report-.+\.json$/,
    `the default report name must be migrate-links-report-<db>-<stamp>.json, got ${args.out}`,
  );
  assert.ok(args.out.includes(`migrate-links-report-${DB}-`), "the default report name must carry the db name");
  const basename = args.out.slice(args.out.lastIndexOf("/") + 1);
  assert.ok(!basename.includes(":"), `the timestamp must have its colons stripped (Windows cannot hold them), got ${basename}`);
  assert.ok(!args.out.includes(URI), "the report path must never carry the URI");
});

// ── source pins: the census must read RAW collections, never a model ───────

test("PIN: the migrate-links scripts never import a Mongoose model (RAW source, negative — a schema would CAST the very strings being censused) — paired with the positive landmarks db.collection<RawDoc>( / createConnection( / parseMigrateArgs(", () => {
  // Needles by concatenation so this gate cannot match its own source lines.
  const BANNED_ALIAS = '"@/' + 'models';
  const BANNED_PATH = "/" + "models" + "/";

  const files = [
    ENTRY,
    ...CENSUS_FILES.map((f) => `${SCRIPT_DIR}/${f}`),
    ...APPLY_FILES.map((f) => `${SCRIPT_DIR}/${f}`),
    `${SCRIPT_DIR}/args.ts`,
    `${SCRIPT_DIR}/report.ts`,
  ];
  for (const rel of files) {
    const src = readSrc(rel);
    assert.ok(src.length > 200, `positive landmark: ${rel} must have been read (got ${src.length} bytes)`);
    assert.ok(
      !src.includes(BANNED_ALIAS),
      `${rel} must not import from the models alias — a Mongoose schema would cast a stray string id into an ObjectId and the census would report a shape that does not exist in the database`,
    );
    assert.ok(!src.includes(BANNED_PATH), `${rel} must not import a model by relative path either`);
  }

  // Positive landmarks, per file, so none of the negatives above can pass
  // vacuously against a file that stopped doing its job.
  // Every census read goes through the raw driver as `db.collection<RawDoc>(...)`
  // — the generic sits between `collection` and `(`, so the landmark is the
  // typed opener, which is itself the proof that a RawDoc (not a schema) types
  // the documents being counted.
  for (const rel of CENSUS_FILES.map((f) => `${SCRIPT_DIR}/${f}`)) {
    const src = readSrc(rel);
    assert.ok(src.includes(".collection<"), `positive landmark: ${rel} must read through the raw driver's db.collection<...>(`);
    assert.ok(src.includes("RawDoc"), `positive landmark: ${rel} must type its documents as RawDoc, not through a Mongoose schema`);
  }
  const entrySrc = readSrc(ENTRY);
  assert.ok(entrySrc.includes("createConnection("), "positive landmark: migrate-links.ts must open its own connection with createConnection(");
  assert.ok(entrySrc.includes("parseMigrateArgs("), "positive landmark: migrate-links.ts must go through parseMigrateArgs(");
});

// CB-DL-2 moved these two pins: the apply pipeline is now built (apply-run.ts
// / apply-categories.ts / apply-reset.ts), so migrate-links.ts no longer
// refuses the apply path with exit(2)/"not in this build" — it runs runApply
// and exits 0/1/3 (see EXIT_OK/EXIT_REFUSED/EXIT_APPLY_NOT_CLEAN below and the
// scrubUri pin on the --backup auto spawnSync argv).
test("PIN: migrate-links.ts defines EXIT_OK/EXIT_REFUSED/EXIT_APPLY_NOT_CLEAN as 0/1/3 and no longer exits with the old 'not built' code 2 (RAW source; negative paired with the positive landmark runApply()", () => {
  const src = readSrc(ENTRY);

  assert.match(src, /EXIT_OK\s*=\s*0/, "positive landmark: EXIT_OK must be 0");
  assert.match(src, /EXIT_REFUSED\s*=\s*1/, "positive landmark: EXIT_REFUSED must be 1");
  assert.match(src, /EXIT_APPLY_NOT_CLEAN\s*=\s*3/, "positive landmark: EXIT_APPLY_NOT_CLEAN must be 3");

  const bannedExit2 = "exit" + "(2)";
  assert.equal(
    src.includes(bannedExit2),
    false,
    "migrate-links.ts must no longer exit(2) anywhere — CB-DL-2 built the apply pipeline, so the old 'not built' refusal code cannot still exist",
  );
  assert.ok(src.includes("runApply("), "positive landmark: migrate-links.ts must call runApply( now that the apply pipeline is built");
});

test("PIN: --backup auto's spawnSync passes the uri only as an argv element, and never interpolates it into a printed message (RAW source; negative paired with the positive landmark scrubUri()", () => {
  const src = readSrc(ENTRY);

  // The uri must be its own argv array element (a template literal producing
  // one array item is fine — spawnSync never invokes a shell — but the uri
  // must never be concatenated into a single shell-style command string).
  const uriArgvNeedle = "`--uri=${uri}`";
  assert.ok(
    src.includes(uriArgvNeedle),
    `spawnSync's argv must build the uri flag as its own array element (${JSON.stringify(uriArgvNeedle)}), never inside a shell string`,
  );
  assert.ok(src.includes("spawnSync("), "positive landmark: migrate-links.ts must call spawnSync( for mongodump");
  assert.match(src, /spawnSync\(\s*"mongodump",\s*\[/, "positive landmark: mongodump's argv must be an array (never a joined shell string) passed to spawnSync");

  // Negative: no console.log/template that interpolates `uri` directly into a
  // printed string — every uri-bearing message must go through scrubUri first.
  const bannedLogUri = "console." + "log(`" + "${uri}";
  const bannedLogUri2 = "console." + "log(uri";
  assert.equal(src.includes(bannedLogUri), false, "no console.log template may interpolate the raw uri");
  assert.equal(src.includes(bannedLogUri2), false, "no console.log may pass the raw uri directly");
  assert.ok(src.includes("scrubUri("), "positive landmark: migrate-links.ts must scrub before printing any uri-derived message");
});

// Review round 1 (spec-fidelity lens, CONFIRMED against the installed
// mongodb-connection-string-url dist): the driver quotes the RAW uri inside
// MongoParseError messages, so a mistyped --uri used to reach console.error
// with the owner's password in it. scrubUri() is the fix; these pins keep it.
test("scrubUri: the full connection URI is replaced wherever it appears, and a credential fragment is swallowed to its LAST @ (a password containing @ is never half-printed)", () => {
  const uri = "mongodb+srv://owner:p@ss@word@cluster0.example.net/pos?retryWrites=true";
  const driverMessage = `Invalid connection string "${uri}"`;
  const scrubbed = scrubUri(driverMessage, uri);
  assert.equal(scrubbed.includes(uri), false, "the full uri must be gone");
  assert.equal(scrubbed.includes("p@ss@word"), false, "no password fragment may survive");
  assert.match(scrubbed, /Invalid connection string "<uri>"/, "the rest of the message is kept so the owner still sees WHAT failed");

  const fragmentOnly = "Protocol and host list are required in mongodb://user:secret@host:27017/db";
  const scrubbedFragment = scrubUri(fragmentOnly, "mongodb://something-else/x");
  assert.equal(scrubbedFragment.includes("secret"), false, "a credential fragment that is NOT the parsed uri is still scrubbed");
  assert.match(scrubbedFragment, /mongodb:\/\/<credentials>@host:27017\/db/);

  // Fix-round review: the driver quotes the BARE username (no // or @ around
  // it) when the username carries an unescaped character, so the uri's own
  // userinfo tokens must be scrubbed too — raw and percent-decoded.
  const badUserUri = "mongodb://ad?min:s%40cret@127.0.0.1:27017/pos";
  const usernameMessage = "Username contains unescaped characters ad?min";
  const scrubbedUsername = scrubUri(usernameMessage, badUserUri);
  assert.equal(scrubbedUsername.includes("ad?min"), false, "the bare username must not survive");
  assert.match(scrubbedUsername, /Username contains unescaped characters <credentials>/);
  const passwordMessage = "something quoted s%40cret and decoded s@cret";
  const scrubbedPassword = scrubUri(passwordMessage, badUserUri);
  assert.equal(scrubbedPassword.includes("s%40cret"), false, "the raw password token must not survive");
  assert.equal(scrubbedPassword.includes("s@cret"), false, "the percent-decoded password must not survive either");
  const noUserinfo = scrubUri("Username contains unescaped characters ad?min", "mongodb://127.0.0.1:27017/pos");
  assert.equal(noUserinfo, "Username contains unescaped characters ad?min", "a uri without userinfo contributes no tokens (nothing to scrub, nothing over-scrubbed)");

  const plain = "Connection has no db handle";
  assert.equal(scrubUri(plain, uri), plain, "a message without the uri or credentials is returned unchanged");
  // NOTE: "no-op" here means only for a message carrying NO credential
  // fragment. With an empty uri the CREDENTIAL_FRAGMENT rule still runs — see
  // the C11 pin below, which depends on exactly that.
  assert.equal(scrubUri(plain, ""), plain, "an empty uri (error before the args parsed) is a no-op, never a split on empty string");
});

// C11: the parse refusal prints a raw argv token, and a connection string
// typed WITHOUT its `--uri` marker lands in argv verbatim ("Unknown flag:
// mongodb+srv://user:pass@..."). At that point no uri has been parsed, so the
// scrub runs with "" — the credential fragment is still stripped.
test("PIN: C11 — an empty-uri scrub still strips credentials from a refusal, while keeping the refusal diagnosable", () => {
  const leaked = "Unknown flag: mongodb+srv://pos_user:S3cr3tPw@cluster0.abcde.mongodb.net/pos";
  const safe = scrubUri(leaked, "");
  assert.equal(safe.includes("S3cr3tPw"), false, "a URI typed without --uri must never echo its password");
  assert.equal(safe.includes("pos_user"), false, "nor its username");
  assert.match(safe, /Unknown flag:/, "the operator must still see WHAT was rejected");
  assert.match(safe, /cluster0\.abcde\.mongodb\.net/, "host and db survive so the refusal stays diagnosable");
});

test("PIN: C11 — the parse refusal scrubs before printing (RAW source, negative + positive landmarks)", () => {
  const src = readSrc(ENTRY);
  // NEGATIVE: the unscrubbed print must be gone. Needle built by
  // concatenation so this line cannot match itself.
  const rawPrint = "console.error(" + "parsed.error)";
  assert.equal(src.includes(rawPrint), false, "the parse refusal must not print raw argv — a misplaced --uri echoes the credentialed URI");
  // POSITIVE landmarks so the negative cannot pass vacuously on a gutted or
  // renamed file.
  assert.ok(src.includes("scrubUri(parsed.error"), "positive: the parse refusal must scrub before printing");
  assert.ok(src.includes("parseMigrateArgs(process.argv.slice(2)"), "positive landmark: the parse call site must still exist");
});

test("PIN: migrate-links.ts wraps createConnection in try/catch and scrubs BOTH error paths — the caught connect error and the top-level handler (RAW source; landmarks: createConnection(, main().catch)", () => {
  const src = readSrc(ENTRY);
  const tryIdx = src.indexOf("try {");
  const connectIdx = src.indexOf("createConnection(");
  const catchIdx = src.indexOf("} catch (error)");
  assert.ok(tryIdx >= 0 && connectIdx >= 0 && catchIdx >= 0, "positive landmarks: try {, createConnection(, } catch (error) must all exist");
  assert.ok(tryIdx < connectIdx && connectIdx < catchIdx, "createConnection( must sit inside the try/catch");
  const scrubCalls = src.match(/scrubUri\(/g) ?? [];
  assert.ok(scrubCalls.length >= 2, "both the connect catch and the top-level handler must scrub (at least two scrubUri( calls)");
  const topLevel = src.slice(src.indexOf("main().catch"));
  assert.match(topLevel, /scrubUri\(/, "the top-level handler must scrub before console.error");
  const rawPrint = "console.error(error" + " instanceof Error ? error.message";
  assert.equal(src.includes(rawPrint), false, "no unscrubbed console.error(error.message) may remain");
});

test("PIN: censusDuePayments orphan-checks EVERY canonical customerId — no string-only type gate (RAW source, negative) — paired with the positive landmark parents.customerIds.has(canonical)", () => {
  const src = readSrc(`${SCRIPT_DIR}/census-refs.ts`);
  const start = src.indexOf("export async function censusDuePayments");
  assert.ok(start >= 0, "positive landmark: censusDuePayments must exist");
  const next = src.indexOf("export async function", start + 1);
  const body = src.slice(start, next > 0 ? next : src.length);
  assert.match(body, /parents\.customerIds\.has\(canonical\)/, "positive landmark: the orphan lookup against the canonical hex");
  const gate = "if (canonical && typeof doc.customerId" + " === \"string\")";
  assert.equal(body.includes(gate), false, "an ObjectId-typed customerId (the post-apply shape) must be orphan-checked too — the orders census never had this gate");
});
