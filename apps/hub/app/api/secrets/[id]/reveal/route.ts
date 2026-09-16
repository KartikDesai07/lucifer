import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { z } from "zod";

import { toVaultAudit, withPanelGate } from "@/lib/panel-gate";
import { getSecret, VaultError } from "@/lib/vault";

// POST /api/secrets/[id]/reveal — the §E-4 just-in-time secret reveal, the
// canonical STEP-UP-gated action. withPanelGate({stepUp:true}) enforces session
// + owner role + IP allowlist + FRESH step-up before the handler runs; getSecret
// itself writes the fail-closed `secret.reveal` audit row BEFORE returning
// plaintext. The reveal is for a single operation — the caller must not persist
// or log it. (The panel UI that consumes this lands in a later F3 step.)
export const dynamic = "force-dynamic";

const bodySchema = z.object({ allowRevoked: z.boolean().optional() }).optional();

export const POST = withPanelGate(
  async (req, ctx, { params }) => {
    const { id } = await params;
    if (!isValidObjectId(id)) {
      return NextResponse.json({ success: false, error: "invalid secret id" }, { status: 400 });
    }

    // Body is optional; only `allowRevoked` is honored (forensic reveal).
    let allowRevoked = false;
    try {
      const json = await req.json();
      const parsed = bodySchema.safeParse(json);
      if (parsed.success && parsed.data) allowRevoked = parsed.data.allowRevoked ?? false;
    } catch {
      // no body → default (allowRevoked=false)
    }

    try {
      const plaintext = await getSecret(id, toVaultAudit(ctx), { allowRevoked });
      return NextResponse.json({ success: true, data: { plaintext } });
    } catch (err) {
      if (err instanceof VaultError) {
        // Terse — a revoked/absent secret must not distinguish itself to a
        // caller probing ids (the vault already refused; no detail leaks).
        return NextResponse.json({ success: false, error: "secret unavailable" }, { status: 404 });
      }
      return NextResponse.json({ success: false, error: "reveal failed" }, { status: 500 });
    }
  },
  { stepUp: true },
);
