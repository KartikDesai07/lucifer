// Build a Cloudinary delivery URL from a stored `public_id` at render time
// (CLAUDE.md §13 — we store the public_id only, never the full URL).
// Returns null when there is no image or the cloud name is not configured, so
// callers can fall back to a placeholder.

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

export function productImageUrl(
  publicId: string | undefined,
  size = 300,
): string | null {
  if (!publicId || !CLOUD_NAME) return null;
  const transform = `w_${size},h_${size},c_fill,f_auto,q_auto`;
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${transform}/${publicId}`;
}
