---
name: current-architecture
description: Current tech stack, data flow, and deployment for Lucifer Cafe POS
metadata:
  type: project
---

# Current Architecture

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19.2.0 + TanStack Start 1.167 |
| Routing | TanStack Router (file-based, src/routes/) |
| State / Server State | TanStack Query 5.83 |
| Database | Supabase PostgreSQL (single `app_kv` table) |
| Auth | Supabase Auth (email/password + Google OAuth planned) |
| UI | shadcn/ui (new-york style) + Tailwind CSS 4 |
| Icons | lucide-react |
| Charts | recharts |
| Forms | react-hook-form + zod |
| Build | Vite 7 + @lovable.dev/vite-tanstack-config |
| Runtime | Cloudflare Workers (via Wrangler) |
| Dev tooling | TypeScript 5.8, ESLint 9, Prettier 3 |

## Data Flow (Current)

```
User action
  → useLocal() hook (src/lib/storage.ts)
    → Optimistic update to React state
    → Supabase upsert to app_kv table (key = "cafe.products", value = JSON[])
    → Realtime subscription invalidates other clients
  → Fallback: localStorage when not logged in
```

## Database Schema (Current)

```sql
CREATE TABLE public.app_kv (
  key TEXT PRIMARY KEY,        -- e.g. "cafe.products"
  value JSONB NOT NULL,        -- entire array as JSON blob
  updated_at TIMESTAMPTZ,
  updated_by UUID
);
```

Keys stored: `cafe.products`, `cafe.categories`, `cafe.customers`, `cafe.orders`,
`cafe.reservations`, `cafe.events`, `cafe.staff`, `cafe.tableStatus`

## Key Source Files

| File | Role |
|------|------|
| `src/lib/storage.ts` | ALL data types + hooks — the entire data layer |
| `src/routes/pos.tsx` | POS terminal — largest file (~40KB) |
| `src/routes/orders.tsx` | Order browser (~26KB) |
| `src/routes/__root.tsx` | Root layout, auth guard, sidebar |
| `src/routes/auth.tsx` | Login/signup page |
| `src/integrations/supabase/client.ts` | Supabase client |
| `src/router.tsx` | TanStack Router setup |

## Deployment

- Cloudflare Workers via Wrangler (`wrangler.jsonc`)
- SSR-ready (TanStack Start server entry)
- GitHub: `https://github.com/KartikDesai07/lucifer.git`

**Why:** This context matters for migration — we're replacing Supabase with MongoDB+Express but keeping the Cloudflare/Vite/React layer.
