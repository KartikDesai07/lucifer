import type { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { failure } from "@pos/shared/api";

// Re-export the shared, auth-free response + validation helpers (success, created,
// failure, serverError, notFound, isDuplicateKeyError, validationError,
// validateBody) so existing `@/lib/api-helpers` imports keep resolving unchanged.
// Single source of truth lives in packages/shared (consumed by the Hub too).
export * from "@pos/shared/api";

// ── Auth guards ──────────────────────────────────────────────────────────────
// Stay app-local: they depend on the cafe's own NextAuth instance (@/lib/auth),
// which is why they cannot live in the shared package. Narrow with the same
// discriminated-union shape: `if ("error" in x) return x.error;`.

export async function requireAuth(): Promise<
  { session: Session } | { error: NextResponse }
> {
  const session = await auth();
  if (!session?.user) return { error: failure("Not authenticated", 401) };
  return { session };
}

export async function requireAdmin(): Promise<
  { session: Session } | { error: NextResponse }
> {
  const result = await requireAuth();
  if ("error" in result) return result;
  if (result.session.user.role !== "admin") {
    return { error: failure("Admin access required", 403) };
  }
  return result;
}
