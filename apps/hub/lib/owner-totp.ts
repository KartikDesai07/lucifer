import { HubUser } from "@/models/HubUser";
import { verifyTotp } from "@/lib/totp";
import { decryptTotpSecret, rewrapTotpSecretIfStale } from "@/lib/totp-secret";

// ─────────────────────────────────────────────────────────────────────────────
// Owner TOTP check with replay guard (F3.4) — the ONE place a submitted code is
// validated, shared by login (lib/auth.ts) and step-up (POST /api/step-up) so
// both enforce identical semantics. Decrypts the seed just-in-time, verifies,
// then CLAIMS the code atomically: it is accepted only for a HOTP step strictly
// greater than the last accepted one (HubUser.totpLastStep), making a code
// single-use even within its ±1-step validity window. This module NEVER logs —
// the decrypted seed flows through it (eslint no-console override + scan test).
// ─────────────────────────────────────────────────────────────────────────────

export interface OwnerTotpCheck {
  ok: boolean;
  step?: number; // the accepted HOTP step (present only when ok)
}

/**
 * Verify `code` for the owner and consume it (replay-guarded). Returns
 * `{ ok:false }` on a decrypt failure, a wrong/expired code, OR a replayed/
 * concurrent code (the atomic claim loses the race). On success also opportun-
 * istically re-wraps a stale-KEK TOTP secret (best-effort, pre-image guarded).
 */
export async function checkOwnerTotp(
  userId: string,
  totpSecretEnc: string,
  code: string,
  now: number = Date.now(),
): Promise<OwnerTotpCheck> {
  let secret: string;
  try {
    secret = decryptTotpSecret(userId, totpSecretEnc);
  } catch {
    return { ok: false };
  }

  const step = verifyTotp(secret, code, now);
  if (step === null) return { ok: false };

  // Atomic replay claim: accept only if strictly newer than the last step.
  const claim = await HubUser.updateOne(
    {
      _id: userId,
      $or: [{ totpLastStep: { $exists: false } }, { totpLastStep: { $lt: step } }],
    },
    { $set: { totpLastStep: step } },
  );
  if (claim.matchedCount !== 1) return { ok: false };

  // Lazy KEK migration (rotateKEK also sweeps this, but a login/step-up on an
  // old-KEK record self-heals it). Non-fatal on failure — the old KEK is still
  // configured until migration completes.
  try {
    const rewrapped = rewrapTotpSecretIfStale(totpSecretEnc);
    if (rewrapped) {
      await HubUser.updateOne(
        { _id: userId, totpSecretEnc },
        { $set: { totpSecretEnc: rewrapped } },
      );
    }
  } catch {
    // ignore — see above
  }

  return { ok: true, step };
}
