import { v2 as cloudinary } from "cloudinary";

// Configured lazily from server-only env vars. Never expose the API secret.
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Folder all product images live under (CLAUDE.md §13).
export const CLOUDINARY_FOLDER = "lucifer-cafe/products";

export default cloudinary;
