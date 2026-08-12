// Re-export shim → implementation lives in packages/shared (build-rule #31).
// Kept as a distinct file because a few call sites import `@/schemas/staff.schema`
// directly (login page, lib/auth, password dialogs).
export * from "@pos/shared/schemas/staff.schema";
