import { randomUUID } from "node:crypto";

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import authConfig from "@/auth.config";
import { connectDB } from "@/lib/db";
import { HubUser } from "@/models/HubUser";
import { checkOwnerTotp } from "@/lib/owner-totp";
import { writeAudit, writeAuditCoalesced } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp, ipAllowed } from "@/lib/ip";

// ─────────────────────────────────────────────────────────────────────────────
// Full Auth.js instance for the Hub (Node runtime — used by API routes + the
// panel gate). The owner authenticates with email + a TOTP code (there is NO
// password — HubUser has no password field by design, F3.1). This module never
// logs: the decrypted TOTP seed flows through it (eslint no-console override +
// source-scan test, like the vault).
//
// A successful login IS a fresh 2FA, so authorize() stamps the step-up window
// (stepUp{at,sid}) with a freshly-minted, server-side session id `sid`. That sid
// flows into the JWT (auth.config jwt callback copies user.sid) and binds every
// later step-up to THIS login — a step-up stamped under one login can't satisfy
// a different (or forged) session.
// ─────────────────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: z.string().trim().min(1),
});

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        code: { label: "Authenticator code", type: "text" },
      },
      async authorize(credentials, request) {
        try {
          const ip = clientIp(request?.headers ?? new Headers());

          const parsed = loginSchema.safeParse(credentials);
          if (!parsed.success) return null;
          const { email, code } = parsed.data;

          // §E-5 rate limit: 5/min per IP, checked FIRST — this bounds the DB
          // lookups (and per-email limiter hits) any single source IP can drive,
          // and short-circuits before the per-email window is touched.
          if (!rateLimit(`login:ip:${ip}`).allowed) return null;

          await connectDB();
          const user = await HubUser.findOne({ email, isActive: true })
            .select("+totpSecretEnc role ipAllowlist")
            .lean<{
              _id: unknown;
              email: string;
              role: "owner";
              totpSecretEnc?: string;
              ipAllowlist?: string[];
            } | null>();

          // Unknown email or not-yet-enrolled: fail silently, write NO audit row
          // (no attributable actor; avoids unbounded rows on M0).
          if (!user || !user.totpSecretEnc) return null;

          const userId = String(user._id);

          // §E-3 IP allowlist ALSO on the login path (not just the post-login
          // gate) — fail-closed on an empty allowlist unless HUB_ALLOW_ANY_IP.
          // Checked BEFORE the per-email limiter so a non-allowlisted attacker who
          // knows the owner's email cannot burn the owner's per-email budget
          // (a targeted from-any-IP lockout).
          const allowAnyIp = process.env.HUB_ALLOW_ANY_IP === "1";
          if (!ipAllowed(ip, user.ipAllowlist ?? [], allowAnyIp)) {
            await writeAuditCoalesced({ actorId: userId, action: "auth.login.fail", ip });
            return null;
          }

          // Per-email limiter — only reachable from an allowlisted IP now.
          if (!rateLimit(`login:email:${email}`).allowed) return null;

          // Decrypt + verify + replay-claim (+ lazy KEK rewrap) — the shared
          // owner-TOTP check. A false result is a wrong/expired/replayed code or
          // a decrypt failure; all are known-user failures worth auditing.
          const check = await checkOwnerTotp(userId, user.totpSecretEnc, code);
          if (!check.ok) {
            await writeAuditCoalesced({ actorId: userId, action: "auth.login.fail", ip });
            return null;
          }

          // Login = fresh 2FA: stamp the step-up window with a new SERVER-SIDE
          // session id, and return that same sid on the user object so the JWT
          // carries it (auth.config jwt callback copies user.sid). Stamping and
          // the token thus share one sid → a fresh login satisfies the step-up
          // gate immediately (no client-forgeable value anywhere in the path).
          const sid = randomUUID();
          await HubUser.updateOne(
            { _id: user._id },
            { $set: { stepUp: { at: new Date(), sid } } },
          );

          await writeAudit({ actorId: userId, action: "auth.login", ip });

          return { id: userId, email: user.email, role: user.role, sid };
        } catch {
          // Never leak internals through Auth.js; a null is a generic failure.
          return null;
        }
      },
    }),
  ],
});
