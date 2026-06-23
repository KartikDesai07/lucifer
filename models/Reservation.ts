import mongoose, { Schema, type Document, type Model } from "mongoose";
import { RESERVATION_STATUSES, type ReservationStatus } from "@/lib/constants";

export interface IReservation extends Document {
  name: string;
  mobile: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  guests: number;
  tableNo?: string;
  notes?: string;
  status: ReservationStatus;
  createdAt: Date;
  updatedAt: Date;
}

const reservationSchema = new Schema<IReservation>(
  {
    name: { type: String, required: true },
    mobile: { type: String, required: true },
    date: { type: String, required: true },
    time: { type: String, required: true },
    guests: { type: Number, required: true, min: 1 },
    tableNo: { type: String },
    notes: { type: String },
    status: {
      type: String,
      enum: [...RESERVATION_STATUSES],
      default: "Booked",
    },
  },
  { timestamps: true },
);

reservationSchema.index({ date: 1, status: 1 });

// Reuse the compiled model across hot reloads / serverless invocations.
export const Reservation: Model<IReservation> =
  (mongoose.models.Reservation as Model<IReservation>) ??
  mongoose.model<IReservation>("Reservation", reservationSchema);
