import mongoose from "mongoose";
import { z } from "zod";
import { publishCafeEvent } from "@/lib/realtime-publish";
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { success, notFound, validateBody, requireAuth, serverError } from "@/lib/api-helpers";
import { getSettings } from "@/lib/settings";
import { tokenModeOf, tokenOrderFilter } from "@/lib/token-board";
import { writeKotReady, writeTokenCollected } from "@/lib/token-board-server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Four verbs, each strict: a stray field is a 400, never silently ignored. `seenFiredAt` is the newest fire instant
// the staff member could SEE (TokenBoardEntry.firedAt) — the same P4-C stamp rule as the kitchen's Ready.
const tokenActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ready"), seenFiredAt: z.string().datetime().optional() }).strict(),
  z.object({ action: z.literal("unready") }).strict(),
  z.object({ action: z.literal("collected") }).strict(),
  z.object({ action: z.literal("uncollected") }).strict(),
]);

// POST /api/tokens/[id] — mark a token ready / not ready / collected / not collected. requireAuth() (NOT
// requireAdmin): same staff surface as the kitchen's Ready, and nothing here touches money. Idempotent single-doc
// KotTick updates (no CAS, no Order write): a retry or a double tap lands the same state.
export async function POST(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  const parsed = await validateBody(req, tokenActionSchema);
  if ("error" in parsed) return parsed.error;
  if (!mongoose.isValidObjectId(id)) return notFound("Token not found");

  const body = parsed.data;
  try {
    await connectDB();
    const mode = tokenModeOf(await getSettings(), new Date());
    if (!mode.enabled) return notFound("Tokens are off");

    // Only a token on TODAY's list can be changed (open or paid; never a cancelled order).
    const onList = await Order.exists({ _id: id, ...tokenOrderFilter(mode.dayStart), kotRounds: { $gte: 1 } });
    if (!onList) return notFound("That token is no longer on the list");

    if (body.action === "ready" || body.action === "unready") {
      await writeKotReady(id, body.action === "ready", body.action === "ready" ? body.seenFiredAt : undefined);
    } else {
      await writeTokenCollected(id, body.action === "collected");
    }

    // The board changed — nudge every OTHER device ahead of its poll (the kitchen's own kind; the poll stays truth).
    publishCafeEvent("kot-ticked");
    return success({ id, action: body.action });
  } catch (error) {
    return serverError("Failed to update the token", error);
  }
}
