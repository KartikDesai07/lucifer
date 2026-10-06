import { connectDB } from "@/lib/db";
import { success, requireAuth, serverError } from "@/lib/api-helpers";
import { getSettings } from "@/lib/settings";
import { tokenModeOf } from "@/lib/token-board";
import { readTokenBoard } from "@/lib/token-board-server";
import type { TokenBoard } from "@/lib/token-view";

export const dynamic = "force-dynamic";

// GET /api/tokens — the token list (Preparing / Ready) for the POS sheet and, later, the Now Serving screen.
// requireAuth() (NOT requireAdmin): counter staff hand tokens over, and the payload is numbers and times only —
// no name, amount or dish. Tokens off answers without touching Orders. Never cached (orders are never cached).
export async function GET() {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  try {
    await connectDB();
    const now = new Date();
    const mode = tokenModeOf(await getSettings(), now);
    const generatedAt = now.toISOString();
    if (!mode.enabled) {
      const off: TokenBoard = { enabled: false, preparing: [], ready: [], generatedAt };
      return success(off);
    }
    const board: TokenBoard = { enabled: true, ...(await readTokenBoard(mode, now.getTime())), generatedAt };
    return success(board);
  } catch (error) {
    return serverError("Failed to load the token list", error);
  }
}
