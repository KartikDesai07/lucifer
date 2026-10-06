import { after } from "next/server";
import { connectDB } from "@/lib/db";
import { printJobDrainHead } from "@/lib/print-queue-feeds";
import { readJobsForDevice } from "@/lib/print-lease";
import { beatPrintDevice, countOnlineAgents, printDeviceDrawsTokens } from "@/lib/print-device";
import { listPrinters } from "@/lib/print-printers";
import { sweepPrintJobsThrottled } from "@/lib/print-sweep";
import { wakeBeatBodySchema } from "@/lib/print-lifecycle-schemas";
import { printAgentDailyCap, type PrintWakeBeatData } from "@pos/shared/print-agent-wire";
import { printerWriterDevices } from "@pos/shared/print-printers";
import { success, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

// GET /api/print-jobs/wake (CB-U1) — an EXPLICIT amendment, not a silent
// override, of print-host-plan.md §B4 / order-requests/pulse/route.ts's own
// pinned invariant ("no second 20s poll from every open tab"): this endpoint
// is polled by exactly ONE tab — the lock-holding draining print host — and
// answers with a pending flag plus the newest pending job's id — a change
// signal, no payload. The alternative (a flat 3s poll from every open tab)
// blows the Vercel Hobby invocation budget; see cb-u1-wake-and-session-plan.md's
// arithmetic.
//
// GET is READ-ONLY, always: no prune, no beat, no write, ever — the same invariant pulse/route.ts
// pins for itself. Tabs from before Phase 1 keep polling it unchanged for one release.
//
// POST (Phase 1, spec §9.1, §10) is the new agent's wake. It carries the device heartbeat (at most one
// PrintDevice write per 30 s), answers jobsForMe + the online agent count (each agent's share of the
// cafe's one daily wake cap), and runs the sweep AFTER the response at most once per 60 s. That is
// the "sweep rides wake/pulse, never Cron" rule of spec §17.3, so it adds no request.
//
// Body is exactly one query: printJobDrainHead's index-backed read (rides
// {status:1,createdAt:1,_id:1}), sharing printJobDrainFilter with the D1
// drain read so the two can never disagree on "pending".
export async function GET() {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  try {
    await connectDB();
    const head = await printJobDrainHead(Date.now());
    return noStore(success(head));
  } catch (error) {
    return noStore(serverError("Failed to read print queue state", error));
  }
}

export async function POST(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, wakeBeatBodySchema);
  if ("error" in parsed) return parsed.error;

  const nowMs = Date.now();
  try {
    await connectDB();
    await beatPrintDevice(parsed.data, nowMs);
    // Phase 3 (the token fix's M-2): token jobs count only for a page that prints them; one that says nothing (a page
    // from before Phase 3) is answered from what its device's last lease said.
    const tokens = parsed.data.tokenSlips === true || (await printDeviceDrawsTokens(parsed.data.deviceId));
    const [jobsForMe, agents, printers] = await Promise.all([readJobsForDevice(parsed.data.deviceId, nowMs, tokens), countOnlineAgents(nowMs), listPrinters()]);
    try {
      after(() => sweepPrintJobsThrottled(nowMs));
    } catch {
      // no after() in this runtime — skip the sweep, keep the wake
    }
    const data: PrintWakeBeatData = {
      jobsForMe,
      agents,
      // Session 2C (the 2A gate's Important 1): printers mode shares the writers' allowance by the setup.
      agentDailyCap: printAgentDailyCap(printers, agents),
      serverNow: new Date(nowMs).toISOString(),
      // The 2C gate's emulator run: a writer whose printer list missed a print-setup frame learns it here.
      writesPrinters: printerWriterDevices(printers).includes(parsed.data.deviceId),
    };
    return noStore(success(data));
  } catch (error) {
    return noStore(serverError("Failed to read print queue state", error));
  }
}
