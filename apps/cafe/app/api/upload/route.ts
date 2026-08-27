import { z } from "zod";

import cloudinary, { CLOUDINARY_FOLDER } from "@/lib/cloudinary";
import { parseImageRef, r2Ref } from "@/lib/images";
import { IMAGE_STORE } from "@/lib/platform";
import {
  deleteProductImage,
  isProductImageKey,
  presignProductImagePut,
  r2Config,
} from "@/lib/r2";
import { IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES } from "@/lib/constants";
import {
  success,
  failure,
  requireAuth,
  requireAdmin,
  serverError,
  validateBody,
} from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

// What the client declares about the (already resized) blob it wants to PUT.
// The presign binds both values into the signature, so a grant can't be reused
// for different bytes.
const uploadGrantSchema = z.object({
  contentType: z
    .string()
    // `Object.hasOwn`, not `in`: IMAGE_CONTENT_TYPES is a plain object literal, so
    // `"constructor" in IMAGE_CONTENT_TYPES` is true and the lookup in
    // presignProductImagePut then yields the Object function as the file
    // extension. Verified by probe.
    .refine((t) => Object.hasOwn(IMAGE_CONTENT_TYPES, t), "Unsupported image type"),
  size: z.number().int().positive().max(MAX_IMAGE_BYTES),
});

// POST /api/upload — issue a direct-upload grant for the store this runtime
// targets (IMAGE_STORE, lib/platform.ts). R2 → a presigned PUT URL; Cloudinary
// (the single per-cafe-account alternative — never pooled, F2 §2.11) → the v1
// signed payload. Image bytes never pass through this server on either path.
export async function POST(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  try {
    if (IMAGE_STORE === "r2") {
      const cfg = r2Config();
      if (!cfg) return failure("Image uploads are not configured", 500);

      const parsed = await validateBody(req, uploadGrantSchema);
      if ("error" in parsed) return parsed.error;

      const { contentType, size } = parsed.data;
      const grant = await presignProductImagePut(contentType, size, cfg);
      return success({
        store: "r2" as const,
        uploadUrl: grant.uploadUrl,
        headers: grant.headers,
        ref: r2Ref(grant.key),
      });
    }

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) {
      return failure("Image uploads are not configured", 500);
    }

    const timestamp = Math.round(Date.now() / 1000);
    const signature = cloudinary.utils.api_sign_request(
      { timestamp, folder: CLOUDINARY_FOLDER },
      apiSecret,
    );
    return success({
      store: "cloudinary" as const,
      signature,
      timestamp,
      cloudName,
      apiKey,
      folder: CLOUDINARY_FOLDER,
    });
  } catch (error) {
    return serverError("Failed to prepare upload", error);
  }
}

// DELETE /api/upload — remove a stored image. Dispatch on the REF's own store
// (not IMAGE_STORE): legacy Cloudinary images must stay deletable after the
// runtime flipped to R2. `publicId` is accepted as an alias of `ref` for the
// v1 field name. Admin-only: the products/ scope now also holds the
// admin-owned Settings logo, and there is no in-app DELETE caller at all
// (ImageUpload only POSTs; product deletion goes through /api/products) — so
// any staff session hitting this route directly could destroy it.
export async function DELETE(req: Request) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  const body = (await req.json().catch(() => null)) as {
    ref?: unknown;
    publicId?: unknown;
  } | null;
  const raw =
    typeof body?.ref === "string"
      ? body.ref
      : typeof body?.publicId === "string"
        ? body.publicId
        : "";
  const parsed = parseImageRef(raw.trim() || undefined);
  if (!parsed) return failure("ref is required", 400);

  try {
    // A branding logo lives in this cafe's own DB, keyed by its slot, and the
    // settings form owns the ref that points at it. Deleting the bytes from here
    // would strand that ref — the receipt would render a broken image with no
    // way to tell from Settings that anything was wrong. Clearing the field in
    // Settings is the supported way to remove a logo; the next upload upserts
    // the slot in place, so nothing is ever orphaned.
    if (parsed.store === "local") {
      return failure("Remove a logo from Settings, not from here", 400);
    }

    if (parsed.store === "r2") {
      const cfg = r2Config();
      if (!cfg) return failure("Image uploads are not configured", 500);
      // Scope deletes to this cafe's own product-image prefix so a signed-in
      // user can't destroy other objects in the bucket (e.g. DB backups) by
      // crafting keys — the R2 twin of the v1 Cloudinary folder guard.
      if (!isProductImageKey(parsed.ref, cfg)) {
        return failure("Image is outside the allowed folder", 403);
      }
      await deleteProductImage(parsed.ref, cfg);
      return success({ deleted: true });
    }

    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      return failure("Image uploads are not configured", 500);
    }
    // Scope deletes to the cafe's own folder so a signed-in user can't destroy
    // arbitrary assets elsewhere in the Cloudinary account by guessing public_ids.
    if (!parsed.ref.startsWith(`${CLOUDINARY_FOLDER}/`)) {
      return failure("Image is outside the allowed folder", 403);
    }
    const result = await cloudinary.uploader.destroy(parsed.ref);
    return success(result);
  } catch (error) {
    return serverError("Failed to delete image", error);
  }
}
