import { z } from "zod";
import { TABLE_STATUSES } from "@/lib/constants";

// Tables are seeded (T-1..T-8); only their live status/order pointer changes.
export const updateTableSchema = z.object({
  status: z.enum(TABLE_STATUSES),
  currentOrderId: z.string().optional(),
});

export type UpdateTableInput = z.infer<typeof updateTableSchema>;
