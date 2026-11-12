import type { LeasedPrintJob, PrintAckData } from "@pos/shared/print-agent-wire";
import { ackAnswered } from "@/lib/print-ack-store";
import type { AckFlusher } from "@/lib/print-agent-acks";
import type { RefusalHolds } from "@/lib/print-agent-holds";
import { failedAckBody } from "@/lib/print-agent-slip";
import type { PrintAgentDeps } from "@/lib/print-agent-types";
import { PRINT_HOST_NOT_DRAWN_MESSAGE } from "@/lib/print-host-tickets";
import { PRINT_SLIP_REFUSALS_MAX, isSlipRefusal, printWriteOutcomeOf } from "@/lib/print-write-outcome";

// Printing Phase 6 Task 5 (spec §9 rulings 12, 15, 18, 20): one leased job on its printer line, from its print to its
// ack. This is the body of the agent's cycle after a job was taken (lib/print-agent.ts before Phase 6), unchanged, with
// no lease and no device-wide flag: the agent runs one per line at a time and decides what each end means.

/** How a line's job ended. printed: its ack was answered or kept (`more`: lease the line again). back: it is back in
 *  line, so the timer looks at the line at `at` (its backoff on the server's clock, or its refusal hold's end on this
 *  tab's own clock when `local`). failed: it left the line (`more`: its answer says the line holds more). unanswered:
 *  its failed ack got no answer and is kept for re-sending. */
export type LineJobEnd =
  | { kind: "printed"; more: boolean }
  | { kind: "back"; at: number; local: boolean }
  | { kind: "failed"; more: boolean }
  | { kind: "unanswered" };

export interface LineJobContext {
  deps: PrintAgentDeps;
  acks: AckFlusher;
  /** Each ack's answer by `${id}:${epoch}`, as the ack flusher heard it. */
  answers: Map<string, PrintAckData>;
  holds: RefusalHolds;
  /** Per job id: how often its slip itself was refused (owner, 1C gate I3). */
  slipRefusals: Map<string, number>;
  /** The line a job's refusal holds (Session 2E: its printer, else the device line). */
  lineOf(job: LeasedPrintJob): string;
  /** A refusal holds this line (the agent remembers it, so its timer looks at the line when the hold ends). */
  hold(line: string): void;
  /** The final review (I-1(a)): this job's printed ack is kept: the agent ends its line the moment that ack's answer is
   *  heard, inside the flush, so a lease waiting on the same flush finds the line free (whichever waited first). */
  kept?(): void;
}

/** Why a held job went back to its line unprinted: its refusal's error (the waiting-slips panel may show it). */
export const HELD_TOO_LONG = "held too long on this device";
export const PRINTING_STOPPED = "printing stopped on this device";

/** A held job dropped unprinted goes back to its line as a refusal (sent:"no", never counted), kept and sent like any
 *  ack: this tab knows nothing of it reached a printer, so it prints again unlabelled rather than expiring into a
 *  REPRINT (a bill: the cashier's question). The server takes it only while the job is still leased at that epoch;
 *  once its expiry is applied, or a new lease made, it is ignored (Session 2B's final review, I-1). */
export function handBack(ctx: Pick<LineJobContext, "deps" | "acks">, job: LeasedPrintJob, why: string): void {
  const { deps } = ctx;
  ctx.acks.keep({ id: job.id, epoch: job.epoch, at: deps.now(), fail: { deviceId: deps.deviceId, epoch: job.epoch, outcome: "failed", sent: "no", error: why } });
}

/** The final review (I-1(a)): runs a started job, whose line ends exactly once: the moment its printed ack's answer is
 *  heard (the ack flusher's answered hook calls `onAnswer` by key, inside the flush, so a lease waiting on that flush
 *  finds the line free, whichever waited first), else when the run returns. Only that return pumps: a job started inside
 *  the flush would keep its ack into a flush already done (lib/print-agent-acks.ts) and miss its answer. */
