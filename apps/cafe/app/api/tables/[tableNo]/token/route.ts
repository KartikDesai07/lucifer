import { connectDB } from "@/lib/db";
import { Table } from "@/models/Table";
import cache from "@/lib/cache";
import {
  success,
  notFound,
  failure,
  requireAdmin,
  isDuplicateKeyError,
  serverError,
} from "@/lib/api-helpers";
import { TABLE_NOT_FOUND_ERROR } from "@/lib/table-admin";
import { mintUniquePublicToken, TOKEN_MINT_EXHAUSTED_ERROR } from "@/lib/public-token";

export const dynamic = "force-dynamic";

const CACHE_KEY = "tables";

type Params = { params: Promise<{ tableNo: string }> };

// POST /api/tables/[tableNo]/token — mint (or RE-mint) this table's public QR
// token. This is both "give an existing (pre-CR2) table its first token" and
// "regenerate a sticker I think was tampered with" — regenerating
// deliberately INVALIDATES every printed copy of the old sticker, since a
// leaked/tampered token can otherwise never be revoked. That invalidation is
// the point, not a side effect.
export async function POST(_req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { tableNo } = await params;

  try {
    await connectDB();
    const publicToken = await mintUniquePublicToken((t) =>
      Table.exists({ publicToken: t }).then(Boolean),
    );
    const table = await Table.findOneAndUpdate(
      { tableNo },
      { publicToken },
      { new: true, runValidators: true },
    ).lean();

    if (!table) return notFound(TABLE_NOT_FOUND_ERROR);

    cache.del(CACHE_KEY);
    return success(table);
  } catch (error) {
    // The unique+sparse index on publicToken can only fail here on the
    // never-in-practice collision mintUniquePublicToken's retry cap already
    // guards against — surfaced as a clean 409 rather than a raw 500.
    if (isDuplicateKeyError(error)) return failure(TOKEN_MINT_EXHAUSTED_ERROR, 409);
    return serverError("Failed to mint table token", error);
  }
}
