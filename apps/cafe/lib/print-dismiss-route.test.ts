import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PRINT_ACK_UNREACHABLE, PRINT_ATTENTION_LIMIT, type PrintAckData } from "@pos/shared/print-agent-wire";
import { stripComments } from "@/lib/source-pin-utils";
import { createAckFlusher } from "@/lib/print-agent-acks";
import type { PendingPrintAck } from "@/lib/print-agent-types";
import { PRINT_LIFECYCLE_SELECT, printJobCasFilter } from "@/lib/print-lease";
import { ackSkipsUnreachableWriter, dismissPrintJobsBodySchema } from "@/lib/print-dismiss";

// Printer UX PX-2 Task 2 (spec 2026-11-05 §6.9 B1/B2, §8, R2, R7, R15, SR-8, SR-10): a staff Clear that lands while a
// slip prints, and Clear all. Schema and source checks here; the DB paths are proven live (npm run verify:print:live,
// legs cw1–cw9). Every source pin pairs its absence checks with a positive landmark, so a blinded file cannot pass.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CAFE = path.join(REPO_ROOT, "apps/cafe");
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const relOf = (abs: string): string => path.relative(REPO_ROOT, abs).split(path.sep).join("/");
const SINGLE = "apps/cafe/app/api/print-jobs/[id]/dismiss/route.ts";
const BULK = "apps/cafe/app/api/print-jobs/dismiss/route.ts";
const DISMISS = "apps/cafe/lib/print-dismiss.ts";

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** The production files (app, lib, hooks, components; no tests) whose code names `needle`. */
function filesNaming(needle: string, dirs: readonly string[] = ["app", "lib", "hooks", "components"]): string[] {
  const files = dirs.flatMap((dir) => sourceFiles(path.join(CAFE, dir)));
  assert.ok(files.length > 100, `vision guard: the walk read the tree (${files.length} files)`);
  return files.filter((file) => stripComments(readFileSync(file, "utf8")).includes(needle)).map(relOf).sort();
}

/** The object literal that opens at the first "{" after `from`, up to its matching brace (comments already stripped). */
function objectAt(text: string, from: number): string {
  assert.ok(from >= 0, "the call to slice from is in the source");
  const open = text.indexOf("{", from);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}" && --depth === 0) return text.slice(open, i + 1);
  }
  throw new assert.AssertionError({ message: "unbalanced braces after the call" });
}

const idsOf = (n: number): string[] => Array.from({ length: n }, (_, i) => `65f0000000000000000000${String(i).padStart(2, "0")}`);

test("the body takes 1–20 ids and the staff reason only", () => {
  const ok = (body: unknown): boolean => dismissPrintJobsBodySchema.safeParse(body).success;
  assert.equal(PRINT_ATTENTION_LIMIT, 20, "the waiting-slips feed shows at most 20 rows (R15)");
  assert.equal(ok({ ids: idsOf(20), reason: "staff" }), true, "20 ids: one Clear all for every row the feed shows");
  assert.equal(ok({ ids: idsOf(1), reason: "staff" }), true, "one id");
  assert.equal(ok({ ids: [], reason: "staff" }), false, "no id is refused");
  assert.equal(ok({ ids: idsOf(21), reason: "staff" }), false, "21 ids: more than the feed shows is refused");
  assert.equal(ok({ ids: idsOf(2) }), false, "a missing reason is refused");
  assert.equal(ok({ ids: idsOf(2), reason: "order-cancelled" }), false, "a server-stamped reason is never a client's");
  assert.equal(ok({ ids: idsOf(2), reason: "staff", force: true }), false, "an unknown key is refused (strict)");
});

test("only the staff routes take a leased slip", () => {
  assert.deepEqual(filesNaming("dismissPrintJobByStaff("), [SINGLE, DISMISS].sort(), "the single staff Clear only");
  assert.deepEqual(filesNaming("dismissPrintJobs("), [BULK, DISMISS].sort(), "Clear all only");
  assert.deepEqual(filesNaming("requestDismissWhilePrinting("), [DISMISS], "the leased CAS lives behind the two staff calls");
  assert.deepEqual(filesNaming("dismissRequestedAt: new Date("), [DISMISS], "nothing else writes the request");
  // R2 / F-M4: dismissPrintJob (and so its eight server callers) never takes a leased slip. Its comment says
  // "leased", so only the stripped filter object is read.
  const queue = src("apps/cafe/lib/print-queue.ts");
  const single = queue.slice(queue.indexOf("export async function dismissPrintJob("), queue.indexOf("export async function dismissQueuedPrintJobsForClearedHost("));
  const filter = objectAt(single, single.indexOf("PrintJob.findOneAndUpdate("));
  assert.ok(filter.includes('status: { $in: ["queued", "needs-confirm", "failed"] }'), "landmark: the sliced filter is today's");
  assert.ok(filter.includes("claimedAt: { $exists: false }"), "landmark: the claim guard is in the slice");
  assert.ok(!filter.includes('"leased"'), "dismissPrintJob's filter never names a leased slip");
});

