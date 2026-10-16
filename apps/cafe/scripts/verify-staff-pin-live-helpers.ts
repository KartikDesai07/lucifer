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

export interface Harness {
  setRole(role: Role): void;
  check(label: string, ok: boolean, res?: Res): void;
  staff: {
    list(): Promise<Res>;
    create(body: unknown): Promise<Res>;
    update(id: string, body: unknown): Promise<Res>;
    pin(id: string): Promise<Res & { cacheControl: string | null }>;
  };
}

/** One part of the leg; later tasks append parts B, C, D to the list in verify-staff-pin-live.ts. */
export type Part = (h: Harness) => Promise<void>;

export const dataOf = (res: Res): Body =>
  res.body.data && !Array.isArray(res.body.data) ? (res.body.data as Body) : {};
export const rowsOf = (res: Res): Body[] => (Array.isArray(res.body.data) ? (res.body.data as Body[]) : []);
