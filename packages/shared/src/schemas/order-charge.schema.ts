import { z } from "zod";
import { TABLE_CHARGE_LABEL_MAX_LEN, TABLE_CHARGE_LABEL_PATTERN } from "../constants";

// CB-CHG — the shape a client may send for ONE charge. MONEY FENCE, same idiom
// as orderItemSchema's missing `reward`: deliberately NO `type` key. A client
// may only ever declare an `extra` (staff types a label + amount); the server
// alone stamps `type:"table"` from the table's own admin config, so a client
// payload can never invent or overwrite the table's charge through this seam.
// NO `.max()` on amount (owner decision 8, 2026-09-25: "hame hamari panel me
// aesi koi limitation nahi rakhni hai") — the new extra charge is uncapped,
// unlike the table's own bounded TABLE_CHARGE_MAX (table.schema.ts), which is
// a different, still-bounded admin config and stays untouched.
export const orderChargeInputSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Name the charge")
    .max(TABLE_CHARGE_LABEL_MAX_LEN, `Keep it to ${TABLE_CHARGE_LABEL_MAX_LEN} characters or fewer`)
    .regex(TABLE_CHARGE_LABEL_PATTERN, "Use plain text only"),
  amount: z.number().int("Charge must be a whole rupee amount").min(1, "Charge must be at least ₹1"),
});

// The whole extra set a writer's body carries (create / add-round / settle
// bodies — decision 6, extras save on Send/Settle). Present = replace the
// whole set; absent = unchanged (see applyExtraCharges). No `.max()` here
// either — no count cap (decision 8).
export const extraChargesSchema = z.array(orderChargeInputSchema);

export type OrderChargeInput = z.infer<typeof orderChargeInputSchema>;
export type ExtraChargesInput = z.infer<typeof extraChargesSchema>;
