// Re-export shim → shared client-facing types live in packages/shared
// (build-rule #31). Type-only re-export keeps it isolatedModules-safe.
export type * from "@pos/shared/types";
