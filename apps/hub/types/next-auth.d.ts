import type { DefaultSession } from "next-auth";

// Hub session augmentation (F3.4). The Hub auth store is the single-owner
// HubUser — SEPARATE from any cafe's Staff (fed-secrets-vault.json §E-1). Role is
// always 'owner' in F3 (P8 may widen it later). `sid` is a per-login session id
// minted server-side at sign-in (NEVER client-supplied) that step-up freshness
// is bound to (see lib/auth.ts + lib/panel-gate.ts).

declare module "next-auth" {
  // The object returned from `authorize` and stored on the session.
  interface User {
    role: "owner";
    sid: string;
  }

  interface Session {
    user: {
      id: string;
      role: "owner";
      sid: string;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: "owner";
    // Per-login session id (see above). Minted once at sign-in and carried,
    // unchanged, across every re-encode of the token.
    sid: string;
  }
}
