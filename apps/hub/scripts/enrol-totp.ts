/**
 * Enrol (or re-enrol / reset) the owner's TOTP 2FA (F3.4). Generates a fresh
 * secret, encrypts it under the KEK map, stores it on the HubUser, prints the
 * otpauth:// URI + base32 secret ONCE for the owner to add to their authenticator
 * app, and clears any prior replay counter / step-up so a reset is clean.
 *
 *   HUB_OWNER_EMAIL='you@example.com' npm run enrol:totp --workspace apps/hub
 *
 * Re-running ROTATES the secret (old authenticator entries stop working) — this
 * is the recovery path if a device is lost. The secret is printed to the console
 * intentionally (this is an interactive ops CLI, not app code — the no-console
 * gate covers lib/, not scripts/). Run it somewhere shoulder-surf-safe.
 */
import mongoose from "mongoose";
import { APP_NAME } from "@pos/shared/constants";

import { connectDB } from "@/lib/db";
import { HubUser } from "@/models/HubUser";
import { generateTotpSecret, totpAuthUri } from "@/lib/totp";
import { encryptTotpSecret } from "@/lib/totp-secret";
import { writeAudit } from "@/lib/audit";

export async function enrolTotp() {
  const raw = process.env.HUB_OWNER_EMAIL;
  if (!raw) {
    throw new Error(
      "HUB_OWNER_EMAIL is required. Set the owner account email, e.g.\n" +
        "  HUB_OWNER_EMAIL='you@example.com' npm run enrol:totp --workspace apps/hub",
    );
  }
  const email = raw.trim().toLowerCase();

  await connectDB();
  const user = await HubUser.findOne({ email }).select("_id").lean<{ _id: unknown } | null>();
  if (!user) {
    throw new Error(`No HubUser for ${email}. Run seed:hub-user first.`);
  }
  const userId = String(user._id);

  const secret = generateTotpSecret();
  const totpSecretEnc = encryptTotpSecret(userId, secret);
  // Reset the replay counter + any step-up so the new secret starts clean.
  await HubUser.updateOne(
    { _id: user._id },
    { $set: { totpSecretEnc }, $unset: { totpLastStep: "", stepUp: "" } },
  );
  await writeAudit({ actorId: userId, action: "totp.enrol", ip: "cli" });

  const uri = totpAuthUri(secret, email, APP_NAME);
  console.log(`\nEnrolled TOTP for ${email}.`);
  console.log("\nAdd this to your authenticator app (scan the URI or type the secret):");
  console.log(`  otpauth URI: ${uri}`);
  console.log(`  secret (base32): ${secret}`);
  console.log("\nThe secret is shown ONCE. Store it in your app now; re-run to reset.\n");
}

const isMain = (process.argv[1] ?? "").replace(/\\/g, "/").endsWith("scripts/enrol-totp.ts");
if (isMain) {
  enrolTotp()
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
