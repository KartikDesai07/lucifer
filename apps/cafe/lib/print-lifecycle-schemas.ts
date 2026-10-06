import { z } from "zod";
import { PRINT_DEVICE_SHELLS } from "@pos/shared/print-agent-wire";
import { PRINT_ACK_ERROR_MAX_CHARS } from "@pos/shared/print-lifecycle";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS, PRINT_HOST_LABEL_MAX_CHARS } from "@/lib/print-host";
import { PRINT_HOST_TAB_ID_MAX_CHARS } from "@/lib/print-queue-claim";

// Printing redesign, Phase 1 (spec §7.3): the agent's request bodies. They live in a lib file
// because a Next route file cannot export extra names, and the tests need them.

const deviceId = z.string().trim().min(1).max(PRINT_HOST_DEVICE_ID_MAX_CHARS);
const tabId = z.string().trim().min(1).max(PRINT_HOST_TAB_ID_MAX_CHARS);

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
      })
      .strict(),
    appVersion: z.string().trim().min(1).max(40).optional(),
    nativeProtocol: z.number().int().min(1).max(99).optional(),
  })
  .strict();

/** POST /api/print-jobs/lease. `tokenSlips: true` = this page can print a "token" job (print-customization S7);
 *  a page built before S7 never sends it, so its lease skips token jobs (lib/print-lease.ts leaseKindFence). */
export const leaseBodySchema = z.object({ deviceId, tabId, tokenSlips: z.literal(true).optional() }).strict();

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
  })
  .strict()
  .refine(
    (body) => (body.outcome === "printed" ? body.sent === undefined && body.permanent === undefined : body.sent !== undefined),
    { message: "A failed ack must say whether anything was sent; a printed ack carries no failure fields." },
  );

/** POST /api/print-jobs/[id]/confirm: the cashier's answer to "Print the bill again?". */
export const confirmBodySchema = z.object({ decision: z.enum(["reprint", "printed", "dismiss"]) }).strict();
