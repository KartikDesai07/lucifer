/**
 * Shared types for the staff PIN live leg (verify-staff-pin-live.ts and its case files).
 * Later parts append their own Harness members here.
 */
export type Role = "admin" | "staff";
export type Json = { success: boolean; data?: unknown; error?: string; details?: unknown };
export type Res = { status: number; body: Json };
export type Body = Record<string, unknown>;

export const ADMIN_ID = "665f0000000000000000b001";
export const STAFF_ID = "665f0000000000000000b002";

/** Who the stubbed auth() says is signed in. */
export type StubUser = { id: string; name: string; role: Role };
/** A route answer with the headers the sign-in routes care about (Set-Cookie lines as Next would append them). */
export type RouteRes = Res & { cacheControl: string | null; setCookie: string[] };

export interface Harness {
  /** Back to the role's fixed user (and ends any signInAs). */
  setRole(role: Role): void;
  /** The stubbed session is this user until the next setRole; null = no session. */
  signInAs(user: StubUser | null): void;
  check(label: string, ok: boolean, res?: Res): void;
  staff: {
    list(): Promise<Res>;
    create(body: unknown): Promise<Res>;
    update(id: string, body: unknown): Promise<Res>;
    pin(id: string): Promise<Res & { cacheControl: string | null }>;
  };
  /** Part C: GET /api/sign-in/known and POST /api/sign-in/remember, carrying `cookie` as the Cookie header. */
  signInRoutes: {
    known(opts?: { cookie?: string; host?: string }): Promise<RouteRes>;
    remember(cookie?: string): Promise<RouteRes>;
  };
}

/** One part of the leg; later tasks append parts B, C, D to the list in verify-staff-pin-live.ts. */
export type Part = (h: Harness) => Promise<void>;

export const dataOf = (res: Res): Body =>
  res.body.data && !Array.isArray(res.body.data) ? (res.body.data as Body) : {};
export const rowsOf = (res: Res): Body[] => (Array.isArray(res.body.data) ? (res.body.data as Body[]) : []);
