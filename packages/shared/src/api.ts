import { NextResponse } from "next/server";
import { z, type ZodTypeAny } from "zod";

// API response builders + request validation (CLAUDE.md §7 response shape),
// shared by the cafe runtime and the owner Hub so both speak the SAME envelope.
// Auth guards (requireAuth / requireAdmin) stay app-local in each app's
// lib/api-helpers — they depend on that app's own NextAuth instance.

// ── Response builders ────────────────────────────────────────────────────────

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
