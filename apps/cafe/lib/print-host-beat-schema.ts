import { z } from "zod";
import { PRINT_HOST_BEAT_PRINTER_VALUES } from "@pos/shared/print-host-printer";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS } from "@/lib/print-host";

// The POST /api/print-host/beat body, moved out of the route file (a Next
// route file cannot export extra names, and the tests need the schema).
//
// `silentProbeMs` carries no upper bound: it is a raw probe measurement,
// server-side only, never compared against a threshold until §E R6 measures a
// real `dt` on the cafe PC. It is `.int()` because a fractional configured
// value rounds when stored, not when re-derived, and a strict re-derive
// compare against a fractional value deadlocks forever (memory
// rounding-vs-strict-compare-deadlock).
//
// `printer` is the host's printer-connection report: "connected" /
// "disconnected" are stored, "unknown" CLEARS the stored value (the lane
// cannot tell), absent leaves it untouched (a non-owner tab, or the
// attestation beat, says nothing about the printer).
export const beatBodySchema = z
  .object({
    deviceId: z.string().trim().min(1).max(PRINT_HOST_DEVICE_ID_MAX_CHARS),
    silentMode: z.boolean().optional(),
    silentProbeMs: z.number().int().nonnegative().optional(),
    printer: z.enum(PRINT_HOST_BEAT_PRINTER_VALUES).optional(),
  })
  .strict();
