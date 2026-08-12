import { NextResponse } from "next/server";
import { z } from "zod";

import { withPanelGate } from "@/lib/panel-gate";
import { HubUser } from "@/models/HubUser";
import { checkOwnerTotp } from "@/lib/owner-totp";
import { writeAudit, writeAuditCoalesced } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";

// POST /api/step-up — refresh the step-up window (§E-4). The owner re-enters a
// TOTP code; on success we stamp stepUp{at:now, sid} with THIS login's session
// id, so subsequent sensitive routes (reveal/provision) pass the gate's
// freshness check. Gated (session + IP + rate-limit) but NOT stepUp:true itself
// — this route is how you BECOME fresh.
export const dynamic = "force-dynamic";

const bodySchema = z.object({ code: z.string().trim().min(1) });

export const POST = withPanelGate(async (req, ctx) => {
  // §E-5 rate limit — per IP and per owner id.
  const byIp = rateLimit(`stepup:ip:${ctx.ip}`);
  const byUser = rateLimit(`stepup:user:${ctx.actorId}`);
  if (!byIp.allowed || !byUser.allowed) {
    return NextResponse.json({ success: false, error: "too many attempts" }, { status: 429 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "invalid body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "code is required" }, { status: 400 });
  }

  const user = await HubUser.findById(ctx.actorId)
    .select("+totpSecretEnc")
    .lean<{ totpSecretEnc?: string } | null>();
  if (!user?.totpSecretEnc) {
    return NextResponse.json({ success: false, error: "not enrolled" }, { status: 403 });
  }

  const check = await checkOwnerTotp(ctx.actorId, user.totpSecretEnc, parsed.data.code);
  if (!check.ok) {
    await writeAuditCoalesced({ actorId: ctx.actorId, action: "auth.stepup.fail", ip: ctx.ip });
    return NextResponse.json({ success: false, error: "invalid code" }, { status: 403 });
  }

  // Stamp the step-up window against THIS session id (from the gate context).
  await HubUser.updateOne(
    { _id: ctx.actorId },
    { $set: { stepUp: { at: new Date(), sid: ctx.sid } } },
  );
  await writeAudit({ actorId: ctx.actorId, action: "auth.stepup", ip: ctx.ip });

  return NextResponse.json({ success: true, data: { stepUp: true } });
});
