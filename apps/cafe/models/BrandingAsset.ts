import mongoose, { Schema, type Document, type Model } from "mongoose";
import {
  BRANDING_SLOTS,
  IMAGE_CONTENT_TYPES,
  type BrandingSlot,
} from "@/lib/constants";

// The cafe's own logo bytes, held in its own database — the storage of last
// resort so branding works on a deployment with NO asset plane configured (no R2
// bucket, no Cloudinary account).
//
// CONTENT-ADDRESSED: `_id` is "<slot>:<version>" where version is the content
// hash. That is load-bearing, not tidiness. An earlier draft keyed documents by
// slot alone, which made an upload destructive in place: picking a file in
// Settings replaced the logo the cafe was actively printing, before the admin
// pressed Save and with no way back. Keying by content means an upload ADDS a
// document, the ref saved in Settings keeps resolving to the bytes it was saved
// against, and nothing the operator can see changes until they save.
//
// `_id` is never client-controlled: the slot half is matched against a closed
// enum at the route and the version half is a hash this server computed over the
// bytes. Growth is bounded by the prune in lib/branding.ts: a grace-windowed age
// prune plus a hard count bound (BRANDING_PRUNE_MAX_PENDING) cap each slot at at
// most 2 kept documents (the saved version plus the newest) plus that many
// pending ones, regardless of how many uploads happen inside the grace window.
//
// Why not on the Settings doc: GET /api/settings is fetched by every screen for
// every signed-in user and cached client-side for 10 minutes — a base64 logo
// riding on it would be paid for on every POS/receipt/sidebar read. Settings
// stores only the opaque ref; these are the bytes behind it.
//
// Bytes are held base64 in a String path, matching the one existing precedent
// for binary-in-Mongo in this repo (the hub vault's ciphertext fields) rather
// than introducing Schema.Types.Buffer. `bytes` is the DECODED length and is
// verified on read: Buffer.from(s, "base64") is lenient and silently accepts
// truncated input, so the length is the only thing that proves the round-trip.
export interface IBrandingAsset extends Document<string> {
  _id: string; // "<slot>:<version>"
  slot: BrandingSlot;
  contentType: string;
  dataB64: string; // the image bytes, base64
  bytes: number; // DECODED byte length — the integrity gate for dataB64
  version: string; // content hash prefix; the ref's cache key and the ETag
  createdAt: Date;
  updatedAt: Date;
}

export const brandingAssetSchema = new Schema<IBrandingAsset>(
  {
    _id: { type: String, required: true },
    // Closed enums at the storage layer too, so no code path can invent a third
    // slot (bytes nothing would ever read or prune) and no document can be
    // written whose Content-Type the public GET would then echo to browsers.
    slot: { type: String, required: true, enum: [...BRANDING_SLOTS] },
    contentType: {
      type: String,
      required: true,
      enum: Object.keys(IMAGE_CONTENT_TYPES),
    },
    dataB64: { type: String, required: true },
    bytes: { type: Number, required: true, min: 1 },
    version: { type: String, required: true },
  },
  { timestamps: true },
);

// Reuse the compiled model across hot reloads / serverless invocations.
export const BrandingAsset: Model<IBrandingAsset> =
  (mongoose.models.BrandingAsset as Model<IBrandingAsset>) ??
  mongoose.model<IBrandingAsset>("BrandingAsset", brandingAssetSchema);
