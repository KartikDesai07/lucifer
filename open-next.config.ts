import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// OpenNext Cloudflare adapter config. Empty default is correct for this app:
// the POS is almost entirely dynamic (orders/POS are never statically cached),
// so no R2/KV incremental cache is needed. Add an `incrementalCache` here later
// only if static/ISR pages are introduced.
export default defineCloudflareConfig({});