export function runLineOnce(
  job: LeasedPrintJob,
  ctx: LineJobContext,
  onAnswer: Map<string, (answer: PrintAckData) => void>,
  ended: (end: LineJobEnd) => void,
  pump: () => void,
): void {
  const key = `${job.id}:${job.epoch}`;
  let done = false;
  const end = (result: LineJobEnd, pumpNow = true): void => {
    if (!done) ended(result);
    done = true;
    onAnswer.delete(key);
    if (pumpNow) pump();
  };
  const kept = (): void => void onAnswer.set(key, (answer) => end({ kind: "printed", more: answer.more !== false }, false));
  void runLineJob(job, { ...ctx, kept }).then((result) => end(result), () => end({ kind: "unanswered" }));
}

export async function runLineJob(job: LeasedPrintJob, ctx: LineJobContext): Promise<LineJobEnd> {
  const { deps, acks, holds } = ctx;
  const key = `${job.id}:${job.epoch}`;
  const line = ctx.lineOf(job);
  const result = await deps.print(job);
  if (result.ok) {
    // A printed slip's refusal count is done with (1D gate M-3). A failed one keeps it, so a staff
    // Retry stays one tap, one try.
    ctx.slipRefusals.delete(job.id);
    // Kept BEFORE it is sent, so a reload mid-ack still reports the paper (spec §7.9). Awaited, so the line's next
    // lease does not find this job still leased at its head. Ruling 18: acks go one flush at a time on the wire.
    ctx.kept?.();
    acks.keep({ id: job.id, epoch: job.epoch, at: deps.now() });
    await acks.flush();
    // Session 2B (decision 9): lease again only when the ack says the line holds more. No answer, or
    // an older server that does not say: lease again, as in Phase 1.
    const more = ctx.answers.get(key)?.more !== false;
    ctx.answers.delete(key);
    return { kind: "printed", more };
  }
  let outcome = printWriteOutcomeOf(result.error);
  // Phase 6 (spec §9 rulings 12, 20): a slip withdrawn before it was drawn is acked sent "no" like any refusal, but it is
  // no refusal of its printer nor of the slip: it never holds its line and never counts; it is leased again at its backoff.
  const withdrawn = outcome.message === PRINT_HOST_NOT_DRAWN_MESSAGE;
  if (!withdrawn && isSlipRefusal(outcome) && deps.printerReady()) {
    // The slip itself was refused (owner, 1C gate I3): its second refusal fails the job, freeing the line.
    const count = (ctx.slipRefusals.get(job.id) ?? 0) + 1;
    ctx.slipRefusals.set(job.id, count);
    if (count >= PRINT_SLIP_REFUSALS_MAX) outcome = { ...outcome, permanent: true };
  } else if (!withdrawn && outcome.sent === "no" && !outcome.permanent) {
    // Nothing reached the printer: it is off or unreachable. No automatic attempt on it until it changes.
    ctx.hold(line);
  }
  // Session 3B (spec §9.3): a network printer this device could not reach says so, so another device takes it over.
  const body = failedAckBody(deps.deviceId, job.epoch, outcome, deps.networkPrinter?.(job) === true);
  const answer = await deps.ack(job.id, body).catch((error: unknown) => {
    // No answer: kept and re-sent like a printed ack, so the lease never expires into a counted "maybe" (M4).
    if (!ackAnswered(error)) acks.keep({ id: job.id, epoch: job.epoch, at: deps.now(), fail: body });
    return null;
  });
  if (answer === null) return { kind: "unanswered" };
  // A job back in line waits for its own nextAttemptAt; Session 2E: a line its refusal holds is looked at again when the
  // hold ends (a lease at its backoff would only find the other printers' lines).
  if (answer.nextAttemptAt !== null) {
    const end = holds.holding(line) ? holds.nextEnd() : null;
    return end !== null ? { kind: "back", at: end, local: true } : { kind: "back", at: Date.parse(answer.nextAttemptAt), local: false };
  }
  return { kind: "failed", more: !holds.holding(line) && answer.more !== false };
}
