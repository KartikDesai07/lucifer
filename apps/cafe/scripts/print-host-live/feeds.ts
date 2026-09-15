/**
 * PH-10 Slice F — legs e, j, l: the three feed chains' query-plan shape
 * (amendment (e)), the D1/D2 age split + drain-candidate pick, and the
 * createdAt tie-break ordering (amendment (l)).
 */
import { PrintJob } from "@/models/PrintJob";
import {
  PRINT_JOB_PULSE_LIMIT,
  PRINT_JOB_STALE_LIMIT,
  PRINT_JOB_RESOLVED_LIMIT,
  PRINT_HOST_MAX_AGE_MS,
  printJobDrainCandidate,
} from "@pos/shared/print-job";
import { readPrintJobFeeds } from "@/lib/print-queue-feeds";
import { drainAgeCutoff, resolvedPruneCutoff } from "@/lib/print-queue";
import { check, backdatePrintJob, resetCollections } from "./harness";

// ── explain() plan shapes, both classic and SBE ─────────────────────────────
interface WinningPlanNode {
  stage?: string;
  keyPattern?: Record<string, number>;
  inputStage?: WinningPlanNode;
  inputStages?: WinningPlanNode[];
  queryPlan?: WinningPlanNode; // SBE shape nests the classic tree one level deeper
}

function collectStages(node: WinningPlanNode | undefined, out: string[] = []): string[] {
  if (!node) return out;
  if (typeof node.stage === "string") out.push(node.stage);
  if (node.inputStage) collectStages(node.inputStage, out);
  if (node.inputStages) for (const s of node.inputStages) collectStages(s, out);
  if (node.queryPlan) collectStages(node.queryPlan, out);
  return out;
}

function collectIxscanKeyPatterns(node: WinningPlanNode | undefined, out: Record<string, number>[] = []): Record<string, number>[] {
  if (!node) return out;
  if (node.stage === "IXSCAN" && node.keyPattern) out.push(node.keyPattern);
  if (node.inputStage) collectIxscanKeyPatterns(node.inputStage, out);
  if (node.inputStages) for (const s of node.inputStages) collectIxscanKeyPatterns(s, out);
  if (node.queryPlan) collectIxscanKeyPatterns(node.queryPlan, out);
  return out;
}

function winningPlanOf(explainResult: unknown): WinningPlanNode | undefined {
  const doc = explainResult as { queryPlanner?: { winningPlan?: WinningPlanNode } };
  return doc.queryPlanner?.winningPlan;
}

async function seedQueuedRow(createdAt: Date, index: number): Promise<string> {
  const doc = await PrintJob.create({
    kind: "eod",
    status: "queued",
    payload: JSON.stringify({ kind: "eod", dateKey: `2026-09-0${(index % 9) + 1}`, dateLabel: "seed" }),
    label: `Seed ${index}`,
    queuedBy: "Staff",
  });
  await backdatePrintJob(String(doc._id), createdAt);
  return String(doc._id);
}

async function seedResolvedRow(createdAt: Date, index: number, status: "printed" | "dismissed"): Promise<string> {
  const doc = await PrintJob.create({
    kind: "eod",
    status,
    payload: JSON.stringify({ kind: "eod", dateKey: `2026-09-0${(index % 9) + 1}`, dateLabel: "seed" }),
    label: `Resolved ${index}`,
    queuedBy: "Staff",
    ...(status === "dismissed" ? { dismissedAt: createdAt, dismissReason: "staff", dismissedBy: "Staff" } : {}),
  });
  await backdatePrintJob(String(doc._id), createdAt);
  return String(doc._id);
}

