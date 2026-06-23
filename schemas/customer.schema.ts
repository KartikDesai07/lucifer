import { z } from "zod";
import { CUSTOMER_NOTES } from "@/lib/constants";

// visits / totalSpend / totalDue are SERVER-OWNED, order-derived counters and are
// deliberately NOT accepted here — they change only through the order ledger paths
// and the admin settle/reconcile endpoints, never via a general create/update.
export const createCustomerSchema = z.object({
  name: z.string().trim().min(1, "Customer name is required").max(120),
  mobile: z.string().trim().min(10, "Enter a valid mobile number").max(20),
  notes: z.enum(CUSTOMER_NOTES).default("Regular"),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
