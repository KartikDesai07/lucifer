"use client";

import { useSession, signOut } from "next-auth/react";

/**
 * Client-side access to the current session + role helpers.
 * Requires <SessionProvider> above it (wired in app/layout.tsx).
 */
export function useAuth() {
  const { data: session, status } = useSession();
  const role = session?.user?.role;

  return {
    user: session?.user,
    role,
    isAdmin: role === "admin",
    isStaff: role === "staff",
    isAuthenticated: status === "authenticated",
    isLoading: status === "loading",
    logout: () => signOut({ callbackUrl: "/login" }),
  };
}
