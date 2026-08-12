// Re-export shim → implementation lives in packages/shared (build-rule #31).
// Default export is the cache instance; `TTL` is a named export.
export { default } from "@pos/shared/cache";
export * from "@pos/shared/cache";
