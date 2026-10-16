import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { PIN_DEVICE_COOKIE, encodePinFailure, type PinSignInFailure } from "@pos/shared/staff-pin";
import authConfig from "@/auth.config";
import { connectDB } from "@/lib/db";
import { Staff } from "@/models/Staff";
import cache from "@/lib/cache";
import { loginSchema } from "@/schemas/staff.schema";
import { SESSION_REVALIDATE_MS } from "@/lib/constants";
import { cookieValue, pinDeviceKey, readPinDevice } from "@/lib/pin-device";
import { pruneRateWindows } from "@/lib/public-rate-limit";
import { verifyStaffPinSignIn } from "@/lib/staff-pin-signin";

// node-cache TTLs are in seconds.
const REVALIDATE_TTL_SECONDS = Math.ceil(SESSION_REVALIDATE_MS / 1000);
const revalidatedKey = (id: string) => `auth:revalidated:${id}`;

// A refused PIN try (spec 2026-10-16 §5.4). Auth.js puts `code` in the answer's URL, so
// signIn("pin", { redirect: false }) on the page resolves with it and lib/pin-sign-in-client.ts
// parses it back ("wrong:3", "wait:540", "blocked", "device", "nopin"). The codes name no secret.
export class PinSignInError extends CredentialsSignin {
  constructor(failure: PinSignInFailure) {
    super();
    this.code = encodePinFailure(failure);
  }
}

// Full Auth.js instance (Node runtime). Used by API routes and server components.
// Middleware uses the edge-safe auth.config.ts instead.
export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    // Re-validate the session's account against the DB (Node-only — the edge
    // config can't reach Mongo). On sign-in we stamp the token; afterwards we
    // re-check at most once per SESSION_REVALIDATE_MS. If the account was
    // deactivated, deleted, or had its role changed, the token is refreshed or
    // invalidated — returning `null` clears the session cookie (verified against
    // @auth/core session action). This is what actually locks out a staff member
    // an admin just disabled, without re-login.
    async jwt(params) {
      const { token, user } = params;

      // Sign-in: persist identity from the authorize() result.
      if (user) {
        token.id = user.id ?? "";
        token.role = user.role;
        token.lastValidated = Date.now();
        return token;
      }

      // Throttle DB hits. The re-encoded token is NOT persisted on ordinary
      // server-side auth() calls (only on the session endpoint / sign-in), so
      // token.lastValidated alone can't throttle the API traffic that dominates
      // the POS — every request would otherwise decode the same stale token and
      // re-query Mongo. Back the throttle with a per-isolate node-cache marker
      // keyed by account id so a fresh re-check happens ~once per window.
      if (cache.get(revalidatedKey(token.id))) return token;
      const last = token.lastValidated ?? 0;
      if (Date.now() - last < SESSION_REVALIDATE_MS) return token;

      try {
        await connectDB();
        const account = await Staff.findById(token.id)
          .select("role isActive")
          .lean<{ role: "admin" | "staff"; isActive: boolean } | null>();

        // Account gone or deactivated → kill the session.
        if (!account || !account.isActive) return null;

        // Pick up role changes (e.g. admin → staff demotion) live.
        token.role = account.role;
        token.lastValidated = Date.now();
        cache.set(revalidatedKey(token.id), true, REVALIDATE_TTL_SECONDS);
        return token;
      } catch {
        // Transient DB issue: keep the existing token rather than logging
        // everyone out on a blip. Re-validation retries on the next call.
        return token;
      }
    },
  },
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { username, password } = parsed.data;

        await connectDB();
        // lean(): the credential check only reads scalars + compares the hash —
        // no document methods, no save — so skip hydration (F2.10 audit).
        const staff = await Staff.findOne({
          username: username.toLowerCase(),
          isActive: true,
        })
          .select("+password")
          .lean();

        if (!staff) return null;

        const isValid = await bcrypt.compare(password, staff.password);
        if (!isValid) return null;

        return {
          id: String(staff._id),
          name: staff.name,
          role: staff.role,
        };
      },
    }),
    // PIN sign-in (spec 2026-10-16 §5.4): the tile chosen on the page names the person, and only a
    // device that person signed in on with a password may try their PIN (the signed device cookie,
    // read from the request Auth.js hands authorize). The user returned is the password provider's
    // shape, so the jwt callback above stamps it through the same sign-in branch.
    Credentials({
      id: "pin",
      credentials: { staffId: {}, pin: {} },
      async authorize(credentials, request) {
        const devicePeople = readPinDevice(
          cookieValue(request.headers.get("cookie"), PIN_DEVICE_COOKIE),
          pinDeviceKey(process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET),
        );
        const result = await verifyStaffPinSignIn({
          staffId: credentials.staffId,
          pin: credentials.pin,
          devicePeople,
        });
        // The staff-PIN windows share publicratelimits with the QR order route, its only other
        // reaper; a cafe without QR ordering would never prune them. Best-effort: it swallows its
        // own errors, so it can never fail a sign-in.
        await pruneRateWindows(Date.now());
        if (!result.ok) throw new PinSignInError(result.failure);
        return result.user;
      },
    }),
  ],
});
