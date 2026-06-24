import { NextResponse } from "next/server";
import { z, type ZodTypeAny } from "zod";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";

// ── Response builders (CLAUDE.md §7 response shape) ──────────────────────────

export function success(data: unknown, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function created(data: unknown) {
  return success(data, 201);
}

export function failure(message: string, status = 500) {
  return NextResponse.json({ success: false, error: message }, { status });
}

// Logs an unexpected server error so it surfaces in the host's function logs,
// then returns the standard failure response. Use in route catch blocks.
export function serverError(message: string, error: unknown, status = 500) {
  console.error(`[API] ${message}:`, error);
  return failure(message, status);
}

export function notFound(message = "Not found") {
  return failure(message, 404);
}

// Detects MongoDB duplicate-key (unique index) violations so routes can return
// a friendly 400 instead of a generic 500.
export function isDuplicateKeyError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: number }).code === 11000
  );
}

export function validationError(
  details: Record<string, string[] | undefined>,
) {
  return NextResponse.json(
    { success: false, error: "Validation failed", details },
    { status: 400 },
  );
}

// ── Request body validation ──────────────────────────────────────────────────
// Returns either { data } (parsed + coerced) or { error } (a ready 400 response).
// Routes narrow with: `if ("error" in parsed) return parsed.error;`

export async function validateBody<S extends ZodTypeAny>(
  req: Request,
  schema: S,
): Promise<{ data: z.infer<S> } | { error: NextResponse }> {
  const body = await req.json().catch(() => null);
  const result = schema.safeParse(body);
  if (!result.success) {
    return { error: validationError(result.error.flatten().fieldErrors) };
  }
  return { data: result.data };
}

// ── Auth guards ──────────────────────────────────────────────────────────────
// Same discriminated-union shape: narrow with `if ("error" in x) return x.error;`

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
