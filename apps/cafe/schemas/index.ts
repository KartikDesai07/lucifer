// Re-export shim → all Zod schemas + inferred types live in packages/shared
// (build-rule #31). Existing `@/schemas` barrel imports keep working unchanged.
export * from "@pos/shared/schemas";
