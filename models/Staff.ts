import mongoose, { Schema, type Document, type Model } from "mongoose";

export interface IStaff extends Document {
  name: string;
  mobile: string;
  username: string;
  password: string;
  role: "admin" | "staff";
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const staffSchema = new Schema<IStaff>(
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
  },
  { timestamps: true },
);

// Reuse the compiled model across hot reloads / serverless invocations.
export const Staff: Model<IStaff> =
  (mongoose.models.Staff as Model<IStaff>) ??
  mongoose.model<IStaff>("Staff", staffSchema);
