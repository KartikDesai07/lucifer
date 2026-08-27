import { isPublicToken } from "@pos/shared/public";
import { connectDB } from "@/lib/db";
import { Table } from "@/models/Table";
import { notFound, serverError, success } from "@/lib/api-helpers";
import { tableChargeOf } from "@/lib/receipt";
import { tableChargeAppliesNow } from "@/lib/order-request-intake";

export const dynamic = "force-dynamic";

const TABLE_LOOKUP_FAILED_MESSAGE = "Could not look up that table";

// Every non-success response is explicitly uncacheable (a bare 404/503 is
// still heuristically storable per RFC 9111): a miss or a failure must never
// outlive the moment it was true — a token minted a second later must resolve
// on the very next scan, and a recovered DB must serve the very next diner.
function noStore<T extends { headers: Headers }>(res: T): T {
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Content-Type-Options", "nosniff");
  return res;
}

type Params = { params: Promise<{ token: string }> };

// GET /api/public/table/[token] — resolve an opaque QR token to the small
// diner-facing slice of a table's state, for the /m/[token] menu page.
//
// PUBLIC on purpose (same discipline as GET /api/public/menu — see the THREAT
// MODEL comment in lib/public-menu.ts). The response is deliberately narrower
// than a Table document: only `tableNo` and the resolved charge. It never
// returns `status`, `currentOrderId` or the token itself — a diner does not
// need to know whether the table is occupied, and echoing the token back
// would let a captured response page double as a token oracle. Not
// rate-limited: brute-forcing a 70-bit token is not a real threat (see
// PUBLIC_TOKEN_LENGTH in @pos/shared/public), and an unknown/malformed token
// costs this route nothing beyond a regex test — it never reaches Mongo.
export async function GET(_req: Request, { params }: Params) {
  const { token } = await params;

  // Shape-validated BEFORE any query, and the input is never echoed back in
  // the 404: a token that fails the pattern must be indistinguishable, from
  // the outside, from one that parses but matches no table — either response
  // would otherwise confirm or deny a guess.
  if (!isPublicToken(token)) return noStore(notFound("Table not found"));

  try {
    await connectDB();
    const table = await Table.findOne({ publicToken: token })
      .select("tableNo chargeAmount chargeLabel")
      .lean();
    if (!table) return noStore(notFound("Table not found"));

    // tableChargeOf (lib/receipt.ts) is the ONE implementation the POS and the
    // order route both price against — reusing it here means a diner is shown
    // exactly the figure they would actually be charged, never a second guess
    // that could drift from the real one.
    const charge = tableChargeOf(table);
    // Owner field-feedback 2026-08-20 ("every order me additional charge lag
    // rahe hai") — the charge is only ACTUALLY quoted on the table's first
    // order of a session; tableChargeAppliesNow is the SAME helper the POST
    // route bills off of, so display can never disagree with the real quote.
    const chargeApplies = await tableChargeAppliesNow(table.tableNo);
    const res = success({
      tableNo: table.tableNo,
      charge: charge.amount > 0 ? charge : null,
      chargeApplies,
    });
    // A table's charge must never be served stale to a diner about to consent
    // to it — unlike the menu, this is never cached, not even for a second,
    // and every response must be revalidated.
    res.headers.set("Cache-Control", "private, max-age=0, must-revalidate");
    res.headers.set("X-Content-Type-Options", "nosniff");
    return res;
  } catch (error) {
    return noStore(serverError(TABLE_LOOKUP_FAILED_MESSAGE, error, 503));
  }
}