export async function legE(nowMs: number): Promise<void> {
  console.log("\nLeg e — the three feed chains' own query plans: IXSCAN, no SORT, D3's doc-examine bound\n");
  await resetCollections();

  const cutoff = drainAgeCutoff(nowMs);
  const resolvedCutoff = resolvedPruneCutoff(nowMs);

  // D1: rows within the age window (>= cutoff), more than the pulse limit.
  for (let i = 0; i < PRINT_JOB_PULSE_LIMIT + 2; i++) {
    await seedQueuedRow(new Date(cutoff.getTime() + 1000 * (i + 1)), i);
  }
  // D2: rows OLDER than the cutoff (< cutoff), more than the stale limit.
  for (let i = 0; i < PRINT_JOB_STALE_LIMIT + 2; i++) {
    await seedQueuedRow(new Date(cutoff.getTime() - 1000 * (i + 1)), i);
  }
  // D3: more than PRINT_JOB_RESOLVED_LIMIT resolved rows within the 2h window
  // (30, per the amendment) so the doc-examine bound is meaningful.
  for (let i = 0; i < 30; i++) {
    await seedResolvedRow(new Date(resolvedCutoff.getTime() + 1000 * (i + 1)), i, i % 2 === 0 ? "printed" : "dismissed");
  }

  const d1Query = PrintJob.find({ status: "queued", createdAt: { $gte: cutoff } })
    .select("kind label orderId createdAt")
    .sort({ createdAt: 1, _id: 1 })
    .limit(PRINT_JOB_PULSE_LIMIT);
  const d2Query = PrintJob.find({ status: "queued", createdAt: { $lt: cutoff } })
    .select("kind label orderId createdAt")
    .sort({ createdAt: 1, _id: 1 })
    .limit(PRINT_JOB_STALE_LIMIT);
  const d3Query = PrintJob.find({ status: { $in: ["printed", "dismissed"] }, createdAt: { $gte: resolvedCutoff } })
    .select("status dismissReason")
    .sort({ createdAt: -1 })
    .limit(PRINT_JOB_RESOLVED_LIMIT);

  const [d1Explain, d2Explain, d3Explain] = await Promise.all([
    d1Query.explain("executionStats"),
    d2Query.explain("executionStats"),
    d3Query.explain("executionStats"),
  ]);

  const d1Plan = winningPlanOf(d1Explain);
  const d2Plan = winningPlanOf(d2Explain);
  const d3Plan = winningPlanOf(d3Explain);

  const d1Stages = collectStages(d1Plan);
  const d2Stages = collectStages(d2Plan);
  const d3Stages = collectStages(d3Plan);

  const d1Ixscans = collectIxscanKeyPatterns(d1Plan);
  const d2Ixscans = collectIxscanKeyPatterns(d2Plan);

  const expectedKeyPattern = { status: 1, createdAt: 1, _id: 1 };
  check(
    "leg e (D1): an IXSCAN stage with keyPattern {status:1,createdAt:1,_id:1}",
    d1Ixscans.some((kp) => JSON.stringify(kp) === JSON.stringify(expectedKeyPattern)),
  );
  check("leg e (D1): NO stage named SORT", !d1Stages.includes("SORT"));
  check(
    "leg e (D2): an IXSCAN stage with keyPattern {status:1,createdAt:1,_id:1}",
    d2Ixscans.some((kp) => JSON.stringify(kp) === JSON.stringify(expectedKeyPattern)),
  );
  check("leg e (D2): NO stage named SORT", !d2Stages.includes("SORT"));

  check("leg e (D3): NO stage named SORT", !d3Stages.includes("SORT"));
  const d3ExecStats = (d3Explain as { executionStats?: { totalDocsExamined?: number } }).executionStats;
  const d3DocsExamined = d3ExecStats?.totalDocsExamined ?? Infinity;
  check(
    `leg e (D3): totalDocsExamined (${d3DocsExamined}) <= PRINT_JOB_RESOLVED_LIMIT (${PRINT_JOB_RESOLVED_LIMIT})`,
    d3DocsExamined <= PRINT_JOB_RESOLVED_LIMIT,
  );

  // MEASURED on the stand-in mongod 6.0.3 (PH-10 build run): the D3 tree is
  // LIMIT>PROJECTION_SIMPLE>FETCH>SORT_MERGE>IXSCAN>IXSCAN — the $in on status
  // becomes two backward IXSCANs merged in sort order, so no blocking SORT
  // stage ever materialises the 2h window. Pinned as measured (the plan's
  // "SORT_MERGE over two IXSCANs" oracle, now proven here), and the full
  // stage list is printed so a deploy-target re-run can be compared by eye.
  const d3IxscanCount = d3Stages.filter((s) => s === "IXSCAN").length;
  check(
    `leg e (D3): a SORT_MERGE stage over >= 2 IXSCANs (stages: ${d3Stages.join(">")})`,
    d3Stages.includes("SORT_MERGE") && d3IxscanCount >= 2,
  );
}

