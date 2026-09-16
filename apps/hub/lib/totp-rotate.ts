import { HubUser } from "@/models/HubUser";
import { rewrapTotpSecretIfStale } from "@/lib/totp-secret";
import { VaultError } from "@/lib/vault-core";

// ─────────────────────────────────────────────────────────────────────────────
// HubUser TOTP-secret KEK sweep (F3.4). The owner's TOTP secret is wrapped under
// the SAME env KEK map as the vault's tenant credentials, but it lives inline on
// HubUser.totpSecretEnc — OUTSIDE the `Secret` collection that vault.rotateKEK
// sweeps. This module re-wraps stale TOTP secrets so rotateKEK's `remaining`
// count (its retirement gate) is HONEST about the TOTP secret too. Kept separate
// from vault.ts so that file stays under the 300-line rule and its "only touches
// Secret crypto fields" boundary holds; the crypto itself is the pure
// rewrapTotpSecretIfStale (lib/totp-secret). This module NEVER logs.
// ─────────────────────────────────────────────────────────────────────────────

export interface TotpSweepResult {
  scanned: number; // TOTP secrets found off the current version
  rotated: number; // re-wrapped by this run
  failed: Array<{ secretId: string; keyVersion: number; error: string }>;
  remaining: number; // still off-version after the sweep
}

/**
 * Re-wrap every HubUser TOTP secret that is off `toVersion` to the current KEK.
 * Loads the (tiny — one owner) set of enrolled users, since the keyVersion is
 * inside the encrypted JSON blob and can't be queried directly. Each write is
 * pre-image-guarded (a concurrent rotation loses the race cleanly). Payloads are
 * NEVER re-encrypted (rewrapTotpSecretIfStale re-wraps the DEK only).
 */
export async function sweepHubUserTotp(toVersion: number): Promise<TotpSweepResult> {
  const users = await HubUser.find({ totpSecretEnc: { $exists: true } })
    .select("+totpSecretEnc")
    .lean<Array<{ _id: unknown; totpSecretEnc?: string }>>();

  let scanned = 0;
  let rotated = 0;
  let remaining = 0;
  const failed: TotpSweepResult["failed"] = [];

  for (const user of users) {
    if (!user.totpSecretEnc) continue;
    const id = `hubuser:${String(user._id)}`;

    let version: number;
    try {
      version = (JSON.parse(user.totpSecretEnc) as { keyVersion: number }).keyVersion;
    } catch {
      failed.push({ secretId: id, keyVersion: -1, error: "totp blob unparseable" });
      remaining += 1;
      continue;
    }
    if (version === toVersion) continue;

    scanned += 1;
    try {
      const rewrapped = rewrapTotpSecretIfStale(user.totpSecretEnc);
      if (!rewrapped) continue; // already current (unreachable given version !== toVersion)
      const res = await HubUser.updateOne(
        { _id: user._id, totpSecretEnc: user.totpSecretEnc },
        { $set: { totpSecretEnc: rewrapped } },
      );
      if (res.matchedCount === 1) rotated += 1;
      else remaining += 1; // lost a concurrent race; still off-version
    } catch (err) {
      failed.push({
        secretId: id,
        keyVersion: version,
        error: err instanceof VaultError ? err.message : "totp re-wrap failed",
      });
      remaining += 1;
    }
  }

  return { scanned, rotated, failed, remaining };
}
