## Goal

Rename the app to **Lucifer Cafe** (done) and move all data (menu, categories, customers, staff, orders, reservations, events) from browser `localStorage` into Lovable Cloud so it persists across refresh, deploy, logout, and devices, with realtime sync and error handling.

## Decisions (chosen for you)

- **Auth:** Login required, **shared cafe data** — every signed-in staff member sees and edits the same cafe. Email/password + Google sign-in.
- **Existing data:** **Auto-migrate** the current `localStorage` contents into the database on the first login after Cloud is enabled, then switch to Cloud as the source of truth.
- **Realtime:** Supabase Postgres Changes subscriptions on each table — edits from one device appear instantly on others.
- **Error handling:** Optimistic updates with rollback + toast on failure; offline writes queued in memory and retried.

## Scope of changes

1. **Enable Lovable Cloud** and create 7 tables with RLS:
   `products`, `categories`, `customers`, `staff`, `orders` (items as JSONB), `reservations`, `events`.
   Policy: any authenticated user can read/write all rows (shared cafe).
2. **Auth gate:** wrap all existing routes under `_authenticated/`, add `/auth` page (email/password + Google). `/auth` callback handled by integration.
3. **Replace `useLocal(...)` hooks** in `src/lib/storage.ts` with `useCloud(...)` hooks backed by Supabase + TanStack Query + realtime channel. Same return shape `[state, update, hydrated]` so route files need minimal changes.
4. **One-time migration:** on first sign-in, if a table is empty and `localStorage` has data, bulk-insert it and mark a `cafe.migrated` flag.
5. **Header/sidebar:** show signed-in user + Sign-out button (proper cache teardown).
6. **Keep current UI/UX** — POS, orders, customers, reports, table-no, payment colors, due tracking all unchanged behaviorally.

## Technical notes

- Tables get standard GRANTs (`authenticated`: SELECT/INSERT/UPDATE/DELETE, `service_role`: ALL) and RLS policies `USING (auth.uid() IS NOT NULL)`.
- `orders.items` stored as `jsonb` to preserve current `OrderItem[]` shape without a join table.
- Realtime via `supabase.channel('public:<table>').on('postgres_changes', ...)` invalidating the relevant React Query cache key.
- Writes go through small wrapper: optimistic cache update → `upsert` → on error, rollback + `toast.error`.
- Google sign-in uses the Lovable broker (`lovable.auth.signInWithOAuth('google', ...)`); `configure_social_auth` enables Google in Supabase Auth in the same step.
- Auth-protected routes live under `src/routes/_authenticated/` using the integration-managed layout (`ssr: false`).

## Out of scope

- Per-user roles/permissions (every signed-in user is treated as staff).
- Image upload to Cloud Storage — product images stay as data URLs for now.
- Multi-tenant (per-owner) data isolation.

Approve and I'll enable Cloud and ship it.