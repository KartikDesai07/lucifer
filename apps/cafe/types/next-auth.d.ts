import type { DefaultSession } from "next-auth";

// Role values are shared across the app. Keep in sync with the Staff model.
type Role = "admin" | "staff";

declare module "next-auth" {
  // The object returned from `authorize` and stored on the session.
  interface User {
    role: Role;
  }

  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession["user"];
  }
}

// Augment the core JWT interface directly. The `next-auth/jwt` submodule only
// re-exports it (`export * from "@auth/core/jwt"`), so augmenting that specifier
// would create a disconnected interface that the session/jwt callbacks ignore.
declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: Role;
    // Epoch ms of the last DB re-validation of this account (role/isActive).
    // Used by the Node auth instance to throttle revalidation. Optional so
    // pre-existing tokens (issued before this field) still decode.
    lastValidated?: number;
  }
}
