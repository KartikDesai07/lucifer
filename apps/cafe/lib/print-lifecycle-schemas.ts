import { z } from "zod";
import { PRINT_ACK_UNREACHABLE, PRINT_DEVICE_SHELLS } from "@pos/shared/print-agent-wire";
import { PRINTERS_MAX, PRINTER_DEVICE_ID_MAX_CHARS } from "@pos/shared/print-printers";
import { PRINTER_COVER_STATES, PRINTER_LINK_STATES, PRINTER_PAPER_STATES } from "@pos/shared/print-failover";
import { PRINT_ACK_ERROR_MAX_CHARS } from "@pos/shared/print-lifecycle";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS, PRINT_HOST_LABEL_MAX_CHARS } from "@/lib/print-host";
import { PRINT_HOST_TAB_ID_MAX_CHARS } from "@/lib/print-queue-claim";

// Printing redesign, Phase 1 (spec §7.3): the agent's request bodies. They live in a lib file
// because a Next route file cannot export extra names, and the tests need them.

const deviceId = z.string().trim().min(1).max(PRINT_HOST_DEVICE_ID_MAX_CHARS);
const tabId = z.string().trim().min(1).max(PRINT_HOST_TAB_ID_MAX_CHARS);
/** Session 2C (printers mode): the printers this tab can print on now (the lease body). The lib keeps only
 *  real printer ids (printerIdsOf), so an odd value only means fewer printers. */
const printerIds = z.array(z.string().trim().max(PRINTER_DEVICE_ID_MAX_CHARS)).max(PRINTERS_MAX).optional();

/** POST /api/print-jobs/wake: the heartbeat (spec §10). */
export const wakeBeatBodySchema = z
  .object({
    deviceId,
    label: z.string().trim().min(1).max(PRINT_HOST_LABEL_MAX_CHARS),
    shell: z.enum(PRINT_DEVICE_SHELLS),
    capabilities: z
      .object({
        lan: z.boolean(),
        bluetooth: z.boolean(),
        usb: z.boolean(),
        windowsPrinters: z.boolean(),
        webSerial: z.boolean(),
        webBluetooth: z.boolean(),
        /** Phase 3 (spec §9.3): this page may write any network printer the setup names. */
        lanFailover: z.boolean().optional(),
      })
      .strict(),
    appVersion: z.string().trim().min(1).max(40).optional(),
    nativeProtocol: z.number().int().min(1).max(99).optional(),
    /** Phase 3 (the token fix's M-2): this page prints "token" jobs (PRINT_PULSE_TOKENS_PARAM). */
    tokenSlips: z.literal(true).optional(),
    /** Phase 3 (spec §10): the health of each printer this device writes (the heartbeat carries it; no request of its
     *  own). The lib keeps only the reports for printers this device writes now. */
    printers: z
      .array(
        z
          .object({
            printerId: z.string().trim().min(1).max(PRINTER_DEVICE_ID_MAX_CHARS),
            link: z.enum(PRINTER_LINK_STATES),
            paper: z.enum(PRINTER_PAPER_STATES).optional(),
            cover: z.enum(PRINTER_COVER_STATES).optional(),
            error: z.literal(true).optional(),
          })
          .strict(),
      )
      .max(PRINTERS_MAX)
      .optional(),
  })
  .strict();

/** POST /api/print-jobs/lease. `tokenSlips: true` = this page can print a "token" job (print-customization S7);
 *  a page built before S7 never sends it, so its lease skips token jobs on every line (lib/print-lease.ts leaseKindFence). */
export const leaseBodySchema = z.object({ deviceId, tabId, printerIds, tokenSlips: z.literal(true).optional() }).strict();

/** POST /api/print-jobs/[id]/ack. A printed ack says nothing else; a failed one must say whether
 *  any byte was sent (spec §7.5: "no" only when the writer KNOWS nothing reached the printer). */
export const ackBodySchema = z
  .object({
    deviceId,
    epoch: z.number().int().min(1),
    outcome: z.enum(["printed", "failed"]),
    sent: z.enum(["no", "maybe"]).optional(),
    permanent: z.literal(true).optional(),
    error: z.string().trim().max(PRINT_ACK_ERROR_MAX_CHARS).optional(),
    /** Phase 3 (the token fix's M-2): this page prints "token" jobs, so the answer's `more` counts them. */
    tokenSlips: z.literal(true).optional(),
    /** Phase 3 (spec §9.3): the writer could not reach this network printer (a failed connect, before any byte). */
    reason: z.literal(PRINT_ACK_UNREACHABLE).optional(),
  })
  .strict()
  .refine(
    (body) => (body.outcome === "printed" ? body.sent === undefined && body.permanent === undefined : body.sent !== undefined),
    { message: "A failed ack must say whether anything was sent; a printed ack carries no failure fields." },
  )
  .refine((body) => body.reason === undefined || (body.outcome === "failed" && body.sent === "no" && body.permanent === undefined), {
    message: "Only a printer that could not be reached before any byte was sent is unreachable.",
  });

/** POST /api/print-jobs/[id]/confirm: the cashier's answer to "Print the bill again?". */
export const confirmBodySchema = z.object({ decision: z.enum(["reprint", "printed", "dismiss"]) }).strict();
