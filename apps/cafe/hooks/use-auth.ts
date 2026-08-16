"use client";

import { useSession, signOut } from "next-auth/react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * Client-side access to the current session + role helpers.
 * Requires <SessionProvider> above it (wired in app/layout.tsx).
 */
export function useAuth() {
  const { data: session, status } = useSession();
  const queryClient = useQueryClient();
  const role = session?.user?.role;

  // The POS runs on ONE shared tablet: a manager signs out and a waiter signs
  // in on the same browser minutes later. Two things follow.
  //
  // 1. Drop every cached query first. Query keys carry no user or role, and the
  //    customer list is cached for minutes, so whatever the admin fetched —
  //    including real mobile numbers — would otherwise be served to the next
  //    person from cache with no network call at all.
  // 2. signOut() can REJECT (its internal fetch is unguarded), and when it does
  //    it never reaches its own redirect: the session cookie is never cleared
  //    and the screen does not change. Left unhandled, the manager walks away
  //    believing they logged out while an admin session stays live for the rest
  //    of its 8-hour life. Say so instead of failing silently.
  const logout = async () => {
    queryClient.clear();
    try {
      await signOut({ callbackUrl: "/login" });
    } catch {
      toast.error("Could not sign out. Check the connection and try again.");
    }
  };

  return {
    user: session?.user,
    role,
    isAdmin: role === "admin",
    isStaff: role === "staff",
    isAuthenticated: status === "authenticated",
    isLoading: status === "loading",
    logout,
  };
}
