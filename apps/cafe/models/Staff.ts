import mongoose, { Schema, type Document, type Model } from "mongoose";

export interface IStaff extends Document {
  name: string;
  mobile: string;
  username: string;
  password: string;
  role: "admin" | "staff";
  isActive: boolean;
  pin?: string;
  hasPin: boolean;
  pinBlocked: boolean;
  pinFailDay?: string;
  pinFailCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// Exported as a SCHEMA for the F2 per-cluster registry (schemas-not-models, #21);
// the default-bound `Staff` export below stays for the live v1 routes.
export const staffSchema = new Schema<IStaff>(
  {
    name: { type: String, required: true, trim: true },
    mobile: { type: String, required: true },
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    // select:false → never returned by default; opt in with .select('+password')
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ["admin", "staff"], default: "staff" },
    isActive: { type: Boolean, default: true },
    // The 4-digit sign-in PIN, stored as typed because admins are shown it (spec 5.2).
    // select:false like the password: only the admin PIN route opts in with .select('+pin').
    pin: { type: String, select: false },
    hasPin: { type: Boolean, default: false },
    pinBlocked: { type: Boolean, default: false },
    // The wrong-try counter for one cafe day; internal, never listed.
    pinFailDay: { type: String, select: false },
    pinFailCount: { type: Number, default: 0, select: false },
  },
  { timestamps: true },
);

// Reuse the compiled model across hot reloads / serverless invocations.
export const Staff: Model<IStaff> =
  (mongoose.models.Staff as Model<IStaff>) ??
  mongoose.model<IStaff>("Staff", staffSchema);
