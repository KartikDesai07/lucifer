import mongoose, { Schema, type Document, type Model } from "mongoose";
import {
  EVENT_PAY_MODES,
  EVENT_STATUSES,
  type EventPayMode,
  type EventStatus,
} from "@/lib/constants";

export interface IEvent extends Document {
  name: string;
  mobile: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  eventName: string;
  notes?: string;
  payable: number; // total amount
  advance: number; // paid upfront
  payMode: EventPayMode;
  status: EventStatus;
  createdAt: Date;
  updatedAt: Date;
}

const eventSchema = new Schema<IEvent>(
  {
    name: { type: String, required: true },
    mobile: { type: String, required: true },
    date: { type: String, required: true },
    time: { type: String, required: true },
    eventName: { type: String, required: true },
    notes: { type: String },
    payable: { type: Number, required: true, min: 0 },
    advance: { type: Number, required: true, default: 0, min: 0 },
    payMode: { type: String, enum: [...EVENT_PAY_MODES], required: true },
    status: { type: String, enum: [...EVENT_STATUSES], default: "Booked" },
  },
  { timestamps: true },
);

eventSchema.index({ date: 1 });

// Reuse the compiled model across hot reloads / serverless invocations.
export const Event: Model<IEvent> =
  (mongoose.models.Event as Model<IEvent>) ??
  mongoose.model<IEvent>("Event", eventSchema);
