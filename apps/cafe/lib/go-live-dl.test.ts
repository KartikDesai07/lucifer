// CB-DL-1 S5.8 — the GO-LIVE checklist's DL rehearsal section.
//
// A runbook has no build step to catch rot (auto-memory `pin-operator-docs-to-
// source`), so the operator-facing facts in this section are pinned: the exact
// command the owner types, the report file name, every --apply gate, the
// 60-minute backup window, the mongodump line HARVESTED from the nightly
// workflow (so a change to the CI command reddens the doc), the tools
// prerequisite, and the scratch-DB prefix the rehearsal restores into.
//
// Every pin is scoped to this section's OWN heading slice and normalised
// (auto-memory `doc-pins-need-section-scope-and-norm`): a whole-doc
// includes() would happily match the same sentence somewhere else in a
// 900-line document and pass while this section was empty.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { MASTERS_BLOB_MAX_AGE_MS } from "@/lib/bootstrap-contract";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DOC_PATH = path.join(REPO_ROOT, "docs/GO-LIVE-CHECKLIST.md");
const doc = readFileSync(DOC_PATH, "utf8");
const WORKFLOW_PATH = path.join(REPO_ROOT, ".github/workflows/db-backup.yml");
const workflow = readFileSync(WORKFLOW_PATH, "utf8");

