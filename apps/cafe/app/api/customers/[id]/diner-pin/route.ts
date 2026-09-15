import mongoose from "mongoose";

import { connectDB } from "@/lib/db";
import { Customer } from "@/models/Customer";
import { success, notFound, requireAuth, serverError } from "@/lib/api-helpers";
import { revokeDinerSessions } from "@/lib/diner-session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// DELETE /api/customers/[id]/diner-pin — the COUNTER-SIDE PIN RESET.
//
// This route is the entire recovery story for a forgotten diner PIN. CB-4
// ships no OTP (SMS OTP in India needs DLT principal-entity registration at
// Rs 5,000-10,000/yr per client plus per-template approval, which breaks both
// "near-lifetime-free" and "an unpadh client must configure it easily"), so a
// diner who forgets their PIN asks at the counter and a staff member clears
// it here. The diner then sets a fresh PIN from their own phone — the public
// set-PIN route only ever claims an account that has NO pinHash, which is
// precisely the state this route restores.
//
// requireAuth, NOT requireAdmin: this is a counter action a cashier must be
// able to do while the diner is standing there. It grants no access to
// anything — it REMOVES a credential and kills sessions — so gating it behind
// an owner-only role would just push staff to work around it.
//
// ORDER MATTERS. Sessions are revoked AFTER the hash is cleared: if the
// process dies between the two steps, the account is left with no PIN and
// live sessions (recoverable — the diner is at the counter and can re-set it,
// and any live session was already theirs). Clearing in the other order could
// leave a revoked-session account still holding the OLD PIN, which is the
// state a reset is supposed to make impossible. revokeDinerSessions PROPAGATES
// its errors for the same reason: this route must not report success if the
// old sessions might still resolve.
export async function DELETE(_req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Customer not found");

  try {
    await connectDB();
    // $unset, never `$set: { pinHash: null }` — the public set-PIN route's CAS
    // filter is `pinHash: { $exists: false }`, and a null value still EXISTS.
    // Setting null here would clear the diner's PIN and then make it
    // impossible for them to set a new one.
    // `.select("_id")` and a LITERAL-only response: this route returns no
    // customer field at all. The caller already knows which customer they
    // picked, so echoing a name/mobile back would add a second, unmasked
    // disclosure path for data that lib/customer-privacy exists to mask by
    // role — for no benefit. (The completeness sweep in
    // lib/customer-privacy-paths.test.ts pins exactly this discipline for
    // every route under app/api/customers/.)
    const reset = await Customer.findOneAndUpdate(
      { _id: id },
      { $unset: { pinHash: "", pinSetAt: "" }, $inc: { pinVersion: 1 } },
      { new: true },
    )
      .select("_id")
      .lean();
    if (!reset) return notFound("Customer not found");

    await revokeDinerSessions(id);

    return success({ reset: true });
  } catch (error) {
    return serverError("Failed to reset the diner PIN", error);
  }
}
