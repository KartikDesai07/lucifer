import { z } from "zod";
import { RESERVATION_STATUSES } from "@/lib/constants";

export const createReservationSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  mobile: z.string().trim().min(10, "Enter a valid mobile number"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM"),
  guests: z.number().int().min(1, "At least 1 guest is required"),
  tableNo: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(RESERVATION_STATUSES).default("Booked"),
});

export const updateReservationSchema = createReservationSchema.partial();

export type CreateReservationInput = z.infer<typeof createReservationSchema>;
export type UpdateReservationInput = z.infer<typeof updateReservationSchema>;
