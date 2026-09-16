import { PUBLIC_TOKEN_PATTERN } from "@pos/shared/public";
import { success, failure, requireAdmin } from "@/lib/api-helpers";
import { revokeInvite } from "@/lib/telegram/chats";

// CR2.3b §21.7 — revoke an UNUSED invite. Idempotent: revoking an already-
// used or unknown code just answers { revoked: false }, still 200.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ code: string }> };

export async function DELETE(_req: Request, { params }: Params) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  const { code } = await params;
  // Charset-gated BEFORE any query — the same shape lib/telegram/chats.ts's
  // own (unexported) isInviteCodeShape gate uses, reused here via its shared
  // source (@pos/shared/public) rather than duplicating the pattern.
  if (!PUBLIC_TOKEN_PATTERN.test(code)) return success({ revoked: false });

  try {
    const revoked = await revokeInvite(code);
    return success({ revoked });
  } catch {
    return failure("Could not revoke that invite.", 500);
  }
}
