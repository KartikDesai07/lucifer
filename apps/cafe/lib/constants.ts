// Re-export shim → single source of truth lives in packages/shared (consumed by
// the cafe runtime + the owner Hub, build-rule #31). Existing `@/lib/constants`
// imports across the app keep working unchanged.
export * from "@pos/shared/constants";
