import { z } from "zod";
import { objectIdString } from "@pos/shared/schemas";
import {
  PRINTER_ADDRESS_MAX_CHARS,
  PRINTER_COPIES_MAX,
  PRINTER_COPIES_MIN,
  PRINTER_DEVICE_ID_MAX_CHARS,
  PRINTER_DEVICE_TRANSPORTS,
  PRINTER_LAN_DEFAULT_PORT,
  PRINTER_NAME_MAX_CHARS,
  STATIONS_MAX,
  STATION_NAME_MAX_CHARS,
} from "@pos/shared/print-printers";
import { ADDRESS_MESSAGE, isValidPrinterHost } from "@/lib/printer/network-address";

// Printing redesign, Phase 2 (spec §6.1, §6.3, §11): the request bodies of the stations and printers routes.
// They live in a lib file because a Next route file cannot export extra names, and the tests need them.
// Messages are the words staff read on the setup screens (Session 2D).

const stationName = z
  .string()
  .trim()
  .min(1, "Name the station")
  .max(STATION_NAME_MAX_CHARS, `Keep it to ${STATION_NAME_MAX_CHARS} characters or fewer`);

/** POST /api/stations. */
export const createStationBodySchema = z.object({ name: stationName }).strict();

/** PUT /api/stations/[id]: a new name, and/or "make this the default". The default is moved, never unset. */
export const updateStationBodySchema = z
  .object({ name: stationName.optional(), isDefault: z.literal(true).optional() })
  .strict()
  .refine((body) => body.name !== undefined || body.isDefault !== undefined, { message: "Nothing to change", path: ["name"] });

const copies = z
  .number()
  .int("Use a whole number")
  .min(PRINTER_COPIES_MIN, `At least ${PRINTER_COPIES_MIN} copy`)
  .max(PRINTER_COPIES_MAX, `At most ${PRINTER_COPIES_MAX} copies`);

// A LAN printer's address is checked the way the POS app checks it before it connects (network-address.ts,
// pinned to the app's own rule), so a typo is caught on the form, never as a refusal from the printer.
const lanConnection = z
  .object({
    kind: z.literal("lan"),
    host: z.string().trim().toLowerCase().refine(isValidPrinterHost, ADDRESS_MESSAGE),
    port: z.number().int().min(1).max(65535).default(PRINTER_LAN_DEFAULT_PORT),
  })
  .strict();

const deviceConnection = z
  .object({
    kind: z.literal("device"),
    deviceId: z.string().trim().min(1).max(PRINTER_DEVICE_ID_MAX_CHARS),
    transport: z.enum(PRINTER_DEVICE_TRANSPORTS),
    address: z.string().trim().min(1).max(PRINTER_ADDRESS_MAX_CHARS),
  })
  .strict();

/** POST /api/printers and PUT /api/printers/[id]: the WHOLE printer, as the setup form saves it (one unit,
 *  so the LAN-needs-a-printing-device rule is checked against the connection it is saved with). */
export const printerBodySchema = z
  .object({
    name: z.string().trim().min(1, "Name the printer").max(PRINTER_NAME_MAX_CHARS, `Keep it to ${PRINTER_NAME_MAX_CHARS} characters or fewer`),
    connection: z.discriminatedUnion("kind", [lanConnection, deviceConnection]),
    primaryDeviceId: z.string().trim().min(1).max(PRINTER_DEVICE_ID_MAX_CHARS).optional(),
    /** Display order; absent on create puts it last, absent on save keeps it. */
    order: z.number().int().min(0).max(10_000).optional(),
    paper: z.union([z.literal(58), z.literal(80)]),
    slips: z
      .object({
        bill: z.boolean(),
        kotStations: z
          .array(objectIdString)
          .max(STATIONS_MAX)
          .refine((ids) => new Set(ids).size === ids.length, "The same station appears twice"),
        kotAll: z.boolean(),
        notices: z.boolean(),
        eod: z.boolean(),
      })
      .strict(),
    copies: z.object({ kot: copies, bill: copies }).strict(),
    enabled: z.boolean(),
  })
  .strict()
  .superRefine((body, ctx) => {
    // Phase 2: one writer per printer (spec §9.3). A network printer is written by the device chosen here;
    // a device printer only ever by its own device. Failover to other devices is Phase 3 (§9.4).
    if (body.connection.kind === "lan" && body.primaryDeviceId === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["primaryDeviceId"], message: "Choose the device that prints to this network printer" });
    }
    if (body.connection.kind === "device" && body.primaryDeviceId !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["primaryDeviceId"], message: "Only a network printer is printed by another device" });
    }
  });

export type CreateStationBody = z.infer<typeof createStationBodySchema>;
export type UpdateStationBody = z.infer<typeof updateStationBodySchema>;
export type PrinterBody = z.infer<typeof printerBodySchema>;
