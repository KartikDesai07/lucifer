import { Category } from "@/models/Category";

// C12 (arbiter-confirmed review fix) — the category DELETE's
// countDocuments -> deleteOne window can strand a product on a dangling
// categoryId (accepted, pre-existing, by design — see the route's own
// comment), but nothing on the product WRITE side validated that a posted
// categoryId names a live category at all: POST /api/products with a
// categoryId that never existed returned 201. Mirrors table-admin.ts's
// checkTableExists idiom exactly — one indexed existence check, no populate.

// Confirms a categoryId names an actual category. Returns null when the
// category exists; otherwise the rejection message. Caller must have already
// called connectDB().
export async function checkCategoryExists(categoryId: string): Promise<string | null> {
  const exists = await Category.exists({ _id: categoryId });
  return exists ? null : "Select a valid category.";
}
