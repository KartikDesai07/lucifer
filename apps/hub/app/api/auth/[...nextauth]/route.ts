import { handlers } from "@/lib/auth";

// Auth.js v5 catch-all (sign-in / callback / session / sign-out) for the Hub
// owner store. PUBLIC by design (this IS the login endpoint) — the panel gate
// (lib/panel-gate.ts) protects every OTHER route; this one is on the source-scan
// allowlist (routes.gate.test.ts).
export const { GET, POST } = handlers;
