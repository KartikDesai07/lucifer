// The cafe node:test chain runner (s63). The file list lives in package.json "testChain" (an array) because npm on
// Windows runs scripts through cmd.exe, whose 8 191-character command-line cap the inline chain outgrew ("The command
// line is too long." — npm test could not start at 272 files). spawnSync with an argument array goes straight to the
// OS process API (no shell, no quoting; a 32 767-character limit on Windows), so the chain keeps its explicit,
// reviewable list. Extra CLI flags pass through: `node scripts/run-test-chain.mjs --test-concurrency=1`.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CAFE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(CAFE_ROOT, "package.json"), "utf8"));
const files = pkg.testChain;

if (!Array.isArray(files) || files.length === 0 || files.some((f) => typeof f !== "string" || f.length === 0)) {
  process.stderr.write('apps/cafe/package.json "testChain" must be a non-empty array of test file paths\n');
  process.exit(1);
}
// The 2F1 review gate: an entry that names no file (a typo, or two paths in one string) would run no test and pass.
const missing = files.filter((f) => !existsSync(path.join(CAFE_ROOT, f)));
if (missing.length > 0) {
  process.stderr.write(`apps/cafe/package.json "testChain" names files that do not exist: ${missing.join(", ")}\n`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...process.argv.slice(2), ...files], {
  cwd: CAFE_ROOT,
  stdio: "inherit",
});
if (result.error) {
  process.stderr.write(`could not start the test runner: ${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