// Collapse whitespace runs to one space — containment checks must survive the
// doc's prose being reflowed. Copied (not imported) from
// lib/go-live-runbook.test.ts: that file does not export its helpers, and this
// section's pins must not depend on edits to a 700-line neighbour.
function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// One heading's own slice of the doc: from the heading text to the next
// heading of level 1-3 or a `---` rule, whichever comes first.
function sectionSlice(heading: string): string {
  const start = doc.indexOf(heading);
  assert.ok(start >= 0, `could not find the heading "${heading}" in docs/GO-LIVE-CHECKLIST.md`);
  const rest = doc.slice(start + heading.length);
  const nextHeadingMatch = rest.match(/\n(#{1,3}\s|---)/);
  const end = nextHeadingMatch ? start + heading.length + (nextHeadingMatch.index ?? 0) : doc.length;
  return doc.slice(start, end);
}

const DL_HEADING = "### DL rehearsal: master-data bootstrap + link migration dry run";
const SECTION_TEN_HEADING = "## §10";

test("PIN: the DL rehearsal section exists, is non-trivial, and is bounded BEFORE §10 (so every pin below reads this section and not the handover pack)", () => {
  const start = doc.indexOf(DL_HEADING);
  assert.ok(start >= 0, `docs/GO-LIVE-CHECKLIST.md must carry the section "${DL_HEADING}"`);
  assert.equal(
    doc.indexOf(DL_HEADING, start + 1),
    -1,
    "the DL rehearsal heading must appear exactly once — two copies would make sectionSlice read whichever came first",
  );

  const section = sectionSlice(DL_HEADING);
  assert.ok(section.length > 800, `the section must carry the real rehearsal instructions, got only ${section.length} bytes`);

  const tenIdx = doc.indexOf(SECTION_TEN_HEADING);
  assert.ok(tenIdx > start, `${SECTION_TEN_HEADING} must come after the DL section (it is placed inside §9)`);
  assert.ok(
    start + section.length <= tenIdx,
    "the DL section's slice must end before §10 begins — otherwise these pins could pass against §10's text",
  );

  // The slice terminator: this section is followed by a `---` rule, so the
  // slice itself must contain none (a stray rule inside would silently cut
  // every pin below off from the second half of the section).
  const body = section.slice(DL_HEADING.length);
  assert.ok(
    !body.includes("---"),
    "the DL section must contain no `---` rule of its own — sectionSlice stops at one, which would truncate this section mid-way and make the pins below vacuous",
  );
});

test("PIN: the DL section states the exact dry-run command, the report file name, and that the run is read-only and never prints the URI", () => {
  const section = norm(sectionSlice(DL_HEADING));

  assert.ok(
    section.includes("npm run migrate:links -- --dry-run --uri"),
    "the section must carry the exact command the owner types, including the `--` separator npm needs to pass flags through",
  );
  assert.ok(
    section.includes("migrate-links-report-"),
    "the section must name the report file prefix so the owner knows what file to look for (and what not to commit)",
  );
  assert.match(section, /read-only/i, "the section must say the dry run is read-only — that is why it is safe against the live database");
  assert.match(section, /URI[^.]{0,60}never printed|never printed/i, "the section must state that the URI is never printed (it carries credentials)");
});

test("PIN: the DL section states every --apply gate in the operator's words — --backup, --confirm, and the 60-minute freshness window", () => {
  const section = norm(sectionSlice(DL_HEADING));

  assert.ok(section.includes("--apply"), "the section must name --apply");
  assert.ok(
    section.includes("--backup"),
    "the section must name the --backup flag itself (both spellings: --backup <archive> and --backup auto), not only describe 'a fresh backup file' in prose — parseMigrateArgs refuses --apply with a message quoting that flag name",
  );
  assert.ok(section.includes("--confirm"), "the section must name --confirm, the db-name echo gate");
  assert.ok(
    section.includes("60 minutes"),
    "the section must state the 60-minute backup freshness window — the same figure the parser enforces as BACKUP_MAX_AGE_MS",
  );
});

// CB-DL-2 (rationale): the apply pipeline is now built, so the "refused in
// this build"/"not in this build" pins (CB-DL-1) are REPLACED by pins on the
// real --reset/--create-missing-categories/--drop-legacy-category surface,
// the rehearsal's nsFrom/nsTo rename, the exit-code table, the rehearsal-only
// stand-in backup note, and the owner-confirms-the-reset-list note.
test("PIN: the DL section names --reset and every collection in the literal default list", () => {
  const section = norm(sectionSlice(DL_HEADING));

  assert.ok(section.includes("--reset"), "positive landmark: the section must name --reset");
  for (const name of ["orders", "duepayments", "orderrequests", "promoredemptions", "printjobs", "counters", "customers"]) {
    assert.ok(section.includes(name), `the section must list the default --reset collection "${name}" by name`);
  }
});

test("PIN: the DL section names --create-missing-categories and --drop-legacy-category", () => {
  const section = norm(sectionSlice(DL_HEADING));

  assert.ok(section.includes("--create-missing-categories"), "the section must name --create-missing-categories");
  assert.ok(section.includes("--drop-legacy-category"), "the section must name --drop-legacy-category");
});

test("PIN: the DL section documents the rehearsal's mongorestore rename into pos_scratch_migrate via --nsFrom/--nsTo", () => {
  const section = norm(sectionSlice(DL_HEADING));

  assert.ok(section.includes("--nsFrom"), "positive landmark: the section must name --nsFrom");
  assert.ok(section.includes("--nsTo"), "positive landmark: the section must name --nsTo");
  assert.ok(
    section.includes("pos_scratch_migrate"),
    "the section must name the pos_scratch_migrate database the rehearsal restore renames into",
  );
});

test("PIN: the DL section documents exit codes 0, 1 and 3 near the word exit", () => {
  const section = norm(sectionSlice(DL_HEADING));

  // Anchor on the "Exit codes:" LABEL specifically (not any earlier "exit
  // code N" mention in prose) — the doc states all three codes as one run
  // right after this label, so "near" is scoped to that one block.
  const exitLabelIdx = section.search(/\*?\*?Exit codes:?\*?\*?/);
  assert.ok(exitLabelIdx >= 0, "positive landmark: the section must carry an 'Exit codes' label");
  const exitBlock = section.slice(exitLabelIdx, exitLabelIdx + 1200);
  for (const code of ["0", "1", "3"]) {
    assert.match(
      exitBlock,
      new RegExp("`?" + code + "`?\\s*="),
      `exit code ${code} must be documented in the "Exit codes" block, got: ${exitBlock}`,
    );
  }
});

test("PIN: the DL section states the stand-in backup file used by the automated rehearsal leg is rehearsal-only", () => {
  const section = norm(sectionSlice(DL_HEADING));

  assert.match(
    section,
    /rehearsal-only/i,
    "the section must say the stand-in --backup file (used by verify:migrate:live) is rehearsal-only — never a substitute for a real mongodump on the live database",
  );
});

test("PIN: the DL section carries the owner-confirms-the-reset-list note tying customers to dues history", () => {
  const section = norm(sectionSlice(DL_HEADING));

  assert.match(
    section,
    /customers[^.]{0,120}dues|dues[^.]{0,120}customers/i,
    "the section must warn, near the word customers and the word dues, that resetting customers removes dues history",
  );
});

test("PIN: the DL section no longer says the apply pipeline is 'in this build' anywhere (negative, paired with the positive landmark --apply)", () => {
  const section = norm(sectionSlice(DL_HEADING));

  assert.ok(section.includes("--apply"), "positive landmark: the section must still name --apply (proves the section was actually read)");
  const bannedPhrase = "in this " + "build";
  assert.equal(
    section.includes(bannedPhrase),
    false,
    "the section must not say the apply pipeline is 'in this build' anywhere any more — CB-DL-2 built it",
  );
});

test("PARITY: the mongodump line in the DL section is the SAME command the nightly db-backup workflow runs (harvested from .github/workflows/db-backup.yml)", () => {
  // Harvest the workflow's own mongodump invocation. It is split across two
  // YAML lines with a trailing `\` continuation, so the continuation is
  // dropped and the two halves are joined the way a shell would see them.
  const lines = workflow.split("\n");
  const idx = lines.findIndex((l) => l.includes("mongodump --uri="));
  assert.ok(idx >= 0, "positive landmark: .github/workflows/db-backup.yml must still carry a `mongodump --uri=` line");

  let harvested = lines[idx].trim();
  let cursor = idx;
  while (harvested.endsWith("\\")) {
    harvested = harvested.slice(0, -1).trim();
    cursor += 1;
    assert.ok(cursor < lines.length, "the workflow's mongodump continuation ran off the end of the file");
    harvested = `${harvested} ${lines[cursor].trim()}`;
  }
  harvested = norm(harvested);

  // Sanity-check the harvest itself before pinning the doc against it — an
  // empty or truncated harvest would make the containment assert vacuous.
  assert.ok(harvested.startsWith("mongodump --uri="), `the harvested command must start with mongodump --uri=, got ${harvested}`);
  for (const flag of ["--gzip", "--archive=", "--readPreference=secondaryPreferred", "--quiet"]) {
    assert.ok(harvested.includes(flag), `the harvested workflow command must carry ${flag}, got ${harvested}`);
  }

  const section = norm(sectionSlice(DL_HEADING));
  assert.ok(
    section.includes(harvested),
    `the DL section must quote the nightly workflow's mongodump command verbatim so a change to CI reddens the runbook.\n  workflow: ${harvested}`,
  );
});

test("PIN: the DL section names the MongoDB Database Tools prerequisite and the pos_scratch_ prefix the rehearsal restores into", () => {
  const section = norm(sectionSlice(DL_HEADING));

  assert.ok(
    section.includes("MongoDB Database Tools"),
    "the section must name MongoDB Database Tools — measured: this dev machine has only mongod, so the rehearsal machine needs them installed",
  );
  assert.match(section, /mongodump/, "the prerequisite must name mongodump, the binary the backup gate looks for");
  assert.ok(
    section.includes("pos_scratch_"),
    "the section must name the pos_scratch_ prefix — the live legs refuse any database that does not carry it, so the rehearsal restore must land there",
  );
  assert.match(section, /DL-3|DL-2/, "the section must say where the real apply pipeline lands, so nobody waits for it in this build");
});

// Contract change (owner directive 2026-09-09/11, "use local store properly"):
// the DL section's opening paragraph was rewritten to describe the device
// store (localStorage), the 24h age figure, that staff is never stored on
// the device, and the two moments the copy is cleared. Section-scoped and
// norm()'d, same as every other pin in this file.
test("PIN: the DL section names the device scope (on the device / local storage), the 24-hour figure derived from MASTERS_BLOB_MAX_AGE_MS, that staff is never stored on the device, and the two clear moments (sign-out, sign-in page)", () => {
  const section = norm(sectionSlice(DL_HEADING));

  assert.equal(
    MASTERS_BLOB_MAX_AGE_MS,
    24 * 60 * 60 * 1000,
    "precondition: MASTERS_BLOB_MAX_AGE_MS must actually be 24 hours for the '24 hours' pin below to mean anything",
  );

  assert.match(section, /on the device/i, "the section must say the copy is kept ON THE DEVICE, not merely 'in the tab'");
  assert.match(section, /local storage/i, "the section must name the storage mechanism as local storage (the browser's persistent per-origin store)");
  assert.ok(section.includes("24 hours"), "the section must state the 24-hour figure in the operator's words");

  assert.match(
    section,
    /staff list is never stored on the device/i,
    "the section must state plainly that the staff list is never stored on the device — it stays in memory for that tab only",
  );

  assert.match(
    section,
    /cleared on sign-out/i,
    "the section must name sign-out as one of the two moments the stored copy is cleared",
  );
  assert.match(
    section,
    /sign-in page opens/i,
    "the section must name the sign-in page opening as the other moment the stored copy is cleared — so the next person on a shared device starts fresh",
  );
});

// ══════════════════════════════════════════════════════════════════════════
// C3 (arbiter-confirmed) — the --backup auto archive is a FULL mongodump of
// the live database (customer names, mobiles, orders, dues) and was covered
// by neither ignore file. The owner-approved fix moves the default path to
// the OS temp dir (a sibling agent's change to migrate-links.ts, NOT pinned
// here) AND adds both ignore files as defence-in-depth — pinned below.
// ══════════════════════════════════════════════════════════════════════════

const GITIGNORE_PATH = path.join(REPO_ROOT, ".gitignore");
const VERCELIGNORE_PATH = path.join(REPO_ROOT, ".vercelignore");
const gitignore = readFileSync(GITIGNORE_PATH, "utf8");
const vercelignore = readFileSync(VERCELIGNORE_PATH, "utf8");

// Same formula scripts/migrate-links.ts's autoBackup() uses to name the
// archive: `migrate-links-backup-${dbName}-${stamp}.archive.gz`, where stamp
// is an ISO timestamp with `:`/`.` swapped for `-`. A sample built from that
// SAME shape, not a hand-typed guess, is what gets matched against each
// ignore file's own pattern below.
function sampleBackupArchiveName(): string {
  const dbName = "pos";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `migrate-links-backup-${dbName}-${stamp}.archive.gz`;
}

// Minimal gitignore/vercelignore glob -> RegExp: both tools treat an
// unanchored pattern (no leading/embedded "/") as matching the BASENAME
// anywhere in the tree, and "*" as "any run of non-slash characters" — which
// is exactly the shape `migrate-links-backup-*.archive.gz` needs.
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}

function firstMatchingPattern(ignoreFileText: string, sampleName: string): string | undefined {
  return ignoreFileText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .find((pattern) => globToRegExp(pattern).test(sampleName));
}

test("PIN: .gitignore carries a pattern matching the --backup auto archive's basename formula (migrate-links-backup-<db>-<stamp>.archive.gz), AND the existing report rule still matches a sample report path", () => {
  const sample = sampleBackupArchiveName();
  const matched = firstMatchingPattern(gitignore, sample);
  assert.ok(
    matched,
    `.gitignore must carry a pattern matching "${sample}" (the live archive basename formula) — a mongodump of the live database must never be committable`,
  );

  // Positive landmark: the pre-existing report rule is untouched and still
  // matches a same-shaped report filename — proves this isn't a case where
  // the whole ignore block was replaced rather than added to.
  const sampleReport = "migrate-links-report-pos-2026-09-12T10-00-00-000Z.json";
  const reportMatched = firstMatchingPattern(gitignore, sampleReport);
  assert.ok(reportMatched, `.gitignore must still match "${sampleReport}" via its existing report rule`);
});

test("PIN: .vercelignore ALSO carries a pattern matching the --backup auto archive's basename formula — required because the Vercel CLI upload honours .vercelignore, not .gitignore", () => {
  const sample = sampleBackupArchiveName();
  const matched = firstMatchingPattern(vercelignore, sample);
  assert.ok(
    matched,
    `.vercelignore must carry a pattern matching "${sample}" — .gitignore alone does not stop the Vercel CLI from uploading this file`,
  );

  // Positive landmark: the report rule was added to .vercelignore too (it
  // was previously covered by .gitignore only, same upload-path gap).
  const sampleReport = "migrate-links-report-pos-2026-09-12T10-00-00-000Z.json";
  const reportMatched = firstMatchingPattern(vercelignore, sampleReport);
  assert.ok(reportMatched, `.vercelignore must also match "${sampleReport}" via a report rule`);
});

test("PIN: cb-dl2-decisions.md D-C's archive-path clause names the OS temp directory, not <cwd>, and says the path is printed", () => {
  const decisionsPath = path.join(REPO_ROOT, ".claude/plan/v2/_research/cb-dl2-decisions.md");
  const decisions = readFileSync(decisionsPath, "utf8");
  const dcHeadingIdx = decisions.indexOf("## D-C");
  assert.ok(dcHeadingIdx >= 0, "positive landmark: the D-C heading must still exist");
  const nextHeadingIdx = decisions.indexOf("\n## ", dcHeadingIdx + 1);
  const dcSection = decisions.slice(dcHeadingIdx, nextHeadingIdx > 0 ? nextHeadingIdx : undefined);

  assert.ok(
    dcSection.includes("--backup auto"),
    "positive landmark: the D-C section must still describe --backup auto",
  );
  assert.match(
    dcSection,
    /OS temp directory/i,
    "the D-C section's archive-path clause must say the archive is written to the OS temp directory",
  );
  assert.ok(
    !/archive=<cwd>\//.test(dcSection),
    "the D-C section must no longer contract the archive path as <cwd>/migrate-links-backup-... — that was the leak this fix closes",
  );
  assert.match(
    dcSection,
    /path[^.]{0,40}printed|printed/i,
    "the D-C section must say the archive's path is printed so the operator knows where to find and move it",
  );
});

// ══════════════════════════════════════════════════════════════════════════
// C1 (arbiter-confirmed) — the live step-2 command must be flag-identical to
// the rehearsal command (the doc calls the rehearsal "the same pipeline the
// live runbook uses"), plus a recovery branch and a LIVE rollback line.
// ══════════════════════════════════════════════════════════════════════════

// Pulls the exact rehearsal/live command LINES (not just "does the flag
// appear somewhere in the section") so the flag-identical claim is checked
// against the real command text, not prose near it.
function commandLine(section: string, marker: string): string {
  const idx = section.indexOf(marker);
  assert.ok(idx >= 0, `expected to find a command line containing "${marker}"`);
  const lineStart = section.lastIndexOf("\n", idx) + 1;
  const lineEnd = section.indexOf("\n", idx);
  return section.slice(lineStart, lineEnd > 0 ? lineEnd : undefined).trim();
}

test("PIN: the live step-2 command carries every category-resolution flag the rehearsal command carries (flag-identical, not merely 'the flag appears somewhere')", () => {
  const section = sectionSlice(DL_HEADING); // NOT norm()'d — command lines matter verbatim

  const rehearsalLine = commandLine(section, "--confirm pos_scratch_migrate");
  const liveLine = commandLine(section, "--confirm pos --reset default");

  assert.match(rehearsalLine, /--create-missing-categories/, "positive landmark: the rehearsal command must carry --create-missing-categories");
  assert.match(
    liveLine,
    /--create-missing-categories/,
    "the LIVE step-2 command must ALSO carry --create-missing-categories — without it, a rehearsal exiting 0 predicts nothing about the live run",
  );

  // Every flag on the rehearsal line (except the ones that legitimately
  // differ: --uri and --confirm name different databases) must also appear
  // on the live line.
  const rehearsalFlags = (rehearsalLine.match(/--[a-z-]+/g) ?? []).filter(
    (f) => f !== "--uri" && f !== "--confirm",
  );
  assert.ok(rehearsalFlags.length >= 3, "sanity: expected several shared flags on the rehearsal line");
  for (const flag of rehearsalFlags) {
    assert.ok(liveLine.includes(flag), `the live step-2 command is missing "${flag}", which the rehearsal command carries`);
  }
});

test("PIN: the live runbook names a recovery branch for a non-zero step 2 (stop, do not deploy, read the report, resolve categories, re-run)", () => {
  const section = norm(sectionSlice(DL_HEADING));

  assert.ok(section.includes("--reset default"), "positive landmark: step 2 of the live runbook must still exist");
  assert.match(section, /non-zero/i, "the live runbook must name the non-zero exit case for step 2");
  assert.match(section, /do not deploy|stop/i, "the recovery branch must say to stop / not deploy on a non-zero step 2");
  assert.match(section, /report/i, "the recovery branch must say to read the report");
  assert.match(section, /category names|resolve/i, "the recovery branch must say to resolve the named category names");
});

test("PIN: the live runbook adds a LIVE rollback line (mongorestore back into the live db), distinct from the scratch-only mongorestore used for rehearsal", () => {
  const section = norm(sectionSlice(DL_HEADING));

  // Positive landmark: the scratch-only mongorestore must still be there.
  assert.ok(
    section.includes('mongorestore --gzip --archive=<file> --nsFrom="pos.*" --nsTo="pos_scratch_migrate.*"'),
    "positive landmark: the rehearsal's scratch-only mongorestore must be unchanged",
  );

  const liveRollbackIdx = section.search(/live rollback/i);
  assert.ok(liveRollbackIdx >= 0, "the live runbook must name a 'live rollback' step");
  const rollbackBlock = section.slice(liveRollbackIdx, liveRollbackIdx + 400);
  assert.match(rollbackBlock, /mongorestore/, "the live rollback step must name mongorestore");
  assert.ok(
    !rollbackBlock.includes("pos_scratch_migrate"),
    "the live rollback's own mongorestore must NOT target pos_scratch_migrate — it restores into the LIVE database",
  );
});

// ══════════════════════════════════════════════════════════════════════════
// C4 (arbiter-confirmed) — exit 1 is refused-OR-FAILED, not always read-only:
// once --apply has started, exit 1 can mean the run failed part-way through
// (back-fill and/or reset may already have run) with no report written.
// ══════════════════════════════════════════════════════════════════════════

test("PIN: the exit-1 gloss no longer claims exit 1 is ALWAYS read-only / nothing-changed, while the exit-1 row itself still exists, names failing part-way, and tells the owner to restore the backup", () => {
  const section = norm(sectionSlice(DL_HEADING));

  // Positive landmark: the exit-1 row itself is still there.
  const exitOneIdx = section.search(/`?1`?\s*=/);
  assert.ok(exitOneIdx >= 0, "positive landmark: the exit-1 row must still exist");
  const exitOneBlock = section.slice(exitOneIdx, exitOneIdx + 700);

  assert.match(exitOneBlock, /part-way/i, "the exit-1 gloss must say the run can FAIL PART-WAY once --apply has started");
  assert.match(exitOneBlock, /no report/i, "the exit-1 gloss must say no report file is written for the failed-part-way case");
  assert.match(
    exitOneBlock,
    /restore the (mongodump|backup)/i,
    "the exit-1 gloss must tell the owner to restore the mongodump/backup from step 1 before re-running or deploying",
  );

  // Negative pin, vision-guarded by the positive landmark above: the doc must
  // no longer claim exit 1 is UNCONDITIONALLY read-only / always safe.
  assert.ok(
    !/always\s+read-only/i.test(exitOneBlock),
    "the exit-1 gloss must not claim exit 1 is ALWAYS read-only any more — once --apply has started, exit 1 can mean a part-way failure",
  );
});

// ══════════════════════════════════════════════════════════════════════════
// C21 (arbiter-confirmed) — the pipeline IS idempotent but the DL section
// never said so, and that fact governs every recovery path above.
// ══════════════════════════════════════════════════════════════════════════

test("PIN: the DL section states every step is idempotent — a fresh mongodump + identical re-run after any interruption, already-migrated products skipped, already-empty resets delete nothing", () => {
  const section = norm(sectionSlice(DL_HEADING));

  assert.match(section, /idempotent/i, "the section must use the word idempotent");
  assert.match(section, /interrupted/i, "the section must name 'interrupted' as the trigger for the re-run advice");
  assert.match(section, /fresh mongodump/i, "the section must say to take a fresh mongodump before re-running");
  assert.match(section, /skipped/i, "the section must say already-migrated products are skipped");
});

// ══════════════════════════════════════════════════════════════════════════
// C23 (arbiter-confirmed) — the exit-3 paragraph must name ALL the conditions
// that make a run non-clean, including a reset collection still holding
// documents afterwards (the closed-shop-window-write signal).
// ══════════════════════════════════════════════════════════════════════════

test("PIN: the exit-3 gloss names every non-clean condition, including a --reset collection still holding documents afterwards", () => {
  const section = norm(sectionSlice(DL_HEADING));

  const exitThreeIdx = section.search(/`?3`?\s*=/);
  assert.ok(exitThreeIdx >= 0, "positive landmark: the exit-3 row must still exist");
  const exitThreeBlock = section.slice(exitThreeIdx, exitThreeIdx + 700);

  assert.match(exitThreeBlock, /skipped/i, "the exit-3 gloss must still name skipped category names");
  assert.match(exitThreeBlock, /drop-legacy-category/i, "the exit-3 gloss must still name a refused --drop-legacy-category");
  assert.match(
    exitThreeBlock,
    /reset[^.]{0,80}(still holds|holds documents|holding documents)/i,
    "the exit-3 gloss must name a --reset collection still holding documents afterwards — the signal that a write landed during the closed-shop window",
  );
  // The two causes the fix round added to `clean` must be documented too, or
  // the owner sees an exit 3 the runbook cannot explain.
  assert.match(
    exitThreeBlock,
    /String-shaped/i,
    "the exit-3 gloss must name a collection still carrying String-shaped link values",
  );
  assert.match(
    exitThreeBlock,
    /sourceRequestIds/,
    "the exit-3 gloss must name the orders.sourceRequestIds type signal — the double-accept fence cannot match non-ObjectId entries",
  );
});

// The C1 refusal is a SAFE exit 1 (nothing deleted, report written). The
// runbook must not sweep it into the blanket "restore the mongodump" advice,
// or an owner recovers from a no-op run with a destructive full restore of a
// live database, inside the closed-shop window.
test("PIN: the exit-1 gloss distinguishes the safe --reset refusal from a part-way failure, and does not tell the owner to restore for the safe one", () => {
  const section = norm(sectionSlice(DL_HEADING));

  const exitOneIdx = section.search(/`?1`?\s*=/);
  assert.ok(exitOneIdx >= 0, "positive landmark: the exit-1 row must still exist");
  const exitOneBlock = section.slice(exitOneIdx, exitOneIdx + 1400);

  // Positive: both halves must be described.
  assert.match(
    exitOneBlock,
    /refused[^.]{0,120}nothing was deleted|nothing was deleted/i,
    "the exit-1 gloss must state that the --reset refusal deleted nothing",
  );
  assert.match(exitOneBlock, /do NOT restore/i, "the gloss must tell the owner NOT to restore for the refusal case");
  assert.match(exitOneBlock, /part-way/i, "the gloss must still describe the unsafe part-way failure");
  assert.match(
    exitOneBlock,
    /report/i,
    "the gloss must name the report file as the way to tell the two exit-1 cases apart",
  );

  // Negative: the old unconditional instruction must be gone — it is the one
  // that would send the owner into a destructive restore after a no-op run.
  const blanket = "If `--apply` exits" + " non-zero, restore the mongodump";
  assert.equal(
    norm(exitOneBlock).includes(norm(blanket)),
    false,
    "the blanket 'any non-zero exit means restore' instruction must be gone — it misdirects the owner after a safe refusal",
  );
});

// ══════════════════════════════════════════════════════════════════════════
// C16 (arbiter-confirmed) — §6's staff-briefing bullet must not promise a
// category-delete cascade that CB-DL-2 replaced with a hard 409 refusal.
// ══════════════════════════════════════════════════════════════════════════

const STAFF_HEADING = "## §6 Staff accounts";

test("PIN: §6's staff-briefing no longer says deleting a category silently re-tags products to Uncategorized (negative, paired with a positive landmark that the section and the corrected rule both still exist)", () => {
  const start = doc.indexOf(STAFF_HEADING);
  assert.ok(start >= 0, `could not find the heading "${STAFF_HEADING}"`);
  const rest = doc.slice(start + STAFF_HEADING.length);
  const nextHeadingMatch = rest.match(/\n(#{1,3}\s|---)/);
  const end = nextHeadingMatch ? start + STAFF_HEADING.length + (nextHeadingMatch.index ?? 0) : doc.length;
  const section = norm(doc.slice(start, end));

  // Positive landmarks first (vision guard): the section must still exist
  // with real content, AND the corrected rule must be present.
  assert.ok(section.length > 500, `§6 must carry real staff-briefing content, got only ${section.length} bytes`);
  assert.match(
    section,
    /category can only be deleted once it has no products/i,
    "§6 must state the corrected rule: a category can only be deleted once it has no products",
  );
  assert.match(section, /admin-only/i, "§6 must say category deletion is admin-only somewhere in the section");

  // Negative pin: the old cascade sentence must be gone.
  assert.ok(
    !/silently re-tags every product/i.test(section),
    "§6 must no longer say deleting a category silently re-tags every product to Uncategorized — CB-DL-2 replaced that cascade with a hard 409 refusal",
  );
});
