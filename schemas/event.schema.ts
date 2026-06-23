import { z } from "zod";
import { EVENT_PAY_MODES, EVENT_STATUSES } from "@/lib/constants";

export const createEventSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  mobile: z.string().trim().min(10, "Enter a valid mobile number"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM"),
  eventName: z.string().trim().min(1, "Event name is required"),
  notes: z.string().optional(),
  payable: z.number().min(0), // total amount
  advance: z.number().min(0).default(0), // paid upfront
  payMode: z.enum(EVENT_PAY_MODES),
  status: z.enum(EVENT_STATUSES).default("Booked"),
});

export const updateEventSchema = createEventSchema.partial();

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
