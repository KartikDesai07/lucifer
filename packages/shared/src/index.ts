// Barrel for the shared spine consumed by the cafe runtime + the owner Hub.
// NOTE: the client hook factory (create-crud-hooks) is intentionally NOT
// re-exported here — it carries a "use client" directive; import it directly via
// "@pos/shared/create-crud-hooks". The default `cache` instance is likewise
// imported via "@pos/shared/cache" (this barrel re-exports only its TTL map).
export * from "./constants";
export * from "./utils";
export * from "./codec";
export * from "./query";
export * from "./api-client";
export * from "./product-import";
export * from "./api";
export * from "./cache";
export * from "./schemas";

// types.ts re-exports the schema-inferred Input types (already provided above via
// ./schemas), so to avoid an ambiguous double star-export we surface here ONLY the
// entity + analytics interfaces unique to types.ts.
export type {
  Product,
  Category,
  Customer,
  Table,
  OrderItem,
  Order,
  OrderVoid,
  Staff,
  Reservation,
  Event,
  Settings,
  PaymentStat,
  ProductStat,
  HourlyStat,
  OrderSummary,
  CustomerDue,
  ImportRowResult,
  ImportPreview,
  ImportResult,
  ImportResponse,
  Report,
} from "./types";
export type { DuePayment, DuesCollected } from "./types-analytics";