export async function legJ(nowMs: number): Promise<void> {
  console.log("\nLeg j — readPrintJobFeeds: D1 is the fresh row, D2 is the 10 stale rows, printJobDrainCandidate returns the fresh one\n");
  await resetCollections();

  const cutoff = drainAgeCutoff(nowMs);
  for (let i = 0; i < 10; i++) {
    await seedQueuedRow(new Date(cutoff.getTime() - 1000 * (i + 1)), i);
  }
  const freshId = await seedQueuedRow(new Date(cutoff.getTime() + 1000), 99);

  const feeds = await readPrintJobFeeds(nowMs);
  check("leg j: D1 (printJobs) is exactly the 1 fresh row", feeds.printJobs.length === 1 && feeds.printJobs[0]?.id === freshId);
  check("leg j: D2 (stalePrintJobs) is exactly the 10 stale rows", feeds.stalePrintJobs.length === 10);
  check("leg j: stalePrintJobsTruncated is false (10 < the 20 stale limit)", feeds.stalePrintJobsTruncated === false);
  check("leg j: printJobsTruncated is false (1 < the pulse limit)", feeds.printJobsTruncated === false);

  const candidate = printJobDrainCandidate(feeds.printJobs, nowMs, PRINT_HOST_MAX_AGE_MS);
  check("leg j: printJobDrainCandidate returns the fresh row", candidate !== null && candidate.id === freshId);
}

export async function legL(nowMs: number): Promise<void> {
  console.log("\nLeg l — forced createdAt tie: KOT precedes bill on BOTH reads; an unrelated tied pair keeps its relative order\n");
  await resetCollections();

  const tiedAt = new Date(nowMs - 60_000);

  const kotDoc = await PrintJob.create({
    kind: "kot",
    status: "queued",
    payload: JSON.stringify({ kind: "kot", snapshot: null, round: null }),
    label: "KOT reprint",
    queuedBy: "Staff",
  });
  const billDoc = await PrintJob.create({
    kind: "bill",
    status: "queued",
    payload: JSON.stringify({ kind: "bill", snapshot: null, reprint: true }),
    label: "Bill reprint",
    queuedBy: "Staff",
  });
  await backdatePrintJob(String(kotDoc._id), tiedAt);
  await backdatePrintJob(String(billDoc._id), tiedAt);

  const eodA = await PrintJob.create({
    kind: "eod",
    status: "queued",
    payload: JSON.stringify({ kind: "eod", dateKey: "2026-09-06", dateLabel: "a" }),
    label: "EOD A",
    queuedBy: "Staff",
  });
  const eodB = await PrintJob.create({
    kind: "eod",
    status: "queued",
    payload: JSON.stringify({ kind: "eod", dateKey: "2026-09-06", dateLabel: "b" }),
    label: "EOD B",
    queuedBy: "Staff",
  });
  await backdatePrintJob(String(eodA._id), tiedAt);
  await backdatePrintJob(String(eodB._id), tiedAt);

  const read1 = await readPrintJobFeeds(nowMs);
  const read2 = await readPrintJobFeeds(nowMs);

  const kotIdx1 = read1.printJobs.findIndex((r) => r.id === String(kotDoc._id));
  const billIdx1 = read1.printJobs.findIndex((r) => r.id === String(billDoc._id));
  const kotIdx2 = read2.printJobs.findIndex((r) => r.id === String(kotDoc._id));
  const billIdx2 = read2.printJobs.findIndex((r) => r.id === String(billDoc._id));
  check(
    "leg l: KOT precedes bill on read #1 ({createdAt:1,_id:1} tie-break)",
    kotIdx1 >= 0 && billIdx1 >= 0 && kotIdx1 < billIdx1,
  );
  check("leg l: KOT precedes bill on read #2 (identical ordering)", kotIdx2 >= 0 && billIdx2 >= 0 && kotIdx2 < billIdx2);

  const eodAIdx1 = read1.printJobs.findIndex((r) => r.id === String(eodA._id));
  const eodBIdx1 = read1.printJobs.findIndex((r) => r.id === String(eodB._id));
  const eodAIdx2 = read2.printJobs.findIndex((r) => r.id === String(eodA._id));
  const eodBIdx2 = read2.printJobs.findIndex((r) => r.id === String(eodB._id));
  check(
    "leg l: the unrelated tied pair's relative order is identical across both reads",
    (eodAIdx1 < eodBIdx1) === (eodAIdx2 < eodBIdx2),
  );
}
