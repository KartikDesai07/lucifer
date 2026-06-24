import cloudinary, { CLOUDINARY_FOLDER } from "@/lib/cloudinary";
import { success, failure, requireAuth, serverError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

// POST /api/upload — return a signed payload so the browser can upload directly
// to Cloudinary (no image bytes pass through this server).
export async function POST() {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    return failure("Image uploads are not configured", 500);
  }

  try {
    const timestamp = Math.round(Date.now() / 1000);
    const signature = cloudinary.utils.api_sign_request(
      { timestamp, folder: CLOUDINARY_FOLDER },
      apiSecret,
    );
    return success({
      signature,
      timestamp,
      cloudName,
      apiKey,
      folder: CLOUDINARY_FOLDER,
    });
  } catch (error) {
    return serverError("Failed to sign upload", error);
  }
}

// DELETE /api/upload — remove an image from Cloudinary by public_id
export async function DELETE(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  if (!process.env.CLOUDINARY_API_SECRET) {
    return failure("Image uploads are not configured", 500);
  }

  const body = (await req.json().catch(() => null)) as {
    publicId?: unknown;
  } | null;
  const publicId = body?.publicId;
  if (typeof publicId !== "string" || !publicId.trim()) {
    return failure("publicId is required", 400);
  }

  // Scope deletes to the cafe's own folder so a signed-in user can't destroy
  // arbitrary assets elsewhere in the Cloudinary account by guessing public_ids.
  if (!publicId.startsWith(`${CLOUDINARY_FOLDER}/`)) {
    return failure("Image is outside the allowed folder", 403);
  }

  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return success(result);
  } catch (error) {
    return serverError("Failed to delete image", error);
  }
}