test("a second Clear on a requested slip also answers dismissed", () => {
  const s = src(DISMISS);
  const ask = s.slice(s.indexOf("export async function requestDismissWhilePrinting("), s.indexOf("export async function dismissPrintJobByStaff("));
  const filter = objectAt(ask, ask.indexOf("PrintJob.updateOne("));
  assert.ok(filter.includes('status: "leased"') && filter.includes("claimedAt: { $exists: false }"), "landmark: B1's leased CAS, never a claimed job");
  assert.equal(filter.split("$exists").length - 1, 1, "its one $exists term is claimedAt's: no term on the request itself (F-M3)");
  assert.ok(ask.includes("return res.matchedCount === 1;"), "a match answers, even when the request was already set");
  const staff = s.slice(s.indexOf("export async function dismissPrintJobByStaff("));
  assert.ok(staff.includes("if (await requestDismissWhilePrinting(input)) return { dismissed: true };"), "the request answers dismissed: the client type is unchanged");
});

test("every select that feeds applyPrintJobPlan reads the request", () => {
  const callers = filesNaming("applyPrintJobPlan(", ["app", "lib"]).filter((rel) => rel !== "apps/cafe/lib/print-lease.ts");
  const expected = ["apps/cafe/lib/print-job-actions.ts", "apps/cafe/lib/print-offline-replay.ts", "apps/cafe/lib/print-sweep.ts"];
  assert.deepEqual(callers, expected, "a new caller of the CAS must read the request too (SR-10), so it is added here on purpose");
  for (const rel of [...expected, "apps/cafe/lib/print-lease.ts"]) {
    const selects = src(rel).match(/\.select\([^)]*\)/g) ?? [];
    const reads = selects.some((sel) => sel.includes("PRINT_LIFECYCLE_SELECT") || (sel.includes("dismissRequestedAt") && sel.includes("dismissRequestedBy")));
    assert.ok(reads, `${rel}: its lifecycle read selects PRINT_LIFECYCLE_SELECT or both request fields (${selects.join(" | ")})`);
  }
  assert.match(src("apps/cafe/lib/print-lease.ts"), /const LEASE_SELECT = `\$\{PRINT_LIFECYCLE_SELECT\} /, "the lease's own read is built on it");
  const replay = src("apps/cafe/lib/print-offline-replay.ts");
  assert.ok(/\.select\("[^"]*dismissRequestedAt dismissRequestedBy[^"]*"\)/.test(replay), "R7: the offline replay's own select reads both fields");
});

test("the route answers no-store and needs a session", () => {
  const s = src(BULK);
  assert.ok(s.includes('export const dynamic = "force-dynamic";'), "never cached by Next");
  const post = s.slice(s.indexOf("export async function POST("));
  const [auth, body, db] = [post.indexOf("await requireAuth()"), post.indexOf("validateBody(req, dismissPrintJobsBodySchema)"), post.indexOf("await connectDB()")];
  assert.ok(auth >= 0 && auth < body && body < db, "a session before the body is read, the body before the database");
  const returns = post.match(/\breturn\b[^;]*;/g) ?? [];
  assert.ok(returns.length >= 5, `landmark: every way out is read (${returns.length})`);
  for (const r of returns) assert.ok(r.startsWith("return noStore("), `${r}: every answer is no-store`);
  assert.ok(post.includes("mongoose.isValidObjectId(id)") && post.includes('failure("Print job not found", 400)'), "every id is checked before the database");
  assert.ok(post.includes("const dismissedBy = authed.session.user.name ?? "), "who cleared comes from the session, never the body");
  assert.ok(post.includes("await dismissPrintJobs({ ids: parsed.data.ids, dismissedBy, nowMs: Date.now() })"), "one call for the whole list");
  assert.ok(post.includes("success({ dismissed })"), "the answer: how many left the list");
  const one = src(SINGLE);
  assert.ok(one.includes("await dismissPrintJobByStaff({ id, dismissedBy, nowMs: Date.now() })"), "the single Clear takes a slip that is printing too");
  assert.ok(!one.includes("dismissPrintJob("), "the single route no longer calls today's dismiss itself");
});

test("the CAS filter carries the clear request", () => {
  const plain = printJobCasFilter("x", { status: "leased", epoch: 3 });
  assert.deepEqual(plain.dismissRequestedAt, { $exists: false }, "a plan read without the request misses once a Clear is written (SR-10)");
  const asked = printJobCasFilter("x", { status: "leased", epoch: 3, dismissRequest: { at: new Date(0), by: "Asha" } });
  assert.deepEqual(asked.dismissRequestedAt, { $exists: true }, "a plan read with the request lands only while it is there");
});

test("the lifecycle select reads the request", () => {
  const fields = PRINT_LIFECYCLE_SELECT.split(" ");
  assert.ok(fields.includes("dismissRequestedAt") && fields.includes("dismissRequestedBy"), `both fields in "${PRINT_LIFECYCLE_SELECT}"`);
});

// Controller Ruling E: the failover signal is never lost. An unreachable refusal skips its writer for the network
// printer when it put the slip back in line (today) or when it ended a slip a staff Clear waited on; a permanent one
// never skips (as today).
test("an unreachable refusal still skips its writer when a Clear ended the slip; a permanent one never does", () => {
  const asked = { dismissRequest: { at: new Date(0), by: "Asha" } };
  const ack = { reason: PRINT_ACK_UNREACHABLE, sent: "no" as const };
  assert.equal(ackSkipsUnreachableWriter(ack, {}, "queued"), true, "today: back in line, the writer is skipped");
  assert.equal(ackSkipsUnreachableWriter(ack, asked, "dismissed"), true, "the Clear ended it: the writer is still skipped");
  assert.equal(ackSkipsUnreachableWriter({ ...ack, permanent: true }, asked, "dismissed"), false, "a permanent refusal records nothing, as today");
  assert.equal(ackSkipsUnreachableWriter({ ...ack, sent: "maybe" }, {}, "queued"), false, "bytes may have gone: not unreachable");
  assert.equal(ackSkipsUnreachableWriter({ sent: "no" }, asked, "dismissed"), false, "no unreachable reason: no skip");
  assert.equal(ackSkipsUnreachableWriter(ack, {}, "dismissed"), false, "dismissed without a request never comes from this ack");
  assert.equal(ackSkipsUnreachableWriter(ack, asked, "failed"), false, "any other end: no skip, as today");
});

// SR-8 (spec §8): an open old page's agent ends its tries on the new answer. Its kept failed ack is answered
// { applied: true, status: "dismissed", nextAttemptAt: null }; it re-leases only on a non-null nextAttemptAt.
test("an open old page's agent ends its tries on a dismissed answer: it re-leases only on a non-null nextAttemptAt", async () => {
  async function flushWith(answer: PrintAckData): Promise<{ requeued: number[]; pending: PendingPrintAck[] }> {
    let pending: PendingPrintAck[] = [{ id: "j1", epoch: 1, at: 1_000, fail: { deviceId: "dev", epoch: 1, outcome: "failed", sent: "no" } }];
    const requeued: number[] = [];
    const deps = {
      deviceId: "dev",
      ack: async (): Promise<PrintAckData> => answer,
      readPending: () => pending,
      writePending: (entries: PendingPrintAck[]) => void (pending = entries),
      now: () => 1_000,
      setTimer: () => 0,
      clearTimer: () => undefined,
    };
    await createAckFlusher(deps, { stopped: () => false, answered: () => undefined, requeued: (at) => void requeued.push(at) }).flush();
    return { requeued, pending };
  }
  const cleared = await flushWith({ applied: true, status: "dismissed", nextAttemptAt: null, more: false });
  assert.deepEqual(cleared.requeued, [], "a dismissed answer never re-leases the job");
  assert.deepEqual(cleared.pending, [], "and the kept ack is answered: forgotten");
  const back = await flushWith({ applied: true, status: "queued", nextAttemptAt: new Date(5_000).toISOString() });
  assert.deepEqual(back.requeued, [5_000], "control: a job back in line is leased at its nextAttemptAt");
});
